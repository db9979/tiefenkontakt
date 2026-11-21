import type { BearingSample } from './contacts.js';
import { KN, angleDiff, bearing, headingVec, type Vec2 } from './math.js';

/** Target motion analysis from bearings-only data. Runs on the client with what the player knows. */

export interface OwnFix {
  t: number;
  x: number;
  y: number;
}

/** A hypothesis of the target track: position at t0 plus constant course and speed. */
export interface TmaSolution {
  t0: number;
  x0: number;
  y0: number;
  course: number;
  speedKn: number;
}

export function ownPosAt(track: readonly OwnFix[], t: number): Vec2 | undefined {
  if (track.length === 0) return undefined;
  const first = track[0]!;
  const last = track[track.length - 1]!;
  if (t <= first.t) return { x: first.x, y: first.y };
  if (t >= last.t) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo]!;
  const b = track[hi]!;
  const f = (t - a.t) / Math.max(b.t - a.t, 1e-9);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export function targetPosAt(sol: TmaSolution, t: number): Vec2 {
  const v = headingVec(sol.course);
  const d = sol.speedKn * KN * (t - sol.t0);
  return { x: sol.x0 + v.x * d, y: sol.y0 + v.y * d };
}

export interface TmaFit {
  rmsDeg: number;
  residuals: { t: number; err: number }[];
  /** 0..100: low residuals and enough bearing spread and samples. */
  quality: number;
}

export function evaluateSolution(sol: TmaSolution, hist: readonly BearingSample[], track: readonly OwnFix[]): TmaFit {
  const residuals: { t: number; err: number }[] = [];
  let sq = 0;
  for (const h of hist) {
    const own = ownPosAt(track, h.t);
    if (!own) continue;
    const pred = bearing(own, targetPosAt(sol, h.t));
    let err = angleDiff(pred, h.b);
    if (h.alt !== undefined) {
      const errAlt = angleDiff(pred, h.alt);
      if (Math.abs(errAlt) < Math.abs(err)) err = errAlt;
    }
    residuals.push({ t: h.t, err });
    sq += err * err;
  }
  const n = residuals.length;
  const rmsDeg = n ? Math.sqrt(sq / n) : 99;
  const first = hist[0];
  const last = hist[hist.length - 1];
  const spread = first && last ? Math.abs(angleDiff(first.b, last.b)) : 0;
  const quality = Math.round(100 * Math.exp(-rmsDeg / 1.5) * Math.min(1, n / 40) * Math.min(1, spread / 8));
  return { rmsDeg, residuals, quality };
}

function subsample<T>(xs: readonly T[], n: number): T[] {
  if (xs.length <= n) return [...xs];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.floor((i * (xs.length - 1)) / (n - 1))]!);
  return out;
}

/**
 * Brute-force search for the best-fitting straight-line track. Anchored at the
 * latest bearing: range along that bearing, course and speed are searched.
 */
export function autoSolve(hist: readonly BearingSample[], track: readonly OwnFix[], maxSpeedKn = 30): TmaSolution | undefined {
  const last = hist[hist.length - 1];
  if (!last || hist.length < 5) return undefined;
  const own = ownPosAt(track, last.t);
  if (!own) return undefined;
  const sample = subsample(hist, 24);
  const bearings = last.alt !== undefined ? [last.b, last.alt] : [last.b];
  let best: { sol: TmaSolution; rms: number } | undefined;
  for (const b0 of bearings) {
    const dir = headingVec(b0);
    for (let r = 500; r <= 60_000; r *= 1.15) {
      const x0 = own.x + dir.x * r;
      const y0 = own.y + dir.y * r;
      for (let c = 0; c < 360; c += 5) {
        for (let v = 0; v <= maxSpeedKn; v += 1) {
          const sol = { t0: last.t, x0, y0, course: c, speedKn: v };
          const rms = evaluateSolution(sol, sample, track).rmsDeg;
          if (!best || rms < best.rms) best = { sol, rms };
        }
      }
    }
  }
  return best?.sol;
}

/** Heading for a weapon at `weaponKn` from `from` to intercept a target track. */
export function interceptHeading(from: Vec2, weaponKn: number, sol: TmaSolution, now: number): number | undefined {
  const p = targetPosAt(sol, now);
  const v = headingVec(sol.course);
  const tv = { x: v.x * sol.speedKn * KN, y: v.y * sol.speedKn * KN };
  const w = weaponKn * KN;
  const d = { x: p.x - from.x, y: p.y - from.y };
  const a = tv.x * tv.x + tv.y * tv.y - w * w;
  const b = 2 * (d.x * tv.x + d.y * tv.y);
  const c = d.x * d.x + d.y * d.y;
  let t: number;
  if (Math.abs(a) < 1e-9) t = -c / b;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return undefined;
    const t1 = (-b - Math.sqrt(disc)) / (2 * a);
    const t2 = (-b + Math.sqrt(disc)) / (2 * a);
    t = Math.min(...[t1, t2].filter((x) => x > 0));
  }
  if (!Number.isFinite(t) || t <= 0) return undefined;
  return bearing(from, { x: p.x + tv.x * t, y: p.y + tv.y * t });
}
