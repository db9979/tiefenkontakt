import { KN, angleDiff, headingVec, wrap360, type Vec2 } from '@tk/shared';
export { BearingRangeFilter, easeAngle } from '@tk/shared';
import { store } from '../store.js';

/**
 * Smooth rendering between 5-10 Hz snapshots: estimate the current sim time,
 * extrapolate moving things, and filter noisy measurements for display only.
 * Readouts keep showing the raw measurements.
 */

const MAX_LEAD_S = 1.5; // never extrapolate further than this (real seconds)

/** Sim time "now", advanced by real time since the last snapshot. */
export function simNow(): number {
  const s = store.snap;
  if (!s) return 0;
  const dt = Math.min(MAX_LEAD_S, (performance.now() - store.snapAt) / 1000);
  return s.time + dt * Math.max(1, s.timeScale);
}

/** Own ship position and heading extrapolated to now (turning toward the ordered course). */
export function ownNow(): { x: number; y: number; heading: number } {
  const s = store.snap;
  if (!s) return { x: 0, y: 0, heading: 0 };
  const dt = simNow() - s.time;
  const turn = angleDiff(s.own.heading, s.own.order.heading);
  const maxTurn = 1.5 * dt;
  const heading = wrap360(s.own.heading + Math.max(-maxTurn, Math.min(maxTurn, turn)));
  const v = headingVec(wrap360(s.own.heading + angleDiff(s.own.heading, heading) / 2));
  const d = s.own.speedKn * KN * dt;
  return { x: s.own.x + v.x * d, y: s.own.y + v.y * d, heading };
}

/** Extrapolate any reported mover (friendly, torpedo) by its course and speed. */
export function moverNow(p: { x: number; y: number; heading: number; speedKn?: number }, at: number): Vec2 {
  const dt = Math.max(0, simNow() - at);
  const v = headingVec(p.heading);
  const d = (p.speedKn ?? 0) * KN * dt;
  return { x: p.x + v.x * d, y: p.y + v.y * d };
}

