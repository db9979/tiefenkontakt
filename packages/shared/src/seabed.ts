import type { Vec2 } from './math.js';

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

/** 0 inside |v| < a, 1 beyond b, smooth between. */
const ramp = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (Math.abs(v) - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ridged noise in [0, 1]: sharp crests (ridges, sand waves, mountain chains). */
function ridged(seed: number, x: number, y: number): number {
  return 1 - Math.abs(2 * fbm(seed, x, y) - 1);
}

/**
 * Land above the water line: rugged hills that rise inland (negative = height in metres).
 * Coasts break into headlands and skerries.
 */
function land(seed: number, x: number, y: number, inland: number): number {
  const rise = Math.min(1, inland / 4000);
  return -(15 + 720 * rise * (0.3 + 0.7 * ridged(seed + 41, x / 7000, y / 7000)) + 25 * noise(seed + 43, x / 900, y / 900));
}

/** Distance (m) past a coast that runs north–south at about `at` on one side, wandering in bays and headlands. */
function pastCoast(seed: number, x: number, y: number, at: number): number {
  const side = seed % 2 ? 1 : -1;
  const wander = 7000 * (fbm(seed + 45, y / 14_000, 0.3) - 0.5) + 2500 * (noise(seed + 47, y / 3000, x / 3000) - 0.5);
  return side * x - at - wander;
}

/**
 * Deep sea: abyssal hills everywhere (they stay well below 2000 m, so the acoustics along the
 * route keep their convergence zones); beyond about 20 km to the sides seamounts and ridges
 * rise, and far out the continental slope climbs to the shelf.
 */
function deepSea(spec: SeabedSpec, x: number, y: number, n: number): number {
  const hills = 160 * (fbm(spec.seed + 23, x / 4000, y / 4000) - 0.5);
  let d = 2500 + 1100 * n + hills;
  const side = ramp(x, 20_000, 28_000);
  if (side > 0) {
    // Seamount chain and ridges: peaks to about 700 m
    const ridge = Math.pow(ridged(spec.seed + 29, x / 16_000, y / 11_000), 3);
    d -= side * 1900 * ridge;
    // Far out on one side: the continental slope, the shelf and the coast
    const past = pastCoast(spec.seed, x, y, 60_000);
    const slope = Math.min(1, Math.max(0, (past + 18_000) / 18_000));
    if (slope > 0) d = d * (1 - slope * slope) + (150 + 80 * n) * slope * slope - Math.max(0, past) * 0.05;
    if (d < 0) return land(spec.seed, x, y, past);
  }
  return d;
}

export function depthAt(spec: SeabedSpec | undefined, x: number, y: number): number {
  if (!spec) return 3000;
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
    const past = pastCoast(spec.seed, x, y, 40_000);
    if (past > -12_000) {
      const k = Math.min(1, (past + 12_000) / 12_000);
      d = d * (1 - k) + (40 - Math.max(0, past) * 0.05) * k + 90 * (fbm(spec.seed + 35, x / 3500, y / 3500) - 0.5) * k;
      if (d < 0) return land(spec.seed, x, y, Math.max(0, past) + 200);
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
  if (d < 0) return land(spec.seed, x, y, -d * 15);
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
