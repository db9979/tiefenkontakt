import type { DatabaseSync } from 'node:sqlite';

/**
 * Ranking seasons: calendar periods in UTC (default a quarter; SEASON_MONTHS = 1, 2, 3, 4, 6
 * or 12). A match belongs to the season its end time falls in, so seasons are derived from
 * results.ended_at and changing the length later never rewrites history. When a season is
 * over its top three are frozen in season_podium (callsign and points as they were).
 */

export const SEASON_LENGTHS = [1, 2, 3, 4, 6, 12] as const;
export const DEFAULT_SEASON_MONTHS = 3;

export interface Season {
  id: string;
  start: number;
  end: number;
}

export function seasonMonths(env: string | undefined = process.env.SEASON_MONTHS): number {
  const n = Number(env);
  return (SEASON_LENGTHS as readonly number[]).includes(n) ? n : DEFAULT_SEASON_MONTHS;
}

function idFor(year: number, index: number, months: number): string {
  if (months === 12) return String(year);
  if (months === 6) return `${year}-H${index + 1}`;
  if (months === 3) return `${year}-Q${index + 1}`;
  if (months === 1) return `${year}-${String(index + 1).padStart(2, '0')}`;
  return `${year}-P${index + 1}`;
}

/** The season a moment (ms) falls in. */
export function seasonOf(ts: number, months = seasonMonths()): Season {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const index = Math.floor(d.getUTCMonth() / months);
  const start = Date.UTC(year, index * months, 1);
  const end = Date.UTC(year, (index + 1) * months, 1);
  return { id: idFor(year, index, months), start, end };
}

/** The season right before the given one. */
export function previousSeason(s: Season, months = seasonMonths()): Season {
  return seasonOf(s.start - 1, months);
}

/** Parse a season id of the current scheme back into its window (undefined if it isn't one). */
export function seasonById(id: string, months = seasonMonths()): Season | undefined {
  const m = /^(\d{4})(?:-(?:Q([1-4])|H([12])|P(\d)|(\d{2})))?$/.exec(id);
  if (!m) return undefined;
  const year = Number(m[1]);
  if (year < 2000 || year > 2999) return undefined;
  const idx = Number(m[2] ?? m[3] ?? m[4] ?? m[5] ?? 1) - 1;
  const s = seasonOf(Date.UTC(year, idx * months, 1), months);
  return s.id === id ? s : undefined;
}

export interface PodiumEntry {
  place: number;
  callsign: string;
  points: number;
}

export interface Standing {
  userId: number;
  callsign: string;
  points: number;
}

/** Freezes the podium of finished seasons. */
export class SeasonStore {
  constructor(private db: DatabaseSync, private months = seasonMonths()) {
    // Additive migration: new tables only
    db.exec(`
      CREATE TABLE IF NOT EXISTS season_podium (
        season TEXT NOT NULL,
        place INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        callsign TEXT NOT NULL,
        points INTEGER NOT NULL,
        PRIMARY KEY (season, place)
      );
      CREATE TABLE IF NOT EXISTS seasons_closed (
        season TEXT PRIMARY KEY,
        starts_at INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        closed_at INTEGER NOT NULL
      );`);
  }

  current(now = Date.now()): Season {
    return seasonOf(now, this.months);
  }

  byId(id: string): Season | undefined {
    return seasonById(id, this.months);
  }

  /**
   * Close every finished season since the first recorded match that is not closed yet.
   * `top3` ranks a season window; `onPodium` hears about each new podium place (badges).
   */
  closeFinished(firstMatchAt: number | undefined, top3: (s: Season) => Standing[], onPodium?: (userId: number, s: Season) => void, now = Date.now()): Season[] {
    if (firstMatchAt === undefined) return [];
    const closed = new Set((this.db.prepare('SELECT season FROM seasons_closed').all() as { season: string }[]).map((r) => r.season));
    const out: Season[] = [];
    const cur = this.current(now);
    for (let s = previousSeason(cur, this.months); s.end > firstMatchAt; s = previousSeason(s, this.months)) {
      if (closed.has(s.id)) continue;
      const ins = this.db.prepare('INSERT OR IGNORE INTO season_podium (season, place, user_id, callsign, points) VALUES (?, ?, ?, ?, ?)');
      top3(s).slice(0, 3).forEach((r, i) => {
        ins.run(s.id, i + 1, r.userId, r.callsign, r.points);
        onPodium?.(r.userId, s);
      });
      this.db.prepare('INSERT OR IGNORE INTO seasons_closed (season, starts_at, ends_at, closed_at) VALUES (?, ?, ?, ?)').run(s.id, s.start, s.end, now);
      out.push(s);
    }
    return out;
  }

  /** Closed seasons that had ranked players, newest first, with their frozen podium. */
  past(limit = 12): (Season & { podium: PodiumEntry[] })[] {
    const rows = this.db.prepare('SELECT season, starts_at, ends_at FROM seasons_closed c WHERE EXISTS (SELECT 1 FROM season_podium p WHERE p.season = c.season) ORDER BY starts_at DESC LIMIT ?').all(limit) as { season: string; starts_at: number; ends_at: number }[];
    const pod = this.db.prepare('SELECT place, callsign, points FROM season_podium WHERE season = ? ORDER BY place');
    return rows.map((r) => ({
      id: r.season, start: r.starts_at, end: r.ends_at,
      podium: (pod.all(r.season) as unknown as PodiumEntry[]).map((p) => ({ ...p })),
    }));
  }
}
