import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Debrief, PlayerSlot } from '@tk/shared';
import { AuthStore } from '../src/auth.js';
import { StatsStore } from '../src/stats.js';
import { PerfStore } from '../src/perf-samples.js';
import { DropoutStore, DropoutTracker, type MatchLike } from '../src/dropouts.js';
import { formatRealBalance, realBalance } from '../src/real-balance.js';
import { Lobby } from '../src/lobby.js';
import { parseClientMsg } from '../src/input.js';

const sample = { quality: 'mittel', setting: 'auto', steppedDown: false, avgMs: 30, p95Ms: 40, device: 'phone', dpr: '2', phase: 'mid' };

describe('graphics performance samples', () => {
  it('aggregates valid samples per device and setting, rejects junk and extra fields', () => {
    const p = new PerfStore(new DatabaseSync(':memory:'));
    expect(p.add(sample)).toBe(true);
    expect(p.add({ ...sample, avgMs: 40, p95Ms: 80 })).toBe(true);
    expect(p.add({ ...sample, device: 'desktop', quality: 'hoch', setting: 'manual' })).toBe(true);
    expect(p.add({ ...sample, device: 'toaster' })).toBe(false);
    expect(p.add({ ...sample, avgMs: -1 })).toBe(false);
    expect(p.add({ ...sample, userAgent: 'Mozilla' })).toBe(false);
    const rows = p.rows();
    expect(rows).toHaveLength(2);
    const phone = rows.find((r) => r.device === 'phone')!;
    expect(phone).toMatchObject({ samples: 2, avgMs: 35, p95Ms: 60, stutter: 0.5, quality: 'mittel', setting: 'auto', steppedDown: false });
  });
});

const slot = (playerId: string, team: 'west' | 'east', cls: PlayerSlot['cls'], bot = false): PlayerSlot => ({ playerId, callsign: playerId, team, cls, ready: true, bot });

function match(over: Partial<MatchLike> = {}): MatchLike {
  return { id: 'm1', state: 'running', settings: {}, world: { time: 0 }, slots: [slot('a', 'west', 'ffg'), slot('b', 'east', 'ssk'), slot('bot-1', 'east', 'ssn', true)], ...over };
}

describe('drop-out statistics', () => {
  it('counts lobby leaves, tutorial steps, match leaves by minute and class, lost links after the grace period, and finishers', () => {
    const store = new DropoutStore(new DatabaseSync(':memory:'));
    const t = new DropoutTracker(store, 1000);
    // Lobby: left before the start (twice, same player may come back)
    const lobby = match({ id: 'l1', state: 'lobby' });
    t.left(lobby, 'a');
    t.left(lobby, 'a');
    // Tutorial given up at step 3 (index 2)
    const lesson = match({ id: 't1', settings: { lesson: 'feindfahrt' }, slots: [slot('c', 'east', 'ssk')] });
    t.lessonStep('c', 2);
    t.left(lesson, 'c');
    // A second lesson finished
    const lesson2 = match({ id: 't2', settings: { lesson: 'feindfahrt' }, slots: [slot('d', 'east', 'ssk')] });
    t.finished(lesson2);
    // Running match: 'a' loses the link at minute 7 and does not return, 'b' drops and comes back
    const m = match({ world: { time: 7 * 60 + 10 } });
    t.detached(m, 'a', 0);
    t.detached(m, 'b', 0);
    t.back('b');
    t.tick(500);
    expect(store.view().matches.left).toBe(0); // still within the grace period
    t.tick(1500);
    t.finished(m); // bot is not counted, 'a' already counted as gone
    // Another match: 'b' leaves on purpose at minute 12; sandbox is ignored
    t.left(match({ id: 'm2', world: { time: 12 * 60 } }), 'b');
    t.left(match({ id: 'm3', settings: { sandbox: true } }), 'a');
    const v = store.view();
    expect(v.lobbyLeft).toBe(2);
    expect(v.tutorials).toEqual([{ lesson: 'feindfahrt', finished: 1, left: [{ step: 2, n: 1 }] }]);
    expect(v.matches).toMatchObject({ finished: 1, left: 2, disconnects: 1 });
    expect(v.matches.byMinute).toEqual([{ from: 5, to: 10, n: 1 }, { from: 10, to: 15, n: 1 }]);
    expect(v.matches.byClass).toEqual([
      { team: 'east', cls: 'ssk', left: 1, finished: 1 },
      { team: 'west', cls: 'ffg', left: 1, finished: 0 },
    ]);
  });

  it('a match dropped while someone is away counts them as gone', () => {
    const store = new DropoutStore(new DatabaseSync(':memory:'));
    const t = new DropoutTracker(store, 60_000);
    const m = match();
    t.detached(m, 'a', 0);
    t.dropped(m);
    expect(store.view().matches).toMatchObject({ left: 1, disconnects: 1 });
  });

  it('the lobby reports leaves and the tutorial step message is validated', () => {
    const lobby = new Lobby();
    const store = new DropoutStore(new DatabaseSync(':memory:'));
    lobby.dropouts = new DropoutTracker(store);
    const conn = { playerId: 'g-x', callsign: 'Gast-1', send: () => undefined };
    lobby.connect(conn);
    lobby.handle(conn, { t: 'create_match', name: 'Test' });
    lobby.handle(conn, { t: 'leave' });
    expect(store.view().lobbyLeft).toBe(1);
    expect(parseClientMsg(JSON.stringify({ t: 'lesson_step', step: 3 }))).toEqual({ t: 'lesson_step', step: 3 });
    expect(parseClientMsg(JSON.stringify({ t: 'lesson_step', step: -1 }))).toBeUndefined();
    for (const m of lobby.allMatches()) m.stop();
  });
});

