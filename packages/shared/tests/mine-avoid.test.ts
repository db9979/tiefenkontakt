import { describe, expect, it } from 'vitest';
import {
  CONVOY_DETOUR_MAX, KN, MINE_AVOID_FACTOR, MINE_DETECT_M, createConvoy, createShip, createWorld, installWeapons, mineSearchRange, setConvoyOffset, stepConvoy,
} from '../src/index.js';

describe('mine countermeasures', () => {
  it('the high-frequency mine-avoidance sonar reaches further, works without the active hull sonar, not when fast', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', team: 'west', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    const w = createWorld([ffg], 3, { layerDepth: 80, layerLoss: 12, seaState: 0, seabed: { kind: 'schelf', seed: 3 } });
    installWeapons(w);
    ffg.speed = 10 * KN;
    expect(mineSearchRange(w, ffg)).toBe(0);
    ffg.activeSonar = true;
    expect(mineSearchRange(w, ffg)).toBe(MINE_DETECT_M);
    ffg.activeSonar = false;
    ffg.mineAvoid = true;
    expect(mineSearchRange(w, ffg)).toBe(MINE_DETECT_M * MINE_AVOID_FACTOR);
    ffg.speed = 20 * KN;
    expect(mineSearchRange(w, ffg)).toBe(0);
    // Submarines have none
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, depth: 40 });
    sub.mineAvoid = true;
    expect(mineSearchRange(w, sub)).toBe(0);
  });

  it('a detour shifts the convoy track sideways and back again', () => {
    const m = createShip({ id: 'm1', cls: 'merchant', name: 'M', team: 'west', pos: { x: 0, y: 0 }, heading: 0, speedKn: 9 });
    const run = (offset: number) => {
      const c = createConvoy([{ ...m, pos: { x: 0, y: 0 } }], [{ x: 0, y: 40_000 }], 9);
      c.zigzag = false;
      setConvoyOffset(c, offset);
      for (let t = 0; t < 1200; t++) stepConvoy(c, [], 1, t);
      return c.guide;
    };
    expect(Math.abs(run(0).x)).toBeLessThan(1);
    // 2 km to starboard of a northbound leg = east (+x)
    expect(run(2000).x).toBeGreaterThan(400);
    expect(run(-2000).x).toBeLessThan(-400);
    const c = createConvoy([m], [{ x: 0, y: 40_000 }], 9);
    setConvoyOffset(c, 99_000);
    expect(c.offset).toBe(CONVOY_DETOUR_MAX);
    setConvoyOffset(c, 0);
    expect(c.offset).toBeUndefined();
  });
});
