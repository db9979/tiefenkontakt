import {
  installBoats,
  createConvoy,
  createShip,
  createWorld,
  installAir,
  installWeapons,
  type PlayerSlot,
  type Ship,
  type World,
  SEASON_MONTH,
  lanesOf,
  lightFromSun,
  seaClimate,
  seaLayer,
  startHourFor,
  sunPosition,
  type Season,
  CLASSES,
  depthAt,
  initWeather,
  initMet,
  type SeabedKind,
  installIncidents,
  installOrders,
  mineSystem,
  type RegionId,
  KIND_REGION,
  REGIONS,
  areasFor,
  SEA_TIME_FACTOR,
} from '@tk/shared';
import { loadBathymetry } from './bathy-load.js';
import type { LessonId } from './lessons.js';
import { rollVariation, type LobbyChoice, type Variation } from './variation.js';

// The real sea areas' bathymetry, for every user of the scenarios (server, arena, tests)
loadBathymetry();

export type MissionId = 'groenland' | 'schelf' | 'fjord' | 'duell' | 'hafen' | 'eigene' | 'fuehlung' | 'meerenge' | 'aufklaerung';
/** Strait breakthrough: escorts guard the narrows here, the boats must get past this line. */
export const STRAIT_GUARD_Y = 7_000;
export const STRAIT_EXIT_Y = 16_500;
/** Harbour attack: where the boats start, about 16 km out from the anchorage (arena West:Ost - 18 km 23:7, 16 km 19:21, 14 km 10:20, 10 km 3:17; with terrain and seasons 16 km 2:4, 17 km 8:8, 18 km 14:6). */
export const HARBOUR_SUB_Y = 21_000;
/** Shadowing: minutes of held contact the pack needs. */
export const SHADOW_GOAL_S = 25 * 60;
/** Shadowing only counts within this distance of a convoy ship. */
export const SHADOW_RANGE_M = 12_000;

export type TimeOfDay = 'tag' | 'daemmerung' | 'nacht';

/**
 * subSpread: how far off the convoy route the boats wait (m); convoyKn: the convoy's speed
 * (default 9 kn); escortY: where the escorts start along the route (default 2500 m, ahead of
 * the columns). Balanced per mission with the bot arena (scripts/bot-arena.ts).
 */
