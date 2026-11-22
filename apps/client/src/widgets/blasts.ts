import { angleDiff, type Snapshot } from '@tk/shared';
import type { PeriscopeEffect } from './periscope3d.js';

/**
 * Explosions for the 3D views (periscope, bridge): every hit alert of the last twelve minutes
 * (the oil stays that long), placed at the nearest ship seen on that bearing and pinned to the
 * world where it was first seen. Sinking reports mark the ship to go down; a sinking that
 * follows an earlier hit adds no new detonation.
 */
const blastSeen = new Map<string, { ms: number; x: number; y: number }>();
export function blasts(s: Snapshot, vis: { bearing: number; range: number }[], nowMs: number): PeriscopeEffect[] {
  const out: PeriscopeEffect[] = [];
  for (const a of s.alerts) {
    if (a.kind !== 'hit' || a.bearing === undefined || s.time - a.time > 720) continue;
    const id = `${a.time}|${a.bearing}`;
    const near = vis.filter((c) => Math.abs(angleDiff(c.bearing, a.bearing!)) < 5).sort((x, y) => Math.abs(angleDiff(x.bearing, a.bearing!)) - Math.abs(angleDiff(y.bearing, a.bearing!)))[0];
    const range = near?.range ?? 6000;
    // Fixed in the world where it was first seen, so it stays put while the boat moves on
    let b = blastSeen.get(id);
    if (!b) {
      const rad = (a.bearing * Math.PI) / 180;
      // A hit first seen long after it happened is not shown as a fresh detonation
      const late = Math.max(0, (s.time - a.time) / (s.timeScale || 1) - 3);
      b = { ms: nowMs - late * 1000, x: s.own.x + Math.sin(rad) * range, y: s.own.y + Math.cos(rad) * range };
      blastSeen.set(id, b);
    }
    out.push({ id, bearing: a.bearing, range, age: (nowMs - b.ms) / 1000, x: b.x, y: b.y, sinks: a.sink || /SINKGERÄUSCHE/.test(a.text), quiet: a.sink });
  }
  return out;
}

