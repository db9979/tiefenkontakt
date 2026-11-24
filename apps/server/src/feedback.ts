import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/**
 * Feedback after a game (for test evenings): how much fun it was (1–5), what went wrong
 * (stutter, error, unclear) and a short free text, with the mission, side and class and the
 * graphics level in effect. Moderators read the list in the lobby's admin area.
 */

export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.enum(['ruckeln', 'fehler', 'unklar', 'zu_schwer', 'zu_leicht', 'super'])).max(6).default([]),
  text: z.string().max(1000).default(''),
  mission: z.string().max(40).optional(),
  side: z.enum(['west', 'east']).optional(),
  cls: z.string().max(12).optional(),
  won: z.boolean().optional(),
  quality: z.string().max(20).optional(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

export interface FeedbackRow extends Feedback { at: number; callsign?: string }

export class FeedbackStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      callsign TEXT,
      rating INTEGER NOT NULL,
      tags TEXT NOT NULL,
      text TEXT NOT NULL,
      mission TEXT, side TEXT, cls TEXT, won INTEGER, quality TEXT
    )`);
  }

  add(f: Feedback, callsign?: string, now = Date.now()): void {
    this.db.prepare('INSERT INTO feedback (at, callsign, rating, tags, text, mission, side, cls, won, quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(now, callsign ?? null, f.rating, f.tags.join(','), f.text.trim(), f.mission ?? null, f.side ?? null, f.cls ?? null, f.won === undefined ? null : f.won ? 1 : 0, f.quality ?? null);
  }

  /** Newest first, with the average rating. */
  list(limit = 100): { average: number | null; count: number; rows: FeedbackRow[] } {
    const rows = (this.db.prepare('SELECT * FROM feedback ORDER BY at DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map((r) => ({
      at: r.at as number, callsign: (r.callsign as string | null) ?? undefined, rating: r.rating as number,
      tags: String(r.tags || '').split(',').filter(Boolean) as Feedback['tags'], text: r.text as string,
      mission: (r.mission as string | null) ?? undefined, side: (r.side as Feedback['side'] | null) ?? undefined, cls: (r.cls as string | null) ?? undefined,
      won: r.won === null ? undefined : r.won === 1, quality: (r.quality as string | null) ?? undefined,
    }));
    const agg = this.db.prepare('SELECT AVG(rating) AS a, COUNT(*) AS n FROM feedback').get() as { a: number | null; n: number };
    return { average: agg.a, count: agg.n, rows };
  }
}
