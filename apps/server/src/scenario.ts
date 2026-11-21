import {
  createConvoy,
  createShip,
  createWorld,
  installAir,
  installWeapons,
  type PlayerSlot,
  type Ship,
  type World,
  daylight,
  CLASSES,
  depthAt,
  initWeather,
  type SeabedKind,
} from '@tk/shared';
import type { LessonId } from './lessons.js';

export type MissionId = 'groenland' | 'schelf' | 'fjord' | 'duell' | 'hafen' | 'eigene';
export type TimeOfDay = 'tag' | 'daemmerung' | 'nacht';

export const MISSIONS: Record<MissionId, { title: string; info: string; seabed: SeabedKind; subSpread: number }> = {
  groenland: { title: 'Grönland-Lücke', info: 'Tiefes Wasser, Konvergenzzonen, ausgeprägte Sprungschicht', seabed: 'tief', subSpread: 4000 },
  schelf: { title: 'Schelfmeer', info: 'Flach (110–270 m): schwache Schicht, Nachhall, wenig Tauchtiefe', seabed: 'schelf', subSpread: 4000 },
  fjord: { title: 'Fjordausfahrt', info: 'Enger Kanal zwischen Untiefen; wer ihn verlässt, läuft auf', seabed: 'fjord', subSpread: 2200 },
  duell: { title: 'U-Boot-Duell', info: 'U-Boote gegen U-Boote, kein Konvoi: wer zuerst hört, gewinnt', seabed: 'tief', subSpread: 3000 },
  hafen: { title: 'Hafenangriff', info: 'Frachter ankern in einer Bucht, die Eskorte bewacht die Einfahrt', seabed: 'fjord', subSpread: 2000 },
  eigene: { title: 'Eigene Mission', info: 'Konvoigröße, Fahrt, Meeresboden und Abstand frei wählbar', seabed: 'tief', subSpread: 4000 },
};

/** Parameters of the custom mission (lobby "Eigene Mission"). */
export interface CustomMission {
  convoyKn: number;
  seabed: SeabedKind;
  /** Distance of the submarines up the route (0.2..0.9). */
  subFrac: number;
}

export const DEFAULT_CUSTOM: CustomMission = { convoyKn: 9, seabed: 'tief', subFrac: 0.5 };

/** Classes a team may pick in a mission: in the duel both sides fight with submarines. */
export function allowedClasses(mission: MissionId, team: 'west' | 'east'): ('ffg' | 'ssn' | 'ssk')[] {
  if (mission === 'duell') return ['ssn', 'ssk'];
  return team === 'west' ? ['ffg'] : ['ssk', 'ssn'];
}

export const LIGHT: Record<TimeOfDay, number> = { tag: 1, daemmerung: 0.5, nacht: 0.12 };
/** Start hour per time of day: the clock then runs with the match. */
export const START_HOUR: Record<TimeOfDay, number> = { tag: 10, daemmerung: 18.5, nacht: 23 };

export interface ScenarioSettings {
  mission: MissionId;
  timeOfDay: TimeOfDay;
  /** Sim seconds per real second. Gives room to hunt within a playable real-time match. */
  timeScale: number;
  layerDepth: number;
  seaState: number;
  timeLimitMin: number;
  merchants: number;
  /** Fill a team without players with AI captains. */
  fillBots: boolean;
  botSkill: 'leicht' | 'normal' | 'schwer';
  weather: 'wechselhaft' | 'stabil';
  custom?: CustomMission;
  /** Training lesson instead of the convoy battle. */
  lesson?: LessonId;
}

/** layerDepth 0 = random per match (80-170 m); nobody knows it until measured. */
export const DEFAULT_SETTINGS: ScenarioSettings = { mission: 'groenland', timeOfDay: 'tag', timeScale: 3, layerDepth: 0, seaState: 3, timeLimitMin: 40, merchants: 8, fillBots: true, botSkill: 'normal', weather: 'wechselhaft' };

