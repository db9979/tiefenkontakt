import { describe, expect, it } from 'vitest';
import {
  KN,
  PERISCOPE_DEPTH,
  createConvoy,
  createShip,
  createWorld,
  distance,
  scatterConvoy,
  stepShip,
  stepWorld,
} from '../src/index.js';

describe('ship kinematics', () => {
  it('accelerates, turns and dives toward orders', () => {
    const s = createShip({ id: 'u', cls: 'ssn', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 50 });
    s.order = { heading: 90, speedKn: 10, depth: 200 };
    for (let t = 0; t < 300; t += 0.1) stepShip(s, 0.1, t);
    expect(s.speed / KN).toBeCloseTo(10, 1);
    expect(s.heading).toBeCloseTo(90, 0);
    expect(s.depth).toBeCloseTo(200, 0);
    expect(s.pos.x).toBeGreaterThan(500);
  });

  it('lowers masts when diving below periscope depth', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: PERISCOPE_DEPTH });
    s.mastUp = true;
    s.order.depth = 80;
    for (let t = 0; t < 20; t += 0.1) stepShip(s, 0.1, t);
    expect(s.mastUp).toBe(false);
  });

  it('drains the SSK battery fast at high speed and recharges when snorkeling', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 18, depth: 80 });
    s.order.speedKn = 18;
    const start = s.battery!;
    for (let t = 0; t < 3600; t += 1) stepShip(s, 1, t);
    expect(start - s.battery!).toBeGreaterThan(60);
    const low = s.battery!;
    s.order = { heading: 0, speedKn: 5, depth: PERISCOPE_DEPTH };
    s.snorkel = true;
    for (let t = 3600; t < 7200; t += 1) stepShip(s, 1, t);
    expect(s.battery!).toBeGreaterThan(low);
  });
});

describe('convoy AI', () => {
  function convoyWorld() {
    const ms = Array.from({ length: 6 }, (_, i) =>
      createShip({ id: `m${i}`, cls: 'merchant', name: `M${i}`, pos: { x: (i % 3) * 900, y: -Math.floor(i / 3) * 900 }, heading: 0, speedKn: 9 }),
    );
    const w = createWorld(ms, 5);
    w.convoy = createConvoy(ms, [{ x: 900, y: 40_000 }], 9);
    return { w, ms };
  }

  it('keeps formation while advancing and reports arrivals', () => {
    const { w, ms } = convoyWorld();
    for (let i = 0; i < 12000; i++) stepWorld(w, 1);
    expect(w.convoy!.arrived.length).toBe(ms.length);
    expect(w.events.filter((e) => e.kind === 'arrived')).toHaveLength(ms.length);
  });

  it('scatters away from a threat', () => {
    const { w, ms } = convoyWorld();
    const threat = { x: 900, y: 3000 };
    scatterConvoy(w.convoy!, threat, 0);
    const before = ms.map((m) => distance(m.pos, threat));
    for (let i = 0; i < 300; i++) stepWorld(w, 1);
    const after = ms.map((m) => distance(m.pos, threat));
    const fartherCount = after.filter((d, i) => d > before[i]!).length;
    expect(fartherCount).toBeGreaterThanOrEqual(5);
  });
});
