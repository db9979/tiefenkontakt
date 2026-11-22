import type { ContactTrack } from './contacts.js';
import { KN, angleDiff, headingVec } from './math.js';
import type { ClassChoice } from './signatures.js';
import { ownPosAt, type OwnFix, type TmaSolution } from './tma.js';

/**
 * Least-squares passive target motion analysis, used by the AI captains and by the
 * player's Auto-TMA. The contact book keeps only the last
 * few minutes of raw bearings (one own leg at most), so each captain logs its own plot:
 * bearings averaged over 10 s bins with the own position, kept for 15 minutes. The fit is a
 * range profile: for each range on the latest bearing a linear least-squares solve gives
 * course and speed (and a small lateral offset), a speed prior for the class rules out the
 * implausible ones, and the spread of the solutions that fit about as well as the best one
 * says how far the solution can be trusted (one leg alone: any range fits — low quality).
 */

export interface BotFix {
  t: number;
  b: number;
  ox: number;
  oy: number;
  /** Raw bearings averaged into this bin. */
  n: number;
}

export interface BearingLog {
  fixes: BotFix[];
  /** End of the last binned interval (s). */
  binEnd: number;
  seen: number;
}

const BIN_S = 10;
const LOG_SPAN_S = 900;
const DROP_AFTER_S = 600;

/** Speed priors (kn) for what the contact was classified as: merchants steam 5–14 kn. */
const PRIOR: Partial<Record<ClassChoice, [number, number]>> = { merchant: [5, 14], warship: [4, 30], submarine: [2, 25] };

/** Bin the contact's newest raw bearings into the captain's log (own-ship bearings only). */
export function logBearings(logs: Record<string, BearingLog>, t: ContactTrack, track: readonly OwnFix[], now: number): BearingLog {
  const log = (logs[t.label] ??= { fixes: [], binEnd: -1e9, seen: now });
  log.seen = now;
  const raw = t.history.filter((h) => h.alt === undefined && h.t > log.binEnd);
  const newest = raw[raw.length - 1];
  if (newest) {
    const lastBin = Math.floor(newest.t / BIN_S);
    let i = 0;
    while (i < raw.length) {
      const bin = Math.floor(raw[i]!.t / BIN_S);
      if (bin >= lastBin) break;
      const group = [];
      while (i < raw.length && Math.floor(raw[i]!.t / BIN_S) === bin) group.push(raw[i++]!);
      const b0 = group[0]!.b;
      const ref = group[0]!;
      // Mixed origins (sonobuoy and own sonar) don't average: keep the own ones
      const same = group.filter((h) => h.ox === ref.ox && h.oy === ref.oy);
      const tm = same.reduce((a, h) => a + h.t, 0) / same.length;
      const b = (b0 + same.reduce((a, h) => a + angleDiff(b0, h.b), 0) / same.length + 360) % 360;
      const own = ref.ox !== undefined && ref.oy !== undefined ? { x: ref.ox, y: ref.oy } : ownPosAt(track, tm);
      if (own) log.fixes.push({ t: tm, b, ox: own.x, oy: own.y, n: same.length });
      log.binEnd = (bin + 1) * BIN_S;
    }
  }
  while (log.fixes.length && now - log.fixes[0]!.t > LOG_SPAN_S) log.fixes.shift();
  return log;
}

/** Forget contacts not heard for ten minutes. */
export function pruneLogs(logs: Record<string, BearingLog>, now: number): void {
  for (const [k, v] of Object.entries(logs)) if (now - v.seen > DROP_AFTER_S) delete logs[k];
}

export interface BotTma {
  sol: TmaSolution;
  /** 0..100: fit, data and how tightly the bearings pin down range and course. */
  q: number;
  rmsDeg: number;
  /** Largest course difference (deg) among the solutions that fit about as well. */
  courseSpread: number;
  /** Range interval (m) at the latest bearing among those solutions. */
  rangeLo: number;
  rangeHi: number;
}

interface Cand { r: number; sol: TmaSolution; sq: number; prior: number }

function solve3(a: number[][], b: number[]): number[] | undefined {
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-12) return undefined;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k < 4; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

