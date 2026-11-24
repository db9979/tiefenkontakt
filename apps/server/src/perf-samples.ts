import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/**
 * Graphics performance from real devices. The client sends one anonymous sample after about a
 * minute in a 3D view (periscope, bridge) and one at the match end. Only aggregates per device
 * class and setting are kept: no user, no address, no browser string.
 */

export const perfSampleSchema = z.object({
  quality: z.enum(['niedrig', 'mittel', 'hoch']),
  setting: z.enum(['auto', 'manual']),
  steppedDown: z.boolean(),
  avgMs: z.number().min(1).max(2000),
  p95Ms: z.number().min(1).max(5000),
  device: z.enum(['phone', 'tablet', 'desktop']),
  dpr: z.enum(['1', '1.5', '2', '3']),
  phase: z.enum(['mid', 'end']),
}).strict();
export type PerfSample = z.infer<typeof perfSampleSchema>;

/** A sample counts as stuttering when one frame in twenty takes longer than this (under 20 fps). */
export const STUTTER_P95_MS = 50;

export interface PerfRow {
  device: string;
  dpr: string;
  quality: string;
  setting: string;
  steppedDown: boolean;
  samples: number;
  avgMs: number;
  p95Ms: number;
  /** Share of samples with p95 over STUTTER_P95_MS. */
  stutter: number;
}

export class PerfStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS perf_agg (
      device TEXT NOT NULL, dpr TEXT NOT NULL, quality TEXT NOT NULL, setting TEXT NOT NULL, stepped INTEGER NOT NULL,
      n INTEGER NOT NULL, sum_avg REAL NOT NULL, sum_p95 REAL NOT NULL, stutter INTEGER NOT NULL, last_at INTEGER NOT NULL,
      PRIMARY KEY (device, dpr, quality, setting, stepped))`);
  }

  /** Validate and add a sample; false when it is malformed. */
  add(raw: unknown, now = Date.now()): boolean {
    const r = perfSampleSchema.safeParse(raw);
    if (!r.success) return false;
    const s = r.data;
    this.db.prepare(`INSERT INTO perf_agg (device, dpr, quality, setting, stepped, n, sum_avg, sum_p95, stutter, last_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (device, dpr, quality, setting, stepped) DO UPDATE SET n = n + 1, sum_avg = sum_avg + excluded.sum_avg,
      sum_p95 = sum_p95 + excluded.sum_p95, stutter = stutter + excluded.stutter, last_at = excluded.last_at`)
      .run(s.device, s.dpr, s.quality, s.setting, s.steppedDown ? 1 : 0, s.avgMs, s.p95Ms, s.p95Ms > STUTTER_P95_MS ? 1 : 0, now);
    return true;
  }

  rows(): PerfRow[] {
    const all = this.db.prepare('SELECT * FROM perf_agg ORDER BY device, dpr, quality, setting, stepped').all() as {
      device: string; dpr: string; quality: string; setting: string; stepped: number; n: number; sum_avg: number; sum_p95: number; stutter: number;
    }[];
    return all.map((r) => ({
      device: r.device, dpr: r.dpr, quality: r.quality, setting: r.setting, steppedDown: r.stepped === 1, samples: r.n,
      avgMs: +(r.sum_avg / r.n).toFixed(1), p95Ms: +(r.sum_p95 / r.n).toFixed(1), stutter: +(r.stutter / r.n).toFixed(2),
    }));
  }
}
