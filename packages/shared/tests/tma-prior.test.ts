import { describe, expect, it } from 'vitest';
import {
  EDGE_QUALITY_MAX,
  KN,
  MERCHANT_TONAL_MAX_KN,
  SIGNATURES,
  bearing,
  betterSolution,
  boundedQuality,
  distance,
  evaluateSolution,
  pickSolution,
  hasMerchantTonals,
  lsqSolve,
  ownLegChange,
  rangeObservable,
  rangeUndetermined,
  shaftHz,
  solveInPrior,
  speedAtBound,
  speedPrior,
  TMA_NEAR_M,
  TMA_NOMINAL_M,
  targetPosAt,
  type BearingSample,
  type OwnFix,
  type TmaSolution,
} from '../src/index.js';

/** Own ship on two legs, a freighter at 10 kn on a straight track (as in tma.test.ts). */
function scenario() {
  const truth: TmaSolution = { t0: 0, x0: 8000, y0: 12_000, course: 270, speedKn: 10 };
  const track: OwnFix[] = [];
  const hist: BearingSample[] = [];
  let x = 0;
  let y = 0;
  for (let t = 0; t <= 900; t += 10) {
    const hdg = t < 450 ? 0 : 90;
    const v = 5 * KN * 10;
    track.push({ t, x, y });
    hist.push({ t, b: bearing({ x, y }, targetPosAt(truth, t)), sensor: 'hull' });
    if (hdg === 0) y += v;
    else x += v;
  }
  return { truth, track, hist };
}

describe('TMA speed prior', () => {
  it('without knowledge searches up to 30 kn', () => {
    const p = speedPrior({});
    expect(p).toMatchObject({ lo: 0, hi: 30, by: 'none' });
  });

  it('recognises convoy-merchant tonals (50 Hz family, 37,5 Hz firing line)', () => {
    expect(hasMerchantTonals([50.1, 99.8])).toBe(true);
    expect(hasMerchantTonals([37.4, 50.2])).toBe(true);
    // A diesel boat's lone 50 Hz line or a frigate's 60 Hz family is not a merchant
    expect(hasMerchantTonals([50])).toBe(false);
    expect(hasMerchantTonals([60, 120, 180])).toBe(false);
  });

  it('caps an unclassified contact with merchant tonals at about 20 kn', () => {
    const p = speedPrior({ tonalsHz: [50, 100, 150, 37.5] });
    expect(p.hi).toBe(MERCHANT_TONAL_MAX_KN);
    expect(p.by).toBe('tonals');
  });

  it('a classification caps at its class', () => {
    expect(speedPrior({ choice: 'merchant' }).hi).toBe(14);
    expect(speedPrior({ choice: 'merchant', classMaxKn: 11 }).hi).toBe(11);
    // "Unbekannt" is no classification: the tonals still count
    expect(speedPrior({ choice: 'unknown', tonalsHz: [50, 100] }).by).toBe('tonals');
  });

  it('reads the speed from the DEMON shaft rate (57 U/min: a few knots, never 30)', () => {
    const shaft = 57 / 60;
    const p = speedPrior({ shaftHz: shaft, tonalsHz: [50, 100] });
    expect(p.by).toBe('demon');
    expect(p.hi).toBeLessThan(15);
    expect(p.lo).toBeGreaterThan(1);
    // The true speed of a catalogue freighter turning 57 U/min lies inside the band
    const trueKn = 57 / SIGNATURES.merchant.rpmPerKn;
    expect(trueKn).toBeGreaterThan(p.lo);
    expect(trueKn).toBeLessThan(p.hi);
    expect(p.demonKn).toBeGreaterThan(p.lo);
    expect(p.demonKn).toBeLessThan(p.hi);
  });

  it('the DEMON band holds every catalogue ship at its speed', () => {
    for (const key of ['merchant', 'tanker', 'container', 'ffg', 'kor', 'ssk', 'ssn'] as const) {
      const sig = SIGNATURES[key];
      for (const kn of [5, 8, 12]) {
        const p = speedPrior({ shaftHz: shaftHz(sig, kn) });
        expect(kn, `${key} at ${kn} kn`).toBeGreaterThanOrEqual(p.lo);
        expect(kn, `${key} at ${kn} kn`).toBeLessThanOrEqual(p.hi);
      }
    }
  });

  it('flags a solution on the bound and keeps its Güte under 30 %', () => {
    const p = speedPrior({ tonalsHz: [50, 100] });
    expect(speedAtBound({ speedKn: 19.6 }, p)).toBe(true);
    expect(speedAtBound({ speedKn: 9 }, p)).toBe(false);
    expect(boundedQuality(85, { speedKn: 19.6 }, p)).toBe(EDGE_QUALITY_MAX);
    expect(boundedQuality(85, { speedKn: 9 }, p)).toBe(85);
    // The plain 30 kn search limit is a bound too (the audit's 29,4 kn freighters)
    expect(speedAtBound({ speedKn: 29.4 }, speedPrior({}))).toBe(true);
  });

  it('a solver result outside the prior is replaced by the search inside it', () => {
    const { truth, track, hist } = scenario();
    const prior = speedPrior({ shaftHz: shaftHz(SIGNATURES.merchant, 10), tonalsHz: [50, 100] });
    const wild: TmaSolution = { ...truth, speedKn: 29.4 };
    const sol = solveInPrior(hist, track, prior, () => wild)!;
    expect(sol.speedKn).toBeLessThanOrEqual(prior.hi + 1e-9);
    expect(sol.speedKn).toBeGreaterThanOrEqual(prior.lo - 1e-9);
    expect(distance(targetPosAt(sol, 900), targetPosAt(truth, 900))).toBeLessThan(2000);
    // A result inside the prior is kept as it is
    expect(solveInPrior(hist, track, prior, () => truth)).toBe(truth);
  });
});