/** Convoy route length: sized so a 9 kn convoy needs most of the time limit. */
export function routeLength(s: ScenarioSettings): number {
  return 9 * 0.514444 * simTimeLimit(s) * 0.85;
}

/** Match time limit in sim seconds. */
export function simTimeLimit(s: ScenarioSettings): number {
  return s.timeLimitMin * 60 * s.timeScale;
}

/**
 * "Grönland-Lücke": the convoy steams north from the origin.
 * Escorts screen ahead, submarines lurk 40-70 % up the route.
 */
export function buildScenario(slots: PlayerSlot[], settings: ScenarioSettings, seed: number): World {
  const ships: Ship[] = [];
  const mission = settings.mission;
  const custom = mission === 'eigene' ? { ...DEFAULT_CUSTOM, ...settings.custom } : undefined;
  const route = routeLength(settings);
  const merchants: Ship[] = [];
  const nMerchants = mission === 'duell' ? 0 : settings.merchants;
  const convoyKn = custom?.convoyKn ?? 9;
  for (let i = 0; i < nMerchants; i++) {
    const anchored = mission === 'hafen';
    const m = createShip({
      id: `m${i + 1}`, cls: 'merchant', name: `Frachter ${i + 1}`,
      pos: anchored ? { x: ((i % 4) - 1.5) * 600, y: 3000 + Math.floor(i / 4) * 700 } : { x: ((i % 3) - 1) * 900, y: -Math.floor(i / 3) * 900 },
      heading: 0, speedKn: anchored ? 0 : convoyKn,
    });
    merchants.push(m);
    ships.push(m);
  }

  const west = slots.filter((s) => s.team === 'west' && !s.crewOf);
  const east = slots.filter((s) => s.team === 'east' && !s.crewOf);
  west.forEach((p, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * (2500 + Math.floor(i / 2) * 1500);
    const sub = CLASSES[p.cls].submarine;
    ships.push(createShip({
      id: `p_${p.playerId}`, cls: p.cls, name: p.callsign, team: 'west', playerId: p.playerId,
      pos: { x, y: mission === 'hafen' ? 6500 : 2500 }, heading: 0, speedKn: sub ? 5 : mission === 'hafen' ? 8 : 12, depth: sub ? 80 : undefined,
    }));
  });
  east.forEach((p, i) => {
    const frac = custom ? custom.subFrac : mission === 'hafen' ? 0.9 : 0.45 + ((i * 0.37) % 0.3);
    const spread = MISSIONS[mission].subSpread;
    const x = (i % 2 === 0 ? 1 : -1) * (spread + (i * spread) / 2);
    const y = mission === 'duell' ? 25_000 : mission === 'hafen' ? Math.min(route * frac, 22_000) : route * frac;
    ships.push(createShip({
      id: `p_${p.playerId}`, cls: p.cls, name: p.callsign, team: 'east', playerId: p.playerId,
      pos: { x, y }, heading: 180, speedKn: 4, depth: 80,
    }));
  });

  const layer = settings.layerDepth > 0 ? settings.layerDepth : 80 + ((seed * 7919) % 91);
  const w = createWorld(ships, seed, {
    layerDepth: layer, layerLoss: 12, seaState: settings.seaState,
    seabed: { kind: custom?.seabed ?? MISSIONS[mission].seabed, seed }, light: LIGHT[settings.timeOfDay],
  });
  w.env.weather = initWeather(w.env, START_HOUR[settings.timeOfDay], settings.weather !== 'stabil');
  w.env.light = daylight(START_HOUR[settings.timeOfDay]);
  // Subs start safely above the bottom in shallow missions
  for (const s of ships) {
    if (s.depth > 10 && s.cls !== 'merchant') {
      const bottom = depthAt(w.env.seabed, s.pos.x, s.pos.y);
      s.depth = s.order.depth = Math.max(18, Math.min(s.depth, bottom - 30));
    }
  }
  if (merchants.length && mission !== 'hafen') w.convoy = createConvoy(merchants, [{ x: 0, y: route * 0.5 }, { x: 0, y: route }], convoyKn);
  installWeapons(w);
  installAir(w);
  return w;
}
