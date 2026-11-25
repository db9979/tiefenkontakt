import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '@tk/shared';
import { parseClientMsg } from '../src/input.js';
import { Lobby } from '../src/lobby.js';
import { Match, type Conn } from '../src/match.js';

// Time controls are checked step for step: no wall-clock budget under a loaded test run
Match.sandboxBudgetMs = Infinity;
import { seriesStats, SeriesRunner } from '../src/series.js';
import { ArenaGame, DEFAULT_ARENA } from '../src/arena.js';

function fakeConn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m) };
}

function setup(sandbox: boolean) {
  const lobby = new Lobby();
  const a = fakeConn('a1');
  const b = fakeConn('b1');
  for (const c of [a, b]) {
    lobby.connect(c);
    lobby.resume(c);
  }
  lobby.handle(a, { t: 'create_match', name: 'Übung' });
  const m = lobby.matchOf('a1')!;
  lobby.handle(b, { t: 'join', matchId: m.id, team: 'east' });
  if (sandbox) lobby.handle(a, { t: 'settings', sandbox: true });
  lobby.handle(a, { t: 'ready', ready: true });
  lobby.handle(b, { t: 'ready', ready: true });
  m.stop();
  return { lobby, m, a, b };
}

const truths = (c: { inbox: ServerMsg[] }) => c.inbox.filter((x) => x.t === 'sandbox' && x.truth);

describe('sandbox truth view', () => {
  it('is refused in a normal match and never sent', () => {
    const { lobby, m, a } = setup(false);
    for (const op of ['truth', 'speed', 'spawn'] as const) {
      a.inbox.length = 0;
      lobby.handle(a, { t: 'sandbox', op, on: true, scale: 10, cls: 'merchant', bearing: 0, range: 3000 });
      expect(a.inbox.some((x) => x.t === 'error' && x.msg.includes('Sandkasten'))).toBe(true);
    }
    lobby.sandbox.push();
    expect(a.inbox.some((x) => x.t === 'sandbox')).toBe(false);
    expect(m.settings.timeScale).toBe(1);
  });

  it('shows the truth only to players who switched it on, with time controls and spawning', () => {
    const { lobby, m, a, b } = setup(true);
    expect(m.settings.sandbox).toBe(true);
    lobby.handle(a, { t: 'sandbox', op: 'truth', on: true });
    lobby.sandbox.push();
    const t = truths(a).pop();
    expect(t?.t === 'sandbox' && t.truth?.ships.some((s) => s.id === 'p_b1')).toBe(true);
    expect(truths(b)).toHaveLength(0);
    expect(b.inbox.some((x) => x.t === 'sandbox' && x.scale === 1)).toBe(true);
    // Spawn a target 4 km north of the own ship and steer it
    const own = m.shipOf('a1')!;
    lobby.handle(a, { t: 'sandbox', op: 'spawn', cls: 'merchant', bearing: 0, range: 4000, heading: 90, speedKn: 8 });
    const tgt = m.world!.ships.find((s) => s.id === 'sb1')!;
    expect(tgt.pos.y - own.pos.y).toBeCloseTo(4000, 0);
    expect(tgt.team).toBe('neutral');
    lobby.handle(a, { t: 'sandbox', op: 'steer', id: 'sb1', heading: 180, speedKn: 12 });
    expect(tgt.order).toMatchObject({ heading: 180, speedKn: 12 });
    // Players' ships are not steered by others
    a.inbox.length = 0;
    lobby.handle(a, { t: 'sandbox', op: 'steer', id: 'p_b1', heading: 10 });
    expect(a.inbox.some((x) => x.t === 'error')).toBe(true);
    // Pause: the world stands still but snapshots keep coming and the match does not end
    lobby.handle(a, { t: 'sandbox', op: 'speed', scale: 0 });
    const t0 = m.world!.time;
    for (let i = 0; i < 5; i++) m.tick();
    expect(m.world!.time).toBe(t0);
    expect(m.state).toBe('running');
    lobby.handle(a, { t: 'sandbox', op: 'speed', scale: 10 });
    m.tick();
    expect(m.world!.time).toBeCloseTo(t0 + 1, 5);
    const snap = a.inbox.filter((x) => x.t === 'snap').pop();
    expect(snap?.t === 'snap' && snap.s.timeScale).toBe(10);
    lobby.handle(a, { t: 'sandbox', op: 'remove', id: 'sb1' });
    expect(m.world!.ships.some((s) => s.id === 'sb1')).toBe(false);
    // Switched off again: no more truth
    lobby.handle(a, { t: 'sandbox', op: 'truth', on: false });
    a.inbox.length = 0;
    lobby.sandbox.push();
    expect(truths(a)).toHaveLength(0);
  });

  it('validates sandbox messages at the boundary', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'sandbox', op: 'speed', scale: 11 }))).toBeUndefined();
    expect(parseClientMsg(JSON.stringify({ t: 'sandbox', op: 'spawn', cls: 'battleship' }))).toBeUndefined();
    expect(parseClientMsg(JSON.stringify({ t: 'sandbox', op: 'truth', on: true }))).toBeDefined();
    expect(parseClientMsg(JSON.stringify({ t: 'campaign_start' }))).toBeDefined();
  });
});

describe('replay series', () => {
  it('plays a bot match to the end with detections and a replay', () => {
    const g = new ArenaGame({ ...DEFAULT_ARENA, timeLimitMin: 10, timeScale: 3 }, 7, true);
    while (!g.step(2000));
    const s = g.summary();
    expect(['west', 'east']).toContain(s.winner);
    expect(g.debrief()?.frames.length).toBeGreaterThan(10);
    const st = seriesStats([s, { ...s, winner: 'east', detect: { west: [1000], east: [3000] } }]);
    expect(st.games).toBe(2);
    expect(st.westWins + st.eastWins).toBe(2);
    expect(st.avgDetectEast).toBeGreaterThan(0);
  });

  it('limits series size by role', () => {
    const r = new SeriesRunner();
    expect(r.start(DEFAULT_ARENA, 5, 'x', false)).toMatch(/1–3/);
    expect(r.start({ ...DEFAULT_ARENA, west: ['ssk'] }, 1, 'x', true)).toMatch(/Westbund/);
    expect(r.start(DEFAULT_ARENA, 1, 'x', true)).toBeUndefined();
    expect(r.start(DEFAULT_ARENA, 1, 'x', true)).toMatch(/bereits/);
    r.stop();
  });
});
