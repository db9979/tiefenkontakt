import { createShip, createWorld, installAir, installBoats, installWeapons, type PlayerSlot, type World } from '@tk/shared';

/**
 * "Erste Feindfahrt": the guided beginner sortie. One lone freighter steams east
 * across the bow of the player's diesel boat; no escorts, no aircraft threat, calm sea,
 * daylight. The client walks the player through depth/helm, listening, a TMA leg, a
 * periscope look, the shot and evading afterwards.
 */

export const FIRST_PATROL_TARGET = 'm1';
/** Target track: from the west at this northing, eastbound. */
/** Close and fast enough that the bearing moves about 2°/min: a beginner's TMA converges within a few minutes. */
export const FIRST_PATROL_TRACK_Y = 4500;
export const FIRST_PATROL_TARGET_KN = 10;
/** Depth the boat must have reached after the hit for the lesson to count as evaded. */
export const EVADE_DEPTH = 60;
/** Hull points of the damaged straggler (a fresh freighter has 110). */
export const FIRST_PATROL_TARGET_HP = 70;

export function buildFirstPatrol(slot: PlayerSlot, seed: number): World {
  const target = createShip({
    id: FIRST_PATROL_TARGET, cls: 'merchant', name: 'Nachzügler',
    pos: { x: -7000, y: FIRST_PATROL_TRACK_Y }, heading: 90, speedKn: FIRST_PATROL_TARGET_KN,
  });
  // A straggler that already took damage: one heavyweight (80) sinks it, as the lesson's single shot expects
  target.hp = FIRST_PATROL_TARGET_HP;
  // Own boat shallow and a bit fast: the first steps are to go deeper and slow down
  const own = createShip({
    id: `p_${slot.playerId}`, cls: 'ssk', name: slot.callsign, team: 'east', playerId: slot.playerId,
    pos: { x: 0, y: 0 }, heading: 0, speedKn: 7, depth: 30,
  });
  const world = createWorld([target, own], seed, { layerDepth: 110, layerLoss: 12, seaState: 2, light: 1 });
  world.env.seed = seed;
  installWeapons(world);
  installAir(world);
  installBoats(world);
  return world;
}

/** Success once the freighter is sunk and the boat has gone deep again; otherwise at the time limit. */
export function firstPatrolResult(w: World, limitS: number): { winner: 'east'; reason: string } | undefined {
  const sunk = w.ships.some((s) => s.id === FIRST_PATROL_TARGET && !s.alive);
  const boat = w.ships.find((s) => s.team === 'east' && s.playerId);
  if (sunk && boat?.alive && boat.depth >= EVADE_DEPTH) return { winner: 'east', reason: 'Lektion geschafft: Ziel versenkt, Boot abgelaufen' };
  if (w.time >= limitS) return { winner: 'east', reason: 'Lektion beendet' };
  return undefined;
}
