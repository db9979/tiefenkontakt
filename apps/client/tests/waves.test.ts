import { describe, expect, it } from 'vitest';
import { hullOnSea, seaWaves, waveHeight } from '../src/widgets/sea3d/waves.js';

describe('sea surface', () => {
  it('stays fixed to the map while the own ship moves through it', () => {
    const wind = { x: 6, y: -2 };
    // The same sea point (east 5000, north 300) seen from two own positions at the same moment
    const a = seaWaves(4, wind, { x: 0, y: 0 }, 100);
    const b = seaWaves(4, wind, { x: 4200, y: -900 }, 100);
    const pa = waveHeight(a, 5000, -300);
    const pb = waveHeight(b, 5000 - 4200, -(300 + 900));
    expect(pb).toBeCloseTo(pa, 6);
  });

  it('runs the long waves with the wind and grows with the sea state', () => {
    const w = seaWaves(5, { x: 0, y: 10 }, { x: 0, y: 0 }, 0);
    // Wind toward north = scene −z: the energy-weighted mean direction runs with it
    const mz = w.wd.reduce((a, d, i) => a + d[1] * w.wa[i]!, 0);
    const mx = w.wd.reduce((a, d, i) => a + d[0] * w.wa[i]!, 0);
    expect(mz).toBeLessThan(-0.85);
    expect(Math.abs(mx)).toBeLessThan(0.25);
    expect(w.wa.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    expect(seaWaves(6, undefined, { x: 0, y: 0 }, 0).amp).toBeGreaterThan(seaWaves(2, undefined, { x: 0, y: 0 }, 0).amp);
  });

  it('lets a long hull bridge the short waves', () => {
    const w = seaWaves(5, { x: 5, y: 0 }, { x: 0, y: 0 }, 30);
    let small = 0, big = 0;
    for (let i = 0; i < 50; i++) {
      small = Math.max(small, Math.abs(hullOnSea(w, i * 37, i * 11, 90, 20, 5).pitch));
      big = Math.max(big, Math.abs(hullOnSea(w, i * 37, i * 11, 90, 200, 30).pitch));
    }
    expect(big).toBeLessThan(small);
  });
});

describe('weather sky', () => {
  it('flashes lightning rarely, and only in some showers', async () => {
    const { squallFlash } = await import('../src/widgets/sea3d/sky.js');
    const flashes = (id: number) => {
      let n = 0;
      for (let t = 0; t < 3600; t += 0.05) if (squallFlash(id, t) > 0.5) n++;
      return n;
    };
    expect(flashes(3)).toBe(0);
    const n = flashes(4);
    // About one double flash a minute, each a few frames long
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(600);
  });
});

describe('sea state', () => {
  it('builds the WMO significant wave height and a steeper sea when rough', async () => {
    const { sigHeight, seaWaves: sw, waveHeight: wh, ownRoll } = await import('../src/widgets/sea3d/waves.js');
    expect(sigHeight(3)).toBeGreaterThan(1.2);
    expect(sigHeight(5)).toBeGreaterThan(3.5);
    // Measured Hs (4σ of the surface) matches the table
    for (const sea of [3, 5]) {
      const w = sw(sea, { x: 5, y: 1 }, { x: 0, y: 0 }, 10);
      let s2 = 0, n = 0;
      for (let i = 0; i < 4000; i++) { const h = wh(w, (i * 37.1) % 3000, (i * 91.7) % 3000); s2 += h * h; n++; }
      expect(4 * Math.sqrt(s2 / n)).toBeCloseTo(sigHeight(sea), 0);
    }
    // Rough sea: the dominant train is shorter than the 250 m swell
    const w5 = sw(5, undefined, { x: 0, y: 0 }, 0);
    expect(w5.wa.indexOf(Math.max(...w5.wa))).toBeGreaterThanOrEqual(1);
    // Own roll: a frigate rolls noticeably in a rough sea, little in a slight one, never wildly
    let r3 = 0, r5 = 0;
    for (let t = 0; t < 200; t += 0.25) { r3 = Math.max(r3, Math.abs(ownRoll(3, 130, 14, t, 0))); r5 = Math.max(r5, Math.abs(ownRoll(5, 130, 14, t, 0))); }
    expect(r5 * 57.3).toBeGreaterThan(6);
    expect(r5 * 57.3).toBeLessThan(15);
    expect(r3).toBeLessThan(r5);
  });
});

describe('ship variety', () => {
  it('gives a ship the same look every time, and different ships different ones', async () => {
    const { look, seedOf, hullFor } = await import('../src/widgets/sea3d/variety.js');
    expect(seedOf('m12')).toBe(seedOf('m12'));
    const a = look('m12'), b = look('m12');
    expect([a.r(), a.r(), a.ballast, a.rust]).toEqual([b.r(), b.r(), b.ballast, b.rust]);
    const looks = Array.from({ length: 60 }, (_, i) => look(`s${i}`));
    expect(new Set(looks.map((l) => l.r().toFixed(3))).size).toBeGreaterThan(50);
    expect(looks.some((l) => l.ballast > 0)).toBe(true);
    expect(looks.some((l) => l.ballast === 0)).toBe(true);
    // The book's ship is plain; in ballast the deck rides higher and the red band grows
    expect(look().varied).toBe(false);
    const spec = { len: 100, beam: 15, freeboard: 6, draft: 7, colors: { top: 0, boot: 0, bottom: 0 }, boot: [-0.5, 0.8] as [number, number] };
    const high = hullFor({ ...a, ballast: 1 }, spec, 3);
    expect(high.freeboard).toBe(9);
    expect(high.draft).toBe(4);
    expect(high.boot![1]).toBeGreaterThan(3);
  });
});
