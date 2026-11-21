import { describe, expect, it } from 'vitest';
import { BearingRangeFilter, Rng, angleDiff, easeAngle } from '../src/index.js';

describe('display filters', () => {
  it('smooth a noisy drifting bearing and follow the drift', () => {
    const rng = new Rng(4);
    const f = new BearingRangeFilter(0.2, 0.02);
    let rawJump = 0;
    let shownJump = 0;
    let prevRaw: number | undefined;
    let prevShown: number | undefined;
    for (let t = 0; t <= 300; t++) {
      const truth = 100 + 0.05 * t;
      const raw = truth + rng.gauss(0, 0.3);
      f.update(t, raw, 5000 * (1 + rng.gauss(0, 0.05)));
      const shown = f.at(t)!.bearing;
      if (t > 60) {
        if (prevRaw !== undefined) rawJump += Math.abs(angleDiff(prevRaw, raw));
        if (prevShown !== undefined) shownJump += Math.abs(angleDiff(prevShown, shown));
        expect(Math.abs(angleDiff(truth, shown))).toBeLessThan(0.4);
      }
      prevRaw = raw;
      prevShown = shown;
    }
    expect(shownJump).toBeLessThan(rawJump / 4);
    expect(Math.abs(f.at(300)!.range! - 5000)).toBeLessThan(250);
  });

  it('eases an angle across north without spinning the long way', () => {
    const a = easeAngle(355, 5, 0.25, 0.25);
    expect(angleDiff(355, a)).toBeGreaterThan(0);
    expect(angleDiff(355, a)).toBeLessThan(10);
  });
});
