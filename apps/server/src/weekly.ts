import type { DatabaseSync } from 'node:sqlite';
import type { Debrief, MatchSetup, WeeklyBoard, WeeklyRow } from '@tk/shared';
import { areasFor, REGIONS } from '@tk/shared';
import { DEFAULT_SETTINGS, type MissionId, type ScenarioSettings } from './scenario.js';
import { pointsFor, userIdOf } from './stats.js';
import { resolveLobby } from './variation.js';

/**
 * Weekly situation: one seed per calendar week (ISO week, Monday 00:00 UTC). Everyone who plays
 * it meets the same mission, weather, positions and convoy route against the AI, on the side of
 * their choice; the best result per account and side goes on the week's board.
 * Quick solo games use the same path with a fresh seed and a random mission.
 */

/** Missions a solo or weekly game may draw (the duel and the free mission need set-up). */
export const SOLO_MISSIONS: MissionId[] = ['groenland', 'schelf', 'fjord', 'hafen', 'fuehlung', 'meerenge', 'aufklaerung'];

const WEEK_MS = 7 * 86_400_000;
/** 1970-01-05 was a Monday. */
const MONDAY0 = 4 * 86_400_000;

/** The ISO week containing `now`: id like 2026-W48, start and end (ms). */
export function weekOf(now = Date.now()): { id: string; start: number; end: number } {
  const start = MONDAY0 + Math.floor((now - MONDAY0) / WEEK_MS) * WEEK_MS;
  // ISO week-year: the year of this week's Thursday
  const thu = new Date(start + 3 * 86_400_000);
  const y = thu.getUTCFullYear();
  const jan4 = Date.UTC(y, 0, 4);
  const week1 = MONDAY0 + Math.floor((jan4 - MONDAY0) / WEEK_MS) * WEEK_MS;
  const n = Math.round((start - week1) / WEEK_MS) + 1;
  return { id: `${y}-W${String(n).padStart(2, '0')}`, start, end: start + WEEK_MS };
}

/** Stable 32-bit seed from a text (FNV-1a). */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

/** Mission, clock and weather of a solo game from its seed; the variation rolls the rest. */
export function soloSetup(seed: number): MatchSetup {
  const pick = <T>(list: readonly T[], salt: number): T => list[(Math.imul(seed ^ salt, 2654435761) >>> 0) % list.length]!;
  const mission = pick(SOLO_MISSIONS, 0x51);
  const settings: ScenarioSettings = {
    ...DEFAULT_SETTINGS,
    mission,
    // Any real sea area the mission suits
    area: pick(areasFor(mission), 0x93),
    timeOfDay: 'zufall',
    weather: 'zufall',
    seaState: pick([2, 3, 3, 4, 4, 5], 0x77),
    variation: 'leicht',
  };
  return { seed, settings: settings as MatchSetup['settings'] };
}

/** This week's situation. */
export function weeklySetup(now = Date.now()): MatchSetup & { week: string } {
  const w = weekOf(now);
  return { ...soloSetup(seedOf(`tiefenkontakt-${w.id}`)), week: w.id };
}

/** Score of one finished weekly game: the ranking points plus detail so ties break on tonnage. */
export function weeklyScore(s: Debrief['stats'][number]): number {
  return pointsFor(s) * 100 + Math.round(s.tonnageSunk / 100) + s.kills * 10 + (s.survived ? 5 : 0);
}

export class WeeklyStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS weekly (
      week TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      callsign TEXT NOT NULL,
      team TEXT NOT NULL,
      cls TEXT NOT NULL,
      score INTEGER NOT NULL,
      won INTEGER NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (week, user_id, team)
    )`);
  }

  /** A weekly game ended: keep each account's best result per side. */
  record(week: string, d: Debrief, now = Date.now()): void {
    const up = this.db.prepare(`INSERT INTO weekly (week, user_id, callsign, team, cls, score, won, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (week, user_id, team) DO UPDATE SET score = excluded.score, cls = excluded.cls, won = excluded.won, at = excluded.at, callsign = excluded.callsign
      WHERE excluded.score > weekly.score`);
    for (const s of d.stats) {
      const uid = userIdOf(s.playerId);
      if (uid === undefined || (s.team !== 'west' && s.team !== 'east')) continue;
      up.run(week, uid, s.callsign, s.team, s.cls, weeklyScore(s), s.won ? 1 : 0, now);
    }
  }

  /** Best results of a week per side. */
  board(week: string, limit = 10): WeeklyBoard {
    const rows = (team: string): WeeklyRow[] =>
      (this.db.prepare('SELECT callsign, cls, score, won FROM weekly WHERE week = ? AND team = ? ORDER BY score DESC, at ASC LIMIT ?')
        .all(week, team, limit) as { callsign: string; cls: string; score: number; won: number }[])
        .map((r, i) => ({ rank: i + 1, callsign: r.callsign, cls: r.cls, score: r.score, won: r.won === 1 }));
    return { week, west: rows('west'), east: rows('east') };
  }
}

/** GET /api/weekly: the week's situation (resolved) and its board. */
export function weeklyView(store: WeeklyStore, now = Date.now()): WeeklyBoard {
  const w = weeklySetup(now);
  const r = resolveLobby({ ...(w.settings as ScenarioSettings) }, w.seed);
  return { ...store.board(w.week), lage: { mission: r.mission, area: w.settings.area ? REGIONS[w.settings.area].name : undefined, timeOfDay: r.timeOfDay, weather: r.weather, seaState: r.seaState, endsAt: weekOf(now).end } };
}
