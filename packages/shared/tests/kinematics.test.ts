import { describe, expect, it } from 'vitest';
import {
  KN,
  PERISCOPE_DEPTH,
  createConvoy,
  createShip,
  createWorld,
  distance,
  mastRaised,
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
    // A loaded merchant needs about 8 minutes to come round (700 m turning radius)
    for (let i = 0; i < 600; i++) stepWorld(w, 1);
    const after = ms.map((m) => distance(m.pos, threat));
    const fartherCount = after.filter((d, i) => d > before[i]!).length;
    expect(fartherCount).toBeGreaterThanOrEqual(5);
  });
});

describe('realistic ship handling', () => {
  const run = (s: ReturnType<typeof createShip>, secs: number) => {
    for (let i = 0; i < secs * 10; i++) stepShip(s, 0.1, i / 10);
  };

  it('hoists the mast in about 8 s and lowers it in about 5 s', () => {
    const u = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 18, speedKn: 4 });
    u.mastUp = true;
    run(u, 4);
    expect(mastRaised(u)).toBe(false);
    expect(u.mastExt).toBeGreaterThan(0.4);
    run(u, 5);
    expect(mastRaised(u)).toBe(true);
    u.mastUp = false;
    run(u, 5.5);
    expect(u.mastExt).toBe(0);
  });

  it('turns on a turning circle: slow ships turn slowly, fast ones near their limit', () => {
    const slow = createShip({ id: 'a', cls: 'ffg', name: 'A', pos: { x: 0, y: 0 }, heading: 0, speedKn: 5 });
    const fast = createShip({ id: 'b', cls: 'ffg', name: 'B', pos: { x: 0, y: 0 }, heading: 0, speedKn: 25 });
    slow.order.heading = fast.order.heading = 180;
    run(slow, 30);
    run(fast, 30);
    expect(slow.heading).toBeLessThan(25);
    expect(fast.heading).toBeGreaterThan(30);
    // Rate of turn builds up: after 1 s the frigate has turned only a little
    const c = createShip({ id: 'c', cls: 'ffg', name: 'C', pos: { x: 0, y: 0 }, heading: 0, speedKn: 25 });
    c.order.heading = 90;
    run(c, 1);
    expect(c.heading).toBeLessThan(1);
  });

  it('meets the ordered course without overshooting', () => {
    const s = createShip({ id: 's', cls: 'ssn', name: 'S', pos: { x: 0, y: 0 }, heading: 0, speedKn: 20, depth: 100 });
    s.order.heading = 60;
    let max = 0;
    for (let i = 0; i < 1200; i++) {
      stepShip(s, 0.1, i / 10);
      max = Math.max(max, s.heading > 180 ? 0 : s.heading);
    }
    expect(s.heading).toBeCloseTo(60, 1);
    expect(max).toBeLessThan(61);
  });

  it('changes depth on the planes: faster under way, slowly when stopped', () => {
    const moving = createShip({ id: 'm', cls: 'ssk', name: 'M', pos: { x: 0, y: 0 }, heading: 0, depth: 100, speedKn: 6 });
    const stopped = createShip({ id: 'z', cls: 'ssk', name: 'Z', pos: { x: 0, y: 0 }, heading: 0, depth: 100, speedKn: 0 });
    moving.order.depth = stopped.order.depth = 18;
    run(moving, 60);
    run(stopped, 60);
    expect(100 - moving.depth).toBeGreaterThan(40);
    expect(100 - moving.depth).toBeLessThan(75);
    expect(100 - stopped.depth).toBeLessThan(15);
  });

  it('a nuclear boat needs minutes, not seconds, to reach full speed', () => {
    const s = createShip({ id: 'n', cls: 'ssn', name: 'N', pos: { x: 0, y: 0 }, heading: 0, speedKn: 0, depth: 100 });
    s.order.speedKn = 30;
    run(s, 120);
    expect(s.speed / 0.514444).toBeLessThan(15);
    run(s, 200);
    expect(s.speed / 0.514444).toBeGreaterThan(29);
  });
});
