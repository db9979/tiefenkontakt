import {
  createConvoy,
  createShip,
  createWorld,
  installWeapons,
  type PlayerSlot,
  type Ship,
  type World,
} from '@tk/shared';

export interface ScenarioSettings {
  layerDepth: number;
  seaState: number;
  timeLimitMin: number;
  merchants: number;
}

export const DEFAULT_SETTINGS: ScenarioSettings = { layerDepth: 120, seaState: 3, timeLimitMin: 40, merchants: 8 };

/** Convoy route length: sized so a 9 kn convoy needs most of the time limit. */
export function routeLength(s: ScenarioSettings): number {
  return 9 * 0.514444 * s.timeLimitMin * 60 * 0.85;
}

/**
 * "Grönland-Lücke": the convoy steams north from the origin.
 * Escorts screen ahead, submarines lurk 40-70 % up the route.
 */
export function buildScenario(slots: PlayerSlot[], settings: ScenarioSettings, seed: number): World {
  const ships: Ship[] = [];
  const route = routeLength(settings);
  const merchants: Ship[] = [];
  for (let i = 0; i < settings.merchants; i++) {
    const m = createShip({
      id: `m${i + 1}`, cls: 'merchant', name: `Frachter ${i + 1}`,
      pos: { x: ((i % 3) - 1) * 900, y: -Math.floor(i / 3) * 900 }, heading: 0, speedKn: 9,
    });
    merchants.push(m);
    ships.push(m);
  }

  const west = slots.filter((s) => s.team === 'west');
  const east = slots.filter((s) => s.team === 'east');
  west.forEach((p, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * (2500 + Math.floor(i / 2) * 1500);
    ships.push(createShip({
      id: `p_${p.playerId}`, cls: p.cls, name: p.callsign, team: 'west', playerId: p.playerId,
      pos: { x, y: 2500 }, heading: 0, speedKn: 12,
    }));
  });
  east.forEach((p, i) => {
    const frac = 0.4 + ((i * 0.37) % 0.3);
    const x = (i % 2 === 0 ? 1 : -1) * (3000 + i * 1200);
    ships.push(createShip({
      id: `p_${p.playerId}`, cls: p.cls, name: p.callsign, team: 'east', playerId: p.playerId,
      pos: { x, y: route * frac }, heading: 180, speedKn: 4, depth: 80,
    }));
  });

  const w = createWorld(ships, seed, { layerDepth: settings.layerDepth, layerLoss: 12, seaState: settings.seaState });
  w.convoy = createConvoy(merchants, [{ x: 0, y: route * 0.5 }, { x: 0, y: route }], 9);
  installWeapons(w);
  return w;
}