export const MISSIONS: Record<MissionId, { title: string; info: string; seabed: SeabedKind; region: RegionId; subSpread: number; convoyKn?: number; escortY?: number }> = {
  groenland: { title: 'Grönland-Lücke', info: 'Färöer-Bank: aus dem tiefen Färöer-Bank-Kanal (700 m) auf die flache Bank (100–200 m), nur dort Minen', seabed: 'tief', region: 'faroebank', subSpread: 4000 },
  schelf: { title: 'Schelfmeer', info: 'Barentssee bei der Bäreninsel (120–240 m): schwache Schicht, Nachhall, wenig Tauchtiefe', seabed: 'schelf', region: 'barents', subSpread: 10_000 },
  // A slow convoy; in the wide real fjord the escorts screen ahead of it again (level with its head the boats won 9 in 10)
  fjord: { title: 'Fjordausfahrt', info: 'Vestfjord zwischen Lofoten und Festland (300–600 m); wer die Rinne verlässt, läuft auf', seabed: 'fjord', region: 'vestfjord', subSpread: 2500, convoyKn: 8, escortY: 4000 },
  duell: { title: 'U-Boot-Duell', info: 'Lofotenbecken (3000 m), kein Konvoi: wer zuerst hört, gewinnt', seabed: 'tief', region: 'lofotenbasin', subSpread: 3000 },
  hafen: { title: 'Hafenangriff', info: 'Kolabucht: Frachter ankern im engen Fjord vor Murmansk, die Eskorte bewacht die Einfahrt', seabed: 'fjord', region: 'kola', subSpread: 2000 },
  fuehlung: { title: 'Fühlung halten', info: 'Lofotenbecken, Waffen gesperrt: Kontakt zum Konvoi 25 Minuten aus höchstens 12 km halten', seabed: 'tief', region: 'lofotenbasin', subSpread: 4000 },
  meerenge: { title: 'Meerengen-Durchbruch', info: 'Straße von Gibraltar: die U-Boote müssen durch die bewachte Enge ins Mittelmeer', seabed: 'fjord', region: 'gibraltar', subSpread: 700 },
  aufklaerung: { title: 'Aufklärung', info: 'Barentssee: ein Geleitschiff im Sehrohr erkennen und per Funk melden', seabed: 'schelf', region: 'barents', subSpread: 4000 },
  eigene: { title: 'Eigene Mission', info: 'Konvoigröße, Fahrt, Meeresboden und Abstand frei wählbar', seabed: 'tief', region: 'lofotenbasin', subSpread: 4000 },
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
export type PlayableClass = 'ffg' | 'kor' | 'ffv' | 'ssn' | 'ssk' | 'ssc' | 'ssa' | 'ssw' | 'ffk';
/**
 * Mixed teams: the Westbund may send one hunter-killer boat in direct support of the convoy,
 * the Ostpakt one ASW patrol ship with its wolfpack. One such place per team at most.
 */
export const MIXED_CLASS = { west: 'ssw', east: 'ffk' } as const;
export const isMixedClass = (cls: string): boolean => cls === 'ssw' || cls === 'ffk';
export function allowedClasses(mission: MissionId, team: 'west' | 'east'): PlayableClass[] {
  if (mission === 'duell') return ['ssn', 'ssk', 'ssc', 'ssa', 'ssw'];
  return team === 'west' ? ['ffg', 'kor', 'ffv', 'ssw'] : ['ssk', 'ssn', 'ssc', 'ssa', 'ffk'];
}

export const LIGHT: Record<TimeOfDay, number> = { tag: 1, daemmerung: 0.5, nacht: 0.12 };
/** Start hour per time of day: the clock then runs with the match. */
export const START_HOUR: Record<TimeOfDay, number> = { tag: 10, daemmerung: 18.5, nacht: 23 };

export interface ScenarioSettings {
  mission: MissionId;
  /** Sea area (regions.ts); unset or unsuited = the mission's home area. */
  area?: RegionId;
  /** 'zufall' is rolled from the seed when the match starts (variation.ts). */
  timeOfDay: TimeOfDay | 'zufall';
  /** Sim seconds per real second. Gives room to hunt within a playable real-time match. */
  timeScale: number;
  layerDepth: number;
  seaState: number;
  timeLimitMin: number;
  merchants: number;
  /** Fill a team without players with AI captains. */
  fillBots: boolean;
  botSkill: 'leicht' | 'normal' | 'schwer';
  weather: 'wechselhaft' | 'stabil' | 'zufall';
  /** Season of the match: unset or zufall = a month drawn from the seed. */
  season?: Season | 'zufall';
  /** How much positions, route, speed and sea state vary per match (default leicht). */
  variation?: Variation;
  /** The lobby choices before 'zufall' and the sea-state roll were resolved (rematch). */
  asSet?: LobbyChoice;
  custom?: CustomMission;
  /** Training lesson instead of the convoy battle. */
  lesson?: LessonId;
  /** Invite-only: hidden from the match list and quick match. */
  private?: boolean;
  /** Training sandbox: truth view, time controls, spawning; no time limit. */
  sandbox?: boolean;
  /** A mission of a player's campaign run (ship state carried over). */
  campaign?: boolean;
  /** This match is the weekly situation of that ISO week (its result goes on the week's board). */
  weekly?: string;
}

/** layerDepth 0 = random per match (80-170 m); nobody knows it until measured. */
export const DEFAULT_SETTINGS: ScenarioSettings = { mission: 'groenland', timeOfDay: 'tag', timeScale: 1, layerDepth: 0, seaState: 3, timeLimitMin: 40, merchants: 8, fillBots: true, botSkill: 'normal', weather: 'wechselhaft', variation: 'leicht' };

/** Convoy route length: sized so a 9 kn convoy needs most of the time limit. */
export function routeLength(s: ScenarioSettings): number {
  return 9 * 0.514444 * s.timeLimitMin * 60 * SEA_TIME_FACTOR * 0.85;
}

/**
 * Grönland-Lücke: a shallow bank (150–250 m) crosses the convoy route about here (fraction of
 * the route), just short of the boats' waiting area (45–75 %): the convoy crosses it as the
 * boats close in. The only water shallow enough for mines. At 0.5 the boats waited on the
 * bank itself and the Ostpakt won two games in three; at 0.4 the arena is about even.
 */
export const GROENLAND_BANK_FRAC = 0.4;

/** Sandbox matches run without a time limit (the time scale changes while they run). */
export const SANDBOX_LIMIT_S = 1e9;

/** Match time limit in sim seconds: the same at sea for every time scale (only the real duration changes). */
export function simTimeLimit(s: ScenarioSettings): number {
  return s.sandbox ? SANDBOX_LIMIT_S : s.timeLimitMin * 60 * SEA_TIME_FACTOR;
}

/**
 * "Grönland-Lücke": the convoy steams north from the origin.
 * Escorts screen ahead, submarines lurk 40-70 % up the route.
 */
export function buildScenario(slots: PlayerSlot[], settings: ScenarioSettings, seed: number): World {
  const ships: Ship[] = [];
  const mission = settings.mission;
  const custom = mission === 'eigene' ? { ...DEFAULT_CUSTOM, ...settings.custom } : undefined;
  const v = rollVariation(settings, seed);
  const baseKn = custom?.convoyKn ?? MISSIONS[mission].convoyKn ?? 9;
  const convoyKn = baseKn + (mission === 'hafen' ? 0 : v.convoyKnDelta);
  // A faster or slower convoy gets a longer or shorter passage: the time under the boats stays the same
  const route = routeLength(settings) * (convoyKn / baseKn);
  const merchants: Ship[] = [];
  const nMerchants = mission === 'duell' || mission === 'meerenge' ? 0 : settings.merchants;
  const tod: TimeOfDay = settings.timeOfDay === 'zufall' ? 'tag' : settings.timeOfDay;
  const sp = v.spacing;
  for (let i = 0; i < nMerchants; i++) {
    const anchored = mission === 'hafen';
    const m = createShip({
      id: `m${i + 1}`, cls: 'merchant', name: `Frachter ${i + 1}`,
      pos: anchored ? { x: ((i % 4) - 1.5) * 600, y: 3000 + Math.floor(i / 4) * 700 } : { x: ((i % 3) - 1) * sp, y: -Math.floor(i / 3) * sp },
      heading: 0, speedKn: anchored ? 0 : convoyKn,
    });
    m.autoNav = true;
    merchants.push(m);
    ships.push(m);
  }

  const west = slots.filter((s) => s.team === 'west' && !s.crewOf);
  const east = slots.filter((s) => s.team === 'east' && !s.crewOf);
  west.forEach((p, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const x = v.escortX(i, side * (2500 + Math.floor(i / 2) * 1500));
    const sub = CLASSES[p.cls].submarine;
    ships.push(createShip({
      id: `p_${p.playerId}`, cls: p.cls, name: p.callsign, team: 'west', playerId: p.playerId,
      // Strait: the escorts guard the narrows halfway up the channel
      pos: { x: mission === 'meerenge' ? x * 0.5 : x, y: v.escortDy(i) + (mission === 'hafen' ? 6500 : mission === 'meerenge' ? STRAIT_GUARD_Y : MISSIONS[mission].escortY ?? 2500) }, heading: 0,
      speedKn: sub ? 5 : mission === 'hafen' || mission === 'meerenge' ? 8 : 12, depth: sub ? 80 : undefined,
    }));
  });
  east.forEach((p, i) => {
    const frac = custom ? custom.subFrac : mission === 'hafen' ? 0.9 : v.subFrac(i, 0.45 + ((i * 0.37) % 0.3));
    const spread = MISSIONS[mission].subSpread;
    const x = v.subX(i, (i % 2 === 0 ? 1 : -1) * (spread + (i * spread) / 2));
    const y = mission === 'duell' ? 25_000 + v.subDy(i) : mission === 'meerenge' ? -1500 - i * 800 + v.subDy(i) : mission === 'hafen' ? HARBOUR_SUB_Y + v.subDy(i) : route * frac;
    // The patrol ship steams ahead of the waiting boats toward the convoy, on the surface
    const surface = !CLASSES[p.cls].submarine;
    const ahead = mission === 'meerenge' ? 3000 : -4000;
    ships.push(createShip({
      id: `p_${p.playerId}`, cls: p.cls, name: p.callsign, team: 'east', playerId: p.playerId,
      pos: { x: surface ? x * 0.5 : x, y: surface ? y + ahead : y }, heading: mission === 'meerenge' ? 0 : 180,
      speedKn: surface ? 12 : 4, depth: surface ? undefined : 80,
    }));
  });

  // Sea area: the lobby's choice if the mission can be played there, else its home area
  const region: RegionId = settings.area && areasFor(mission).includes(settings.area) ? settings.area
    : custom ? KIND_REGION[custom.seabed] : MISSIONS[mission].region;
  // Month and the area's layering in that season (the lobby's fixed layer depth wins)
  const month = settings.season && settings.season !== 'zufall' ? SEASON_MONTH[settings.season] : 1 + (seed % 12);
  const sl = custom ? undefined : seaLayer(region, month, ((seed * 7919) % 1000) / 1000);
  const layer = settings.layerDepth > 0 ? settings.layerDepth : sl ? sl.depth : 80 + ((seed * 7919) % 91);
  const w = createWorld(ships, seed, {
    layerDepth: layer, layerLoss: settings.layerDepth > 0 || !sl ? 12 : sl.loss, seaState: settings.seaState,
    seabed: {
      kind: regionSeabed(region), seed, region,
      ...(mission === 'groenland' ? { bankY: route * GROENLAND_BANK_FRAC } : {}),
    }, light: LIGHT[tod],
  });
  w.env.seed = seed;
  w.env.mission = mission;
  w.env.month = month;
  // Lay the area's shipping lanes over the chart once (cached), before traffic spawns on them
  lanesOf(region);
  w.env.lat = REGIONS[region].lat;
  // Where the tide stands at the start: any hour of the 12-hour cycle
  w.env.tidePhase = ((seed * 2654435761) % 1000) / 1000 * Math.PI * 2;
  if (mission === 'fuehlung') {
    w.env.weaponsTight = 'east';
    w.env.shadowS = 0;
  }
  if (mission === 'meerenge') w.env.exitY = STRAIT_EXIT_Y;
  // The light by the sun over the real area: noon, dusk or the darkest hour of that day
  const hour = startHourFor(w.env.lat, month, tod);
  w.env.weather = initWeather(w.env, hour, settings.weather !== 'stabil');
  w.env.light = lightFromSun(sunPosition(w.env.lat, month, hour).el);
  // Fog and ice as the area has them in that season
  const clim = seaClimate(region, month);
  w.env.met = initMet(ships, seed, { dynamic: settings.weather !== 'stabil', ice: mission === 'groenland' || clim.ice, fogBanks: mission === 'groenland' ? 3 : Math.max(clim.fogBanks, seed % 2) });
  // AI crews steer clear of shoals on their own (players get the navigator's warnings)
  for (const p of [...west, ...east]) if (p.bot) { const sh = ships.find((x) => x.playerId === p.playerId); if (sh) sh.autoNav = true; }
  // On the real coasts a start position may fall on land or in the shallows: move it to the nearest water deep enough
  for (const s of ships) s.pos = toWater(w.env.seabed, s.pos, CLASSES[s.cls].submarine ? 45 : s.cls === 'merchant' ? 14 : 10);
  // Subs start safely above the bottom in shallow missions
  for (const s of ships) {
    if (s.depth > 10 && s.cls !== 'merchant') {
      const bottom = depthAt(w.env.seabed, s.pos.x, s.pos.y);
      s.depth = s.order.depth = Math.max(18, Math.min(s.depth, bottom - 30));
    }
  }
  if (merchants.length && mission !== 'hafen') w.convoy = createConvoy(merchants, v.waypoints(route), convoyKn, sp);
  installWeapons(w);
  w.systems.push(mineSystem);
  installAir(w);
  installBoats(w);
  installIncidents(w);
  installOrders(w, simTimeLimit(settings));
  return w;
}

/** The nearest point to `p` (searched in rings out to 12 km) with at least `need` metres of water. */
export function toWater(spec: World['env']['seabed'], p: { x: number; y: number }, need: number): { x: number; y: number } {
  if (depthAt(spec, p.x, p.y) >= need) return p;
  for (let r = 150; r <= 12_000; r += 150) {
    const n = Math.max(8, Math.round(r / 120));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
      if (depthAt(spec, q.x, q.y) >= need) return q;
    }
  }
  return p;
}

/** Procedural stand-in for a sea area until its grid is loaded (and for traffic and air mix). */
export function regionSeabed(id: RegionId): SeabedKind {
  const k = REGIONS[id].kind;
  return k === 'open' ? 'tief' : k === 'schelf' ? 'schelf' : 'fjord';
}
