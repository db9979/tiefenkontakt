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
    const own = h.ox !== undefined && h.oy !== undefined ? { x: h.ox, y: h.oy } : ownPosAt(track, h.t);
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
  const own = last.ox !== undefined && last.oy !== undefined ? { x: last.ox, y: last.oy } : ownPosAt(track, last.t);
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

// ---- Observability, Ekelund ranging and dot-stack (operator tools, U-Jagd style) ----

/** Own course over ground at time t, from the track (averaged over ±window s). */
export function ownCourseAt(track: readonly OwnFix[], t: number, window = 15): number | undefined {
  const a = ownPosAt(track, t - window);
  const b = ownPosAt(track, t + window);
  if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 20) return undefined;
  return bearing(a, b);
}

/** Largest own course change (deg) during the bearing history: range is observable from ~6°, better 30-60°. */
export function ownLegChange(hist: readonly BearingSample[], track: readonly OwnFix[]): number {
  const first = hist[0];
  const last = hist[hist.length - 1];
  if (!first || !last) return 0;
  const c0 = ownCourseAt(track, first.t + 15);
  if (c0 === undefined) return 0;
  let max = 0;
  for (let t = first.t + 30; t <= last.t; t += 15) {
    const c = ownCourseAt(track, t);
    if (c !== undefined) max = Math.max(max, Math.abs(angleDiff(c0, c)));
  }
  return max;
}

/** Least-squares slope of bearing (deg) over time, unwrapped around the first sample. */
function bearingRate(samples: readonly BearingSample[]): number | undefined {
  if (samples.length < 4) return undefined;
  const b0 = samples[0]!.b;
  const t0 = samples[0]!.t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const s of samples) {
    const x = s.t - t0;
    const y = angleDiff(b0, s.b);
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const n = samples.length;
  const den = n * sxx - sx * sx;
  return den === 0 ? undefined : (n * sxy - sx * sy) / den;
}

export interface EkelundResult {
  range: number;
  turnAt: number;
  courseChange: number;
}

/**
 * Ekelund range: bearing rates on two own legs around a course change of at least 30°.
 * R = (Vperp2 - Vperp1) / (Bdot1 - Bdot2), Vperp = own speed across the line of sight.
 */
export function ekelundRange(hist: readonly BearingSample[], track: readonly OwnFix[], legS = 90): EkelundResult | undefined {
  const last = hist[hist.length - 1];
  const first = hist[0];
  if (!first || !last) return undefined;
  let best: { t: number; change: number } | undefined;
  for (let t = first.t + legS; t <= last.t - legS; t += 10) {
    const c1 = ownCourseAt(track, t - legS / 2, legS / 3);
    const c2 = ownCourseAt(track, t + legS / 2, legS / 3);
    if (c1 === undefined || c2 === undefined) continue;
    const change = Math.abs(angleDiff(c1, c2));
    if (change >= 30 && (!best || change > best.change)) best = { t, change };
  }
  if (!best) return undefined;
  const own = (s: BearingSample) => s.alt === undefined && s.ox === undefined;
  const leg1 = hist.filter((s) => s.t >= best!.t - legS && s.t < best!.t - 10 && own(s));
  const leg2 = hist.filter((s) => s.t > best!.t + 10 && s.t <= best!.t + legS && own(s));
  const r1 = bearingRate(leg1);
  const r2 = bearingRate(leg2);
  if (r1 === undefined || r2 === undefined) return undefined;
  const losB = leg1[leg1.length - 1]!.b;
  const p = headingVec(losB + 90);
  const vel = (a: number, b: number) => {
    const pa = ownPosAt(track, a)!;
    const pb = ownPosAt(track, b)!;
    return { x: (pb.x - pa.x) / (b - a), y: (pb.y - pa.y) / (b - a) };
  };
  const v1 = vel(best.t - legS, best.t - 10);
  const v2 = vel(best.t + 10, best.t + legS);
  const vp1 = v1.x * p.x + v1.y * p.y;
  const vp2 = v2.x * p.x + v2.y * p.y;
  const dRate = ((r1 - r2) * Math.PI) / 180;
  if (Math.abs(dRate) < 1e-6) return undefined;
  const range = (vp2 - vp1) / dRate;
  if (!(range > 100 && range < 100_000)) return undefined;
  return { range, turnAt: best.t, courseChange: best.change };
}

/** The same hypothesis with the range at the latest bearing scaled (dot-stack rows 0.6/1.0/1.6). */
export function scaleSolutionRange(sol: TmaSolution, factor: number, tLast: number, track: readonly OwnFix[]): TmaSolution {
  const own = ownPosAt(track, tLast) ?? { x: sol.x0, y: sol.y0 };
  const p = targetPosAt(sol, tLast);
  const np = { x: own.x + (p.x - own.x) * factor, y: own.y + (p.y - own.y) * factor };
  return { ...sol, t0: tLast, x0: np.x, y0: np.y };
}

/** Put a range on the latest bearing, keeping course and speed. */
export function solutionAtRange(
  hist: readonly BearingSample[], track: readonly OwnFix[], range: number, course = 0, speedKn = 0,
): TmaSolution | undefined {
  const last = hist[hist.length - 1];
  if (!last) return undefined;
  const own = last.ox !== undefined && last.oy !== undefined ? { x: last.ox, y: last.oy } : ownPosAt(track, last.t);
  if (!own) return undefined;
  const v = headingVec(last.b);
  return { t0: last.t, x0: own.x + v.x * range, y0: own.y + v.y * range, course, speedKn };
}
