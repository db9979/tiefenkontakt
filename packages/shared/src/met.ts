import type { Vec2 } from './math.js';
import { RAIN_NOISE_DB } from './weather.js';

/**
 * Local weather cells on the map: fog banks and rain squalls that drift with the wind,
 * and (in cold water) drifting ice floe fields and icebergs. The state lives in the
 * environment (JSON-safe, saved with the match); the same shape, rounded, goes to the
 * clients as the met forecast. Everything here is cheap geometry on a handful of circles.
 */

export interface FogBank { id: number; x: number; y: number; r: number; /** 0..1 at the core */ d: number }
export interface SquallCell { id: number; x: number; y: number; r: number; /** Sim time the shower dies out. */ until: number }
export interface IceField { id: number; x: number; y: number; r: number; /** Fraction of the sea covered by floes. */ cover: number }
export interface Iceberg { id: number; x: number; y: number; /** Waterline radius (m). */ r: number; /** Height above water (m). */ h: number; /** Keel depth (m). */ draft: number }

/** What the clients see (met forecast): positions, sizes and the drift. */
export interface MetCells {
  /** Surface wind (m/s, toward): fog drifts with it, squalls run a little faster. */
  wind: Vec2;
  /** Drift of the ice (m/s). */
  drift: Vec2;
  fog: FogBank[];
  squalls: SquallCell[];
  floes: IceField[];
  bergs: Iceberg[];
}

export interface MetState extends MetCells {
  rng: number;
  nextId: number;
  dynamic: boolean;
  /** Centre and half size of the area the cells are kept in (follows the ships). */
  area: { x: number; y: number; half: number };
  /** Next 1 s drift step. */
  next: number;
  /** Last iceberg collision per ship (sim time). */
  hits: Record<string, number>;
}

/** Drift speeds as multiples of the wind: fog creeps, showers run ahead of it. */
export const FOG_SPEED = 0.6;
export const SQUALL_SPEED = 1.3;
/** Fog bank edge (m): density rises from 0 to the core value over this distance. */
const FOG_EDGE = 300;
/** Extra effective distance a line of sight pays per meter of dense fog / rain curtain. */
export const FOG_SIGHT_K = 18;
export const RAIN_SIGHT_K = 1.2;
/** Broadband ice noise (crackling, grinding floes) at full cover (dB). */
export const ICE_NOISE_DB = 9;
/** Masking of a target hiding under or among floes (dB at full cover). */
export const ICE_MASK_DB = 6;

type Cells = Pick<MetCells, 'fog' | 'squalls' | 'floes' | 'bergs'> | undefined;

const d2 = (a: Vec2, x: number, y: number) => Math.hypot(a.x - x, a.y - y);

/** Fog density at a point (0 clear .. 1 thick). */
export function fogAt(m: Cells, p: Vec2): number {
  let f = 0;
  for (const b of m?.fog ?? []) {
    const k = (b.r - d2(p, b.x, b.y)) / FOG_EDGE;
    if (k > 0) f = Math.max(f, b.d * Math.min(1, k));
  }
  return f;
}

export function inSquall(m: Cells, p: Vec2): boolean {
  return (m?.squalls ?? []).some((s) => d2(p, s.x, s.y) < s.r);
}

/** Floe cover at a point (0..1), fading over 1 km at a field's edge. */
export function iceCover(m: Cells, p: Vec2): number {
  let c = 0;
  for (const f of m?.floes ?? []) {
    const k = (f.r - d2(p, f.x, f.y)) / 1000;
    if (k > -1) c = Math.max(c, f.cover * Math.min(1, Math.max(0, (k + 1) / 2)));
  }
  return c;
}

/** Length of the segment a→b inside a circle. */
export function chord(a: Vec2, b: Vec2, cx: number, cy: number, r: number): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return 0;
  const ux = dx / L, uy = dy / L;
  const t = (cx - a.x) * ux + (cy - a.y) * uy;
  const px = a.x + ux * t - cx, py = a.y + uy * t - cy;
  const h2 = r * r - (px * px + py * py);
  if (h2 <= 0) return 0;
  const h = Math.sqrt(h2);
  return Math.max(0, Math.min(L, t + h) - Math.max(0, t - h));
}

/**
 * Extra effective distance (m) a line of sight from a to b pays through fog banks and rain
 * curtains. Visual ranges are compared against distance + penalty: a few hundred meters of
 * thick fog hide even a big ship.
 */
export function sightPenalty(m: Cells, a: Vec2, b: Vec2): number {
  if (!m) return 0;
  let p = 0;
  for (const f of m.fog) p += chord(a, b, f.x, f.y, f.r) * f.d * FOG_SIGHT_K;
  for (const s of m.squalls) p += chord(a, b, s.x, s.y, s.r) * RAIN_SIGHT_K;
  return p;
}

/** Extra ambient noise at a point: rain on the surface above, and ice. */
export function localNoiseDb(m: Cells, p: Vec2, globalRain: boolean): number {
  if (!m) return 0;
  return (!globalRain && inSquall(m, p) ? RAIN_NOISE_DB : 0) + ICE_NOISE_DB * iceCover(m, p);
}

/** Rounded copy for the clients (met forecast). */
let viewCache: { m: MetState; next: number; v: MetCells } | undefined;

export function metView(m: MetState | undefined): MetCells | undefined {
  if (!m) return undefined;
  // Cells only move in 1 s steps: one copy serves every player's snapshot until then
  if (viewCache?.m === m && viewCache.next === m.next) return viewCache.v;
  const v = makeView(m);
  viewCache = { m, next: m.next, v };
  return v;
}

function makeView(m: MetState): MetCells {
  const r = (v: number) => Math.round(v);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    wind: { x: r2(m.wind.x), y: r2(m.wind.y) }, drift: { x: r2(m.drift.x), y: r2(m.drift.y) },
    fog: m.fog.map((f) => ({ id: f.id, x: r(f.x), y: r(f.y), r: r(f.r), d: r2(f.d) })),
    squalls: m.squalls.map((s) => ({ id: s.id, x: r(s.x), y: r(s.y), r: r(s.r), until: r(s.until) })),
    floes: m.floes.map((f) => ({ id: f.id, x: r(f.x), y: r(f.y), r: r(f.r), cover: r2(f.cover) })),
    bergs: m.bergs.map((b) => ({ id: b.id, x: r(b.x), y: r(b.y), r: r(b.r), h: r(b.h), draft: r(b.draft) })),
  };
}
