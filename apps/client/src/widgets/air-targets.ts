import type { Snapshot } from '@tk/shared';
import type { PeriscopeTarget } from './periscope3d.js';

/**
 * Aircraft the own eyes can see right now, as 3D targets (bridge lookout, periscope).
 * Positions come with the snapshot (1 Hz from the server); they are moved on along their
 * course to the current frame so fast jets glide instead of jumping.
 */
export function planeTargets(s: Snapshot, me: { x: number; y: number }, simNow: number): PeriscopeTarget[] {
  const out: PeriscopeTarget[] = [];
  const dt = Math.max(0, Math.min(3, simNow - s.time));
  for (const p of s.planes ?? []) {
    if (!p.via.includes('visual') || p.x === undefined || p.y === undefined) continue;
    const h = ((p.heading ?? 0) * Math.PI) / 180;
    const v = (p.speedKn ?? 0) * 0.5144 * dt;
    const x = p.x + Math.sin(h) * v - me.x;
    const y = p.y + Math.cos(h) * v - me.y;
    const range = Math.hypot(x, y);
    if (range < 30) continue;
    out.push({
      label: p.id, cls: 'merchant', plane: p.kind, alt: p.alt, bearing: (Math.atan2(x, y) * 180) / Math.PI, range,
      course: p.heading, speedKn: p.speedKn, alpha: 1, lit: p.lit,
    });
  }
  return out;
}
