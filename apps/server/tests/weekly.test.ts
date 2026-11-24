import { describe, expect, it } from 'vitest';
import type { Debrief, ServerMsg } from '@tk/shared';
import { AuthStore } from '../src/auth.js';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';
import { SOLO_MISSIONS, WeeklyStore, soloSetup, weekOf, weeklySetup, weeklyView } from '../src/weekly.js';

function fakeConn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: 'Kaleu', inbox, send: (m) => inbox.push(m) };
}

const stat = (playerId: string, team: 'west' | 'east', won: boolean, tonnage: number) => ({
  playerId, callsign: `K${playerId}`, team, cls: team === 'west' ? 'ffg' : 'ssk', survived: true, shots: 2, rockets: 0, buoys: 0,
  kills: won ? 1 : 0, tonnageSunk: tonnage, firstContactS: 100, distanceNm: 5, won,
}) as Debrief['stats'][number];

describe('weekly situation', () => {
  it('numbers ISO weeks from Monday 00:00 UTC', () => {
    expect(weekOf(Date.UTC(2026, 10, 24, 12)).id).toBe('2026-W48');
    expect(weekOf(Date.UTC(2026, 10, 23, 23, 59)).id).toBe('2026-W48');
    expect(weekOf(Date.UTC(2026, 10, 22, 23, 59)).id).toBe('2026-W47');
    // 1 Jan 2027 is a Friday: still week 53 of 2026
    expect(weekOf(Date.UTC(2027, 0, 1)).id).toBe('2026-W53');
    expect(weekOf(Date.UTC(2027, 0, 4)).id).toBe('2027-W01');
    const w = weekOf(Date.UTC(2026, 10, 24));
    expect(new Date(w.start).getUTCDay()).toBe(1);
    expect(w.end - w.start).toBe(7 * 86_400_000);
  });

  it('gives everyone the same situation all week and a new one the next', () => {
    const mon = Date.UTC(2026, 10, 23, 1);
    const sun = Date.UTC(2026, 10, 29, 22);
    expect(weeklySetup(sun)).toEqual(weeklySetup(mon));
    expect(weeklySetup(mon + 7 * 86_400_000).seed).not.toBe(weeklySetup(mon).seed);
    const missions = new Set(Array.from({ length: 40 }, (_, i) => soloSetup(i * 7919 + 1).settings.mission));
    expect(missions.size).toBeGreaterThan(3);
    for (const m of missions) expect(SOLO_MISSIONS).toContain(m);
  });

  it('keeps the best result per account and side, and nothing for guests', () => {
    const auth = new AuthStore(':memory:');
    auth.db.exec("INSERT INTO users (id, callsign, email, password_hash, faction, created_at) VALUES (1, 'A', 'a@x', 'h', 'west', 0), (2, 'B', 'b@x', 'h', 'east', 0)");
    const store = new WeeklyStore(auth.db);
    const d = (stats: Debrief['stats']) => ({ stats }) as Debrief;
    store.record('2026-W48', d([stat('u-1', 'west', false, 0), stat('u-2', 'east', true, 9000), stat('g-7', 'east', true, 99_000)]));
    store.record('2026-W48', d([stat('u-1', 'west', true, 0)]));
    store.record('2026-W48', d([stat('u-2', 'east', false, 1000)]));
    const b = store.board('2026-W48');
    expect(b.west).toHaveLength(1);
    expect(b.west[0]).toMatchObject({ rank: 1, callsign: 'Ku-1', won: true });
    expect(b.east).toHaveLength(1);
    expect(b.east[0]).toMatchObject({ callsign: 'Ku-2', won: true });
    expect(store.board('2026-W49').west).toHaveLength(0);
    const v = weeklyView(store);
    expect(v.lage?.timeOfDay).not.toBe('zufall');
    expect(v.lage?.weather).not.toBe('zufall');
  });

  it('starts a solo game at once, the weekly one with the week\'s seed', () => {
    const lobby = new Lobby();
    const a = fakeConn('u-5');
    lobby.connect(a);
    lobby.handle(a, { t: 'solo', team: 'east', weekly: true });
    const m = lobby.matchOf('u-5')!;
    expect(m.state).toBe('running');
    expect(m.settings.weekly).toBe(weeklySetup().week);
    expect(m.settings.private).toBe(true);
    expect(m.slots.find((s) => s.playerId === 'u-5')?.team).toBe('east');
    expect(m.slots.some((s) => s.bot && s.team === 'west')).toBe(true);
    const b = fakeConn('u-6');
    lobby.connect(b);
    lobby.handle(b, { t: 'solo', team: 'west' });
    const n = lobby.matchOf('u-6')!;
    expect(n.state).toBe('running');
    expect(n.settings.weekly).toBeUndefined();
    expect(n.slots.find((s) => s.playerId === 'u-6')?.cls).toBe('ffg');
  });
});
