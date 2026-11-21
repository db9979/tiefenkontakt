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

export interface BalanceRow {
  key: string;
  games: number;
  westWins: number;
  eastWins: number;
  /** For classes: matches won by the side that fielded the class. */
  wins: number;
  avgMin: number;
}

export interface PlayerSummary {
  callsign: string;
  points: number;
  matches: number;
  wins: number;
  kills: number;
  tonnage: number;
}

/** Naval rank by service points. */
export const RANKS: [number, string][] = [
  [3000, 'Kapitän zur See'], [1500, 'Fregattenkapitän'], [700, 'Korvettenkapitän'], [300, 'Kapitänleutnant'], [100, 'Oberleutnant zur See'], [0, 'Leutnant zur See'],
];
export function rankFor(points: number): string {
  return RANKS.find(([p]) => points >= p)![1];
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
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ended_at INTEGER NOT NULL,
        mission TEXT NOT NULL,
        time_of_day TEXT NOT NULL,
        winner TEXT NOT NULL,
        duration INTEGER NOT NULL,
        humans_west INTEGER NOT NULL,
        humans_east INTEGER NOT NULL,
        classes TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campaign (
        user_id INTEGER NOT NULL REFERENCES users(id),
        step TEXT NOT NULL,
        done_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, step)
      );`);
  }

  /** Record a finished (non-lesson) match: balance data for all, results for account players. */
  record(d: Debrief, mission: string, timeOfDay: string, now = Date.now()): void {
    const humans = (team: string) => d.stats.filter((s) => s.team === team && !s.playerId.startsWith('bot-')).length;
    const classes = d.ships.filter((s) => s.player).map((s) => `${s.team}:${s.cls}`);
    this.db.prepare('INSERT INTO matches (ended_at, mission, time_of_day, winner, duration, humans_west, humans_east, classes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(now, mission, timeOfDay, d.winner, d.duration, humans('west'), humans('east'), JSON.stringify(classes));
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

  /** Win rates per mission and per ship class, over all recorded matches. */
  balance(): { missions: BalanceRow[]; classes: BalanceRow[]; total: number } {
    const rows = this.db.prepare('SELECT mission, time_of_day, winner, duration, classes FROM matches').all() as {
      mission: string; time_of_day: string; winner: string; duration: number; classes: string;
    }[];
    const missions = new Map<string, BalanceRow>();
    const classes = new Map<string, BalanceRow>();
    const add = (map: Map<string, BalanceRow>, key: string, westWon: boolean, won: boolean | undefined, dur: number) => {
      const r = map.get(key) ?? { key, games: 0, westWins: 0, eastWins: 0, wins: 0, avgMin: 0 };
      r.avgMin = (r.avgMin * r.games + dur / 60) / (r.games + 1);
      r.games++;
      if (westWon) r.westWins++;
      else r.eastWins++;
      if (won) r.wins++;
      map.set(key, r);
    };
    for (const m of rows) {
      const westWon = m.winner === 'west';
      add(missions, `${m.mission}/${m.time_of_day}`, westWon, undefined, m.duration);
      for (const c of new Set(JSON.parse(m.classes) as string[])) {
        const [team, cls] = c.split(':');
        add(classes, cls!, westWon, (team === 'west') === westWon, m.duration);
      }
    }
    const round = (r: BalanceRow) => ({ ...r, avgMin: Math.round(r.avgMin) });
    return { missions: [...missions.values()].map(round), classes: [...classes.values()].map(round), total: rows.length };
  }

  leaderboard(limit = 20): PlayerSummary[] {
    return (this.db.prepare(`SELECT u.callsign AS callsign, SUM(r.points) AS points, COUNT(r.id) AS matches, SUM(r.won) AS wins,
      SUM(r.kills) AS kills, SUM(r.tonnage) AS tonnage FROM results r JOIN users u ON u.id = r.user_id
      WHERE u.verified = 1 GROUP BY u.id ORDER BY points DESC, wins DESC LIMIT ?`).all(limit) as unknown as PlayerSummary[]).map((r) => ({ ...r }));
  }
}

export function userIdOf(playerId: string): number | undefined {
  const m = /^u-(\d+)$/.exec(playerId);
  return m ? Number(m[1]) : undefined;
}
