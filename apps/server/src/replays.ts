import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Debrief } from '@tk/shared';

/**
 * Shared replays: a finished match's debrief stored under a random, unguessable id so anyone
 * with the link can watch the after-action playback (read only, no login).
 *
 * What is public: true tracks, torpedoes, sinkings/shots/arrivals, FLASH orders, final stats
 * by callsign. What is stripped: player ids (account ids `u-…`, guest hashes `g-…`, also baked
 * into ship ids), habit profiles and what the AI learned from them, photos (they carry player
 * ids). Chat and radio text never are part of a debrief.
 */

export const REPLAY_ID = /^[A-Za-z0-9_-]{16}$/;
const DAY = 86_400_000;

export interface ReplayMeta {
  winner: Debrief['winner'];
  reason: string;
  duration: number;
  players: string[];
}

export interface ReplayLimits {
  keepDays: number;
  maxBytes: number;
  maxCount: number;
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): ReplayLimits {
  const num = (v: string | undefined, def: number, min: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? n : def;
  };
  return {
    keepDays: num(env.REPLAY_KEEP_DAYS, 90, 1),
    maxBytes: num(env.REPLAY_MAX_BYTES, 2_000_000, 10_000),
    maxCount: num(env.REPLAY_MAX_COUNT, 5000, 1),
  };
}

/** The public copy of a debrief: every id that could name a player replaced by a neutral one. */
export function publicDebrief(d: Debrief): Debrief {
  const shipIds = new Map<string, string>();
  d.ships.forEach((s, i) => shipIds.set(s.id, `s${i}`));
  const ship = (id: string) => {
    let v = shipIds.get(id);
    if (!v) shipIds.set(id, (v = `s${shipIds.size}`));
    return v;
  };
  const torpIds = new Map<string, string>();
  const torp = (id: string) => {
    let v = torpIds.get(id);
    if (!v) torpIds.set(id, (v = `t${torpIds.size}`));
    return v;
  };
  return {
    ships: d.ships.map((s) => ({ id: ship(s.id), name: s.name, cls: s.cls, team: s.team, player: s.player })),
    frames: d.frames.map(([t, list]) => [t, list.map(([id, x, y, hd, alive]) => [ship(id), x, y, hd, alive])]),
    torpedoes: d.torpedoes.map(([t, list]) => [t, list.map(([id, x, y]) => [torp(id), x, y])]),
    events: d.events.map((e) => ({ t: e.t, kind: e.kind, shipId: ship(e.shipId), ...(e.byId ? { byId: ship(e.byId) } : {}), ...(e.what ? { what: e.what } : {}) })),
    stats: d.stats.map((s, i) => ({
      playerId: `p${i}`, callsign: s.callsign, team: s.team, cls: s.cls, survived: s.survived, shots: s.shots, rockets: s.rockets,
      buoys: s.buoys, kills: s.kills, tonnageSunk: s.tonnageSunk, firstContactS: s.firstContactS, distanceNm: s.distanceNm, won: s.won,
      orderPoints: s.orderPoints, mineKills: s.mineKills, attacksSurvived: s.attacksSurvived,
    })),
    winner: d.winner,
    reason: d.reason,
    duration: d.duration,
    orders: d.orders?.map((o) => ({ team: o.team, text: o.text, status: o.status, issuedAt: o.issuedAt, deadline: o.deadline, lateS: o.lateS })),
  };
}

export function metaOf(d: Debrief): ReplayMeta {
  return { winner: d.winner, reason: d.reason, duration: d.duration, players: d.stats.filter((s) => !s.playerId.startsWith('bot-')).map((s) => s.callsign) };
}

export type CreateResult = { id: string; existing: boolean } | { error: string; status: number };

export class ReplayStore {
  constructor(private db: DatabaseSync, readonly limits: ReplayLimits = limitsFromEnv(), private now = () => Date.now()) {
    db.exec(`CREATE TABLE IF NOT EXISTS replays (
      id TEXT PRIMARY KEY, match_key TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, expires INTEGER NOT NULL,
      meta TEXT NOT NULL, data BLOB NOT NULL)`);
    db.exec('CREATE INDEX IF NOT EXISTS replays_expires ON replays(expires)');
  }

