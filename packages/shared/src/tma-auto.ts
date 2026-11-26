import type { BearingSample } from './contacts.js';
import { angleDiff, distance, headingVec } from './math.js';
import {
  EDGE_QUALITY_MAX, autoSolve, evaluateSolution, ownCourseAt, ownLegChange, ownPosAt, speedAtBound, targetPosAt,
  type OwnFix, type SpeedPrior, type TmaSolution,
} from './tma.js';

/**
 * Auto-TMA (the player's button): least squares and the grid inside the speed prior, the range
 * observability check (one leg, a weak second leg, a target that zigzags) and the choice between
 * candidates. Split from tma.ts (the solution model, grid search and operator tools).
 */

/**
 * Güte shown for a solution: capped below 30 % while the speed is only a bound, or the range was
 * kept because the bearings leave it open (a kept range fits as well as any other).
 */
export function boundedQuality(quality: number, sol: Pick<TmaSolution, 'speedKn'>, prior: SpeedPrior): number {
  return speedAtBound(sol, prior) || undetermined.has(sol as TmaSolution) ? Math.min(quality, EDGE_QUALITY_MAX) : quality;
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
  first?: (maxKn: number) => TmaSolution | undefined, opts: { rangeHint?: number; measuredRange?: MeasuredRange } = {},
): TmaSolution | undefined {
  const inBand = (s: TmaSolution) => s.speedKn <= prior.hi + 0.25 && s.speedKn >= prior.lo - 0.25;
  const last = hist[hist.length - 1];
  const me = last ? ownPosAt(track, last.t) : undefined;
  const rangeOf = (sol: TmaSolution) => (last && me ? distance(me, targetPosAt(sol, last.t)) : undefined);
  const rate = (sol: TmaSolution) => ({ sol, rms: evaluateSolution(sol, hist, track).rmsDeg, band: inBand(sol), range: rangeOf(sol) });
  // A range measured lately (periscope stadimeter, active ping) pins the range: course and speed
  // are searched at it, whatever the bearing geometry says (the open-range check below ignored it,
  // and a fixed target kept Güte at 29 % after the periscope look)
  // The player's own stadimeter range (Profi: the server strips the periscope ranges) counts the
  // same; of the two the newer one. Its error (a wrong class, a wrong mast) is the player's.
  const fromHist = last ? [...hist].reverse().find((h) => h.r !== undefined && h.r > 0) : undefined;
  const mark = opts.measuredRange && opts.measuredRange.r > 0 ? opts.measuredRange : undefined;
  const ranged = mark && (!fromHist || mark.t >= fromHist.t) ? mark : fromHist ? { t: fromHist.t, r: fromHist.r! } : undefined;
  if (ranged && last && last.t - ranged.t <= TMA_RANGE_FRESH_S) {
    const fixed = autoSolve(hist, track, prior.hi, { minSpeedKn: prior.lo, speedStep: 0.5, fixedRange: ranged.r });
    if (fixed) {
      anchored.set(fixed, { r: ranged.r, mark: ranged === mark });
      return fixed;
    }
  }
  // One leg only: every range on the bearing line fits as well, and the solvers slide to the
  // nearest one (0,4-0,9 km). Then a near-range answer is only taken when nothing else fits as well.
  const oneLeg = ownLegChange(hist, track) < TMA_LEG_MIN_DEG;
  // A second leg that changes the bearing rate too little (within the noise), or a range profile
  // that fits about equally well from near to far, leaves the range as open as one leg: least
  // squares then slid to 0,5-1 km just as well (audit 4). Then the range the player had (else the
  // nominal one) is kept, moved only into the span the bearings still allow, and course and speed
  // are searched at it; the solution is marked ENTFERNUNG UNBESTIMMT.
  const legs = oneLeg || !last || !me ? undefined : legRanging(hist, track);
  if (legs) {
    const prof = rangeProfile(hist, track, prior);
    const span = equallyGood(prof);
    if (span && (!legs.observable || span.hi / span.lo >= TMA_FLAT_RATIO)) {
      const hint = opts.rangeHint !== undefined && opts.rangeHint >= TMA_NEAR_M ? opts.rangeHint : TMA_NOMINAL_M;
      const keep = Math.min(span.hi, Math.max(span.lo, hint));
      const kept = autoSolve(hist, track, prior.hi, { minSpeedKn: prior.lo, speedStep: 0.5, fixedRange: keep });
      if (kept) {
        undetermined.add(kept);
        return kept;
      }
    }
  }
  const a = first?.(prior.hi);
  const cands = a ? [rate(a)] : [];
  if (cands[0]?.band && cands[0].rms <= TMA_GOOD_RMS_DEG && !(oneLeg && (cands[0].range ?? Infinity) < TMA_NEAR_M)) return a;
  const g = autoSolve(hist, track, prior.hi, { minSpeedKn: prior.lo, speedStep: 0.5, ...(oneLeg ? { nominalRange: TMA_NOMINAL_M } : {}) });
  if (g) cands.push(rate(g));
  return pickSolution(cands, oneLeg)?.sol;
}

