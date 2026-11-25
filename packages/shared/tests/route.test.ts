import { describe, expect, it } from 'vitest';
import { REGIONS, ROUTE_ARRIVE_M, bearing, createShip, createWorld, distance, followRoute, northOffset, setRoute, stepWorld, toTrue } from '../src/index.js';

const env = { layerDepth: 80, layerLoss: 12, seaState: 2 };

describe('Route fahren', () => {
  it('steers for each waypoint in turn and stops at the last one', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 8, depth: 60, playerId: 'p1' });
    const w = createWorld([sub], 1, env);
    expect(setRoute(sub, { wps: [{ x: 0, y: 3000, speedKn: 10, depth: 100 }, { x: 3000, y: 3000 }], active: true })).toBeUndefined();
    let switched = false;
    for (let i = 0; i < 20_000 && sub.route!.active; i++) {
      stepWorld(w);
      if (sub.route!.idx === 1 && !switched) {
        switched = true;
        // Reached the first waypoint, now heading east for the second
        expect(distance(sub.pos, { x: 0, y: 3000 })).toBeLessThan(ROUTE_ARRIVE_M + 50);
        expect(sub.order.heading).toBeCloseTo(bearing(sub.pos, { x: 3000, y: 3000 }), 0);
      }
    }
    expect(switched).toBe(true);
    expect(sub.route!.active).toBe(false);
    expect(sub.route!.idx).toBe(2);
    expect(distance(sub.pos, { x: 3000, y: 3000 })).toBeLessThan(ROUTE_ARRIVE_M + 50);
    // The first leg's orders were given (clamped to the class)
    expect(sub.order.depth).toBe(100);
  });

  it('orders leg speed and depth once, so the player can still change them by hand', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 60 });
    setRoute(s, { wps: [{ x: 0, y: 10_000, speedKn: 99, depth: 9999 }], active: true });
    followRoute(s);
    expect(s.order.speedKn).toBeLessThanOrEqual(25);
    expect(s.order.depth).toBeLessThan(9999);
    s.order.speedKn = 3;
    followRoute(s);
    expect(s.order.speedKn).toBe(3);
    expect(s.route!.active).toBe(true);
  });

  it('a frigate ignores waypoint depths', () => {
    const f = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    const draft = f.order.depth;
    setRoute(f, { wps: [{ x: 5000, y: 0, depth: 200 }], active: true });
    followRoute(f);
    expect(f.order.depth).toBe(draft);
    expect(f.order.heading).toBeCloseTo(90, 5);
  });

  it('steers in the game frame, from where the boat believes it is', () => {
    // A real sea area turns the chart: the order stays in the game frame, the display adds the offset
    const off = northOffset('gibraltar');
    expect(off).not.toBe(0);
    expect(REGIONS.gibraltar).toBeDefined();
    const s = createShip({ id: 'u', cls: 'ssn', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 8, depth: 100 });
    setRoute(s, { wps: [{ x: 0, y: 10_000 }], active: true });
    followRoute(s);
    expect(s.order.heading).toBeCloseTo(0, 5);
    expect(toTrue(s.order.heading, off)).toBeCloseTo(toTrue(0, off), 5);
    // Dead-reckoning error: the boat thinks it is 2 km east, so it steers north-west-ish to the plotted point
    s.drErr = { x: 2000, y: 0 };
    followRoute(s);
    expect(s.order.heading).toBeCloseTo(bearing({ x: 2000, y: 0 }, { x: 0, y: 10_000 }), 5);
  });

  it('turning on an empty route is refused; a finished route starts again', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0 });
    expect(setRoute(s, { active: true })).toBeTypeOf('string');
    setRoute(s, { wps: [{ x: 0, y: 100 }] });
    setRoute(s, { active: true });
    followRoute(s);
    expect(s.route!.active).toBe(false);
    expect(s.route!.idx).toBe(1);
    setRoute(s, { active: true });
    expect(s.route!.idx).toBe(0);
  });
});
