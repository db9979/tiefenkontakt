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
