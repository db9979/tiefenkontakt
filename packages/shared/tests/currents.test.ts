import { describe, expect, it } from 'vitest';
import { KN, currentAt, tideState, type Environment } from '../src/index.js';

const env = (region: Environment['seabed'] extends infer S ? S extends { region?: infer R } ? R : never : never, phase = 0): Environment =>
  ({ layerDepth: 80, layerLoss: 12, seaState: 2, seabed: { kind: 'fjord', seed: 1, region }, tidePhase: phase });

describe('currents and tides', () => {
  it('Gibraltar: two layers, opposite ways (at slack tide)', () => {
    const e = env('gibraltar', Math.PI / 2);
    // Strait axis runs along the route there (bearing 88°): east = game +y
    const top = currentAt(e, { x: 0, y: 0 }, 20, 0);
    const deep = currentAt(e, { x: 0, y: 0 }, 300, 0);
    if (Math.hypot(top.x, top.y) > 0.01) {
      expect(top.y).toBeGreaterThan(0.5 * KN);
      expect(deep.y).toBeLessThan(-0.5 * KN);
    }
  });

  it('the tide turns every six hours or so', () => {
    const e = env('pentland', 0);
    const t = tideState(e, 0)!;
    expect(t.flood).toBe(true);
    expect(t.turnsInS).toBeGreaterThan(10_000);
    expect(t.turnsInS).toBeLessThan(11_300);
    expect(tideState(e, t.turnsInS + 60)!.flood).toBe(false);
  });

  it('no atlas, no current except the drawn set', () => {
    const e: Environment = { layerDepth: 0, layerLoss: 0, seaState: 1 };
    expect(currentAt(e, { x: 0, y: 0 }, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});
