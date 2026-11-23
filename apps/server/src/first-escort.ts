import { createConvoy, createShip, createWorld, installAir, installBoats, installWeapons, type PlayerSlot, type Ship, type World } from '@tk/shared';

/**
 * "Erste Geleitfahrt": the guided beginner escort sortie. The player's frigate screens a
 * small eastbound convoy; one diesel boat comes the other way, deep under the layer and
 * on a steady course. It has no captain (no torpedoes, no evasion): a target that a
 * beginner can find with the towed array and a sonobuoy, range with a ping and hit with
 * one ASW rocket. Calm sea, daylight.
 */

export const FIRST_ESCORT_SUB = 'p_bot-geleit';
/** Convoy track (northing) and speed; it steams east. */
export const FIRST_ESCORT_TRACK_Y = 0;
export const FIRST_ESCORT_CONVOY_KN = 8;
/** The boat starts this far ahead of the frigate (m, east) and a little north of the track. */
export const FIRST_ESCORT_SUB_START = { x: 8000, y: 9000 };
export const FIRST_ESCORT_SUB_HEADING = 200;
export const FIRST_ESCORT_SUB_KN = 10;
export const FIRST_ESCORT_SUB_DEPTH = 150;
/** Hull points of the boat: it already took damage, one lightweight torpedo (55) sinks it. */
export const FIRST_ESCORT_SUB_HP = 50;

export function buildFirstEscort(slot: PlayerSlot, seed: number): World {
  const merchants: Ship[] = [];
  for (let i = 0; i < 3; i++) {
    merchants.push(createShip({
      id: `m${i + 1}`, cls: 'merchant', name: `Frachter ${i + 1}`,
      pos: { x: -3000 + (i % 2) * 900, y: FIRST_ESCORT_TRACK_Y + (i - 1) * 900 }, heading: 90, speedKn: FIRST_ESCORT_CONVOY_KN,
    }));
  }
  // The frigate screens ahead of the convoy, a bit fast for the array: the first step slows it down
  const own = createShip({
    id: `p_${slot.playerId}`, cls: 'ffg', name: slot.callsign, team: 'west', playerId: slot.playerId,
    pos: { x: 0, y: FIRST_ESCORT_TRACK_Y }, heading: 90, speedKn: 20,
  });
  const sub = createShip({
    id: FIRST_ESCORT_SUB, cls: 'ssk', name: 'Übungs-U-Boot', team: 'east',
    pos: { ...FIRST_ESCORT_SUB_START }, heading: FIRST_ESCORT_SUB_HEADING, speedKn: FIRST_ESCORT_SUB_KN, depth: FIRST_ESCORT_SUB_DEPTH,
  });
  sub.hp = FIRST_ESCORT_SUB_HP;
  const world = createWorld([...merchants, own, sub], seed, { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 });
  world.env.seed = seed;
  world.convoy = createConvoy(merchants, [{ x: 60_000, y: FIRST_ESCORT_TRACK_Y }], FIRST_ESCORT_CONVOY_KN);
  world.convoy.zigzag = false;
  installWeapons(world);
  installAir(world);
  installBoats(world);
  return world;
}

/** Success once the boat is sunk (or hit and breaking off); otherwise at the time limit. */
export function firstEscortResult(w: World, limitS: number): { winner: 'west'; reason: string } | undefined {
  const sub = w.ships.find((s) => s.id === FIRST_ESCORT_SUB);
  if (sub && !sub.alive) return { winner: 'west', reason: 'Lektion geschafft: U-Boot versenkt' };
  if (sub && sub.hp < FIRST_ESCORT_SUB_HP) return { winner: 'west', reason: 'Lektion geschafft: U-Boot getroffen und abgedrängt' };
  if (w.time >= limitS) return { winner: 'west', reason: 'Lektion beendet' };
  return undefined;
}
