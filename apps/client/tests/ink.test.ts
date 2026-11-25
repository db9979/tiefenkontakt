import { describe, expect, it } from 'vitest';
import { ink, inkPixels, paperL } from '../src/widgets/ink.js';

describe('light-mode ink', () => {
  it('mirrors black and white, keeps the ends of the scale', () => {
    expect(ink('#000000')).toBe('rgb(255,255,255)');
    expect(ink('#ffffff')).toBe('rgb(0,0,0)');
    expect(paperL(0)).toBe(0);
    expect(paperL(1)).toBe(1);
  });
  it('darkens mid-tones smoothly and stays monotone', () => {
    expect(paperL(0.5)).toBeCloseTo(Math.pow(0.5, 1.35), 6);
    expect(paperL(0.6)).toBeLessThan(0.6);
    let prev = 0;
    for (let l = 0; l <= 1.0001; l += 0.005) {
      const v = paperL(l);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(v - prev)).toBeLessThan(0.03);
      prev = v;
    }
  });
  it('strengthens faint washes, leaves opaque colours alone', () => {
    expect(ink('rgba(93,202,165,0.1)')).toMatch(/,0\.18\)$/);
    expect(ink('rgba(93,202,165,0.8)')).toMatch(/,0\.8\)$/);
  });
  it('pixels and strings agree', () => {
    const d = new Uint8ClampedArray([93, 202, 165, 255]);
    inkPixels(d);
    expect(ink('rgb(93,202,165)')).toBe(`rgb(${d[0]},${d[1]},${d[2]})`);
  });
});
