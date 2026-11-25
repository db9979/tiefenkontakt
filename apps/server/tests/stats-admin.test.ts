import { describe, expect, it } from 'vitest';
import type { Debrief } from '@tk/shared';
import { AuthStore } from '../src/auth.js';
import { DropoutStore } from '../src/dropouts.js';
import { Ratings } from '../src/rating.js';
import { StatsStore } from '../src/stats.js';
import { StatsAdmin } from '../src/stats-admin.js';

function debrief(eastId: string, westId: string, reason: string): Debrief {
  const base = { cls: 'ssk' as const, shots: 3, rockets: 0, buoys: 0, distanceNm: 5 };
  return {
    ships: [], frames: [], torpedoes: [], events: [], winner: 'east', reason, duration: 1800,
    stats: [
      { ...base, playerId: eastId, callsign: 'A', team: 'east', survived: true, kills: 2, tonnageSunk: 24_000, won: true },
      { ...base, playerId: westId, callsign: 'B', team: 'west', cls: 'ffg', survived: false, kills: 0, tonnageSunk: 0, won: false },
    ],
  };
}

async function setup() {
  const auth = new AuthStore(':memory:');
  const a = await auth.register({ callsign: 'Alpha', email: 'a@x.de', password: 'passwort1', faction: 'east' });
  const b = await auth.register({ callsign: 'Bravo', email: 'b@x.de', password: 'passwort1', faction: 'west' });
  if (!('user' in a) || !('user' in b)) throw new Error('register');
  const st = new StatsStore(auth.db);
  const ratings = new Ratings(auth.db);
  const ids = [`u-${a.user.id}`, `u-${b.user.id}`] as const;
  return { auth, st, ratings, admin: new StatsAdmin(auth.db), ids, a: a.user.id };
}

describe('moderation of the statistics', () => {
  it('lists finished matches with their players and end reason, newest first', async () => {
    const { st, admin, ids } = await setup();
    st.record(debrief(ids[0], ids[1], 'Die Hälfte der Konvoi-Tonnage versenkt'), 'groenland', 'tag', 1000);
    st.record(debrief(ids[0], ids[1], 'Zeit abgelaufen'), 'schelf', 'nacht', 2000);
    const list = admin.recent();
    expect(list.map((m) => m.mission)).toEqual(['schelf', 'groenland']);
    expect(list[1]).toMatchObject({ winner: 'east', reason: 'Die Hälfte der Konvoi-Tonnage versenkt', humansWest: 1, humansEast: 1, duration: 1800 });
    expect(list[1]!.players.sort()).toEqual(['Alpha', 'Bravo']);
  });

  it('takes one match out of balance, rankings and careers, the others stay', async () => {
    const { st, admin, ids, a } = await setup();
    st.record(debrief(ids[0], ids[1], 'x'), 'groenland', 'tag', 1000);
    st.record(debrief(ids[0], ids[1], 'y'), 'schelf', 'tag', 2000);
    const gone = admin.recent().find((m) => m.mission === 'groenland')!;
    expect(admin.deleteMatch(gone.id)).toBe(true);
    expect(admin.deleteMatch(gone.id)).toBe(false);
    expect(st.balance().total).toBe(1);
    expect(st.summary(a)).toMatchObject({ matches: 1 });
    expect(admin.recent().map((m) => m.mission)).toEqual(['schelf']);
  });

  it('a reset clears all match statistics and ratings, accounts and campaign stay', async () => {
    const { auth, st, ratings, admin, ids, a } = await setup();
    const d = debrief(ids[0], ids[1], 'x');
    st.record(d, 'groenland', 'tag', 1000);
    ratings.update(d);
    expect(ratings.get(a)).toBeGreaterThan(1000);
    expect(admin.reset()).toBe(1);
    expect(st.balance().total).toBe(0);
    expect(st.leaderboard()).toEqual([]);
    expect(ratings.get(a)).toBe(1000);
    expect(st.campaign(a).find((s) => s.id === 'm1')?.done).toBe(true);
    expect(auth.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 2 });
    // Drop-out counters and graphics samples go too
    const drops = new DropoutStore(auth.db);
    drops.add({ kind: 'match', minute: 3, team: 'west', cls: 'ffg', how: 'disconnect' });
    expect(drops.view().matches.left).toBe(1);
    admin.reset();
    expect(drops.view().matches).toMatchObject({ left: 0, disconnects: 0, finished: 0 });
  });
});
