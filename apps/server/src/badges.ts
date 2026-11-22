import type { DatabaseSync } from 'node:sqlite';
import { BADGE_BY_ID, campaignBadges, careerBadges, type BadgeId, type CareerTotals } from '@tk/shared';
import { parseRun, type CampaignRun } from './campaign-state.js';

export interface EarnedBadge {
  id: BadgeId;
  at: number;
}

/** Badges per account: each one is earned once and kept (additive table). */
export class BadgeStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS badges (
        user_id INTEGER NOT NULL REFERENCES users(id),
        badge TEXT NOT NULL,
        earned_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, badge)
      );`);
  }

  /** Award badges; returns the ones that are new for this account. */
  award(userId: number, ids: BadgeId[], now = Date.now()): BadgeId[] {
    const ins = this.db.prepare('INSERT OR IGNORE INTO badges (user_id, badge, earned_at) VALUES (?, ?, ?)');
    return ids.filter((id) => BADGE_BY_ID[id] && Number(ins.run(userId, id, now).changes) > 0);
  }

  career(userId: number, totals: CareerTotals, now = Date.now()): BadgeId[] {
    return this.award(userId, careerBadges(totals), now);
  }

  /** A campaign run was saved (after a mission): award what its state earns. */
  campaign(userId: number, run: Pick<CampaignRun, 'status' | 'replacements' | 'crew'>, now = Date.now()): BadgeId[] {
    return this.award(userId, campaignBadges(run), now);
  }

  of(userId: number): EarnedBadge[] {
    return (this.db.prepare('SELECT badge, earned_at FROM badges WHERE user_id = ? ORDER BY earned_at, badge').all(userId) as { badge: string; earned_at: number }[])
      .filter((r) => BADGE_BY_ID[r.badge])
      .map((r) => ({ id: r.badge as BadgeId, at: r.earned_at }));
  }

  /** Badge ids for many accounts at once (leaderboard), in catalog order. */
  forUsers(userIds: number[]): Map<number, BadgeId[]> {
    const out = new Map<number, BadgeId[]>();
    if (!userIds.length) return out;
    const ids = userIds.filter((n) => Number.isInteger(n)).slice(0, 200);
    const rows = this.db.prepare(`SELECT user_id, badge FROM badges WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { user_id: number; badge: string }[];
    const order = Object.keys(BADGE_BY_ID);
    for (const r of rows) {
      if (!BADGE_BY_ID[r.badge]) continue;
      const list = out.get(r.user_id) ?? [];
      list.push(r.badge as BadgeId);
      out.set(r.user_id, list);
    }
    for (const list of out.values()) list.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return out;
  }

  /**
   * One sweep at startup so existing accounts get what they have already earned:
   * career totals from their results, campaign badges from their runs (active and archived).
   */
  backfill(userIds: number[], totals: (userId: number) => CareerTotals, now = Date.now()): number {
    let n = 0;
    for (const uid of userIds) n += this.career(uid, totals(uid), now).length;
    let runs: { user_id: number; state: string }[] = [];
    try {
      runs = this.db.prepare('SELECT user_id, state FROM campaign_runs').all() as typeof runs;
    } catch {
      /* no campaign table yet */
    }
    for (const r of runs) {
      const run = parseRun(r.state);
      if (run) n += this.campaign(r.user_id, run, now).length;
    }
    return n;
  }
}
