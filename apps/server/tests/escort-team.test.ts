import { describe, expect, it } from 'vitest';
import { bookFor, createConvoy, createShip, createWorld, installAir, installBoats, installWeapons, stepOrders, type World } from '@tk/shared';
import { newMemory, type BotMemory } from '../src/bots/common.js';
import { ROLE_HOLD_S, directorCourse, heloCovered, planSide } from '../src/bots/escort-team.js';
import { obeySub } from '../src/bots/orders-ai.js';

/** Convoy at the origin heading north, three AI escorts, a boat 7 km ahead. */
function setup(escorts = 3) {
  const ms = [0, 1, 2, 3].map((i) => createShip({ id: `m${i}`, cls: 'merchant', name: `M${i}`, pos: { x: (i % 2) * 900, y: -Math.floor(i / 2) * 900 }, heading: 0, speedKn: 9 }));
  const pos = [{ x: -2500, y: 4500 }, { x: 2500, y: 4500 }, { x: 0, y: -4000 }, { x: 4000, y: 0 }];
  const es = pos.slice(0, escorts).map((p, i) => createShip({ id: `p_bot-w${i + 1}`, cls: 'ffg', name: `W${i + 1}`, pos: p, heading: 0, speedKn: 12, team: 'west' }));
  const u = createShip({ id: 'p_bot-e1', cls: 'ssk', name: 'E1', pos: { x: 0, y: 7000 }, heading: 180, speedKn: 4, depth: 80, team: 'east' });
  const w = createWorld([...ms, ...es, u], 3, { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 });
  w.convoy = createConvoy(ms, [{ x: 0, y: 40_000 }], 9);
  installWeapons(w);
  installAir(w);
  installBoats(w);
  const mems = new Map<string, BotMemory>(es.map((s) => [s.id, newMemory(s.id)]));
  return { w, es, u, mems };
}

/** An active echo on the boat in an escort's book, classified as a submarine by the captain. */
function echo(w: World, m: BotMemory, observer: { id: string; pos: { x: number; y: number } }, target: { id: string; pos: { x: number; y: number } }): void {
  const dx = target.pos.x - observer.pos.x;
  const dy = target.pos.y - observer.pos.y;
  const b = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const tr = bookFor(w, observer.id).ingest({ observerId: observer.id, targetId: target.id, sensor: 'active', time: w.time, bearing: b, range: Math.hypot(dx, dy), se: 20 });
  m.votes = { [tr.label]: { submarine: 5 } };
  m.track.push({ t: w.time, x: observer.pos.x, y: observer.pos.y });
}

