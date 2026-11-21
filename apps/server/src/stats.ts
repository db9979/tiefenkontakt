import type { DatabaseSync } from 'node:sqlite';
import type { Debrief, PlayerStats } from '@tk/shared';

/** Match results, points and campaign progress for registered players (guests are not recorded). */

export type CampaignStep =
  | { id: string; kind: 'lesson'; lesson: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd'; title: string }
  | { id: string; kind: 'mission'; mission: 'groenland' | 'schelf' | 'fjord'; timeOfDay: 'tag' | 'daemmerung' | 'nacht'; title: string };

export const CAMPAIGN: CampaignStep[] = [
  { id: 'l1', kind: 'lesson', lesson: 'klassifizieren', title: 'Ausbildung 1: Horchen und Klassifizieren' },
  { id: 'l2', kind: 'lesson', lesson: 'tma', title: 'Ausbildung 2: Zielbewegungsanalyse' },
  { id: 'l3', kind: 'lesson', lesson: 'angriff', title: 'Ausbildung 3: Torpedoangriff' },
  { id: 'l4', kind: 'lesson', lesson: 'ujagd', title: 'Ausbildung 4: U-Jagd mit Fregatte' },
  { id: 'm1', kind: 'mission', mission: 'groenland', timeOfDay: 'tag', title: 'Einsatz 1: Grönland-Lücke bei Tag gewinnen' },
  { id: 'm2', kind: 'mission', mission: 'schelf', timeOfDay: 'daemmerung', title: 'Einsatz 2: Schelfmeer in der Dämmerung gewinnen' },
  { id: 'm3', kind: 'mission', mission: 'fjord', timeOfDay: 'nacht', title: 'Einsatz 3: Fjordausfahrt bei Nacht gewinnen' },
];

export interface PlayerSummary {
  callsign: string;
  points: number;
  matches: number;
  wins: number;
  kills: number;
  tonnage: number;
}

/** Points: a win counts most; sinkings and survival add, a loss costs a little. */
export function pointsFor(s: PlayerStats): number {
  return (s.won ? 25 : -5) + Math.round(s.tonnageSunk / 2000) + (s.survived ? 5 : 0);
}

export class StatsStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        ended_at INTEGER NOT NULL,
        mission TEXT NOT NULL,
        time_of_day TEXT NOT NULL,
        team TEXT NOT NULL,
        cls TEXT NOT NULL,
        won INTEGER NOT NULL,
        kills INTEGER NOT NULL,
        tonnage INTEGER NOT NULL,
        shots INTEGER NOT NULL,
        survived INTEGER NOT NULL,
        points INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campaign (
        user_id INTEGER NOT NULL REFERENCES users(id),
        step TEXT NOT NULL,
        done_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, step)
      );`);
  }

  /** Record a finished (non-lesson) match for every account player; advances campaign missions. */
  record(d: Debrief, mission: string, timeOfDay: string, now = Date.now()): void {
    const ins = this.db.prepare(`INSERT INTO results (user_id, ended_at, mission, time_of_day, team, cls, won, kills, tonnage, shots, survived, points)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of d.stats) {
      const uid = userIdOf(s.playerId);
      if (uid === undefined) continue;
      ins.run(uid, now, mission, timeOfDay, s.team, s.cls, s.won ? 1 : 0, s.kills, s.tonnageSunk, s.shots + s.rockets, s.survived ? 1 : 0, pointsFor(s));
      if (s.won) {
        for (const step of CAMPAIGN) {
          if (step.kind === 'mission' && step.mission === mission && step.timeOfDay === timeOfDay) this.complete(uid, step.id, now);
        }
      }
    }
  }

  complete(userId: number, stepId: string, now = Date.now()): void {
    if (!CAMPAIGN.some((s) => s.id === stepId)) return;
    this.db.prepare('INSERT OR IGNORE INTO campaign (user_id, step, done_at) VALUES (?, ?, ?)').run(userId, stepId, now);
  }

  campaign(userId: number): (CampaignStep & { done: boolean; unlocked: boolean })[] {
    const done = new Set((this.db.prepare('SELECT step FROM campaign WHERE user_id = ?').all(userId) as { step: string }[]).map((r) => r.step));
    return CAMPAIGN.map((s, i) => ({ ...s, done: done.has(s.id), unlocked: i === 0 || done.has(CAMPAIGN[i - 1]!.id) || done.has(s.id) }));
  }

  summary(userId: number): PlayerSummary | undefined {
    const r = this.db.prepare(`SELECT u.callsign AS callsign, COALESCE(SUM(r.points),0) AS points, COUNT(r.id) AS matches,
      COALESCE(SUM(r.won),0) AS wins, COALESCE(SUM(r.kills),0) AS kills, COALESCE(SUM(r.tonnage),0) AS tonnage
      FROM users u LEFT JOIN results r ON r.user_id = u.id WHERE u.id = ? GROUP BY u.id`).get(userId) as PlayerSummary | undefined;
    return r ? { ...r } : undefined;
  }

  leaderboard(limit = 20): PlayerSummary[] {
    return (this.db.prepare(`SELECT u.callsign AS callsign, SUM(r.points) AS points, COUNT(r.id) AS matches, SUM(r.won) AS wins,
      SUM(r.kills) AS kills, SUM(r.tonnage) AS tonnage FROM results r JOIN users u ON u.id = r.user_id
      GROUP BY u.id ORDER BY points DESC, wins DESC LIMIT ?`).all(limit) as unknown as PlayerSummary[]).map((r) => ({ ...r }));
  }
}

export function userIdOf(playerId: string): number | undefined {
  const m = /^u-(\d+)$/.exec(playerId);
  return m ? Number(m[1]) : undefined;
}
