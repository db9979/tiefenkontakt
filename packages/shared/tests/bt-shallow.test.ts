import { describe, expect, it } from 'vitest';
import { DEFAULT_ENV, createShip, createWorld, depthAt, measureLayer, type Environment } from '../src/index.js';

describe('bathythermograph in shallow water', () => {
  it('finds no layer where the water is shallower than the layer, and the layer where it is deep', () => {
    const env: Environment = { ...DEFAULT_ENV, layerDepth: 90, seabed: { kind: 'fjord', seed: 9, region: 'messina' } };
    const sb = env.seabed!;
    let shallow: { x: number; y: number } | undefined;
    let deep: { x: number; y: number } | undefined;
    for (let x = -30_000; x <= 30_000 && !(shallow && deep); x += 500) {
      for (let y = -30_000; y <= 30_000 && !(shallow && deep); y += 500) {
        const d = depthAt(sb, x, y);
        if (!shallow && d > 10 && d < 60) shallow = { x, y };
        if (!deep && d > 200) deep = { x, y };
      }
    }
    const a = createShip({ id: 'a', cls: 'ffg', name: 'A', pos: shallow!, heading: 0, speedKn: 0 });
    const b = createShip({ id: 'b', cls: 'ffg', name: 'B', pos: deep!, heading: 0, speedKn: 0 });
    const w = createWorld([a, b], 1, env);
    measureLayer(w, a);
    measureLayer(w, b);
    expect(a.btLayer).toBe(0);
    expect(b.btLayer).toBeGreaterThan(75);
    expect(b.btLayer).toBeLessThan(105);
  });
});
