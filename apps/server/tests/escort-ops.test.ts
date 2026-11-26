import { describe, expect, it } from 'vitest';
import {
  FLYCO_REL_DEG, KN, createConvoy, createShip, createWorld, distance, heloOf, heloOrder, initMet, installAir, installWeapons, relativeWind, stepWorld, trueWind, zigPlanOf,
} from '@tk/shared';
import { newMemory } from '../src/bots/common.js';
import { PLAN_CHANGE_S, aiZigzag } from '../src/bots/convoy-plan.js';
import { RECON_ERR_M, convoyEstimate, reconReport } from '../src/bots/convoy-estimate.js';
import { steerFlyingCourse } from '../src/bots/helo.js';

describe('AI officer of the watch steers a flying course (F14)', () => {
  it('turns onto a course with the wind inside the envelope before the launch, and holds a good one', () => {
    const f = createShip({ id: 'p_bot-w1', cls: 'ffg', name: 'W1', team: 'west', pos: { x: 0, y: 0 }, heading: 60, speedKn: 12 });
    const w = createWorld([f], 3, { layerDepth: 80, layerLoss: 12, seaState: 3 });
    w.env.met = initMet([f], 3, { dynamic: false, ice: false, fogBanks: 0 });
    // Wind from 240 (blowing toward 060)
    w.env.met.wind = { x: Math.sin((60 * Math.PI) / 180) * 5, y: Math.cos((60 * Math.PI) / 180) * 5 };
    installWeapons(w);
    installAir(w);
    heloOrder(w, f, 'add', { kind: 'dip', at: { x: 0, y: 8000 } });
    stepWorld(w);
    // Nothing to launch: the screen course stands
    expect(steerFlyingCourse(w, { ...f, id: 'x' } as typeof f)).toBe(false);
    // The preparation runs: she comes onto a flying course at once (the minute with rotors running overlaps it)
    expect(heloOf(w, f.id)!.prepUntil).toBeDefined();
    expect(steerFlyingCourse(w, f)).toBe(true);
    const r = relativeWind(trueWind(w), f.order.heading, Math.max(12, f.speed / KN));
    expect(Math.abs(r.rel)).toBeLessThanOrEqual(FLYCO_REL_DEG);
    // Already on a good course: she holds it
    f.heading = f.order.heading;
    const held = f.order.heading;
    expect(steerFlyingCourse(w, f)).toBe(true);
    expect(f.order.heading).toBe(Math.round(held) % 360);
  });
});

describe('AI escort commander orders the zigzag plan (F28)', () => {
  function convoyWorld(human = false) {
    const ms = [0, 1].map((i) => createShip({ id: `m${i}`, cls: 'merchant', name: `M${i}`, team: 'west', pos: { x: i * 900, y: 0 }, heading: 0, speedKn: 9 }));
    const esc = createShip({ id: human ? 'p_w1' : 'p_bot-w1', cls: 'ffg', name: 'F', team: 'west', pos: { x: 0, y: 5000 }, heading: 0, speedKn: 12 });
    const w = createWorld([...ms, esc], 5);
    w.convoy = createConvoy(ms, [{ x: 0, y: 100_000 }], 9, 900, 42);
    return w;
  }

  it('the irregular plan under a threat; a new quiet plan every watch; hands off when a human commands', () => {
    const w = convoyWorld();
    const c = w.convoy!;
    const first = zigPlanOf(c);
    w.time = 600;
    aiZigzag(w, 'west', 590);
    expect(zigPlanOf(c)).toBe(3);
    w.time = 600 + 900 + PLAN_CHANGE_S;
    aiZigzag(w, 'west', 590);
    expect([1, 2]).toContain(zigPlanOf(c));
    expect(first).toBeGreaterThan(0);
    const h = convoyWorld(true);
    const before = zigPlanOf(h.convoy!);
    h.time = 600;
    aiZigzag(h, 'west', 590);
    expect(zigPlanOf(h.convoy!)).toBe(before);
    // Zigzag off (lessons): left off
    const off = convoyWorld();
    off.convoy!.zigzag = false;
    aiZigzag(off, 'west', 0);
    expect(zigPlanOf(off.convoy!)).toBe(0);
  });
});

describe('Ostpakt patrol ship: convoy from its own picture (F29)', () => {
  it('no radar picture and no report: no convoy; the recon report comes with its targeting error and is dead reckoned', () => {
    const p = createShip({ id: 'p_bot-e9', cls: 'ffk', name: 'P', team: 'east', pos: { x: 0, y: 60_000 }, heading: 180, speedKn: 12 });
    const m1 = createShip({ id: 'm1', cls: 'merchant', name: 'M1', team: 'west', pos: { x: 0, y: 0 }, heading: 0, speedKn: 9 });
    const w = createWorld([p, m1], 5);
    const m = newMemory(p.id);
    expect(convoyEstimate(w, m, p, [])).toBeUndefined();
    m.convoyLine = reconReport(p, { time: 0, x: 0, y: 0, course: 0, speedKn: 9 });
    const at0 = convoyEstimate(w, m, p, [])!;
    expect(distance(at0, { x: 0, y: 0 })).toBeLessThan(4 * RECON_ERR_M);
    expect(distance(at0, { x: 0, y: 0 })).toBeGreaterThan(1);
    w.time = 600;
    const later = convoyEstimate(w, m, p, [])!;
    expect(later.y - at0.y).toBeCloseTo(9 * KN * 600, 0);
  });
});
