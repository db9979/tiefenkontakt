import { CLASSES } from './classes.js';
import { distance, type Vec2 } from './math.js';
import type { Team } from './classes.js';
import type { World } from './world.js';

/**
 * Moving haven: with a friendly submarine in the water, its side keeps a box around her free of
 * own anti-submarine weapons. No rocket, helicopter or aircraft torpedo and no depth charge goes
 * into the water within this distance of an own boat, whatever the contact looks like.
 */
export const HAVEN_M = 4000;

/** Why a weapon may not go in at p for this team (an own boat nearby), or undefined. */
export function havenBlocks(w: World, team: Team, p: Vec2): string | undefined {
  const boat = w.ships.find((s) => s.alive && s.team === team && CLASSES[s.cls].submarine && distance(s.pos, p) < HAVEN_M);
  return boat ? `Sperrgebiet: eigenes U-Boot ${boat.name} innerhalb ${HAVEN_M / 1000} km` : undefined;
}
