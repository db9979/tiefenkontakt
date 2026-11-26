import { describe, expect, it } from 'vitest';
import {
  KN, ZIG_PLANS, ZIG_SWING_M, angleDiff, createConvoy, createShip, defaultZigPlan, setZigPlan, stepConvoy, zigAdvance, zigCycle, zigNow, zigOffset, zigPlanLegs, zigPlanOf,
} from '../src/index.js';

describe('convoy zigzag plans (F28)', () => {
  it('every plan is irregular, stays within the swing, returns to the base track and keeps a realistic advance', () => {
    for (const seed of [1, 3, 17, 4242]) {
      for (let n = 1; n <= ZIG_PLANS.length; n++) {
        const legs = zigPlanLegs(n, seed);
        expect(legs.length).toBeGreaterThanOrEqual(5);
        let y = 0;
        let worst = 0;
        for (const l of legs) {
          expect(Math.abs(l.dc)).toBeGreaterThanOrEqual(10);
          expect(Math.abs(l.dc)).toBeLessThanOrEqual(60);
          expect(l.s).toBeGreaterThanOrEqual(60);
          expect(l.s).toBeLessThanOrEqual(20 * 60);
          y += 9 * KN * l.s * Math.sin((l.dc * Math.PI) / 180);
          worst = Math.max(worst, Math.abs(y));
        }
        expect(worst).toBeLessThan(ZIG_SWING_M + 150);
        expect(Math.abs(y)).toBeLessThan(200);
        // Speed of advance: cos of the mean angle, 75–98 % of the speed through the water
        const adv = zigAdvance(legs);
        expect(adv).toBeGreaterThan(0.75);
        expect(adv).toBeLessThan(0.99);
        // Not a square wave: the legs differ in length
        expect(new Set(legs.map((l) => l.s)).size).toBeGreaterThan(2);
      }
    }
  });

  it('plans come from the match seed: same seed same legs, another seed other legs', () => {
    expect(zigPlanLegs(3, 17)).toEqual(zigPlanLegs(3, 17));
    expect(zigPlanLegs(3, 17)).not.toEqual(zigPlanLegs(3, 18));
    expect([1, 2, 3]).toContain(defaultZigPlan(12345));
  });

  it('a sharper plan advances slower than a shallow one', () => {
    const adv = (n: number) => zigAdvance(zigPlanLegs(n, 7));
    expect(adv(4)).toBeLessThan(adv(1));
  });

  it('zigOffset walks the legs and wraps around the cycle', () => {
    const legs = [{ dc: 20, s: 300 }, { dc: -35, s: 200 }];
    expect(zigOffset(legs, 10)).toEqual({ dc: 20, leftS: 290 });
    expect(zigOffset(legs, 350).dc).toBe(-35);
    expect(zigOffset(legs, zigCycle(legs) + 10).dc).toBe(20);
  });

  it('all merchants turn together and the formation keeps its bearings on the base course', () => {
    const ms = [0, 1, 2, 3].map((i) => createShip({ id: `m${i}`, cls: 'merchant', name: `M${i}`, team: 'west', pos: { x: (i % 2) * 900 - 450, y: -Math.floor(i / 2) * 900 }, heading: 0, speedKn: 9 }));
    const c = createConvoy(ms, [{ x: 0, y: 200_000 }], 9, 900, 17);
    setZigPlan(c, 4, 0);
    expect(zigPlanOf(c)).toBe(4);
    const dt = 1;
    for (let t = 0; t < 1800; t += dt) {
      stepConvoy(c, ms, dt, t);
      for (const m of ms) {
        // Simple kinematics: the ships take their ordered course and speed
        m.heading = m.order.heading;
        m.speed = m.order.speedKn * KN;
        const v = { x: Math.sin((m.heading * Math.PI) / 180), y: Math.cos((m.heading * Math.PI) / 180) };
        m.pos = { x: m.pos.x + v.x * m.speed * dt, y: m.pos.y + v.y * m.speed * dt };
      }
    }
    // The base course stays on the route; the guide swings off it by the plan's angle
    expect(Math.abs(angleDiff(c.baseHeading!, 0))).toBeLessThan(5);
    expect(Math.abs(angleDiff(c.guideHeading, c.baseHeading!))).toBeGreaterThanOrEqual(25);
    // Ships steer parallel (together), not each on her own course
    const hs = ms.map((m) => m.order.heading);
    for (const h of hs) expect(Math.abs(angleDiff(h, hs[0]!))).toBeLessThan(12);
    // The formation's front row still lies abeam on the base course
    expect(Math.abs(ms[0]!.pos.y - ms[1]!.pos.y)).toBeLessThan(400);
  });

  it('switching the zigzag off and back on keeps the plan', () => {
    const c = createConvoy([], [{ x: 0, y: 10_000 }], 9, 900, 5);
    setZigPlan(c, 6, 100);
    setZigPlan(c, 0, 200);
    expect(zigPlanOf(c)).toBe(0);
    expect(zigNow(c, 300).dc).toBe(0);
    setZigPlan(c, 6, 400);
    expect(zigPlanOf(c)).toBe(6);
    expect(c.zigFrom).toBe(400);
  });
});
