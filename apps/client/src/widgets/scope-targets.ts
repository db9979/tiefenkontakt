import { lookoutRanges, type Snapshot } from '@tk/shared';
import type { PeriscopeTarget } from './periscope3d.js';
import { planeTargets } from './air-targets.js';
import { moverNow, ownNow, simNow } from './smooth.js';

/** Visual contacts stay in the picture this long after the last sighting (s). */
export const SIGHT_HOLD = 8;

/**
 * What a surface ship's bridge can see: her own formation within visual range (extrapolated to
 * this frame), the lookouts' sightings, and aircraft. Shared by the bridge and the phone view.
 */
export function bridgeTargets(s: Snapshot): PeriscopeTarget[] {
  const env = { layerDepth: 0, layerLoss: 0, seaState: s.env.seaState, light: s.env.light, rain: s.env.rain };
  const reach = Math.max(4_000, lookoutRanges(env).surfaced * 1.8);
  const out: PeriscopeTarget[] = [];
  const me = ownNow();
  for (const f of s.friendlies) {
    if (f.id === s.own.id) continue;
    // A mate that sank: shown going down if she was in sight
    if (!f.alive) {
      out.push({ label: f.id, cls: f.cls, bearing: 0, range: 0, alpha: 0, sunk: true });
      continue;
    }
    const fp = s.time - f.reportedAt < 3 ? moverNow(f, f.reportedAt) : f;
    const dx = fp.x - me.x;
    const dy = fp.y - me.y;
    const r = Math.hypot(dx, dy);
    if (r > reach || r < 50) continue;
    out.push({ label: f.id, cls: f.cls, bearing: (Math.atan2(dx, dy) * 180) / Math.PI, range: r, course: f.heading, speedKn: f.speedKn, alpha: 1, lit: f.lit, wreck: f.wreck });
  }
  const now = simNow();
  for (const c of s.contacts) {
    if (!c.sighting || c.sightedAt === undefined || c.range === undefined) continue;
    const age = now - c.sightedAt;
    if (age > SIGHT_HOLD) continue;
    out.push({ label: c.label, cls: 'ssk', sighting: c.sighting, bearing: c.bearing, range: c.range, alpha: Math.min(1, (SIGHT_HOLD - age) / 2), speedKn: 6, course: c.bearing + 90 });
  }
  out.push(...planeTargets(s, me, now));
  return out;
}

/** What a periscope shows: contacts seen through it lately (plain bearing and range). */
export function periscopeTargets(s: Snapshot): PeriscopeTarget[] {
  const now = simNow();
  const out: PeriscopeTarget[] = [];
  for (const c of s.contacts) {
    if (!c.sensors.includes('periscope')) continue;
    const age = now - c.lastSeen;
    if (age > 6) continue;
    out.push({ label: c.label, cls: c.classified ?? 'merchant', bearing: c.bearing, range: c.range ?? 8000, alpha: Math.max(0, Math.min(1, 1 - (age - 2) / 4)), lit: c.lit, wreck: c.wreck });
  }
  out.push(...planeTargets(s, ownNow(), now));
  return out;
}
