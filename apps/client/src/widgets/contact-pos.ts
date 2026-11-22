import { distance, headingVec, ownPosAt, type Snapshot, type Vec2 } from '@tk/shared';
import { store } from '../store.js';

type Contact = Snapshot['contacts'][number];

/** Averaging window for ranged fixes (s): single measurements are noisy by design. */
const FIX_WINDOW_S = 60;

/**
 * Position from the recent ranged measurements (own ping, dipping sonar, radar, periscope,
 * lookout), each from where it was taken, averaged with more weight on the newest so the
 * symbol and the range readout hold still instead of jumping with every noisy sample.
 */
export function lastFix(c: Contact, s: Snapshot, maxAgeS = 90): { pos: Vec2; t: number } | undefined {
  const ranged = c.history.filter((x) => x.r !== undefined);
  const newest = ranged[ranged.length - 1];
  if (!newest || s.time - newest.t > maxAgeS) return undefined;
  let wx = 0, wy = 0, wsum = 0;
  for (let i = ranged.length - 1; i >= 0; i--) {
    const h = ranged[i]!;
    const age = newest.t - h.t;
    if (age > FIX_WINDOW_S) break;
    const origin = h.ox !== undefined && h.oy !== undefined ? { x: h.ox, y: h.oy } : ownPosAt(store.ownTrack, h.t) ?? s.own;
    const v = headingVec(h.b);
    const w = Math.exp(-age / 25);
    wx += (origin.x + v.x * h.r!) * w;
    wy += (origin.y + v.y * h.r!) * w;
    wsum += w;
  }
  return { pos: { x: wx / wsum, y: wy / wsum }, t: newest.t };
}

/** Range from the own ship to the latest fix. */
export function fixRange(c: Contact, s: Snapshot): number | undefined {
  const f = lastFix(c, s);
  return f ? distance(s.own, f.pos) : undefined;
}
