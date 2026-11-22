import type { DatabaseSync } from 'node:sqlite';
import type { Debrief } from '@tk/shared';
import type { BadgeStore } from './badges.js';
import type { CampaignRun } from './campaign-state.js';
import { SeasonStore, type Season } from './seasons.js';
import { userIdOf, type StatsStore } from './stats.js';

const LIMIT = 20;
const SEASON_PARAM = /^(current|all|\d{4}(-(Q[1-4]|H[12]|P\d|\d{2}))?)$/;

export interface RankRow {
  rank: number;
  callsign: string;
  points: number;
  matches: number;
  wins: number;
  kills: number;
  tonnage: number;
  badges: string[];
}

/** Seasons, rankings and badges glued to the match end and the HTTP routes. */
export class Rankings {
  readonly seasons: SeasonStore;

  constructor(db: DatabaseSync, private stats: StatsStore, readonly badges: BadgeStore, months?: number) {
    this.seasons = new SeasonStore(db, months);
  }

  /** At startup: badges for what existing accounts have already done, podiums of past seasons. */
  init(now = Date.now()): void {
    this.badges.backfill(this.stats.userIds(), (uid) => this.stats.careerTotals(uid), now);
    this.closeSeasons(now);
  }

  /** A rated match was recorded: career badges for its account players. */
  afterMatch(d: Debrief, now = Date.now()): void {
    for (const s of d.stats) {
      const uid = userIdOf(s.playerId);
      if (uid !== undefined) this.badges.career(uid, this.stats.careerTotals(uid), now);
    }
    this.closeSeasons(now);
  }

  /** A campaign run was saved. */
  afterCampaign(userId: number, run: CampaignRun, now = Date.now()): void {
    this.badges.campaign(userId, run, now);
  }

  closeSeasons(now = Date.now()): Season[] {
    return this.seasons.closeFinished(
      this.stats.firstResultAt(),
      (s) => this.stats.leaderboard(3, s.start, s.end).filter((r) => r.points > 0),
      (uid) => this.badges.award(uid, ['season_podium'], now),
      now,
    );
  }

  rows(from?: number, to?: number): RankRow[] {
    const list = this.stats.leaderboard(LIMIT, from, to);
    const badges = this.badges.forUsers(list.map((r) => r.userId));
    return list.map(({ userId, ...r }, i) => ({ ...r, rank: i + 1, badges: badges.get(userId) ?? [] }));
  }

  /** The leaderboard for 'current', 'all' or a season id; undefined for an unknown season. */
  view(param: string | null, now = Date.now()) {
    this.closeSeasons(now);
    const cur = this.seasons.current(now);
    const key = param ?? 'current';
    if (!SEASON_PARAM.test(key)) return undefined;
    const season = key === 'all' ? undefined : key === 'current' ? cur : this.seasons.byId(key);
    if (key !== 'all' && !season) return undefined;
    if (season && season.start > cur.start) return undefined;
    const past = this.seasons.past();
    return {
      season: season ? { id: season.id, start: season.start, end: season.end } : null,
      current: { id: cur.id, start: cur.start, end: cur.end },
      past,
      rows: season ? this.rows(season.start, season.end) : this.rows(),
    };
  }

  /** GET /api/leaderboard (all time, as before, now with badges) and GET /api/rankings?season=… */
  handle(method: string, rawUrl: string, reply: (status: number, body: unknown) => void): boolean {
    const url = new URL(rawUrl, 'http://x');
    if (method !== 'GET') return false;
    if (url.pathname === '/api/leaderboard') {
      reply(200, this.rows().map(({ rank: _rank, ...r }) => r));
      return true;
    }
    if (url.pathname === '/api/rankings') {
      const v = this.view(url.searchParams.get('season'));
      reply(v ? 200 : 400, v ?? { error: 'Unbekannte Saison' });
      return true;
    }
    return false;
  }
}
