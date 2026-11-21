import type { DatabaseSync } from 'node:sqlite';

/**
 * Player reports and bans. Admins are accounts whose callsign is listed in ADMIN
 * (comma separated). Bans apply to the player id and, for guests who can mint new
 * ids, also to the IP address.
 */

export interface Report {
  id: number;
  at: number;
  reporter: string;
  reported: string;
  reportedId: string;
  matchId: string;
  reason: string;
  evidence: string;
}

export interface Ban {
  id: number;
  playerId: string;
  callsign: string;
  ip: string | null;
  until: number;
  reason: string;
}

export function adminList(env = process.env.ADMIN): Set<string> {
  return new Set((env ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export class ModerationStore {
  constructor(private db: DatabaseSync, private admins = adminList()) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, reporter TEXT NOT NULL, reported TEXT NOT NULL,
        reported_id TEXT NOT NULL, match_id TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bans (id INTEGER PRIMARY KEY, player_id TEXT NOT NULL, callsign TEXT NOT NULL, ip TEXT,
        until INTEGER NOT NULL, reason TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS bans_player ON bans(player_id);`);
  }

  isAdmin(callsign: string | undefined): boolean {
    return !!callsign && this.admins.has(callsign.toLowerCase());
  }

  /** One report per reporter and reported player per match (no flooding). */
  report(r: Omit<Report, 'id' | 'at'>, now = Date.now()): boolean {
    const dup = this.db.prepare('SELECT 1 FROM reports WHERE reporter = ? AND reported_id = ? AND match_id = ?').get(r.reporter, r.reportedId, r.matchId);
    if (dup) return false;
    this.db.prepare('INSERT INTO reports (at, reporter, reported, reported_id, match_id, reason, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(now, r.reporter, r.reported, r.reportedId, r.matchId, r.reason.slice(0, 200), r.evidence.slice(0, 2000));
    return true;
  }

  reports(limit = 100): Report[] {
    return (this.db.prepare('SELECT id, at, reporter, reported, reported_id AS reportedId, match_id AS matchId, reason, evidence FROM reports ORDER BY at DESC LIMIT ?').all(limit) as unknown) as Report[];
  }

  dismissReport(id: number): void {
    this.db.prepare('DELETE FROM reports WHERE id = ?').run(id);
  }

  ban(b: Omit<Ban, 'id'>): void {
    this.db.prepare('INSERT INTO bans (player_id, callsign, ip, until, reason) VALUES (?, ?, ?, ?, ?)').run(b.playerId, b.callsign, b.ip, b.until, b.reason.slice(0, 200));
  }

  unban(id: number): void {
    this.db.prepare('DELETE FROM bans WHERE id = ?').run(id);
  }

  bans(now = Date.now()): Ban[] {
    return (this.db.prepare('SELECT id, player_id AS playerId, callsign, ip, until, reason FROM bans WHERE until > ? ORDER BY until DESC').all(now) as unknown) as Ban[];
  }

  /** The active ban for this player or address, if any. */
  bannedFor(playerId: string, ip: string | undefined, now = Date.now()): Ban | undefined {
    const row = this.db.prepare('SELECT id, player_id AS playerId, callsign, ip, until, reason FROM bans WHERE until > ? AND (player_id = ? OR (ip IS NOT NULL AND ip = ?)) ORDER BY until DESC LIMIT 1')
      .get(now, playerId, ip ?? '\u0000');
    return row as Ban | undefined;
  }
}
