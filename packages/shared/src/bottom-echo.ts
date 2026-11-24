import { REGIONS } from './regions.js';
import { depthAt, type SeabedSpec } from './seabed.js';

/**
 * Bottom features that answer an active ping like a target: rock pinnacles, seamount tops and
 * steep walls of the real seabed. In a fjord or over a bank one ping brings a dozen echoes,
 * only one of them a boat. They never move (no Doppler) and sit on the bottom: an operator who
 * checks the chart's depth at the echo, or waits for a second ping, sorts them out.
 */

export interface BottomFeature {
  id: string;
  x: number;
  y: number;
  /** Depth of the feature's top (m). */
  depth: number;
  /** Target strength (dB). */
  ts: number;
  kind: 'fels' | 'hang';
}

const STEP_M = 600;
const MAX_FEATURE_DEPTH = 700;
const cache = new Map<string, BottomFeature[]>();

/** All echoing features of a chart (computed once per sea area and seed). */
export function bottomFeatures(spec: SeabedSpec | undefined): BottomFeature[] {
  if (!spec?.region) return [];
  const key = `${spec.region}|${spec.seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const half = REGIONS[spec.region].half * 1000;
  const out: BottomFeature[] = [];
  for (let y = -half / 2; y <= half * 1.5; y += STEP_M) {
    for (let x = -half; x <= half; x += STEP_M) {
      const d = depthAt(spec, x, y);
      if (d < 15 || d > MAX_FEATURE_DEPTH) continue;
      const n = [depthAt(spec, x + STEP_M, y), depthAt(spec, x - STEP_M, y), depthAt(spec, x, y + STEP_M), depthAt(spec, x, y - STEP_M)];
      if (n.some((v) => v < 0)) continue;
      const avg = (n[0]! + n[1]! + n[2]! + n[3]!) / 4;
      const rise = avg - d;
      const slope = Math.hypot(n[0]! - n[1]!, n[2]! - n[3]!) / (2 * STEP_M);
      const ix = Math.round(x / STEP_M), iy = Math.round(y / STEP_M);
      if (rise > Math.max(25, 0.12 * d)) out.push({ id: `R${ix}_${iy}`, x, y, depth: d, ts: Math.min(20, 8 + rise / 15), kind: 'fels' });
      // Steep walls: one echo every third cell, the wall answers wherever the beam hits it square
      else if (slope > 0.2 && (ix + iy) % 3 === 0) out.push({ id: `R${ix}_${iy}`, x, y, depth: d, ts: 6 + Math.min(8, slope * 10), kind: 'hang' });
    }
  }
  if (cache.size > 30) cache.clear();
  cache.set(key, out);
  return out;
}