describe('Auto-TMA keeps the best fit (N8)', () => {
  it('a band that excludes the true speed does not force a solution that fits nowhere', () => {
    const { truth, track, hist } = scenario();
    // A wrong DEMON band (0-0,5 kn) for a 10 kn freighter: the grid inside it fits badly
    const prior = { lo: 0, hi: 0.5, by: 'demon' as const };
    const sol = solveInPrior(hist, track, prior, () => truth)!;
    expect(evaluateSolution(sol, hist, track).rmsDeg).toBeLessThan(0.5);
    expect(sol).toBe(truth);
  });

  it('prefers the in-band candidate while it fits nearly as well', () => {
    expect(pickSolution([{ rms: 1.0, band: false }, { rms: 2.0, band: true }])!.band).toBe(true);
    expect(pickSolution([{ rms: 1.0, band: false }, { rms: 88, band: true }])!.band).toBe(false);
    expect(pickSolution([])).toBeUndefined();
  });

  it('on one leg the search does not slide to the nearest range', () => {
    // Own ship on one straight leg, a freighter 9 km off: every range on the bearing line fits
    const truth: TmaSolution = { t0: 0, x0: 6000, y0: 7000, course: 250, speedKn: 8 };
    const track: OwnFix[] = [];
    const hist: BearingSample[] = [];
    for (let t = 0; t <= 600; t += 10) {
      const p = { x: 0, y: (5 * KN) * t };
      track.push({ t, ...p });
      hist.push({ t, b: bearing(p, targetPosAt(truth, t)), sensor: 'hull' });
    }
    const own = track[track.length - 1]!;
    const sol = solveInPrior(hist, track, speedPrior({ choice: 'merchant' }))!;
    expect(distance(own, targetPosAt(sol, 600))).toBeGreaterThan(TMA_NEAR_M);
    expect(evaluateSolution(sol, hist, track).rmsDeg).toBeLessThan(1);
    expect(pickSolution([{ rms: 0.1, band: true, range: 400 }, { rms: 0.3, band: true, range: 7000 }], true)!.range).toBe(7000);
    expect(pickSolution([{ rms: 0.1, band: true, range: 400 }, { rms: 0.3, band: true, range: 7000 }])!.range).toBe(400);
  });

  it('never replaces a solution with one that fits the plot worse', () => {
    const { truth, track, hist } = scenario();
    // The near-range collapse: 0,9 km on the last bearing, 10 kn
    const last = hist[hist.length - 1]!;
    const own = track[track.length - 1]!;
    const rad = (last.b * Math.PI) / 180;
    const near: TmaSolution = { t0: last.t, x0: own.x + 900 * Math.sin(rad), y0: own.y + 900 * Math.cos(rad), course: 0, speedKn: 10 };
    expect(evaluateSolution(near, hist, track).rmsDeg).toBeGreaterThan(10);
    expect(betterSolution(near, truth, hist, track)).toBe(false);
    expect(betterSolution(truth, near, hist, track)).toBe(true);
    expect(betterSolution(near, undefined, hist, track)).toBe(true);
  });
});

