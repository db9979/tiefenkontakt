import { describe, expect, it } from 'vitest';
import { czBand, predictRanges, predictionSummary, rowRange, type RangePredictInput, type RangePrediction } from '../src/range-predict.js';

const sub: RangePredictInput = { ownCls: 'ssk', ownTeam: 'east', ownDepth: 50, ownSpeedKn: 4, seaState: 3, layerDepth: 120, bottom: 3000 };
const escort: RangePredictInput = { ownCls: 'ffg', ownTeam: 'west', ownDepth: 6, ownSpeedKn: 10, seaState: 3, layerDepth: 100, bottom: 3000, towedLength: 600 };

const rowOf = (p: RangePrediction, d: number) => p.depths.reduce((b, x, j) => (Math.abs(x - d) < Math.abs(p.depths[b]! - d) ? j : b), 0);
const colOf = (p: RangePrediction, r: number) => p.ranges.reduce((b, x, i) => (Math.abs(x - r) < Math.abs(p.ranges[b]! - r) ? i : b), 0);
const se = (p: RangePrediction, a: Float32Array, d: number, r: number) => a[rowOf(p, d) * p.ranges.length + colOf(p, r)]!;

describe('listening-range prediction', () => {
  it('a target below the layer is heard worse than one above it', () => {
    const p = predictRanges(escort);
    // Escort on the surface (hull at the surface): a boat at 50 m vs 200 m, same range
    expect(se(p, p.hear[0], 50, 5000)).toBeGreaterThan(se(p, p.hear[0], 200, 5000) + 5);
    // Boat: hearing a surface escort from above the layer vs below it
    const q = predictRanges(sub);
    expect(rowRange(q, q.hear[0], rowOf(q, 50))).toBeGreaterThan(rowRange(q, q.hear[0], rowOf(q, 200)));
  });

  it('higher own speed shrinks own range and grows counter-detection', () => {
    const slow = predictRanges(sub);
    const sr = rowRange(slow, slow.hear[0], slow.ownRow);
    const sc = rowRange(slow, slow.heard, slow.ownRow);
    const fast = predictRanges({ ...sub, ownSpeedKn: 12 });
    expect(rowRange(fast, fast.hear[0], fast.ownRow)).toBeLessThan(sr);
    expect(rowRange(fast, fast.heard, fast.ownRow)).toBeGreaterThan(sc);
  });

  it('a convergence zone appears only in deep water, around 50–62 km', () => {
    const deep = predictRanges({ ...sub, ownDepth: 40 });
    const cz = czBand(deep, deep.hear[0], deep.ownRow);
    expect(cz).toBeDefined();
    expect(cz![0]).toBeGreaterThanOrEqual(49_000);
    expect(cz![1]).toBeLessThanOrEqual(63_000);
    expect(predictionSummary(deep)).toContain('KONVERGENZZONE');
    // Medium depth (not deep): no zone, and the grid stops at 32 km
    const mid = predictRanges({ ...sub, ownDepth: 40, bottom: 1500 });
    expect(mid.maxRange).toBeLessThan(40_000);
    for (let j = 0; j < mid.depths.length; j++) expect(czBand(mid, mid.hear[0], j)).toBeUndefined();
  });

  it('unknown layer is evaluated without one and flagged; results are cached', () => {
    const p = predictRanges({ ...sub, layerDepth: undefined });
    expect(p.layerKnown).toBe(false);
    expect(predictRanges({ ...sub, layerDepth: undefined, ownDepth: 51 })).toBe(p);
    expect(p.depths[p.depths.length - 1]).toBeLessThanOrEqual(300);
  });
});
