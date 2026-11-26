import { describe, expect, it } from 'vitest';
import {
  MATCH_YEAR, cloudCover, envMoonlight, julianDay, lookoutRanges, matchDay, moonEcliptic, moonPhase, moonReport, moonRiseSet,
  moonSky, moonlight, phaseBrightness, seeingLight, sunPosition, visibility, type Environment,
} from '../src/index.js';

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('lunar ephemeris (Meeus)', () => {
  it('matches Meeus example 47.a (1992 April 12, 0h)', () => {
    const jd = julianDay(1992, 4, 12, 0);
    expect(jd).toBe(2448724.5);
    const m = moonEcliptic(jd);
    expect(angDiff(m.lon, 133.162655)).toBeLessThan(0.15);
    expect(Math.abs(m.lat - -3.229126)).toBeLessThan(0.05);
    expect(Math.abs(m.distKm - 368409.7)).toBeLessThan(300);
  });

  it('matches Meeus example 48.a: 67.86 % lit on 1992 April 12', () => {
    expect(moonPhase(julianDay(1992, 4, 12, 0)).frac).toBeCloseTo(0.6786, 2);
  });

  it('gets the published phases of January 2024 right', () => {
    // USNO: new moon 11 Jan 11:57 UT, first quarter 18 Jan 03:53, full moon 25 Jan 17:54, last quarter 2 Feb 23:18
    const nm = moonPhase(julianDay(2024, 1, 11, 11 + 57 / 60));
    expect(nm.frac).toBeLessThan(0.005);
    const fq = moonPhase(julianDay(2024, 1, 18, 3 + 53 / 60));
    expect(Math.abs(fq.elong - 90)).toBeLessThan(1.5);
    expect(fq.waxing).toBe(true);
    expect(fq.frac).toBeGreaterThan(0.47);
    expect(fq.frac).toBeLessThan(0.53);
    const fm = moonPhase(julianDay(2024, 1, 25, 17 + 54 / 60));
    expect(fm.frac).toBeGreaterThan(0.995);
    const lq = moonPhase(julianDay(2024, 2, 2, 23 + 18 / 60));
    expect(Math.abs(lq.elong - 270)).toBeLessThan(1.5);
    expect(lq.waxing).toBe(false);
    // A day off the full moon it is still about 97 % lit
    expect(moonPhase(julianDay(2024, 1, 26, 17 + 54 / 60)).frac).toBeGreaterThan(0.95);
  });
});

/** The day of the match year's month closest to full (or new) moon. */
function dayOf(month: number, want: 'full' | 'new'): number {
  let best = 1, bestK = want === 'full' ? -1 : 2;
  for (let d = 1; d <= 28; d++) {
    const k = moonPhase(julianDay(MATCH_YEAR, month, d, 0)).frac;
    if (want === 'full' ? k > bestK : k < bestK) { bestK = k; best = d; }
  }
  return best;
}

describe('the moon on the game sky', () => {
  const lat = 62, lon = -6.8, month = 10;
  /** Sunrise and sunset (local solar hours) of the game sun. */
  const sunCross = (lim: number) => {
    let rise = NaN, set = NaN;
    for (let h = 0; h < 24; h += 0.05) {
      const a = sunPosition(lat, month, h).el + 0.83, b = sunPosition(lat, month, h + 0.05).el + 0.83;
      if (a < 0 && b >= 0) rise = h;
      if (a >= 0 && b < 0) set = h;
    }
    return lim < 0 ? rise : set;
  };

  it('rises at sunset and sets at sunrise when full', () => {
    const day = dayOf(month, 'full');
    const at = { lat, lon, month, day };
    const rs = moonRiseSet(at, 12);
    expect(rs.rise).toBeDefined();
    expect(Math.abs(rs.rise! - sunCross(1))).toBeLessThan(1.5);
    const m = moonSky(at, 0);
    expect(m.frac).toBeGreaterThan(0.95);
    // Midnight: in the south, well up
    expect(angDiff(m.az, 180)).toBeLessThan(25);
    expect(m.el).toBeGreaterThan(10);
    const set = moonRiseSet(at, 0).set!;
    expect(Math.abs(set - sunCross(-1))).toBeLessThan(1.5);
  });

  it('is down all night at new moon and stands near the sun by day', () => {
    const day = dayOf(month, 'new');
    const at = { lat, lon, month, day };
    expect(moonSky(at, 0).el).toBeLessThan(0);
    const noon = moonSky(at, 12), sun = sunPosition(lat, month, 12);
    expect(angDiff(noon.az, sun.az)).toBeLessThan(20);
    expect(noon.frac).toBeLessThan(0.02);
  });

  it('rises around noon and stands in the south at dusk at first quarter', () => {
    const nm = dayOf(month, 'new');
    const at = { lat: 45, lon: 0, month, day: nm + 7 };
    const k = moonSky(at, 18).frac;
    expect(k).toBeGreaterThan(0.35);
    expect(k).toBeLessThan(0.7);
    const rs = moonRiseSet(at, 6);
    expect(rs.rise!).toBeGreaterThan(10);
    expect(rs.rise!).toBeLessThan(16);
    expect(angDiff(moonSky(at, 18.5).az, 180)).toBeLessThan(35);
  });

  it('moves on smoothly through midnight when the day rolls on', () => {
    const a = moonSky({ lat, lon, month, day: 9 }, 23.99), b = moonSky({ lat, lon, month, day: 10 }, 0.01);
    expect(Math.abs(a.el - b.el)).toBeLessThan(0.5);
    expect(angDiff(a.az, b.az)).toBeLessThan(1);
  });

  it('draws the day of the month from the seed', () => {
    const days = new Set<number>();
    for (let s = 0; s < 200; s++) {
      const d = matchDay(2, s);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(28);
      days.add(d);
    }
    expect(days.size).toBeGreaterThan(24);
    expect(matchDay(10, 1234)).toBe(matchDay(10, 1234));
  });

  it('reports the moon as the crew sees it', () => {
    const full = { lat, lon, month, day: dayOf(month, 'full') };
    expect(moonReport(full, 0).text).toMatch(/^VOLLMOND · \d{3}° \d+° HOCH · UNTERGANG \d\d:\d\d$/);
    expect(moonReport(full, 13).text).toMatch(/UNTER · AUFGANG \d\d:\d\d$/);
    expect(moonReport({ lat, lon, month, day: dayOf(month, 'new') }, 0).text).toBe('NEUMOND');
  });
});