/** A measured range this fresh (s) anchors Auto-TMA. */
export const TMA_RANGE_FRESH_S = 60;

/** A range the player measured himself (stadimeter), at sim time `t` (s). */
export interface MeasuredRange {
  t: number;
  r: number;
}

/** Solutions anchored on a fresh measured range: the range (m), and whether the player's mark gave it. */
const anchored = new WeakMap<TmaSolution, { r: number; mark: boolean }>();

/** The measured range an Auto-TMA solution was anchored on (undefined: not anchored). */
export function rangeAnchor(sol: TmaSolution): { r: number; mark: boolean } | undefined {
  return anchored.get(sol);
}

/** Ranges (m) of the profile Auto-TMA fits at to see whether the bearings pin the range down. */
const PROFILE_M = [700, 1000, 1500, 2000, 3000, 4500, 6500, 9000, 13_000, 18_000];
/** Fits within this factor of the best RMS (plus 0,05°) count as equally good on the profile. */
const PROFILE_TOL = 1.2;
/** Equally good from one range to this many times it: the range is not determined. */
export const TMA_FLAT_RATIO = 2.5;

/** Best fit (RMS over the plot) with the target at each profile range on the latest bearing. */
function rangeProfile(hist: readonly BearingSample[], track: readonly OwnFix[], prior: SpeedPrior): { r: number; rms: number }[] {
  const out: { r: number; rms: number }[] = [];
  for (const r of PROFILE_M) {
    const sol = autoSolve(hist, track, prior.hi, { minSpeedKn: prior.lo, speedStep: 0.5, fixedRange: r });
    if (sol) out.push({ r, rms: evaluateSolution(sol, hist, track).rmsDeg });
  }
  return out;
}

/** The span of profile ranges that fit about as well as the best one. */
function equallyGood(prof: readonly { r: number; rms: number }[]): { lo: number; hi: number } | undefined {
  if (!prof.length) return undefined;
  const min = Math.min(...prof.map((p) => p.rms));
  const ok = prof.filter((p) => p.rms <= min * PROFILE_TOL + 0.05).map((p) => p.r);
  return { lo: Math.min(...ok), hi: Math.max(...ok) };
}

/** Solutions whose range was kept, not measured (the bearings do not determine it). */
const undetermined = new WeakSet<TmaSolution>();

/** True when Auto-TMA kept the range of this solution because the bearings leave it open. */
export function rangeUndetermined(sol: TmaSolution): boolean {
  return undetermined.has(sol);
}

/** A change of the bearing rate between two own legs counts from this many standard errors. */
export const TMA_RATE_SIGMAS = 4;

/** Bearing rate (°/s) on a steady own leg and its standard error (noise from the leg's own scatter). */
function legRate(samples: readonly BearingSample[]): { rate: number; se: number } | undefined {
  const n = samples.length;
  if (n < 6) return undefined;
  const b0 = samples[0]!.b;
  const t0 = samples[0]!.t;
  const xs = samples.map((s) => s.t - t0);
  const ys = samples.map((s) => angleDiff(b0, s.b));
  const mx = xs.reduce((a, x) => a + x, 0) / n;
  const my = ys.reduce((a, y) => a + y, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  if (sxx <= 0) return undefined;
  const rate = sxy / sxx;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i]! - my - rate * (xs[i]! - mx)) ** 2;
  // At least 0,1° of scatter: a clean plot does not make a tiny rate change certain
  const sd = Math.max(0.1, Math.sqrt(ss / (n - 2)));
  return { rate, se: sd / Math.sqrt(sxx) };
}

