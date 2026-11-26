import { describe, expect, it } from 'vitest';
import {
  EDGE_QUALITY_MAX,
  KN,
  MERCHANT_TONAL_MAX_KN,
  SIGNATURES,
  bearing,
  boundedQuality,
  distance,
  hasMerchantTonals,
  shaftHz,
  solveInPrior,
  speedAtBound,
  speedPrior,
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
