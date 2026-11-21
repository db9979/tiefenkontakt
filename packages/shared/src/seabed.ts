import type { Vec2 } from './math.js';

/**
 * Procedural seabed (deterministic from a seed, so server and client agree).
 * Depth in metres (positive = water depth); negative values are land.
 */

export type SeabedKind = 'tief' | 'schelf' | 'fjord';

export interface SeabedSpec {
  kind: SeabedKind;
  seed: number;
}

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

export function depthAt(spec: SeabedSpec | undefined, x: number, y: number): number {
  if (!spec) return 3000;
  const n = fbm(spec.seed, x / 18_000, y / 18_000);
  if (spec.kind === 'tief') return 2400 + 1200 * n;
  if (spec.kind === 'schelf') return 110 + 160 * n;
  // Fjord: a deep channel along the convoy route (x ≈ 0) between shoals and islands
  const wander = 2500 * (noise(spec.seed + 3, 0, y / 12_000) - 0.5);
  const off = Math.abs(x - wander);
  const channel = 4500 + 2000 * noise(spec.seed + 5, x / 9000, y / 9000);
  if (off < channel) return 140 + 120 * n;
  const shoal = (off - channel) / 1800;
  return 140 + 120 * n - shoal * 120 - 60 * fbm(spec.seed + 11, x / 4000, y / 4000);
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
