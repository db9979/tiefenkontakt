import { describe, expect, it } from 'vitest';
import { bookFor, createConvoy, createShip, createWorld, depthAt, distance, installAir, installBoats, installWeapons, KN, type World } from '@tk/shared';
import { newMemory, type BotMemory } from '../src/bots/common.js';
import { planSide } from '../src/bots/escort-team.js';
import { BARRIER_R, barrierStations, noteTurn, quietEcho } from '../src/bots/veteran-escort.js';
import { ArenaGame, DEFAULT_ARENA } from '../src/arena.js';
import { HARBOUR_ANCHORAGE } from '../src/scenario.js';

/** Convoy at the origin heading north, two AI escorts, a boat 7 km ahead. */
function setup() {
  const ms = [0, 1, 2, 3].map((i) => createShip({ id: `m${i}`, cls: 'merchant', name: `M${i}`, pos: { x: (i % 2) * 900, y: -Math.floor(i / 2) * 900 }, heading: 0, speedKn: 9 }));
  const es = [{ x: -2500, y: 4500 }, { x: 2500, y: 4500 }].map((p, i) => createShip({ id: `p_bot-w${i + 1}`, cls: 'ffg', name: `W${i + 1}`, pos: p, heading: 0, speedKn: 12, team: 'west' }));
  const u = createShip({ id: 'p_bot-e1', cls: 'ssk', name: 'E1', pos: { x: 0, y: 7000 }, heading: 180, speedKn: 4, depth: 80, team: 'east' });
  const w = createWorld([...ms, ...es, u], 3, { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 });
  w.convoy = createConvoy(ms, [{ x: 0, y: 40_000 }], 9);
  installWeapons(w);
  installAir(w);
  installBoats(w);
  const mems = new Map<string, BotMemory>(es.map((s) => [s.id, newMemory(s.id)]));
  return { w, es, u, mems };
}

/** An active echo on the target in the observer's book (nothing heard passively, no class vote). */
function ping(w: World, m: BotMemory, observer: { id: string; pos: { x: number; y: number } }, target: { id: string; pos: { x: number; y: number } }, tonals?: number[]) {
  const dx = target.pos.x - observer.pos.x;
  const dy = target.pos.y - observer.pos.y;
  const b = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  m.track.push({ t: w.time, x: observer.pos.x, y: observer.pos.y });
  const evidence = tonals ? { tonals: tonals.map((hz) => ({ hz, snr: 10 })) } : undefined;
  return bookFor(w, observer.id).ingest({ observerId: observer.id, targetId: target.id, sensor: 'active', time: w.time, bearing: b, range: Math.hypot(dx, dy), se: 20, ...(evidence ? { evidence } : {}) });
}

describe('VETERAN escorts', () => {
  it('a quiet echo (active only, nothing heard) is a probable submarine', () => {
    const { w, es, u, mems } = setup();
    const m = mems.get(es[0]!.id)!;
    w.time = 100;
    ping(w, m, es[0]!, u);
    w.time = 120;
    const t = ping(w, m, es[0]!, u);
    expect(quietEcho(w, es[0]!, t, m)).toBe(true);
  });

  it('one echo alone, or a contact with tonal lines, is no quiet echo', () => {
    const { w, es, u, mems } = setup();
    const m = mems.get(es[0]!.id)!;
    w.time = 100;
    const t = ping(w, m, es[0]!, u);
    expect(quietEcho(w, es[0]!, t, m)).toBe(false);
    const m2 = mems.get(es[1]!.id)!;
    ping(w, m2, es[1]!, u, [37.5, 75]);
    w.time = 120;
    const t2 = ping(w, m2, es[1]!, u, [37.5, 75]);
    expect(quietEcho(w, es[1]!, t2, m2)).toBe(false);
  });

  it('an echo where an own escort just turned hard is taken for her knuckle', () => {
    const { w, es, u, mems } = setup();
    const m = mems.get(es[0]!.id)!;
    const e2 = es[1]!;
    e2.pos = { x: u.pos.x + 150, y: u.pos.y };
    e2.speed = 20 * KN;
    e2.yawRate = 5;
    w.time = 90;
    noteTurn(w, e2);
    e2.pos = { x: 2500, y: 4500 };
    w.time = 100;
    ping(w, m, es[0]!, u);
    w.time = 120;
    const t = ping(w, m, es[0]!, u);
    expect(quietEcho(w, es[0]!, t, m)).toBe(false);
  });

  it('only the VETERAN team puts a datum on a quiet echo (NORMAL as before)', () => {
    for (const [skill, want] of [['normal', false], ['schwer', true]] as const) {
      const { w, es, u, mems } = setup();
      const m = mems.get(es[0]!.id)!;
      w.time = 100;
      ping(w, m, es[0]!, u);
      w.time = 120;
      ping(w, m, es[0]!, u);
      planSide(w, 'west', mems, skill);
      const d = w.env.hunt?.west?.datum;
      expect(!!d).toBe(want);
      if (d) expect(distance(d, u.pos)).toBeLessThan(50);
    }
  });

  it('harbour: the barrier stands across the approach, in deep water, beyond the boats\' reach of the berths', () => {
    const g = new ArenaGame({ ...DEFAULT_ARENA, mission: 'hafen' }, 1003);
    const w = g.world;
    const es = w.ships.filter((s) => s.team === 'west' && s.id.startsWith('p_'));
    const st = barrierStations(w, HARBOUR_ANCHORAGE, es);
    expect(st.size).toBe(2);
    for (const p of st.values()) {
      expect(depthAt(w.env.seabed, p.x, p.y)).toBeGreaterThanOrEqual(60);
      expect(distance(p, HARBOUR_ANCHORAGE)).toBeGreaterThanOrEqual(BARRIER_R - 1);
      expect(p.y).toBeGreaterThan(HARBOUR_ANCHORAGE.y + 4000);
    }
    const [a, b] = [...st.values()];
    expect(distance(a!, b!)).toBeGreaterThan(1500);
  });
});
