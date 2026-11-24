import { CLASSES } from './classes.js';
import type { Ship } from './entities.js';
import { KN, angleDiff, headingVec, wrap360, type Vec2 } from './math.js';
import { depthAt } from './seabed.js';
import type { World } from './world.js';

/**
 * Keeping off the rocks. Ships without a player (convoy, neutrals, AI crews: `autoNav`) turn
 * away early when their course runs into water too shallow for them, toward the side with the
 * most open water; a player's navigator reports shoals ahead instead, and the player steers.
 * Running aground itself is in world.ts (checkGround).
 */

/** Water a ship needs under her keel to pass (m): a submarine also wants room below her depth. */
export function waterNeeded(s: Ship): number {
  const c = CLASSES[s.cls];
  return c.submarine ? Math.max(25, s.depth + 15) : c.draft + 6;
}

/** Distance (m) along `heading` to the first water shallower than `need`, up to `look`; Infinity if clear. */
export function shoalAhead(w: World, p: Vec2, heading: number, need: number, look: number): number {
  if (!w.env.seabed) return Infinity;
  const v = headingVec(heading);
  const step = Math.max(100, Math.min(400, look / 12));
  for (let d = step; d <= look; d += step) if (depthAt(w.env.seabed, p.x + v.x * d, p.y + v.y * d) < need) return d;
  return Infinity;
}

/** How far ahead to look: about two minutes' steaming, at least 1.2 km. */
const lookFor = (s: Ship) => Math.max(1200, (s.speed / KN) * KN * 120);

const navHold = new WeakMap<Ship, { until: number; heading: number }>();

/** Auto-pilot for crews without a player: hold off shoals and land. */
export function keepOffShoals(w: World, s: Ship): void {
  if (!s.alive || !w.env.seabed || s.speed < 0.3) return;
  const need = waterNeeded(s);
  const look = lookFor(s);
  const hold = navHold.get(s);
  if (hold && w.time < hold.until) {
    s.order.heading = hold.heading;
    return;
  }
  if (shoalAhead(w, s.pos, s.order.heading, need, look) === Infinity && shoalAhead(w, s.pos, s.heading, need, look * 0.6) === Infinity) return;
  // Try courses ever further off the ordered one; take the clearest, the nearer one when equal
  let best = s.order.heading;
  let bestRange = -1;
  for (let k = 1; k <= 9; k++) {
    for (const sign of [1, -1]) {
      const h = wrap360(s.order.heading + sign * k * 20);
      const r = Math.min(look * 1.5, shoalAhead(w, s.pos, h, need, look * 1.5));
      if (r > bestRange + 50) {
        bestRange = r;
        best = h;
      }
    }
    if (bestRange >= look * 1.5) break;
  }
  s.order.heading = best;
  navHold.set(s, { until: w.time + 40, heading: best });
}

const warned = new WeakMap<Ship, number>();

/** A player's ship heading into shoals: the navigator reports it (at most every 45 s). */
export function shoalWarning(w: World, s: Ship): void {
  if (!s.alive || !w.env.seabed || s.speed < 0.5) return;
  if (w.time - (warned.get(s) ?? -1e9) < 45) return;
  const r = shoalAhead(w, s.pos, s.heading, waterNeeded(s), lookFor(s));
  if (r === Infinity) return;
  warned.set(s, w.time);
  const sub = CLASSES[s.cls].submarine;
  const km = (r / 1000).toFixed(1).replace('.', ',');
  const ahead = Math.abs(angleDiff(s.heading, s.order.heading)) > 30 ? ' (Ruder liegt schon)' : ' – Kurs ändern!';
  w.events.push({
    kind: 'boat', time: w.time, shipId: s.id, what: 'shoal',
    text: sub ? `Navigator: zu wenig Wasser unter dem Kiel in ${km} km${ahead}` : `Navigator: Untiefe voraus in ${km} km${ahead}`,
  });
}
