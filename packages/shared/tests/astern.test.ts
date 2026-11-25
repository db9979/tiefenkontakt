import { describe, expect, it } from 'vitest';
import { CLASSES, DEFAULT_ENV, KN, asternMaxKn, createShip, createWorld, depthAt, headingVec, stepShip, stepWorld } from '../src/index.js';

describe('going astern', () => {
  it('loses her way first, then gathers sternway up to the astern limit and moves backwards', () => {
    const s = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    s.order.speedKn = -20;
    let stopped = false;
    for (let t = 0; t < 9000; t++) {
      const before = s.speed;
      stepShip(s, 0.1, t / 10);
      if (s.sternway && !stopped) {
        // The first sternway step starts from (almost) a standstill
        expect(before).toBeLessThan(0.1);
        stopped = true;
      }
    }
    expect(s.sternway).toBe(true);
    expect(s.speed / KN).toBeCloseTo(asternMaxKn('ffg'), 0);
    const y = s.pos.y;
    stepShip(s, 10, 1000);
    expect(s.pos.y).toBeLessThan(y);
    // Ahead again: she comes to a stop before making headway
    s.order.speedKn = 10;
    for (let t = 0; t < 900; t++) stepShip(s, 1, 2000 + t);
    expect(s.sternway).toBe(false);
    expect(s.speed / KN).toBeCloseTo(10, 0);
  });
});

describe('backing off the ground', () => {
  it('a ship run aground bow first works herself off astern into deeper water', () => {
    const env = { ...DEFAULT_ENV, seabed: { kind: 'fjord' as const, seed: 9, region: 'messina' } };
    const draft = CLASSES.ffg.draft;
    // A spot where she sits on the ground, bow to the shore, with open water astern
    let at: { x: number; y: number; h: number } | undefined;
    for (let x = -40_000; x <= 40_000 && !at; x += 100) {
      for (let y = -40_000; y <= 40_000 && !at; y += 100) {
        const d = depthAt(env.seabed, x, y);
        if (!(d > 0.5 && d < draft)) continue;
        for (let h = 0; h < 360 && !at; h += 45) {
          const v = headingVec(h);
          if (depthAt(env.seabed, x - v.x * 60, y - v.y * 60) > d + 0.5 && depthAt(env.seabed, x - v.x * 300, y - v.y * 300) > draft + 10) at = { x, y, h };
        }
      }
    }
    expect(at).toBeDefined();
    const s = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: at!.x, y: at!.y }, heading: at!.h, speedKn: 0 });
    const w = createWorld([s], 1, env);
    stepWorld(w);
    expect(s.order.speedKn).toBe(0);
    s.order.speedKn = -5;
    for (let i = 0; i < 3000; i++) stepWorld(w);
    expect(Math.hypot(s.pos.x - at!.x, s.pos.y - at!.y)).toBeGreaterThan(100);
    expect(depthAt(env.seabed, s.pos.x, s.pos.y)).toBeGreaterThan(draft + 1);
  });
});
