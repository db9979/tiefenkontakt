import { describe, expect, it } from 'vitest';
import {
  KN, Rng, ambientNoise, createShip, createWorld, fogAt, iceCover, initMet, lookoutSweep, metView, runSensors, sightPenalty, stepWorld,
  type Environment, type MetState,
} from '../src/index.js';

const day: Environment = { layerDepth: 100, layerLoss: 12, seaState: 3, light: 1 };

const frigate = (y = 0) => createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y }, heading: 0, speedKn: 12, team: 'west' });
const surfacedSub = (y: number) => createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y }, heading: 90, speedKn: 4, depth: 0, team: 'east' });

/** An empty met state with chosen cells (no drift, no squall formation). */
function met(p: Partial<MetState>): MetState {
  return {
    wind: { x: 0, y: 0 }, drift: { x: 0, y: 0 }, fog: [], squalls: [], floes: [], bergs: [], rng: 1, nextId: 100,
    dynamic: false, area: { x: 0, y: 0, half: 50_000 }, next: 0, hits: {}, ...p,
  };
}

describe('met cells', () => {
  it('are deterministic from the seed and keep clear of the starting ships', () => {
    const ships = [frigate(), surfacedSub(20_000)];
    const a = initMet(ships, 42, { dynamic: true, ice: true, fogBanks: 3 });
    const b = initMet(ships, 42, { dynamic: true, ice: true, fogBanks: 3 });
    const c = initMet(ships, 43, { dynamic: true, ice: true, fogBanks: 3 });
    expect(metView(a)).toEqual(metView(b));
    expect(metView(a)).not.toEqual(metView(c));
    expect(a.fog).toHaveLength(3);
    expect(a.floes.length).toBeGreaterThan(0);
    expect(a.bergs.length).toBeGreaterThan(4);
    for (const s of ships) expect(fogAt(a, s.pos)).toBe(0);
  });

  it('drift with the wind, and squalls die out and form again', () => {
    const w = createWorld([frigate()], 1, day);
    w.env.met = met({
      wind: { x: 5, y: 0 }, dynamic: true,
      fog: [{ id: 1, x: 0, y: 10_000, r: 2000, d: 1 }],
      squalls: [{ id: 2, x: -5000, y: 0, r: 2000, until: 120 }],
    });
    for (let i = 0; i < 600; i++) stepWorld(w); // 60 s
    const m = w.env.met;
    expect(m.fog[0]!.x).toBeCloseTo(5 * 0.6 * 60, -1);
    expect(m.fog[0]!.y).toBe(10_000);
    expect(m.squalls.find((s) => s.id === 2)!.x).toBeGreaterThan(-5000 + 5 * 60);
    for (let i = 0; i < 700; i++) stepWorld(w); // past 120 s
    expect(m.squalls.some((s) => s.id === 2)).toBe(false);
    expect(m.squalls.length).toBe(2);
  });

  it('a fog bank between hides a surfaced boat from the lookouts and the periscope', () => {
    const f = frigate();
    const u = surfacedSub(3000);
    const clear = { ...day };
    const foggy = { ...day, met: met({ fog: [{ id: 1, x: 0, y: 1500, r: 600, d: 1 }] }) };
    expect(sightPenalty(foggy.met, f.pos, u.pos)).toBeGreaterThan(15_000);
    const seen = (env: Environment) => {
      const rng = new Rng(5);
      for (let i = 0; i < 30; i++) if (lookoutSweep(f, [f, u], env, rng).length) return true;
      return false;
    };
    expect(seen(clear)).toBe(true);
    expect(seen(foggy)).toBe(false);
    // Periscope of a boat at periscope depth looking at the frigate through the bank
    const p = createShip({ id: 'p', cls: 'ssk', name: 'P', pos: { x: 0, y: 3000 }, heading: 180, speedKn: 3, depth: 15, team: 'east' });
    p.mastUp = true;
    const scope = (env: Environment) => runSensors({ ships: [f, p], env, time: 1, rng: new Rng(2) }).some((d) => d.sensor === 'periscope');
    expect(scope(clear)).toBe(true);
    expect(scope(foggy)).toBe(false);
  });

  it('a squall overhead and ice floes raise the ambient noise locally', () => {
    const env = { ...day, met: met({
      squalls: [{ id: 1, x: 0, y: 0, r: 2000, until: 1e9 }],
      floes: [{ id: 2, x: 20_000, y: 0, r: 3000, cover: 0.8 }],
    }) };
    const base = ambientNoise(day);
    expect(ambientNoise(env, { x: 0, y: 0 })).toBe(base + 6);
    expect(ambientNoise(env, { x: 10_000, y: 0 })).toBe(base);
    expect(iceCover(env.met, { x: 20_000, y: 0 })).toBeCloseTo(0.8);
    expect(ambientNoise(env, { x: 20_000, y: 0 })).toBeGreaterThan(base + 6);
  });

  it('ramming an iceberg damages a player ship; a deep boat passes below the keel', () => {
    const f = frigate();
    f.playerId = 'p1';
    const deep = createShip({ id: 'd', cls: 'ssn', name: 'D', pos: { x: 200, y: 0 }, heading: 0, speedKn: 10, depth: 250, team: 'east' });
    deep.playerId = 'p2';
    const w = createWorld([f, deep], 1, day);
    w.env.met = met({ bergs: [{ id: 1, x: 100, y: 800, r: 80, h: 30, draft: 150 }] });
    const hp = f.hp;
    const deepHp = deep.hp;
    for (let i = 0; i < 4000 && !w.events.some((e) => e.kind === 'boat' && e.shipId === 'f'); i++) stepWorld(w);
    expect(w.events.some((e) => e.kind === 'boat' && e.shipId === 'f' && e.text.includes('EISBERG'))).toBe(true);
    expect(f.hp).toBeLessThan(hp);
    expect(f.speed).toBeLessThan(1 * KN);
    expect(Math.hypot(f.pos.x - 100, f.pos.y - 800)).toBeGreaterThan(80);
    expect(deep.hp).toBe(deepHp);
    expect(Math.abs(deep.pos.x - 100)).toBeLessThan(110); // passed right under it
    expect(w.events.some((e) => e.kind === 'boat' && e.shipId === 'd')).toBe(false);
  });

  it('AI ships steer around an iceberg in their path', () => {
    const m = createShip({ id: 'm', cls: 'merchant', name: 'M', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12, team: 'west' });
    const w = createWorld([m], 1, day);
    w.env.met = met({ bergs: [{ id: 1, x: 0, y: 2000, r: 100, h: 30, draft: 150 }] });
    let closest = Infinity;
    for (let i = 0; i < 6000; i++) {
      stepWorld(w);
      closest = Math.min(closest, Math.hypot(m.pos.x, m.pos.y - 2000));
    }
    expect(w.events.some((e) => e.kind === 'boat')).toBe(false);
    expect(closest).toBeGreaterThan(150);
  });

  it('floes slow surface ships', () => {
    const f = frigate();
    f.order.speedKn = 28;
    f.speed = 28 * KN;
    f.playerId = 'p';
    const w = createWorld([f], 1, day);
    w.env.met = met({ floes: [{ id: 1, x: 0, y: 0, r: 30_000, cover: 0.7 }] });
    for (let i = 0; i < 300; i++) stepWorld(w);
    expect(f.speed / KN).toBeLessThan(29 * (1 - 0.4 * 0.7) + 0.5);
  });
});
