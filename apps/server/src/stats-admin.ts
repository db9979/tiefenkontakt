import type { DatabaseSync } from 'node:sqlite';

/** A finished match as the moderation panel lists it. */
export interface FinishedMatch {
  id: number;
  endedAt: number;
  mission: string;
  timeOfDay: string;
  winner: string;
  /** Sim seconds. */
  duration: number;
  humansWest: number;
  humansEast: number;
  /** Why it ended (empty for matches recorded before this was kept). */
  reason: string;
  /** Account players with a result in it. */
  players: string[];
}

/** Tables a reset empties (drop-outs and graphics samples are the admin insights). */
const RESET_TABLES = ['matches', 'results', 'habits', 'ratings', 'dropout_agg', 'perf_agg'];

/**
 * Moderation of the recorded statistics: list finished matches, take single ones out
 * (balance, results, habits) and reset everything. A match's results are tied to it by
 * end time and mission, as everywhere else in stats.ts.
 */
export class StatsAdmin {
  constructor(private db: DatabaseSync) {}

  recent(limit = 60): FinishedMatch[] {
    const rows = this.db.prepare(`SELECT id, ended_at, mission, time_of_day, winner, duration, humans_west, humans_east, COALESCE(reason, '') AS reason
      FROM matches ORDER BY ended_at DESC, id DESC LIMIT ?`).all(limit) as {
      id: number; ended_at: number; mission: string; time_of_day: string; winner: string; duration: number; humans_west: number; humans_east: number; reason: string;
    }[];
    const who = this.db.prepare('SELECT u.callsign AS c FROM results r JOIN users u ON u.id = r.user_id WHERE r.ended_at = ? AND r.mission = ? ORDER BY r.team, u.callsign');
    return rows.map((r) => ({
      id: r.id, endedAt: r.ended_at, mission: r.mission, timeOfDay: r.time_of_day, winner: r.winner, duration: r.duration,
      humansWest: r.humans_west, humansEast: r.humans_east, reason: r.reason,
      players: (who.all(r.ended_at, r.mission) as { c: string }[]).map((x) => x.c),
    }));
  }

  /** Take one match out of the statistics. Ratings already moved by it stay (Elo has no undo). */
  deleteMatch(id: number): boolean {
    const m = this.db.prepare('SELECT ended_at, mission FROM matches WHERE id = ?').get(id) as { ended_at: number; mission: string } | undefined;
    if (!m) return false;
    this.tx(() => {
      this.db.prepare('DELETE FROM matches WHERE id = ?').run(id);
      // Another match ending in the same millisecond on the same mission keeps its results
      const twin = this.db.prepare('SELECT 1 FROM matches WHERE ended_at = ? AND mission = ?').get(m.ended_at, m.mission);
      if (twin) return;
      this.db.prepare('DELETE FROM results WHERE ended_at = ? AND mission = ?').run(m.ended_at, m.mission);
      this.db.prepare('DELETE FROM habits WHERE ended_at = ?').run(m.ended_at);
    });
    return true;
  }

  /** Clear all match statistics: balance, results (rankings, careers), habits, ratings, drop-outs and graphics samples. Accounts and campaign progress stay. */
  reset(): number {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n;
    this.tx(() => {
      for (const t of RESET_TABLES) {
        const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
        if (exists) this.db.exec(`DELETE FROM ${t}`);
      }
    });
    return n;
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