describe('Auto-TMA after a weak second leg (audit 4)', () => {
  /** Seeded normal noise, so the plots are the same on every run. */
  function noise(seed: number) {
    let s = seed;
    const u = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  }
  /** Own ship 5 min north at 4 kn, then `turn`° to starboard; a freighter at 8 kn, `r0` m off at the start; 1° bearing noise. */
  function weakLeg(turn: number, r0: number, seed: number) {
    const g = noise(seed * 97 + turn);
    const truth: TmaSolution = { t0: 0, x0: r0 * Math.sin(1), y0: r0 * Math.cos(1), course: 250, speedKn: 8 };
    const track: OwnFix[] = [];
    const hist: BearingSample[] = [];
    let x = 0;
    let y = 0;
    for (let t = 0; t <= 600; t += 5) {
      const hdg = ((t < 300 ? 0 : turn) * Math.PI) / 180;
      track.push({ t, x, y });
      hist.push({ t, b: (bearing({ x, y }, targetPosAt(truth, t)) + g() + 360) % 360, sensor: 'hull' });
      x += 4 * KN * 5 * Math.sin(hdg);
      y += 4 * KN * 5 * Math.cos(hdg);
    }
    return { truth, track, hist, own: track[track.length - 1]! };
  }

  it('a small own turn against a far target does not make the range observable', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { track, hist } = weakLeg(12, 10_000, seed);
      expect(ownLegChange(hist, track)).toBeGreaterThanOrEqual(6);
      expect(rangeObservable(hist, track)).toBe(false);
    }
    // A clean plot with a 90° turn does
    const { track, hist } = scenario();
    expect(rangeObservable(hist, track)).toBe(true);
    // Sonobuoy bearings: not judged here
    expect(rangeObservable(hist.map((h) => ({ ...h, ox: 0, oy: 0 })), track)).toBeUndefined();
  });

  it('keeps the range instead of collapsing to 0,5-1 km (target 6-10 km)', () => {
    let collapsedBefore = 0;
    let undetermined = 0;
    for (const turn of [8, 12, 20, 45]) {
      for (const r0 of [8000, 10_000]) {
        for (const seed of [1, 2, 3, 4]) {
          const { track, hist, own } = weakLeg(turn, r0, seed);
          const prior = speedPrior({ choice: 'merchant' });
          // Least squares alone slides to the near ranges in most of these plots
          const lsq = lsqSolve(hist, track, prior.hi, 'merchant')!.sol;
          if (distance(own, targetPosAt(lsq, 600)) < TMA_NEAR_M) collapsedBefore++;
          const sol = solveInPrior(hist, track, prior, (kn) => lsqSolve(hist, track, kn, 'merchant')?.sol)!;
          expect(distance(own, targetPosAt(sol, 600))).toBeGreaterThan(TMA_NEAR_M);
          if (rangeObservable(hist, track) === false) {
            // Kept, said so, and still fitting the bearings about as well as the truth does
            expect(rangeUndetermined(sol)).toBe(true);
            undetermined++;
          }
          if (rangeUndetermined(sol)) expect(evaluateSolution(sol, hist, track).rmsDeg).toBeLessThan(1.5);
        }
      }
    }
    expect(collapsedBefore).toBeGreaterThan(6);
    expect(undetermined).toBeGreaterThan(12);
  });

  it('keeps the previous range when one is given, and never a near one', () => {
    const { track, hist, own } = weakLeg(12, 10_000, 2);
    const prior = speedPrior({ choice: 'merchant' });
    const sol = solveInPrior(hist, track, prior, undefined, { rangeHint: 6500 })!;
    expect(rangeUndetermined(sol)).toBe(true);
    expect(distance(own, targetPosAt(sol, 600))).toBeCloseTo(6500, -2);
    const nearHint = solveInPrior(hist, track, prior, undefined, { rangeHint: 600 })!;
    expect(distance(own, targetPosAt(nearHint, 600))).toBeCloseTo(TMA_NOMINAL_M, -2);
  });

  it('an observable second leg is solved as before, not marked', () => {
    const { truth, track, hist } = scenario();
    const sol = solveInPrior(hist, track, speedPrior({ choice: 'merchant' }), () => truth)!;
    expect(sol).toBe(truth);
    expect(rangeUndetermined(sol)).toBe(false);
  });
});
