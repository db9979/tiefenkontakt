import { describe, expect, it } from 'vitest';
import {
  KN,
  ekelundRange,
  ownLegChange,
  scaleSolutionRange,
  autoSolve,
  bearing,
  distance,
  evaluateSolution,
  interceptHeading,
  targetPosAt,
  type BearingSample,
  type OwnFix,
  type TmaSolution,
} from '../src/index.js';

/** Own ship does two legs (needed for range observability); target on a straight track. */
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

describe('TMA', () => {
  it('rates the true solution with near-zero residual and high quality', () => {
    const { truth, track, hist } = scenario();
    const fit = evaluateSolution(truth, hist, track);
    expect(fit.rmsDeg).toBeLessThan(0.01);
    expect(fit.quality).toBeGreaterThan(90);
  });

  it('auto-solve finds a solution close to the truth after an own-ship leg change', () => {
    const { truth, track, hist } = scenario();
    const sol = autoSolve(hist, track)!;
    const now = 900;
    expect(distance(targetPosAt(sol, now), targetPosAt(truth, now))).toBeLessThan(1500);
    expect(evaluateSolution(sol, hist, track).rmsDeg).toBeLessThan(0.5);
  });

  it('computes a lead angle for a torpedo intercept', () => {
    const sol: TmaSolution = { t0: 0, x0: 0, y0: 5000, course: 90, speedKn: 15 };
    const h = interceptHeading({ x: 0, y: 0 }, 40, sol, 0)!;
    expect(h).toBeGreaterThan(5);
    expect(h).toBeLessThan(40);
  });
});

describe('TMA operator tools', () => {
  it('knows when range is observable', () => {
    const { track, hist } = scenario();
    expect(ownLegChange(hist, track)).toBeGreaterThan(60);
    const firstLeg = hist.filter((h) => h.t < 400);
    expect(ownLegChange(firstLeg, track)).toBeLessThan(6);
  });

  it('Ekelund ranging recovers the range at the turn', () => {
    const { truth, track, hist } = scenario();
    const r = ekelundRange(hist, track)!;
    const own = track.find((f) => f.t === 450)!;
    const trueRange = distance(own, targetPosAt(truth, 450));
    expect(r).toBeDefined();
    expect(Math.abs(r.range - trueRange) / trueRange).toBeLessThan(0.25);
  });

  it('dot-stack: only the true range fits flat', () => {
    const { truth, track, hist } = scenario();
    const rms = (f: number) => evaluateSolution(scaleSolutionRange(truth, f, 900, track), hist, track).rmsDeg;
    expect(rms(1)).toBeLessThan(rms(0.6));
    expect(rms(1)).toBeLessThan(rms(1.6));
  });
});
