import { describe, expect, it } from 'vitest';
import type { Debrief } from '@tk/shared';
import { AuthStore } from '../src/auth.js';
import { StatsStore, pointsFor } from '../src/stats.js';

function debrief(winnerId: string, loserId: string): Debrief {
  const base = { cls: 'ssk' as const, shots: 3, rockets: 0, buoys: 0, distanceNm: 5 };
  return {
    ships: [], frames: [], torpedoes: [], events: [], winner: 'east', reason: 'x', duration: 100,
    stats: [
      { ...base, playerId: winnerId, callsign: 'A', team: 'east', survived: true, kills: 2, tonnageSunk: 24_000, won: true },
      { ...base, playerId: loserId, callsign: 'B', team: 'west', cls: 'ffg', survived: false, kills: 0, tonnageSunk: 0, won: false },
      { ...base, playerId: 'g-abc', callsign: 'Gast', team: 'west', survived: true, kills: 0, tonnageSunk: 0, won: false },
    ],
  };
}

describe('statistics and campaign', () => {
  it('records account players, ranks them and advances the campaign on mission wins', async () => {
    const auth = new AuthStore(':memory:');
    const a = await auth.register({ callsign: 'Alpha', email: 'a@x.de', password: 'passwort1', faction: 'east' });
    const b = await auth.register({ callsign: 'Bravo', email: 'b@x.de', password: 'passwort1', faction: 'west' });
    if (!('user' in a) || !('user' in b)) throw new Error('register');
    const st = new StatsStore(auth.db);
    auth.markVerified(a.user.id);
    auth.markVerified(b.user.id);
    st.record(debrief(`u-${a.user.id}`, `u-${b.user.id}`), 'groenland', 'tag');
    const board = st.leaderboard();
    expect(board.map((r) => r.callsign)).toEqual(['Alpha', 'Bravo']);
    expect(board[0]!.points).toBe(pointsFor(debrief('x', 'y').stats[0]!));
    expect(st.summary(a.user.id)).toMatchObject({ matches: 1, wins: 1, kills: 2 });
    const camp = st.campaign(a.user.id);
    expect(camp.find((s) => s.id === 'm1')?.done).toBe(true);
    expect(camp.find((s) => s.id === 'l1')?.unlocked).toBe(true);
    expect(camp.find((s) => s.id === 'm2')?.unlocked).toBe(true);
    expect(camp.find((s) => s.id === 'm3')?.unlocked).toBe(false);
  });
});

describe('balance statistics', () => {
  it('aggregates win rates per mission and class over all matches (guests and bots too)', () => {
    const auth = new AuthStore(':memory:');
    const st = new StatsStore(auth.db);
    const d = (winner: 'west' | 'east'): Debrief => ({
      ships: [{ id: 'p_a', name: 'A', cls: 'ffg', team: 'west', player: true }, { id: 'p_b', name: 'B', cls: 'ssk', team: 'east', player: true }],
      frames: [], torpedoes: [], events: [], winner, reason: 'x', duration: 3600,
      stats: [{ playerId: 'g-1', callsign: 'A', team: 'west', cls: 'ffg', survived: true, shots: 0, rockets: 0, buoys: 0, kills: 0, tonnageSunk: 0, distanceNm: 1, won: winner === 'west' },
        { playerId: 'bot-e1', callsign: 'B', team: 'east', cls: 'ssk', survived: true, shots: 0, rockets: 0, buoys: 0, kills: 0, tonnageSunk: 0, distanceNm: 1, won: winner === 'east' }],
    });
    st.record(d('west'), 'groenland', 'tag');
    st.record(d('east'), 'groenland', 'tag');
    st.record(d('east'), 'fjord', 'nacht');
    const b = st.balance();
    expect(b.total).toBe(3);
    expect(b.missions.find((m) => m.key === 'groenland/tag')).toMatchObject({ games: 2, westWins: 1, eastWins: 1, avgMin: 60 });
    expect(b.classes.find((c) => c.key === 'ssk')).toMatchObject({ games: 3, wins: 2 });
    expect(st.leaderboard()).toEqual([]);
  });
});
