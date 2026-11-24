import { describe, expect, it } from 'vitest';
import { depthAt, lineOfSight, profile, terrainLossDb, type SeabedSpec } from '../src/index.js';

const spec: SeabedSpec = { kind: 'fjord', seed: 3 };

/** Two water points with land between them, found by walking across the fjord side. */
function acrossLand(): { a: { x: number; y: number }; b: { x: number; y: number } } {
  for (let y = 0; y < 60_000; y += 1000) {
    const a = { x: 0, y };
    if (depthAt(spec, a.x, a.y) < 50) continue;
    for (let x = 2000; x < 30_000; x += 500) {
      const b = { x, y };
      if (depthAt(spec, b.x, b.y) > 20 && profile(spec, a, b).minDepth < -10) return { a, b };
    }
  }
  throw new Error('no land crossing found');
}

describe('terrain between two points', () => {
  it('open water along the channel costs nothing and is in sight', () => {
    const a = { x: 0, y: 1000 }, b = { x: 0, y: 1500 };
    expect(terrainLossDb(spec, a, 50, b, 50)).toBe(0);
    expect(lineOfSight(spec, a, 20, b, 25)).toBe(true);
  });

  it('land in between blocks sound, radar and sight', () => {
    const { a, b } = acrossLand();
    expect(terrainLossDb(spec, a, 50, b, 50)).toBeGreaterThanOrEqual(40);
    expect(profile(spec, a, b).landM).toBeGreaterThan(0);
  });

  it('without a chart nothing is in the way', () => {
    expect(terrainLossDb(undefined, { x: 0, y: 0 }, 50, { x: 50_000, y: 0 }, 50)).toBe(0);
    expect(lineOfSight(undefined, { x: 0, y: 0 }, 20, { x: 50_000, y: 0 }, 25)).toBe(true);
  });
});
