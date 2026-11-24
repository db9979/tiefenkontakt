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
    // Wind toward north = scene −z
    expect(w.wd[1]![1]).toBeCloseTo(-1, 6);
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
