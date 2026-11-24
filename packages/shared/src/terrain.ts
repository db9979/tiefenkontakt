import type { Vec2 } from './math.js';
import { depthAt, type SeabedSpec } from './seabed.js';

/**
 * What lies between two points on the real chart: the shallowest water, the highest land and
 * how far the path runs over land. Sound cannot cross a headland or island, it squeezes over a
 * sill only near the top; radar, eyes and radar warners need a clear line over the land.
 */

export interface Profile {
  /** Shallowest water along the path (m, negative over land). */
  minDepth: number;
  /** Highest land along the path above sea level (m, 0 when all water). */
  maxLand: number;
  /** Metres of the path over land. */
  landM: number;
  /** Land samples: fraction along the path and height (for the line of sight). */
  hills: [number, number][];
}

const STEP_M = 350;
const MAX_SAMPLES = 64;
const CACHE_Q = 150;
const cache = new Map<string, Profile>();

/** Profile of the straight path a–b (cached on a coarse grid: positions move little per sweep). */
// TK_NO_TERRAIN=1 switches the land checks off (A/B balance runs in scripts/bot-arena.ts)
const OFF = !!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TK_NO_TERRAIN;

export function profile(spec: SeabedSpec | undefined, a: Vec2, b: Vec2): Profile {
  if (!spec || OFF) return { minDepth: 3000, maxLand: 0, landM: 0, hills: [] };
  const q = (v: number) => Math.round(v / CACHE_Q);
  const key = `${spec.seed}|${spec.region ?? spec.kind}|${q(a.x)},${q(a.y)}|${q(b.x)},${q(b.y)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil(len / STEP_M)));
  let minDepth = Infinity, maxLand = 0, land = 0;
  const hills: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const d = depthAt(spec, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (d < minDepth) minDepth = d;
    if (d < 0) {
      land++;
      maxLand = Math.max(maxLand, -d);
      if (i > 0 && i < n) hills.push([t, -d]);
    }
  }
  const p: Profile = { minDepth, maxLand, landM: (land / (n + 1)) * len, hills };
  if (cache.size > 40_000) cache.clear();
  cache.set(key, p);
  return p;
}

/** Water depth for the sound path model: the shallowest water, never below a few metres. */
export function soundPathDepth(spec: SeabedSpec | undefined, a: Vec2, b: Vec2): number {
  return Math.max(5, profile(spec, a, b).minDepth);
}

/**
 * Extra loss (dB) for sound that has to cross land or a sill: land is a wall (40 dB and more
 * the wider it is); over a sill, sound from below its crest is cut by how far it has to rise.
 */
export function terrainLossDb(spec: SeabedSpec | undefined, a: Vec2, depthA: number, b: Vec2, depthB: number): number {
  const p = profile(spec, a, b);
  if (p.minDepth <= 0) return Math.min(80, 40 + p.landM / 100);
  const sill = p.minDepth;
  const under = Math.min(depthA, depthB) - sill;
  return under > 0 ? Math.min(18, 3 + under / 15) : 0;
}

/** Radio horizon drop (m) at d1, d2 from the ends with 4/3 earth radius. */
const drop = (d1: number, d2: number) => (d1 * d2) / (2 * 8_500_000);

/** Is the line from a (height hA) to b (height hB) clear of land, including earth curvature? */
export function lineOfSight(spec: SeabedSpec | undefined, a: Vec2, hA: number, b: Vec2, hB: number): boolean {
  const p = profile(spec, a, b);
  if (p.maxLand <= 0) return true;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  for (const [t, h] of p.hills) {
    const ray = hA + (hB - hA) * t - drop(t * len, (1 - t) * len);
    if (h > ray) return false;
  }
  return true;
}
