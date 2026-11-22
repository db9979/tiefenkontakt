import { describe, expect, it } from 'vitest';
import {
  BROADCAST_EVERY_S, BROADCAST_FIRST_S, KN, createConvoy, createShip, createWorld, executeOrder, gridRef, installAir, installBoats,
  installOrders, installWeapons, orderPool, orderResults, ordersFor, stepWorld, transmit, type Environment, type OrderKind, type World,
} from '../src/index.js';

const env: Environment = { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 };
const run = (w: World, secs: number) => { for (let i = 0; i < secs * 10; i++) stepWorld(w); };

function world(depth = 100, mission = 'groenland', seed = 5) {
  const u = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 20_000 }, heading: 180, speedKn: 4, depth, team: 'east' });
  const f = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 3000, y: 2000 }, heading: 0, speedKn: 10, team: 'west' });
  const ms = [0, 1, 2].map((i) => createShip({ id: `m${i}`, cls: 'merchant', name: `M${i}`, pos: { x: (i - 1) * 900, y: 0 }, heading: 0, speedKn: 9 }));
  const w = createWorld([u, f, ...ms], seed, env);
  w.env.seed = seed;
  w.env.mission = mission;
  w.convoy = createConvoy(ms, [{ x: 0, y: 40_000 }], 9);
  installWeapons(w);
  installAir(w);
  installBoats(w);
  return { w, u, f };
}

/** A world with exactly one planned order. */
function withOrder(kind: OrderKind, team: 'west' | 'east', at: number, dur: number, depth = 100) {
  const r = world(depth);
  r.w.env.orders = { plan: [{ at, team, kind, dur }], orders: [], nextId: 1, seed: 9, cursor: 0 };
  return r;
}

describe('FLASH order generation', () => {
  it('plans one to three orders per side, deterministic per seed, inside the time limit', () => {
    for (let seed = 1; seed < 30; seed++) {
      const { w } = world(100, 'groenland', seed);
      const st = installOrders(w, 7200);
      for (const team of ['west', 'east'] as const) {
        const mine = st.plan.filter((p) => p.team === team);
        expect(mine.length).toBeGreaterThanOrEqual(1);
        expect(mine.length).toBeLessThanOrEqual(3);
        expect(new Set(mine.map((p) => p.kind)).size).toBe(mine.length);
        for (const p of mine) expect(p.at + p.dur).toBeLessThanOrEqual(7200);
      }
      // Boats' orders go out with a fleet-command broadcast window
      for (const p of st.plan.filter((x) => x.team === 'east')) expect((p.at - BROADCAST_FIRST_S) % BROADCAST_EVERY_S).toBe(0);
      expect(installOrders(world(100, 'groenland', seed).w, 7200).plan).toEqual(st.plan);
    }
  });

  it('fits the mission: no attack while weapons are tight, no convoy turn in the strait', () => {
    expect(orderPool('fuehlung', true, true)).not.toContain('attack');
    expect(orderPool('groenland', true, true)).toContain('attack');
    expect(orderPool('meerenge', false, false)).not.toContain('turn');
    expect(orderPool('groenland', false, true)).toEqual(expect.arrayContaining(['turn', 'search', 'silence']));
  });

  it('names grid squares of 5 km', () => {
    expect(gridRef(0, 0)).toBe('I3');
    expect(gridRef(-40_000, -10_000)).toBe('A1');
    expect(gridRef(4999, 5001)).toBe('I4');
  });

  it('does not disturb the simulation random numbers', () => {
    const a = world();
    const b = world();
    installOrders(b.w, 7200);
    expect(a.w.rng.state).toBe(b.w.rng.state);
  });
});

describe('FLASH order delivery', () => {
  it('reaches surface ships at once', () => {
    const { w, f } = withOrder('silence', 'west', 100, 600);
    run(w, 101);
    const o = w.env.orders!.orders[0]!;
    expect(o.readAt[f.id]).toBeCloseTo(100, 0);
    expect(w.events.some((e) => e.kind === 'flash' && e.shipId === 'f' && e.text.includes('FUNKSTILLE'))).toBe(true);
    expect(ordersFor(w, f)?.[0]?.kind).toBe('silence');
  });

  it('reaches a boat at VLF depth with the broadcast window', () => {
    const { w, u } = withOrder('sitrep', 'east', BROADCAST_FIRST_S, 2400, 20);
    u.order.depth = 20;
    run(w, BROADCAST_FIRST_S + 80);
    const read = w.env.orders!.orders[0]!.readAt[u.id];
    expect(read).toBeGreaterThanOrEqual(BROADCAST_FIRST_S + 60);
    expect(read).toBeLessThan(BROADCAST_FIRST_S + 70);
  });

  it('a boat that misses the broadcast reads the order a window late', () => {
    const { w, u } = withOrder('sitrep', 'east', BROADCAST_FIRST_S, 2400, 100);
    u.order.depth = 100;
    run(w, BROADCAST_FIRST_S + 300);
    expect(w.env.orders!.orders[0]!.readAt[u.id]).toBeUndefined();
    expect(ordersFor(w, u)).toEqual([]);
    // Up to VLF depth for the next window
    u.order.depth = 20;
    u.order.speedKn = 3;
    run(w, BROADCAST_EVERY_S);
    const read = w.env.orders!.orders[0]!.readAt[u.id]!;
    expect(read).toBeGreaterThanOrEqual(BROADCAST_FIRST_S + BROADCAST_EVERY_S + 60);
    expect(w.events.some((e) => e.kind === 'flash' && e.shipId === 'u' && e.time === read)).toBe(true);
  });
});