describe('AI escort teamwork', () => {
  it('two escorts on a contact form a hunter-killer pair; the third keeps the screen', () => {
    const { w, es, u, mems } = setup(3);
    w.time = 100;
    echo(w, mems.get(es[0]!.id)!, es[0]!, u);
    echo(w, mems.get(es[1]!.id)!, es[1]!, u);
    const tasks = planSide(w, 'west', mems);
    const roles = es.map((s) => tasks.get(s.id)?.role);
    expect(roles.filter((r) => r === 'director')).toHaveLength(1);
    expect(roles.filter((r) => r === 'attacker')).toHaveLength(1);
    expect(tasks.get(es[2]!.id)?.role).toBe('screen');
    // The screen closes toward the threat axis (north, where the datum is)
    expect(tasks.get(es[2]!.id)!.station!.y).toBeGreaterThan(0);
    const d = w.env.hunt!.west!.datum!;
    expect(Math.hypot(d.x - u.pos.x, d.y - u.pos.y)).toBeLessThan(50);
    // Roles announced on team radio
    const radio = w.events.filter((e) => e.kind === 'teamradio').map((e) => (e as { text: string }).text);
    expect(radio.some((t) => t.startsWith('HALTE KONTAKT'))).toBe(true);
    expect(radio.some((t) => t.startsWith('ÜBERNEHME ANGRIFF'))).toBe(true);
  });

  it('roles hold for a while and are not announced twice', () => {
    const { w, es, u, mems } = setup(3);
    w.time = 100;
    echo(w, mems.get(es[0]!.id)!, es[0]!, u);
    echo(w, mems.get(es[1]!.id)!, es[1]!, u);
    planSide(w, 'west', mems);
    const dir = w.env.hunt!.west!.director;
    w.time = 100 + ROLE_HOLD_S / 2;
    echo(w, mems.get(es[0]!.id)!, es[0]!, u);
    echo(w, mems.get(es[1]!.id)!, es[1]!, u);
    planSide(w, 'west', mems);
    expect(w.env.hunt!.west!.director).toBe(dir);
    expect(w.events.filter((e) => e.kind === 'teamradio')).toHaveLength(2);
  });

  it('with only two escorts and a far datum, one stays with the convoy', () => {
    const { w, es, u, mems } = setup(2);
    u.pos = { x: 0, y: 14_000 };
    es[0]!.pos = { x: 0, y: 9000 };
    w.time = 50;
    echo(w, mems.get(es[0]!.id)!, es[0]!, u);
    const tasks = planSide(w, 'west', mems);
    expect(tasks.get(es[0]!.id)?.role).toBe('hunter');
    expect(tasks.get(es[1]!.id)?.role).toBe('screen');
  });

  it('radio silence ordered: no role announcements', () => {
    const { w, es, u, mems } = setup(3);
    w.env.orders = { plan: [], nextId: 2, seed: 1, cursor: 0, orders: [{
      id: 'F1', team: 'west', kind: 'silence', text: 'FUNKSTILLE', issuedAt: 0, deadline: 9999, status: 'active',
      readAt: Object.fromEntries(es.map((s) => [s.id, 0])),
    }] };
    w.time = 100;
    echo(w, mems.get(es[0]!.id)!, es[0]!, u);
    echo(w, mems.get(es[1]!.id)!, es[1]!, u);
    planSide(w, 'west', mems);
    expect(w.env.hunt!.west!.attacker).toBeDefined();
    expect(w.events.some((e) => e.kind === 'teamradio')).toBe(false);
  });

  it('helicopters are not double-committed to one datum', () => {
    const { w, es, mems } = setup(2);
    planSide(w, 'west', mems);
    w.env.hunt!.west!.helo[es[0]!.id] = { x: 0, y: 7000, until: w.time + 300 };
    expect(heloCovered(w, es[1]!, { x: 500, y: 7000 })).toBe(true);
    expect(heloCovered(w, es[0]!, { x: 500, y: 7000 })).toBe(false);
    expect(heloCovered(w, es[1]!, { x: 9000, y: 7000 })).toBe(false);
  });

  it('the director holds 3-5 km from the datum', () => {
    const s = createShip({ id: 'd', cls: 'ffg', name: 'D', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12, team: 'west' });
    expect(directorCourse(s, { x: 0, y: 8000 }, 1).heading).toBeCloseTo(0, 0);
    expect(Math.abs(directorCourse(s, { x: 0, y: 2000 }, 1).heading - 180)).toBeLessThanOrEqual(45);
    expect(directorCourse(s, { x: 0, y: 4000 }, 1).heading).toBeCloseTo(90, 0);
  });

  it('the AI escort executes an ordered convoy turn; a boat leaves an area it has to clear', () => {
    const { w, es, u, mems } = setup(2);
    w.env.orders = { plan: [{ at: 1, team: 'west', kind: 'turn', dur: 600 }, { at: 1, team: 'east', kind: 'clear', dur: 2400 }], orders: [], nextId: 1, seed: 4, cursor: 0 };
    for (let i = 0; i < 100 * 10; i++) {
      w.time += 0.1;
      stepOrders(w, 0.1);
      if (i % 20 === 0) planSide(w, 'west', mems);
    }
    // The boat copied the broadcast (stand-in for the command radio)
    const clear = w.env.orders.orders.find((o) => o.kind === 'clear')!;
    clear.readAt[u.id] = w.time;
    const turn = w.env.orders.orders.find((o) => o.kind === 'turn')!;
    expect(turn.executedAt).toBeDefined();
    const m = newMemory(u.id);
    obeySub(w, m, u);
    const away = ((Math.atan2(u.pos.x - clear.area!.x, u.pos.y - clear.area!.y) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(((u.order.heading - away + 540) % 360) - 180)).toBeLessThan(1);
  });
});
