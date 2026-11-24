import type { Vec2 } from './math.js';
import { gridDepth } from './bathymetry.js';
import type { RegionId } from './regions.js';

/**
 * Procedural seabed (deterministic from a seed, so server and client agree).
 * Depth in metres (positive = water depth); negative values are land.
 */

export type SeabedKind = 'tief' | 'schelf' | 'fjord';

export interface SeabedSpec {
  kind: SeabedKind;
  seed: number;
  /** Deep water only: a shallow bank (150–250 m) runs east–west across the map near this y (m). */
  bankY?: number;
  /** A real sea area (regions.ts): its bathymetry replaces the procedural seabed once loaded. */
  region?: RegionId;
}

/** Half width of the bank's flat crest and the width of its flanks down to the deep sea (m). */
export const BANK_CREST_M = 2500;
const BANK_FLANK_M = 6000;

function hash(seed: number, x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
function noise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(seed, x0, y0);
  const b = hash(seed, x0 + 1, y0);
  const c = hash(seed, x0, y0 + 1);
  const d = hash(seed, x0 + 1, y0 + 1);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}

function fbm(seed: number, x: number, y: number): number {
  return 0.6 * noise(seed, x, y) + 0.3 * noise(seed + 7, x * 2.1, y * 2.1) + 0.1 * noise(seed + 13, x * 4.3, y * 4.3);
}

/** Ridged noise in [0, 1]: sharp crests (ridges, sand waves, mountain chains). */
function ridged(seed: number, x: number, y: number): number {
  return 1 - Math.abs(2 * fbm(seed, x, y) - 1);
}

/**
 * Land above the water line, by distance inland (m): a low coastal strip, then hills and
 * mountain ranges on the scale of tens of kilometres (negative = height in metres).
 */
function land(seed: number, x: number, y: number, inland: number): number {
  const rise = Math.min(1, inland / 25_000);
  const massif = 0.45 + 0.55 * fbm(seed + 41, x / 30_000, y / 30_000);
  const ranges = ridged(seed + 43, x / 11_000, y / 11_000) * Math.min(1, inland / 6000);
  return -(8 + inland * 0.004 + 950 * rise * rise * massif + 220 * ranges);
}

/**
 * Distance (m) past a coast that runs north–south at about `at` on one side. The line wanders
 * on every scale, as real coasts do: great bays, headlands, small coves.
 */
function pastCoast(seed: number, x: number, y: number, at: number): number {
  const side = seed % 2 ? 1 : -1;
  const wander = 25_000 * (fbm(seed + 45, y / 80_000, 0.3) - 0.5)
    + 8000 * (fbm(seed + 47, y / 20_000, x / 20_000) - 0.5)
    + 2000 * (noise(seed + 49, y / 4000, x / 4000) - 0.5);
  return side * x - at - wander;
}

/** A few seamounts on a 30 km grid, all well off the route: (depth they lift the bottom to, 0..1 weight). */
function seamount(seed: number, x: number, y: number, d: number): number {
  const G = 30_000;
  const ci = Math.floor(x / G), cj = Math.floor(y / G);
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      if (hash(seed + 51, i, j) > 0.55) continue;
      const cx = (i + 0.2 + 0.6 * hash(seed + 53, i, j)) * G;
      const cy = (j + 0.2 + 0.6 * hash(seed + 55, i, j)) * G;
      if (Math.abs(cx) < 32_000) continue;
      const r = 4000 + 5000 * hash(seed + 57, i, j);
      const peak = 500 + 1100 * hash(seed + 59, i, j);
      // Elongated along a random strike, with flanks broken by spurs and gullies
      const a = hash(seed + 61, i, j) * Math.PI;
      const u = (x - cx) * Math.cos(a) + (y - cy) * Math.sin(a);
      const v = -(x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
      const q = Math.hypot(u / 1.6, v / 0.7) / r + 0.35 * (fbm(seed + 65, x / 2500, y / 2500) - 0.5);
      if (q < 1) d = Math.min(d, peak + (d - peak) * q * q * (3 - 2 * q));
    }
  }
  return d;
}

/**
 * Deep sea: broad basins with a faint texture of abyssal hills (well below 2000 m along the
 * route, so its acoustics keep their convergence zones), lone seamounts off to the sides,
 * and far out on one side the continental rise, slope and shelf up to a coast.
 */