/**
 * Range observability from the own legs (Ekelund's idea): the range shows only when an own course
 * change alters the bearing rate by more than its noise. Splits the plot into steady own legs
 * (course within 4°) and compares the bearing rates of every pair at least TMA_LEG_MIN_DEG apart.
 * True: some pair differs by TMA_RATE_SIGMAS standard errors or more, by as much as a range on
 * the bearing explains. False: none does (one leg, or a turn too small or too short for the
 * noise), or the change implies no range (the target manoeuvred). Undefined: too few own-ship
 * bearings to judge (sonobuoy plot, unresolved towed array).
 */
export function rangeObservable(hist: readonly BearingSample[], track: readonly OwnFix[]): boolean | undefined {
  return legRanging(hist, track)?.observable;
}

/**
 * The leg comparison behind rangeObservable, with the range it implies (Ekelund: the change of
 * own speed across the line of sight over the change of bearing rate) from the most telling pair.
 */
export function legRanging(hist: readonly BearingSample[], track: readonly OwnFix[]): { observable: boolean; z: number; range?: number } | undefined {
  const own = hist.filter((h) => h.ox === undefined && h.alt === undefined);
  if (own.length < 12 || own.length < hist.length * 0.6) return undefined;
  // Steady legs: the course stays within 4° of the leg's mean so far (a helmsman's few degrees
  // of wander do not cut a leg into pieces too short to measure)
  const legs: { course: number; n: number; samples: BearingSample[] }[] = [];
  let cur: { course: number; n: number; samples: BearingSample[] } | undefined;
  for (const h of own) {
    const c = ownCourseAt(track, h.t, 10);
    if (c === undefined) { cur = undefined; continue; }
    if (!cur || Math.abs(angleDiff(cur.course, c)) > 4) {
      cur = { course: c, n: 0, samples: [] };
      legs.push(cur);
    }
    cur.n++;
    cur.course = (cur.course + angleDiff(cur.course, c) / cur.n + 360) % 360;
    cur.samples.push(h);
  }
  const steady = legs.filter((l) => l.samples.length >= 6 && l.samples[l.samples.length - 1]!.t - l.samples[0]!.t >= 45);
  const rates = steady.map((l) => ({ l, r: legRate(l.samples) }));
  let best: { z: number; range?: number } | undefined;
  for (let i = 0; i < rates.length; i++) {
    for (let j = i + 1; j < rates.length; j++) {
      const a = rates[i]!, b = rates[j]!;
      if (!a.r || !b.r || Math.abs(angleDiff(a.l.course, b.l.course)) < TMA_LEG_MIN_DEG) continue;
      const z = Math.abs(a.r.rate - b.r.rate) / Math.hypot(a.r.se, b.r.se);
      if (best && z <= best.z) continue;
      // Own velocity across the line of sight on each leg (the bearing between the two legs)
      const sa = a.l.samples, sb = b.l.samples;
      const los = sa[sa.length - 1]!.b + angleDiff(sa[sa.length - 1]!.b, sb[0]!.b) / 2;
      const p = headingVec(los + 90);
      const vel = (xs: BearingSample[]) => {
        const p0 = ownPosAt(track, xs[0]!.t), p1 = ownPosAt(track, xs[xs.length - 1]!.t);
        const dt = xs[xs.length - 1]!.t - xs[0]!.t;
        return p0 && p1 && dt > 0 ? ((p1.x - p0.x) * p.x + (p1.y - p0.y) * p.y) / dt : undefined;
      };
      const va = vel(sa), vb = vel(sb);
      const dRate = ((a.r.rate - b.r.rate) * Math.PI) / 180;
      const range = va !== undefined && vb !== undefined && Math.abs(dRate) > 1e-9 ? (vb - va) / dRate : undefined;
      best = { z, range: range !== undefined && range > 0 ? range : undefined };
    }
  }
  // Enough own bearings, but no pair of steady legs shows it (one leg, still turning, a short second
  // leg). A clear rate change that no range explains (behind us, or a few hundred metres) came from
  // the target, not from our turn (a zigzagging convoy): that doesn't give the range either.
  const explained = best?.range !== undefined && best.range >= 300 && best.range <= 100_000;
  return { observable: !!best && best.z >= TMA_RATE_SIGMAS && explained, z: best?.z ?? 0, range: best?.range };
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