  /** Store a match's public debrief; a match already shared returns its existing link. */
  create(matchKey: string, d: Debrief): CreateResult {
    const now = this.now();
    this.cleanup();
    const old = this.db.prepare('SELECT id FROM replays WHERE match_key = ?').get(matchKey) as { id: string } | undefined;
    if (old) return { id: old.id, existing: true };
    const pub = publicDebrief(d);
    const data = gzipSync(JSON.stringify(pub), { level: 9 });
    if (data.length > this.limits.maxBytes) return { error: 'Aufzeichnung zu groß zum Teilen', status: 413 };
    // Over the cap: the oldest shared replays make room
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM replays').get() as { n: number };
    if (n >= this.limits.maxCount) {
      this.db.prepare('DELETE FROM replays WHERE id IN (SELECT id FROM replays ORDER BY created ASC LIMIT ?)').run(n - this.limits.maxCount + 1);
    }
    const id = randomBytes(12).toString('base64url');
    this.db.prepare('INSERT INTO replays (id, match_key, created, expires, meta, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, matchKey, now, now + this.limits.keepDays * DAY, JSON.stringify(metaOf(d)), data);
    return { id, existing: false };
  }

  private row(id: unknown): { meta: string; data: Uint8Array; expires: number } | undefined {
    if (typeof id !== 'string' || !REPLAY_ID.test(id)) return undefined;
    const r = this.db.prepare('SELECT meta, data, expires FROM replays WHERE id = ? AND expires > ?').get(id, this.now()) as
      { meta: string; data: Uint8Array; expires: number } | undefined;
    return r;
  }

  /** The stored gzip JSON (sent as is to browsers that accept gzip). */
  gz(id: unknown): Buffer | undefined {
    const r = this.row(id);
    return r ? Buffer.from(r.data) : undefined;
  }

  get(id: unknown): Debrief | undefined {
    const gz = this.gz(id);
    return gz ? (JSON.parse(gunzipSync(gz).toString()) as Debrief) : undefined;
  }

  meta(id: unknown): (ReplayMeta & { expires: number }) | undefined {
    const r = this.row(id);
    return r ? { ...(JSON.parse(r.meta) as ReplayMeta), expires: r.expires } : undefined;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM replays').get() as { n: number }).n;
  }

  /** Drop expired replays; returns how many went. */
  cleanup(): number {
    return Number(this.db.prepare('DELETE FROM replays WHERE expires <= ?').run(this.now()).changes);
  }
}

/**
 * Finished matches kept in memory for a while, so a player can still share after the end
 * (one entry per match, shared by its players; bots don't count as members).
 */
export class RecentFinished {
  private matches = new Map<string, { d: Debrief; at: number; members: Set<string> }>();
  private byPlayer = new Map<string, string>();
  constructor(private keepMs = 12 * 3_600_000, private max = 200, private now = () => Date.now()) {}

  remember(matchId: string, d: Debrief): string {
    const at = this.now();
    const key = `${matchId}:${at}`;
    const members = new Set(d.stats.map((s) => s.playerId).filter((p) => !p.startsWith('bot-')));
    this.matches.set(key, { d, at, members });
    for (const p of members) this.byPlayer.set(p, key);
    this.prune();
    return key;
  }

  /** The player's last finished match, if it is still held. */
  lastFor(playerId: string): { key: string; d: Debrief } | undefined {
    const key = this.byPlayer.get(playerId);
    const m = key ? this.matches.get(key) : undefined;
    if (!m || !m.members.has(playerId) || this.now() - m.at > this.keepMs) return undefined;
    return { key: key!, d: m.d };
  }

  private prune(): void {
    const now = this.now();
    for (const [k, m] of this.matches) if (now - m.at > this.keepMs || this.matches.size > this.max) this.matches.delete(k);
    for (const [p, k] of this.byPlayer) if (!this.matches.has(k)) this.byPlayer.delete(p);
  }
}
