import { describe, expect, it } from 'vitest';
import { RECOG, RECOG_ORDER, recogDraught } from '@tk/shared';
import { BOW_ZOOM, bowWidthShare, gridLines, metresPerPx, scaleCat, scaleFrame } from '../src/widgets/recog-scale.js';

describe('recognition book: common scale', () => {
  it('sorts submarines and surface ships into their own scale', () => {
    expect(scaleCat('ssk')).toBe('sub');
    expect(scaleCat('ssw')).toBe('sub');
    expect(scaleCat('ffg')).toBe('ship');
    expect(scaleCat('yacht')).toBe('ship');
  });

  it('gives every class of a category the same frame, big enough for all of them', () => {
    for (const cat of ['ship', 'sub'] as const) {
      const f = scaleFrame(cat);
      for (const c of RECOG_ORDER.filter((x) => scaleCat(x) === cat)) {
        expect(scaleFrame(scaleCat(c))).toBe(f);
        expect(RECOG[c].length).toBeLessThan(f.x1);
        expect(RECOG[c].mast).toBeLessThan(f.yTop);
        expect(-recogDraught(c)).toBeGreaterThan(f.yBot);
        expect(RECOG[c].beam / 2).toBeLessThan(f.bowHalf);
        expect(RECOG[c].beam / 2).toBeLessThan(f.topHalf);
      }
      expect(f.x0).toBeLessThan(0);
    }
  });

  it('draws one metre equally wide for a frigate and a supertanker on the same page width', () => {
    const f = scaleFrame(scaleCat('ffg'));
    expect(scaleFrame(scaleCat('tanker'))).toBe(f);
    const mpp = metresPerPx(f, 400);
    // The tanker is longer than the frigate in exactly the ratio of their lengths
    expect(RECOG.tanker.length / mpp / (RECOG.ffg.length / mpp)).toBeCloseTo(240 / 136, 6);
    expect(mpp).toBeGreaterThan(0.5);
    expect(mpp).toBeLessThan(1.2);
  });

  it('grids ships every 10 m and boats every 5 m, waterline included', () => {
    const ship = gridLines(scaleFrame('ship'));
    const sub = gridLines(scaleFrame('sub'));
    expect(ship).toContain(0);
    expect(sub).toContain(0);
    expect(ship[1]! - ship[0]!).toBe(10);
    expect(sub[1]! - sub[0]!).toBe(5);
    expect(Math.max(...ship)).toBeGreaterThanOrEqual(30);
    expect(Math.min(...sub)).toBeLessThanOrEqual(-5);
  });

  it('keeps the bow view at BOW_ZOOM times the side scale', () => {
    for (const cat of ['ship', 'sub'] as const) {
      const f = scaleFrame(cat);
      const sideW = 400;
      const bowW = bowWidthShare(f) * sideW;
      expect(bowW / (2 * f.bowHalf) / (sideW / (f.x1 - f.x0))).toBeCloseTo(BOW_ZOOM, 6);
      expect(bowWidthShare(f)).toBeLessThan(0.5);
    }
  });
});
