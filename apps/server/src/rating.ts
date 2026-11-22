import type { DatabaseSync } from 'node:sqlite';
import type { Debrief } from '@tk/shared';
import { userIdOf } from './stats.js';

export const START_RATING = 1000;

/**
 * Elo rating per account, team against team: each player's result is compared with the
 * expectation from the two team averages (guests and AI count as 1000).
 * New players move faster (K 40 for the first 20 games, then 20).
 */
export class Ratings {
  constructor(private db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS ratings (user_id INTEGER PRIMARY KEY, rating REAL NOT NULL, games INTEGER NOT NULL)');
  }

  get(userId: number | undefined): number {
    if (userId === undefined) return START_RATING;
    const r = this.db.prepare('SELECT rating FROM ratings WHERE user_id = ?').get(userId) as { rating: number } | undefined;
    return Math.round(r?.rating ?? START_RATING);
  }

  private games(userId: number): number {
    return (this.db.prepare('SELECT games FROM ratings WHERE user_id = ?').get(userId) as { games: number } | undefined)?.games ?? 0;
  }

  /** Apply a finished match. Returns the change per account player id. */
  update(d: Debrief): Record<string, number> {
    const teamAvg = (team: string) => {
      const ps = d.stats.filter((s) => s.team === team);
      return ps.length ? ps.reduce((a, s) => a + this.get(userIdOf(s.playerId)), 0) / ps.length : START_RATING;
    };
    const avg = { west: teamAvg('west'), east: teamAvg('east') };
    const out: Record<string, number> = {};
    const upsert = this.db.prepare('INSERT INTO ratings (user_id, rating, games) VALUES (?, ?, 1) ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating, games = games + 1');
    for (const s of d.stats) {
      const uid = userIdOf(s.playerId);
      if (uid === undefined) continue;
      const own = avg[s.team];
      const opp = avg[s.team === 'west' ? 'east' : 'west'];
      const expected = 1 / (1 + 10 ** ((opp - own) / 400));
      const k = this.games(uid) < 20 ? 40 : 20;
      const before = this.get(uid);
      const after = before + k * ((s.won ? 1 : 0) - expected);
      upsert.run(uid, after);
      out[s.playerId] = Math.round(after - before);
    }
    return out;
  }
}