/** Best straight track with the target at range r on the latest bearing (plus a small lateral offset). */
function fitAtRange(fx: readonly BotFix[], r: number): { sol: TmaSolution; sq: number } | undefined {
  const last = fx[fx.length - 1]!;
  const u = headingVec(last.b);
  const nl = { x: u.y, y: -u.x };
  const P = { x: last.ox + u.x * r, y: last.oy + u.y * r };
  let est = { dx: 0, vx: 0, vy: 0 };
  // Two passes: weights follow the predicted range so the residuals are angles
  for (let pass = 0; pass < 2; pass++) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const B = [0, 0, 0];
    for (const f of fx) {
      const dt = f.t - last.t;
      const ui = headingVec(f.b);
      const n = { x: ui.y, y: -ui.x };
      const px = P.x + nl.x * est.dx + est.vx * dt - f.ox;
      const py = P.y + nl.y * est.dx + est.vy * dt - f.oy;
      const R = pass === 0 ? Math.max(200, Math.hypot(P.x - f.ox, P.y - f.oy)) : Math.max(200, Math.hypot(px, py));
      const wgt = f.n / (R * R);
      const row = [n.x * nl.x + n.y * nl.y, n.x * dt, n.y * dt];
      const rhs = -(n.x * (P.x - f.ox) + n.y * (P.y - f.oy));
      for (let i = 0; i < 3; i++) {
        B[i]! += wgt * row[i]! * rhs;
        for (let j = 0; j < 3; j++) A[i]![j]! += wgt * row[i]! * row[j]!;
      }
    }
    // A little ridge on the lateral offset: it should only absorb the noise on the last bin
    A[0]![0]! += 1 / (r * r * 0.0004);
    const x = solve3(A, B);
    if (!x) return undefined;
    est = { dx: x[0]!, vx: x[1]!, vy: x[2]! };
  }
  const p0 = { x: P.x + nl.x * est.dx, y: P.y + nl.y * est.dx };
  let sq = 0;
  let wsum = 0;
  for (const f of fx) {
    const dt = f.t - last.t;
    const tx = p0.x + est.vx * dt;
    const ty = p0.y + est.vy * dt;
    const pred = (Math.atan2(tx - f.ox, ty - f.oy) * 180) / Math.PI;
    const e = angleDiff(pred, f.b);
    sq += f.n * e * e;
    wsum += f.n;
  }
  const speed = Math.hypot(est.vx, est.vy) / KN;
  const course = ((Math.atan2(est.vx, est.vy) * 180) / Math.PI + 360) % 360;
  return { sol: { t0: last.t, x0: p0.x, y0: p0.y, course, speedKn: speed }, sq: sq / Math.max(wsum, 1) };
}

/** Bearings-only fit over the captain's log. */
export function botSolve(fx: readonly BotFix[], maxKn: number, choice?: ClassChoice): BotTma | undefined {
  if (fx.length < 6) return undefined;
  const span = fx[fx.length - 1]!.t - fx[0]!.t;
  const [lo, hi] = PRIOR[choice ?? 'unknown'] ?? [0, maxKn];
  const top = Math.min(hi, maxKn);
  const prior = (v: number) => (v < lo ? ((lo - v) / 1.5) ** 2 : v > top ? ((v - top) / 1) ** 2 : 0);
  const cands: Cand[] = [];
  for (let r = 300; r <= 50_000; r *= 1.05) {
    const f = fitAtRange(fx, r);
    if (f) cands.push({ r, sol: f.sol, sq: f.sq, prior: prior(f.sol.speedKn) });
  }
  if (!cands.length) return undefined;
  // Noise from the best pure fit (at least 0.3° per bin), so the costs are in sigmas
  const nEff = Math.max(1, fx.length - 4);
  const bestSq = Math.min(...cands.map((c) => c.sq));
  const sigma2 = Math.max(0.09, (bestSq * fx.length) / nEff);
  const cost = (c: Cand) => (c.sq * fx.length) / sigma2 + c.prior;
  let best = cands[0]!;
  for (const c of cands) if (cost(c) < cost(best)) best = c;
  // Everything within ~2 sigma of the best is just as believable
  const ok = cands.filter((c) => cost(c) <= cost(best) + 4);
  let spread = 0;
  for (const c of ok) spread = Math.max(spread, Math.abs(angleDiff(best.sol.course, c.sol.course)));
  const rLo = Math.min(...ok.map((c) => c.r));
  const rHi = Math.max(...ok.map((c) => c.r));
  const rmsDeg = Math.sqrt(best.sq);
  const obs = Math.exp(-spread / 25) * Math.exp(-Math.log(rHi / rLo) / 0.8);
  const fit = Math.exp(-Math.max(0, rmsDeg - 0.6) / 2);
  const data = Math.min(1, span / 360) * Math.min(1, fx.length / 20);
  // Even the best track breaks the speed prior: wrong class, or not a straight runner
  const plausible = Math.exp(-best.prior / 3);
  const q = Math.round(100 * obs * fit * data * plausible);
  return { sol: best.sol, q, rmsDeg, courseSpread: spread, rangeLo: rLo, rangeHi: rHi };
}

/**
 * One-off solve of a whole bearing history (the player's Auto-TMA): bins it like the
 * captains' log and runs the least-squares fit. Undefined when there is too little
 * own-ship data (e.g. a towed-array contact with unresolved sides).
 */
export function lsqSolve(history: ContactTrack['history'], track: readonly OwnFix[], maxKn: number, choice?: ClassChoice): BotTma | undefined {
  const last = history[history.length - 1];
  if (!last) return undefined;
  const log = logBearings({}, { label: '_', history } as ContactTrack, track, last.t);
  return botSolve(log.fixes, maxKn, choice);
}
