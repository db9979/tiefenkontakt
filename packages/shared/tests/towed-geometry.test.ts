import { describe, expect, it } from 'vitest';
import { KN, TOWED_MAX_DEPTH, createShip, towedArrayDepth, towedDepthFor } from '../src/index.js';

describe('towed-array geometry (F27)', () => {
  it('the array rises with speed: about 250 m at 6 kn and 100 m at 15 kn on 1,5 km of cable', () => {
    const slow = towedDepthFor(0, 1500, 6, false);
    const fast = towedDepthFor(0, 1500, 15, false);
    expect(slow).toBeGreaterThan(220);
    expect(slow).toBeLessThan(TOWED_MAX_DEPTH + 1);
    expect(fast).toBeGreaterThan(90);
    expect(fast).toBeLessThan(160);
    // Longer cable, deeper array; capped at the deepest it goes
    expect(towedDepthFor(0, 900, 10, false)).toBeLessThan(towedDepthFor(0, 1500, 10, false));
    expect(towedDepthFor(0, 2000, 2, false)).toBe(TOWED_MAX_DEPTH);
  });

  it('the ship\'s array follows her speed through the water; a submarine\'s trails nearly level', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 6 });
    ffg.towedLength = 900;
    ffg.speed = 6 * KN;
    const at6 = towedArrayDepth(ffg);
    ffg.speed = 18 * KN;
    expect(towedArrayDepth(ffg)).toBeLessThan(at6 / 2);
    const ssn = createShip({ id: 'n', cls: 'ssn', name: 'N', pos: { x: 0, y: 0 }, heading: 0, speedKn: 6, depth: 150 });
    ssn.towedLength = 800;
    expect(towedArrayDepth(ssn)).toBeCloseTo(190, 0);
  });
});
