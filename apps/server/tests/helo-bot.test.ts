import { describe, expect, it } from 'vitest';
import { bookFor, createShip, createWorld, heloOf, installAir, installWeapons, stepWorld, type Ship, type World } from '@tk/shared';
import { newMemory, recordTrack, type BotMemory } from '../src/bots/common.js';
import { thinkFrigate } from '../src/bots/frigate.js';
import { heloProsecute } from '../src/bots/helo.js';

/** Two AI frigates, a quiet boat 22 km ahead (beyond the hull sonar); rockets out of play so the helicopter has to deliver. */
function setup() {
  const a = createShip({ id: 'p_bot-w1', cls: 'ffg', name: 'W1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 0, team: 'west' });
  const b = createShip({ id: 'p_bot-w2', cls: 'ffg', name: 'W2', pos: { x: 3000, y: 0 }, heading: 0, speedKn: 0, team: 'west' });
  const u = createShip({ id: 'p_bot-e1', cls: 'ssk', name: 'E1', pos: { x: 0, y: 22_000 }, heading: 90, speedKn: 3, depth: 80, team: 'east' });
  const w = createWorld([a, b, u], 3, { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 });
  installWeapons(w);
  installAir(w);
  for (const s of [a, b]) w.weapons!.loadouts.get(s.id)!.rockets = 0;
  return { w, a, b, u, m: newMemory(a.id) };
}

/** An active echo on the boat in the frigate's book, taken for a submarine by the captain. */
function echo(w: World, m: BotMemory, s: Ship, u: Ship): void {
  const dx = u.pos.x - s.pos.x;
  const dy = u.pos.y - s.pos.y;
  const tr = bookFor(w, s.id).ingest({ observerId: s.id, targetId: u.id, sensor: 'active', time: w.time, bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360, range: Math.hypot(dx, dy), se: 20 });
  m.votes = { [tr.label]: { submarine: 5 } };
  recordTrack(m, s, w.time);
}

describe('AI escort helicopter works through the task queue', () => {
  it('a fresh echo out of rocket reach: the helicopter attacks that fix at once', () => {
    const { w, a, u, m } = setup();
    w.time = 100;
    echo(w, m, a, u);
    thinkFrigate(w, m, a, 'schwer');
    const h = heloOf(w, a.id)!;
    expect(h.queue.map((t) => t.kind)).toEqual(['attack']);
    expect(Math.hypot(h.queue[0]!.x - u.pos.x, h.queue[0]!.y - u.pos.y)).toBeLessThan(50);
    expect(h.queue[0]!.track).toBeDefined();
  });

  it('prosecutes the team datum dip by dip with a buoy line, then attacks the latest fix', () => {
    const { w, a, u, m } = setup();
    w.time = 100;
    w.env.hunt = { west: { rolesAt: -1e9, hunters: [a.id], helo: {}, said: {}, datum: { x: u.pos.x + 800, y: u.pos.y - 600, t: 100, q: 60, by: 'p_bot-w2' } } };
    thinkFrigate(w, m, a, 'normal', { role: 'hunter' });
    const h = heloOf(w, a.id)!;
    expect(h.queue.map((t) => t.kind)).toEqual(['dip', 'buoys']);
    expect(Math.hypot(h.queue[0]!.x - u.pos.x, h.queue[0]!.y - u.pos.y)).toBeLessThan(1500);
    expect(h.queue[0]!.count).toBe(3);
    let attacked = false;
    let dipped = false;
    let torpAt: number | undefined;
    for (let i = 0; i < 10 * 900 && torpAt === undefined; i++) {
      stepWorld(w);
      recordTrack(m, a, w.time);
      // Keep the classification (the bot's own voting is not under test here)
      for (const tr of bookFor(w, a.id).tracks()) if (tr.sensors.includes('active')) (m.votes ??= {})[tr.label] = { submarine: 5 };
      if (i % 20 === 0) thinkFrigate(w, m, a, 'normal', { role: 'hunter' });
      if (h.queue[0]?.kind === "attack") attacked = true;
      if (h.queue[0]?.kind === "dip" && h.queue[0].phase === "work") dipped = true;
      if (w.weapons!.torpedoes.some((t) => t.ownerId === a.id)) torpAt = w.time;
    }
    expect(dipped).toBe(true);
    expect(attacked).toBe(true);
    expect(torpAt).toBeDefined();
    const t = w.weapons!.torpedoes.find((x) => x.ownerId === a.id)!;
    expect(Math.hypot(t.pos.x - u.pos.x, t.pos.y - u.pos.y)).toBeLessThan(1500);
    expect(w.events.some((e) => e.kind === 'boat' && e.text === 'HUBSCHRAUBER · TORPEDO IM WASSER')).toBe(true);
  });

  it('keeps off a datum another helicopter is already working', () => {
    const { w, a, b, u } = setup();
    w.env.hunt = { west: { rolesAt: -1e9, hunters: [], helo: {}, said: {} } };
    heloProsecute(w, a, u.pos);
    expect(heloOf(w, a.id)!.queue[0]?.kind).toBe('dip');
    stepWorld(w);
    heloProsecute(w, b, { x: u.pos.x + 1000, y: u.pos.y });
    expect(heloOf(w, b.id)!.queue).toHaveLength(0);
    // Even without the team's commitment record: the other helicopter is seen at work there
    w.env.hunt.west!.helo = {};
    heloProsecute(w, b, { x: u.pos.x + 1000, y: u.pos.y });
    expect(heloOf(w, b.id)!.queue).toHaveLength(0);
  });

  it('an idle helicopter in the air comes home', () => {
    const { w, a, m } = setup();
    const h = heloOf(w, a.id)!;
    h.state = 'air';
    h.x = 5000;
    w.time = 50;
    thinkFrigate(w, m, a, 'normal');
    expect(h.queue.map((t) => t.kind)).toEqual(['return']);
  });
});