function debrief(winner: 'west' | 'east', stats: [string, 'west' | 'east', 'ffg' | 'ssk' | 'ssn'][]): Debrief {
  return {
    ships: stats.map(([id, team, cls]) => ({ id, name: id, cls, team, player: true })), frames: [], torpedoes: [], events: [], winner, reason: 'x', duration: 600,
    stats: stats.map(([playerId, team, cls]) => ({ playerId, callsign: playerId, team, cls, survived: true, shots: 0, rockets: 0, buoys: 0, kills: 0, tonnageSunk: 0, distanceNm: 0, won: team === winner })),
  };
}

describe('balance from real matches', () => {
  it('splits human-vs-human from human-vs-AI, leaves AI-only out, and keeps human and AI classes apart', () => {
    const auth = new AuthStore(':memory:');
    const st = new StatsStore(auth.db);
    st.record(debrief('west', [['g-1', 'west', 'ffg'], ['g-2', 'east', 'ssk']]), 'groenland', 'tag');
    st.record(debrief('east', [['g-1', 'west', 'ffg'], ['g-2', 'east', 'ssk']]), 'groenland', 'tag');
    st.record(debrief('east', [['g-1', 'west', 'ffg'], ['bot-e1', 'east', 'ssn']]), 'schelf', 'nacht');
    st.record(debrief('west', [['bot-w1', 'west', 'ffg'], ['bot-e1', 'east', 'ssk']]), 'duell', 'tag');
    const b = realBalance(auth.db);
    expect(b).toMatchObject({ total: 4, pvp: 2, pve: 1, botsOnly: 1 });
    expect(b.missions).toEqual([
      { mission: 'schelf', group: 'pve', side: 'west', games: 1, wins: 0 },
      { mission: 'groenland', group: 'pvp', side: 'east', games: 2, wins: 1 },
      { mission: 'groenland', group: 'pvp', side: 'west', games: 2, wins: 1 },
    ]);
    expect(b.classes).toContainEqual({ cls: 'ssn', group: 'pve', side: 'east', crew: 'ki', games: 1, wins: 1 });
    expect(b.classes).toContainEqual({ cls: 'ffg', group: 'pve', side: 'west', crew: 'mensch', games: 1, wins: 0 });
    expect(b.classes).toContainEqual({ cls: 'ssk', group: 'pvp', side: 'east', crew: 'mensch', games: 2, wins: 1 });
    expect(formatRealBalance(b)).toContain('groenland');
  });

  it('reads older rows without crew data from the per-side human counts', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE matches (id INTEGER PRIMARY KEY, ended_at INTEGER, mission TEXT, time_of_day TEXT, winner TEXT, duration INTEGER,
      humans_west INTEGER, humans_east INTEGER, classes TEXT)`);
    db.prepare('INSERT INTO matches (ended_at, mission, time_of_day, winner, duration, humans_west, humans_east, classes) VALUES (0, ?, ?, ?, 60, ?, ?, ?)')
      .run('fjord', 'nacht', 'west', 1, 0, JSON.stringify(['west:ffg', 'east:ssk']));
    db.prepare('INSERT INTO matches (ended_at, mission, time_of_day, winner, duration, humans_west, humans_east, classes) VALUES (0, ?, ?, ?, 60, ?, ?, ?)')
      .run('fjord', 'nacht', 'east', 1, 1, JSON.stringify(['west:ffg', 'west:kor', 'east:ssk']));
    const b = realBalance(db);
    expect(b).toMatchObject({ pvp: 1, pve: 1 });
    expect(b.classes).toContainEqual({ cls: 'ffg', group: 'pve', side: 'west', crew: 'mensch', games: 1, wins: 1 });
    expect(b.classes).toContainEqual({ cls: 'ssk', group: 'pve', side: 'east', crew: 'ki', games: 1, wins: 0 });
    expect(b.classes).toContainEqual({ cls: 'kor', group: 'pvp', side: 'west', crew: '?', games: 1, wins: 0 });
  });
});