function deepSea(spec: SeabedSpec, x: number, y: number, n: number): number {
  let d = 2500 + 1000 * n + 35 * (fbm(spec.seed + 23, x / 6000, y / 6000) - 0.5);
  if (Math.abs(x) < 22_000) return d;
  d = seamount(spec.seed, x, y, d);
  const past = pastCoast(spec.seed, x, y, 95_000);
  if (past < -60_000) return d;
  if (past < -30_000) {
    // Continental rise and slope: the bottom climbs from the basin to the shelf edge
    const f = (past + 60_000) / 30_000;
    return d + (230 - d) * f * f * (3 - 2 * f);
  }
  if (past < 0) {
    // Shelf: shoaling toward the coast, banks and troughs, islands near the shore
    const f = (past + 30_000) / 30_000;
    const shelf = 230 - 190 * f + 70 * (fbm(spec.seed + 61, x / 9000, y / 9000) - 0.5);
    if (f > 0.6 && fbm(spec.seed + 63, x / 5000, y / 5000) > 0.74) return land(spec.seed, x, y, 300);
    return Math.max(8, shelf);
  }
  return land(spec.seed, x, y, past);
}

export function depthAt(spec: SeabedSpec | undefined, x: number, y: number): number {
  if (!spec) return 3000;
  if (spec.region) {
    const real = gridDepth(spec.region, x, y);
    if (real !== undefined) {
      // Below the grid's ~0.5–2 km a little texture of the bottom (none on land or in the shallows)
      if (real < 25) return real;
      return real + Math.min(12, real * 0.03) * (fbm(spec.seed + 71, x / 700, y / 700) - 0.5) * 2;
    }
  }
  const n = fbm(spec.seed, x / 18_000, y / 18_000);
  if (spec.kind === 'tief') {
    const deep = deepSea(spec, x, y, n);
    if (spec.bankY === undefined) return deep;
    // A bank across the route (a sill between the deep basins), its crest line wandering a little
    const centre = spec.bankY + 3000 * (noise(spec.seed + 17, x / 15_000, 0.5) - 0.5);
    const crest = 150 + 100 * fbm(spec.seed + 19, x / 6000, y / 6000);
    const off = Math.abs(y - centre) - BANK_CREST_M;
    if (off <= 0) return Math.min(deep, crest);
    const f = Math.min(1, off / BANK_FLANK_M);
    return Math.min(deep, crest + (deep - crest) * f * f * (3 - 2 * f));
  }
  if (spec.kind === 'schelf') {
    // Sand waves across the tidal stream and a drowned river valley; the coast far off to the side
    const waves = 22 * (ridged(spec.seed + 31, (x + y * 0.6) / 2600, (y - x * 0.6) / 9000) - 0.5);
    const valley = 70 * Math.max(0, 1 - Math.abs(x * 0.35 + y * 0.2 - 9000 - 6000 * (noise(spec.seed + 33, y / 20_000, 0) - 0.5)) / 2500);
    let d = Math.max(105, Math.min(295, 110 + 160 * n + waves + valley));
    // The coast on one side, with bays, headlands and islands off it
    const past = pastCoast(spec.seed, x, y, 58_000);
    if (past >= 0) return land(spec.seed, x, y, past);
    if (past > -15_000) {
      const k = (past + 15_000) / 15_000;
      d = d * (1 - k) + (25 + 70 * (fbm(spec.seed + 35, x / 6000, y / 6000) - 0.5)) * k;
      // Islands and rocks off the coast
      if (k > 0.5 && fbm(spec.seed + 37, x / 4000, y / 4000) > 0.76) return land(spec.seed, x, y, 200);
      d = Math.max(6, d);
    }
    return d;
  }
  // Fjord: a deep channel along the convoy route (x ≈ 0) between shoals, skerries and mountains
  const wander = 2500 * (noise(spec.seed + 3, 0, y / 12_000) - 0.5);
  const off = Math.abs(x - wander);
  const channel = 4500 + 2000 * noise(spec.seed + 5, x / 9000, y / 9000);
  if (off < channel) return 140 + 120 * n;
  const shoal = (off - channel) / 1800;
  let d = 140 + 120 * n - shoal * 120 - 60 * fbm(spec.seed + 11, x / 4000, y / 4000);
  // Skerries: rocks and islets scattered over the shoals just outside the channel
  if (d > 0 && shoal < 1.5 && noise(spec.seed + 37, x / 700, y / 700) > 0.8) d = -6 - 20 * noise(spec.seed + 39, x / 300, y / 300);
  if (d < 0) return land(spec.seed, x, y, -d * 40);
  return d;
}

export const depthAtPos = (spec: SeabedSpec | undefined, p: Vec2) => depthAt(spec, p.x, p.y);

/** Water depth along a sound path: the shallowest of three samples. */
export function pathDepth(spec: SeabedSpec | undefined, a: Vec2, b: Vec2): number {
  if (!spec) return 3000;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return Math.min(depthAtPos(spec, a), depthAtPos(spec, m), depthAtPos(spec, b));
}

export const SHALLOW_M = 300;
export const DEEP_M = 2000;
