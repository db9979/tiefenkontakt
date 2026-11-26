import type { BearingSample } from './contacts.js';
import { KN, angleDiff, bearing, distance, headingVec, type Vec2 } from './math.js';
import { CHOICE_MAX_KN, SIGNATURES, type ClassChoice } from './signatures.js';

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
export interface SolveOptions {
  courseStep?: number;
  speedStep?: number;
  rangeFactor?: number;
  samples?: number;
  /** Lower speed bound (kn) of the search, from a speed prior. */
  minSpeedKn?: number;
  /**
   * Among ranges that fit equally well (within 0,05° RMS), take the one nearest this (m): on one
   * leg every range fits, and the plain search kept the first, nearest one (N8).
   */
  nominalRange?: number;
}

/** Grid fits within this RMS (°) count as equally good (nominal-range tie-break). */
const TIE_RMS_DEG = 0.05;

export function autoSolve(
  hist: readonly BearingSample[], track: readonly OwnFix[], maxSpeedKn = 30, opts: SolveOptions = {},
): TmaSolution | undefined {
  const courseStep = opts.courseStep ?? 5;
  const speedStep = opts.speedStep ?? 1;
  const rangeFactor = opts.rangeFactor ?? 1.15;
  const last = hist[hist.length - 1];
  if (!last || hist.length < 5) return undefined;
  const own = last.ox !== undefined && last.oy !== undefined ? { x: last.ox, y: last.oy } : ownPosAt(track, last.t);
  if (!own) return undefined;
  const sample = subsample(hist, opts.samples ?? 24);
  const bearings = last.alt !== undefined ? [last.b, last.alt] : [last.b];
  const nominal = opts.nominalRange;
  let best: { sol: TmaSolution; rms: number; r: number } | undefined;
  for (const b0 of bearings) {
    const dir = headingVec(b0);
    for (let r = 500; r <= 60_000; r *= rangeFactor) {
      const x0 = own.x + dir.x * r;
      const y0 = own.y + dir.y * r;
      for (let c = 0; c < 360; c += courseStep) {
        for (let v = Math.max(0, opts.minSpeedKn ?? 0); v <= maxSpeedKn + 1e-9; v += speedStep) {
          const sol = { t0: last.t, x0, y0, course: c, speedKn: v };
          const rms = evaluateSolution(sol, sample, track).rmsDeg;
          if (!best || rms < best.rms - (nominal ? TIE_RMS_DEG : 0)) best = { sol, rms, r };
          else if (nominal && rms <= best.rms + TIE_RMS_DEG && Math.abs(Math.log(r / nominal)) < Math.abs(Math.log(best.r / nominal))) best = { sol, rms: Math.min(rms, best.rms), r };
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

// ---- Speed prior: what the ear says about how fast she can be going ----

const LINE_TOL_HZ = 1.5;
/** An unclassified surface contact with merchant tonals is no faster than this. */
export const MERCHANT_TONAL_MAX_KN = 20;
/** Spread on the DEMON speed estimate (shaft-rate noise, load and pitch). */
const DEMON_SLACK = 0.15;
/** Within this of a speed bound the solution only says "at least / at most". */
export const SPEED_EDGE_KN = 1;
/** Güte is capped below this while the target speed sits on a bound. */
export const EDGE_QUALITY_MAX = 29;

/** Convoy-merchant tonals: the 50 Hz family (ship's mains) with the 37,5 Hz diesel firing line, or two harmonics of it. */
export function hasMerchantTonals(tonalsHz: readonly number[]): boolean {
  const hit = (f: number) => tonalsHz.some((hz) => Math.abs(hz - f) <= LINE_TOL_HZ);
  const family = [50, 100, 150].filter(hit).length;
  return (hit(37.5) && family >= 1) || family >= 2;
}

export interface SpeedPrior {
  lo: number;
  hi: number;
  /** What set the upper bound. */
  by: 'class' | 'demon' | 'tonals' | 'none';
  /** Speed read from the shaft rate (kn) with the catalogue's median turns per knot. */
  demonKn?: number;
}

export interface SpeedPriorInput {
  /** The player's classification (choice), if any. */
  choice?: ClassChoice;
  /** Top speed of a visually identified class. */
  classMaxKn?: number;
  /** DEMON shaft rate (Hz): the operator's mark or the latest measurement. */
  shaftHz?: number;
  /** Narrowband tonals heard on the contact (Hz). */
  tonalsHz?: readonly number[];
  /** Search ceiling without other knowledge. */
  maxKn?: number;
}

/**
 * Bounds for the target-speed search. The shaft rate on DEMON gives the speed through the
 * ship's turns per knot: the catalogue's ships (not yachts) turn 4,6–22 U/min per knot, so
 * 57 U/min means about 2–14 kn whatever she is. An unclassified contact with convoy-merchant
 * tonals is capped at 20 kn; a classification caps at its class.
 */
export function speedPrior(inp: SpeedPriorInput): SpeedPrior {
  const known = inp.choice !== undefined && inp.choice !== 'unknown';
  let hi = inp.maxKn ?? 30;
  let by: SpeedPrior['by'] = 'none';
  if (known) {
    hi = Math.min(hi, CHOICE_MAX_KN[inp.choice!]);
    by = 'class';
  }
  if (inp.classMaxKn !== undefined) {
    hi = Math.min(hi, inp.classMaxKn);
    by = 'class';
  }
  if (by === 'none' && inp.tonalsHz && hasMerchantTonals(inp.tonalsHz) && hi > MERCHANT_TONAL_MAX_KN) {
    hi = MERCHANT_TONAL_MAX_KN;
    by = 'tonals';
  }
  let lo = 0;
  let demonKn: number | undefined;
  const shaft = inp.shaftHz;
  if (shaft !== undefined && Number.isFinite(shaft) && shaft > 0.3) {
    const rpm = shaft * 60;
    const want: ClassChoice[] = known ? [inp.choice!] : ['merchant', 'warship', 'submarine'];
    const rpk = Object.values(SIGNATURES)
      .filter((g) => want.includes(g.choice) && g.rpmPerKn > 0 && g.rpmPerKn <= 30)
      .map((g) => g.rpmPerKn)
      .sort((a, b) => a - b);
    if (rpk.length) {
      demonKn = rpm / rpk[Math.floor(rpk.length / 2)]!;
      const dHi = (rpm / rpk[0]!) * (1 + DEMON_SLACK);
      const dLo = (rpm / rpk[rpk.length - 1]!) * (1 - DEMON_SLACK);
      if (dHi < hi) {
        hi = dHi;
        by = 'demon';
      }
      lo = Math.min(dLo, hi);
    }
  }
  return { lo: Math.round(lo * 10) / 10, hi: Math.round(hi * 10) / 10, by, ...(demonKn !== undefined && { demonKn }) };
}

/** The solution's speed sits on a bound of the prior: the data don't fix it, the bound does. */
export function speedAtBound(sol: Pick<TmaSolution, 'speedKn'>, prior: SpeedPrior): boolean {
  return sol.speedKn >= prior.hi - SPEED_EDGE_KN || (prior.lo > SPEED_EDGE_KN && sol.speedKn <= prior.lo + SPEED_EDGE_KN);
}

/** Güte shown for a solution: capped below 30 % while the speed is only a bound. */
export function boundedQuality(quality: number, sol: Pick<TmaSolution, 'speedKn'>, prior: SpeedPrior): number {
  return speedAtBound(sol, prior) ? Math.min(quality, EDGE_QUALITY_MAX) : quality;
}

/** A least-squares result that fits this well (RMS °) inside the prior is taken without a grid search. */
export const TMA_GOOD_RMS_DEG = 2;
/** An in-band candidate is preferred over an out-of-band one that fits at most this much better (°). */
export const TMA_BAND_SLACK_DEG = 1.5;

/**
 * Auto-TMA inside the speed prior: the preferred solver (least squares) first; if its speed
 * leaves the prior's band, or it fits badly, the grid search restricted to that band too.
 * N8: candidates are compared by their RMS over the whole plot, and a worse one is never taken
 * (after a second leg the grid in a wrong band gave 0,9 km at RMS 88° while least squares had 4°).
 * Inside the band wins unless an outside candidate fits clearly better.
 */
export function solveInPrior(
  hist: readonly BearingSample[], track: readonly OwnFix[], prior: SpeedPrior,
  first?: (maxKn: number) => TmaSolution | undefined,
): TmaSolution | undefined {
  const inBand = (s: TmaSolution) => s.speedKn <= prior.hi + 0.25 && s.speedKn >= prior.lo - 0.25;
  const last = hist[hist.length - 1];
  const me = last ? ownPosAt(track, last.t) : undefined;
  const rangeOf = (sol: TmaSolution) => (last && me ? distance(me, targetPosAt(sol, last.t)) : undefined);
  const rate = (sol: TmaSolution) => ({ sol, rms: evaluateSolution(sol, hist, track).rmsDeg, band: inBand(sol), range: rangeOf(sol) });
  // One leg only: every range on the bearing line fits as well, and the solvers slide to the
  // nearest one (0,4-0,9 km). Then a near-range answer is only taken when nothing else fits as well.
  const oneLeg = ownLegChange(hist, track) < TMA_LEG_MIN_DEG;
  const a = first?.(prior.hi);
  const cands = a ? [rate(a)] : [];
  if (cands[0]?.band && cands[0].rms <= TMA_GOOD_RMS_DEG && !(oneLeg && (cands[0].range ?? Infinity) < TMA_NEAR_M)) return a;
  const g = autoSolve(hist, track, prior.hi, { minSpeedKn: prior.lo, speedStep: 0.5, ...(oneLeg ? { nominalRange: TMA_NOMINAL_M } : {}) });
  if (g) cands.push(rate(g));
  return pickSolution(cands, oneLeg)?.sol;
}

/** Own course change (°) below which the range is not observable (one leg). */
export const TMA_LEG_MIN_DEG = 6;
/** A one-leg solution closer than this (m) counts as the near-range collapse. */
export const TMA_NEAR_M = 1500;
/** On one leg the grid prefers, among equally good ranges, the one nearest to this (m). */
export const TMA_NOMINAL_M = 8000;

/**
 * The best candidate by RMS; one inside the speed band is preferred while it fits nearly as well.
 * With `avoidNear` (one leg), a candidate beyond TMA_NEAR_M is preferred over a nearer one that
 * fits only as well (within the band slack).
 */
export function pickSolution<T extends { rms: number; band: boolean; range?: number }>(cands: readonly T[], avoidNear = false): T | undefined {
  const ok = cands.filter((c) => Number.isFinite(c.rms));
  const lowest = (xs: T[]) => xs.reduce<T | undefined>((m, c) => (!m || c.rms < m.rms ? c : m), undefined);
  const best = lowest(ok);
  if (!best) return undefined;
  let pool = ok.filter((c) => c.rms <= best.rms + TMA_BAND_SLACK_DEG);
  if (avoidNear && pool.some((c) => (c.range ?? Infinity) >= TMA_NEAR_M)) pool = pool.filter((c) => (c.range ?? Infinity) >= TMA_NEAR_M);
  const banded = lowest(pool.filter((c) => c.band));
  return banded ?? lowest(pool) ?? best;
}

/**
 * Keep the stored solution when a new one fits the plot worse (N8): Auto-TMA never replaces a
 * good solution with a worse one. True when `next` should be stored.
 */
export function betterSolution(next: TmaSolution, old: TmaSolution | undefined, hist: readonly BearingSample[], track: readonly OwnFix[]): boolean {
  if (!old) return true;
  return evaluateSolution(next, hist, track).rmsDeg <= evaluateSolution(old, hist, track).rmsDeg + 0.05;
}
