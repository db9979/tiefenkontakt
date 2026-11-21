import { describe, expect, it } from 'vitest';
import { DEFAULT_ENV, KN, activeSignalExcess, createShip, stepShip, type ClassId, type Ship } from '../src/index.js';

/** Guard rails for game balance. Change deliberately, with scripts/balance.ts. */
const mk = (cls: ClassId, kn: number, depth?: number): Ship =>
  createShip({ id: cls, cls, name: cls, pos: { x: 0, y: 0 }, heading: 0, speedKn: kn, depth });

function maxRange(f: (r: number) => number): number {
  let lo = 10;
  let hi = 400_000;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) lo = m;
    else hi = m;
  }
  return lo;
}

describe('balance guard rails', () => {
  it('active sonar reaches 4-9 km above the layer and under half that below it', () => {
    const above = maxRange((r) => activeSignalExcess(mk('ssk', 4, 60), mk('ffg', 15), r, DEFAULT_ENV));
    const below = maxRange((r) => activeSignalExcess(mk('ssk', 4, 150), mk('ffg', 15), r, DEFAULT_ENV));
    expect(above).toBeGreaterThan(4000);
    expect(above).toBeLessThan(9000);
    expect(below).toBeLessThan(above / 2 + 500);
  });

  it('an SSK sprinting at full speed empties its battery within about an hour of sim time', () => {
    const s = mk('ssk', 18, 80);
    s.order.speedKn = 18;
    let t = 0;
    while (s.battery! > 0 && t < 7200) stepShip(s, 1, t++);
    expect(t).toBeGreaterThan(1800);
    expect(t).toBeLessThan(4000);
    expect(s.speed / KN).toBeGreaterThan(0);
  });
});