describe('FLASH order checks', () => {
  it('radio silence: kept until the deadline is fulfilled, broken is missed', () => {
    const kept = withOrder('silence', 'west', 10, 300);
    run(kept.w, 320);
    expect(kept.w.env.orders!.orders[0]!.status).toBe('done');
    const broken = withOrder('silence', 'west', 10, 300);
    run(broken.w, 20);
    transmit(broken.w, broken.f, 'Kontakt Peilung 010');
    run(broken.w, 2);
    expect(broken.w.env.orders!.orders[0]!.status).toBe('missed');
  });

  it('a situation report is a transmission before the deadline', () => {
    const { w, u } = withOrder('sitrep', 'east', 10, 600, 15);
    run(w, 30);
    expect(w.env.orders!.orders[0]!.status).toBe('active');
    transmit(w, u, 'Lagebericht');
    run(w, 2);
    expect(w.env.orders!.orders[0]!.status).toBe('done');
  });

  it('clearing an area is judged at the deadline', () => {
    const stay = withOrder('clear', 'east', 10, 300);
    run(stay.w, 320);
    expect(stay.w.env.orders!.orders[0]!.area).toBeDefined();
    expect(stay.w.env.orders!.orders[0]!.status).toBe('missed');
    const go = withOrder('clear', 'east', 10, 300);
    run(go.w, 12);
    go.u.pos = { x: 30_000, y: 30_000 };
    run(go.w, 310);
    expect(go.w.env.orders!.orders[0]!.status).toBe('done');
  });

  it('the convoy turn is fulfilled when the escort passes it on: the convoy steers the new course', () => {
    const { w, f } = withOrder('turn', 'west', 10, 600);
    run(w, 12);
    const o = w.env.orders!.orders[0]!;
    expect(o.heading).toBeDefined();
    expect(ordersFor(w, f)![0]!.canExecute).toBe(true);
    expect(executeOrder(w, f, o.id)).toBe(true);
    expect(executeOrder(w, f, o.id)).not.toBe(true);
    run(w, 120);
    expect(o.status).toBe('done');
    expect(Math.abs(((w.convoy!.guideHeading - o.heading! + 540) % 360) - 180)).toBeLessThan(30);
  });

  it('an unexecuted convoy turn is missed at the deadline', () => {
    const { w } = withOrder('turn', 'west', 10, 200);
    run(w, 220);
    expect(w.env.orders!.orders[0]!.status).toBe('missed');
  });

  it('a sector counts as searched once a ship is in it', () => {
    const { w, f } = withOrder('search', 'west', 10, 900);
    run(w, 12);
    const area = w.env.orders!.orders[0]!.area!;
    f.pos = { x: area.x + 1000, y: area.y };
    f.speed = 0;
    f.order.speedKn = 0;
    run(w, 3);
    expect(w.env.orders!.orders[0]!.status).toBe('done');
  });

  it('attacking the convoy: a torpedo in the water does it', () => {
    const { w } = withOrder('attack', 'east', 10, 600);
    run(w, 20);
    w.events.push({ kind: 'weapon', time: w.time, sourceId: 'u', what: 'torpedo' });
    run(w, 2);
    expect(w.env.orders!.orders[0]!.status).toBe('done');
  });

  it('results give each side points (done +10, missed -5) without touching the match result', () => {
    const { w } = world();
    w.env.orders = {
      plan: [{ at: 10, team: 'west', kind: 'silence', dur: 100 }, { at: 10, team: 'west', kind: 'turn', dur: 100 }, { at: 10, team: 'east', kind: 'clear', dur: 100 }],
      orders: [], nextId: 1, seed: 3, cursor: 0,
    };
    run(w, 130);
    const r = orderResults(w);
    expect(r.list).toHaveLength(3);
    expect(r.points.west).toBe(10 - 5);
    expect(r.points.east).toBe(-5);
    expect(w.ships.every((s) => s.alive)).toBe(true);
    void KN;
  });
});

describe('FLASH orders in short matches', () => {
  it('still plans orders for both sides in a 10-minute match (1800 s sim)', () => {
    for (let seed = 1; seed < 10; seed++) {
      const st = installOrders(world(100, 'groenland', seed).w, 1800);
      expect(st.plan.some((p) => p.team === 'west')).toBe(true);
      expect(st.plan.some((p) => p.team === 'east')).toBe(true);
      for (const p of st.plan) expect(p.at + p.dur).toBeLessThanOrEqual(1800);
    }
  });
});
