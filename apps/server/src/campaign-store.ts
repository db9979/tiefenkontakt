import type { DatabaseSync } from 'node:sqlite';
import { parseRun, type CampaignRun } from './campaign-state.js';

/** Campaign runs per account in SQLite: one active run, finished ones kept as history. */
export class CampaignStore {
  constructor(private db: DatabaseSync) {
    // Additive migration: a new table only, existing tables are untouched
    db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS campaign_runs_user ON campaign_runs (user_id, active);`);
  }

  /** The account's current run (also a just-finished one until a new run is started). */
  active(userId: number): { id: number; run: CampaignRun } | undefined {
    const row = this.db.prepare('SELECT id, state FROM campaign_runs WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(userId) as { id: number; state: string } | undefined;
    const run = row ? parseRun(row.state) : undefined;
    return row && run ? { id: row.id, run } : undefined;
  }

  /** Start a new run; the previous one is archived. */
  create(userId: number, run: CampaignRun, now = Date.now()): number {
    this.db.prepare('UPDATE campaign_runs SET active = 0 WHERE user_id = ? AND active = 1').run(userId);
    const r = this.db.prepare('INSERT INTO campaign_runs (user_id, started_at, updated_at, active, state) VALUES (?, ?, ?, 1, ?)').run(userId, now, now, JSON.stringify(run));
    return Number(r.lastInsertRowid);
  }

  save(id: number, run: CampaignRun, now = Date.now()): void {
    this.db.prepare('UPDATE campaign_runs SET state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(run), now, id);
  }

  /** Archive the active run without starting a new one. */
  close(userId: number): void {
    this.db.prepare('UPDATE campaign_runs SET active = 0 WHERE user_id = ? AND active = 1').run(userId);
  }

  /** Earlier runs (newest first): class, missions, points, how they ended. */
  past(userId: number, limit = 5): { startedAt: number; cls: string; missions: number; points: number; status: string }[] {
    const rows = this.db.prepare('SELECT started_at, state FROM campaign_runs WHERE user_id = ? AND active = 0 ORDER BY id DESC LIMIT ?').all(userId, limit) as { started_at: number; state: string }[];
    return rows.flatMap((r) => {
      const run = parseRun(r.state);
      return run ? [{ startedAt: r.started_at, cls: run.ship.cls, missions: run.crew.missions, points: run.points, status: run.status }] : [];
    });
  }
}
