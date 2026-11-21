import { distance, headingVec, ownPosAt, type Snapshot, type Vec2 } from '@tk/shared';
import { store } from '../store.js';

type Contact = Snapshot['contacts'][number];

/** Position of the latest ranged measurement (own ping, dipping sonar, radar, periscope), from where it was taken. */
export function lastFix(c: Contact, s: Snapshot, maxAgeS = 90): { pos: Vec2; t: number } | undefined {
  const h = [...c.history].reverse().find((x) => x.r !== undefined);
  if (!h || h.r === undefined || s.time - h.t > maxAgeS) return undefined;
  const origin = h.ox !== undefined && h.oy !== undefined ? { x: h.ox, y: h.oy } : ownPosAt(store.ownTrack, h.t) ?? s.own;
  const v = headingVec(h.b);
  return { pos: { x: origin.x + v.x * h.r, y: origin.y + v.y * h.r }, t: h.t };
}

/** Range from the own ship to the latest fix. */
export function fixRange(c: Contact, s: Snapshot): number | undefined {
  const f = lastFix(c, s);
  return f ? distance(s.own, f.pos) : undefined;
}
