import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  CRIPPLED_MAX_KN,
  FOUNDER_S,
  KN,
  LAUNCH_MAX_KN,
  bearing,
  createConvoy,
  createShip,
  createWorld,
  defaultSpreadDeg,
  fireSalvo,
  fireTorpedo,
  heavyRange,
  installWeapons,
  launchBlock,
  runTimeLeft,
  stepWorld,
  weaponHit,
  type Torpedo,
} from '../src/index.js';

function duel(sub = { speedKn: 3, depth: 60 }) {
  const u = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: sub.speedKn, depth: sub.depth });
  const m = createShip({ id: 'm1', cls: 'merchant', name: 'M1', pos: { x: 0, y: 5000 }, heading: 90, speedKn: 10 });
  const w = createWorld([u, m], 2);
  installWeapons(w);
  return { w, u, m };
}

describe('heavyweight torpedo (C8)', () => {
  it('reaches 25 km at 30 kn and 15 km at 40 kn', () => {
    expect(heavyRange(30)).toBe(25_000);
    expect(heavyRange(40)).toBe(15_000);
    expect(heavyRange(35)).toBe(20_000);
    const { w, u } = duel();
    const slow = fireTorpedo(w, u, { heading: 0, speedKn: 30 }) as Torpedo;
    const fast = fireTorpedo(w, u, { heading: 0, speedKn: 40 }) as Torpedo;
    expect(slow.maxRun).toBe(25_000);
    expect(fast.maxRun).toBe(15_000);
    // Run time left: the fuel at the run speed
    expect(runTimeLeft(fast)).toBeCloseTo(15_000 / (40 * KN), 0);
  });

  it('can only be launched at 15 kn or slower and no deeper than 0.8 × test depth', () => {
    const fast = duel({ speedKn: 17, depth: 60 });
    expect(fireTorpedo(fast.w, fast.u, { heading: 0 })).toBe('Abschuss nur bis 15 kn (jetzt 17 kn)');
    const deepest = Math.floor(CLASSES.ssk.maxDepth * 0.8);
    const deep = duel({ speedKn: 4, depth: deepest + 20 });
    expect(fireTorpedo(deep.w, deep.u, { heading: 0 })).toBe(`Abschuss nur bis ${deepest} m Tiefe (jetzt ${deepest + 20} m)`);
    expect(launchBlock('ssk', LAUNCH_MAX_KN, deepest)).toBeUndefined();
    expect(launchBlock('ssk', 16, 50)).toEqual({ why: 'speed', limit: 15 });
    // Surface ships' tubes have no such envelope
    expect(launchBlock('ffg', 28, 6)).toBeUndefined();
  });

  it('a salvo fans 1–4 torpedoes symmetrically about the solution bearing', () => {
    const { w, u } = duel();
    const r = fireSalvo(w, u, { heading: 90, speedKn: 40 }, 4, 3);
    expect(Array.isArray(r)).toBe(true);
    expect((r as Torpedo[]).map((t) => t.heading)).toEqual([85.5, 88.5, 91.5, 94.5]);
    // More than the loaded tubes: fires what is loaded (6 tubes, 4 gone)
    const more = fireSalvo(w, u, { heading: 0 }, 4, 2) as Torpedo[];
    expect(more).toHaveLength(2);
    expect(fireSalvo(w, u, { heading: 0 }, 2, 2)).toBe('Kein Rohr geladen');
  });

  it('the default spread is the target length at range plus the TMA error, 2–4°', () => {
    expect(defaultSpreadDeg(3000, 1)).toBeGreaterThan(3);
    expect(defaultSpreadDeg(20_000, 0)).toBe(2);
    expect(defaultSpreadDeg(1000, 3)).toBe(4);
  });
});

describe('merchant hit (C8)', () => {
  it('one hit cripples her: ≤4 kn, she founders about 15 minutes later, credited to the shooter', () => {
    const { w, m } = duel();
    weaponHit(w, m, 95, 'u1');
    expect(m.alive).toBe(true);
    expect(m.founderAt).toBeCloseTo(w.time + FOUNDER_S);
    for (let i = 0; i < 600; i++) stepWorld(w);
    expect(m.speed / KN).toBeLessThanOrEqual(CRIPPLED_MAX_KN + 1e-6);
    expect(m.alive).toBe(true);
    for (let i = 0; i < FOUNDER_S * 10 && m.alive; i++) stepWorld(w);
    expect(m.alive).toBe(false);
    expect(w.time).toBeGreaterThan(FOUNDER_S * 0.8);
    expect(w.events.some((e) => e.kind === 'sunk' && e.shipId === 'm1' && e.byId === 'u1')).toBe(true);
  });

  it('a heavyweight hit on a merchant does 95, two sink her at once', () => {
    const { w, u, m } = duel();
    fireTorpedo(w, u, { heading: bearing(u.pos, m.pos) + 5, enableAfter: 2500, searchDepth: 10 });
    for (let i = 0; i < 6000 && m.hp >= 110; i++) stepWorld(w);
    expect(m.hp).toBeLessThanOrEqual(15);
    expect(m.founderAt).toBeDefined();
    weaponHit(w, m, 95, 'u1');
    stepWorld(w);
    expect(m.alive).toBe(false);
  });

  it('escorts are not crippled by one hit', () => {
    const f = createShip({ id: 'f1', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    const w = createWorld([f], 1);
    installWeapons(w);
    weaponHit(w, f, 80, 'u1');
    expect(f.founderAt).toBeUndefined();
  });

  it('the crippled freighter falls out of the convoy formation as a straggler', () => {
    const ms = Array.from({ length: 4 }, (_, i) => createShip({ id: `m${i}`, cls: 'merchant', name: `M${i}`, pos: { x: (i % 2) * 900, y: -Math.floor(i / 2) * 900 }, heading: 0, speedKn: 9 }));
    const w = createWorld(ms, 5);
    installWeapons(w);
    w.convoy = createConvoy(ms, [{ x: 450, y: 60_000 }], 9);
    for (let i = 0; i < 600; i++) stepWorld(w);
    weaponHit(w, ms[0]!, 95, 'u1');
    for (let i = 0; i < 8000; i++) stepWorld(w);
    expect(ms[0]!.alive).toBe(true);
    expect(ms[0]!.order.speedKn).toBeLessThanOrEqual(CRIPPLED_MAX_KN);
    // The others steamed on: she is kilometres astern of her station
    expect(ms[1]!.pos.y - ms[0]!.pos.y).toBeGreaterThan(1500);
  });
});