describe('moonlight and the eye', () => {
  it('follows phase, height and clouds', () => {
    expect(moonlight({ el: 50, phaseAngle: 0 })).toBeCloseTo(1, 5);
    // The phase law: a half moon gives about a tenth of the full moon's light
    expect(phaseBrightness(90)).toBeGreaterThan(0.07);
    expect(phaseBrightness(90)).toBeLessThan(0.12);
    expect(moonlight({ el: -2, phaseAngle: 0 })).toBe(0);
    expect(moonlight({ el: 5, phaseAngle: 0 })).toBeLessThan(0.25);
    expect(moonlight({ el: 50, phaseAngle: 0 }, 1)).toBeCloseTo(0.15, 5);
    expect(cloudCover(3, false)).toBeCloseTo(0.34, 5);
    expect(cloudCover(2, true)).toBe(0.95);
  });

  it('a dark night is darker than the old constant night, a bright moon lighter; the day is untouched', () => {
    expect(seeingLight({ light: 0.12 })).toBe(0.12);
    expect(seeingLight({ light: 0.12, moon: 0 })).toBeCloseTo(0.107, 5);
    expect(seeingLight({ light: 0.12, moon: 1 })).toBeCloseTo(0.257, 5);
    // The average night (moonlight about 0.09 under the usual clouds) stays where the plain night was
    expect(Math.abs(seeingLight({ light: 0.12, moon: 0.087 }) - 0.12)).toBeLessThan(0.002);
    expect(seeingLight({ light: 1, moon: 1 })).toBe(1);
    expect(seeingLight({ light: 0.5, moon: 1 })).toBe(0.5);
  });

  it('lets the lookouts see a periscope farther under a full moon than on a moonless night', () => {
    const base: Environment = { layerDepth: 0, layerLoss: 0, seaState: 3, light: 0.12 };
    const dark = lookoutRanges({ ...base, moon: 0 }).mast, plain = lookoutRanges(base).mast, bright = lookoutRanges({ ...base, moon: 1 }).mast;
    expect(dark).toBeLessThan(plain);
    expect(bright).toBeGreaterThan(plain);
    // Moderate: a moonless night costs a few per cent, a full moon in a clear sky gains about a third
    expect(dark / plain).toBeGreaterThan(0.95);
    expect(bright / plain).toBeLessThan(1.4);
    expect(visibility({ ...base, light: 1, moon: 1 })).toBe(1);
  });

  it('is computed from the environment\'s place, date and clock', () => {
    const env = { lat: 62, lon: -6.8, month: 10, day: dayOf(10, 'full'), seaState: 2, weather: { clock: 0, dynamic: false, rainUntil: 0, nextChange: 0, baseLayer: 0 } };
    const clear = envMoonlight(env)!;
    expect(clear).toBeGreaterThan(0.4);
    expect(envMoonlight({ ...env, rain: true })!).toBeLessThan(clear * 0.3);
    expect(envMoonlight({ ...env, day: undefined })).toBeUndefined();
  });
});
