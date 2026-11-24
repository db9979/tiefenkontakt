import type { DatabaseSync } from 'node:sqlite';
import type { PlayerSlot } from '@tk/shared';

/**
 * Where players drop out: left a lobby before the start, left a tutorial at step N, left a
 * running match at minute M (on purpose, or a lost link that did not come back within the
 * grace period), or stayed to the end. Only counters are stored, never who.
 */

/** A lost link that comes back within this time is a reconnect, not a drop-out. */
export const DROPOUT_GRACE_MS = 3 * 60_000;
/** Minutes per bucket in the admin view. */
export const MINUTE_BUCKET = 5;

type Kind = 'lobby' | 'tutorial' | 'match' | 'finished';
type How = 'leave' | 'disconnect' | '';

/** What the tracker needs to know about a match (Match satisfies it). */
export interface MatchLike {
  id: string;
  state: 'lobby' | 'running' | 'ended';
  settings: { lesson?: string; sandbox?: boolean };
  world?: { time: number };
  slots: PlayerSlot[];
}

interface Event { kind: Kind; lesson?: string; step?: number; minute?: number; team?: string; cls?: string; how?: How }

export interface DropoutView {
  lobbyLeft: number;
  tutorials: { lesson: string; finished: number; left: { step: number; n: number }[] }[];
  matches: {
    finished: number;
    left: number;
    disconnects: number;
    byMinute: { from: number; to: number; n: number }[];
    byClass: { team: string; cls: string; left: number; finished: number }[];
  };
}

export class DropoutStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS dropout_agg (
      kind TEXT NOT NULL, lesson TEXT NOT NULL, step INTEGER NOT NULL, minute INTEGER NOT NULL, team TEXT NOT NULL, cls TEXT NOT NULL, how TEXT NOT NULL,
      n INTEGER NOT NULL, PRIMARY KEY (kind, lesson, step, minute, team, cls, how))`);
  }

  add(e: Event): void {
    this.db.prepare(`INSERT INTO dropout_agg (kind, lesson, step, minute, team, cls, how, n) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT (kind, lesson, step, minute, team, cls, how) DO UPDATE SET n = n + 1`)
      .run(e.kind, e.lesson ?? '', e.step ?? -1, e.minute ?? -1, e.team ?? '', e.cls ?? '', e.how ?? '');
  }

  view(): DropoutView {
    const rows = this.db.prepare('SELECT * FROM dropout_agg').all() as {
      kind: Kind; lesson: string; step: number; minute: number; team: string; cls: string; how: How; n: number;
    }[];
    const tut = new Map<string, { finished: number; left: Map<number, number> }>();
    const lesson = (l: string) => tut.get(l) ?? (tut.set(l, { finished: 0, left: new Map() }), tut.get(l)!);
    const minutes = new Map<number, number>();
    const classes = new Map<string, { team: string; cls: string; left: number; finished: number }>();
    const cls = (team: string, c: string) => classes.get(`${team}:${c}`) ?? (classes.set(`${team}:${c}`, { team, cls: c, left: 0, finished: 0 }), classes.get(`${team}:${c}`)!);
    const out: DropoutView = { lobbyLeft: 0, tutorials: [], matches: { finished: 0, left: 0, disconnects: 0, byMinute: [], byClass: [] } };
    for (const r of rows) {
      if (r.kind === 'lobby') out.lobbyLeft += r.n;
      else if (r.kind === 'tutorial') lesson(r.lesson).left.set(r.step, (lesson(r.lesson).left.get(r.step) ?? 0) + r.n);
      else if (r.kind === 'finished' && r.lesson) lesson(r.lesson).finished += r.n;
      else if (r.kind === 'finished') {
        out.matches.finished += r.n;
        cls(r.team, r.cls).finished += r.n;
      } else if (r.kind === 'match') {
        out.matches.left += r.n;
        if (r.how === 'disconnect') out.matches.disconnects += r.n;
        const b = Math.floor(Math.max(0, r.minute) / MINUTE_BUCKET) * MINUTE_BUCKET;
        minutes.set(b, (minutes.get(b) ?? 0) + r.n);
        cls(r.team, r.cls).left += r.n;
      }
    }
    out.tutorials = [...tut].sort(([a], [b]) => a.localeCompare(b))
      .map(([l, t]) => ({ lesson: l, finished: t.finished, left: [...t.left].sort(([a], [b]) => a - b).map(([step, n]) => ({ step, n })) }));
    out.matches.byMinute = [...minutes].sort(([a], [b]) => a - b).map(([from, n]) => ({ from, to: from + MINUTE_BUCKET, n }));
    out.matches.byClass = [...classes.values()].sort((a, b) => a.team.localeCompare(b.team) || a.cls.localeCompare(b.cls));
    return out;
  }
}

interface Pending { matchId: string; at: number; event: Event }

/** Turns lobby happenings (leave, lost link, reconnect, end) into drop-out counts. */
export class DropoutTracker {
  private pending = new Map<string, Pending>();
  /** Tutorial step each player is on (reported by the client). */
  private steps = new Map<string, number>();
  /** Players of a match already counted as gone (so the end does not count them again). */
  private gone = new Map<string, Set<string>>();

  constructor(private store: DropoutStore, private graceMs = DROPOUT_GRACE_MS) {}

  lessonStep(playerId: string, step: number): void {
    this.steps.set(playerId, step);
  }

  /** The player left the match on purpose (or a lobby link dropped). */
  left(m: MatchLike, playerId: string): void {
    this.pending.delete(playerId);
    const e = this.eventFor(m, playerId, 'leave');
    if (e) this.record(m.id, playerId, e);
  }

  /** The link of a player in a running match dropped: counted unless they return in time. */
  detached(m: MatchLike, playerId: string, now = Date.now()): void {
    const e = this.eventFor(m, playerId, 'disconnect');
    if (e) this.pending.set(playerId, { matchId: m.id, at: now, event: e });
  }

  /** The player is back in their match. */
  back(playerId: string): void {
    this.pending.delete(playerId);
  }

  /** Count lost links older than the grace period. */
  tick(now = Date.now()): void {
    for (const [pid, p] of this.pending) {
      if (now - p.at < this.graceMs) continue;
      this.pending.delete(pid);
      this.record(p.matchId, pid, p.event);
    }
  }

  /** The match is gone without an end (abandoned, moderator): nobody can come back. */
  dropped(m: MatchLike): void {
    for (const [pid, p] of this.pending) {
      if (p.matchId !== m.id) continue;
      this.pending.delete(pid);
      this.record(m.id, pid, p.event);
    }
    this.forget(m);
  }

  /** The match ended: everyone still aboard (or only briefly away) finished it. */
  finished(m: MatchLike): void {
    if (m.settings.sandbox) return this.forget(m);
    const gone = this.gone.get(m.id) ?? new Set<string>();
    for (const s of m.slots) {
      if (s.bot || gone.has(s.playerId)) continue;
      this.pending.delete(s.playerId);
      this.store.add({ kind: 'finished', lesson: m.settings.lesson, team: m.settings.lesson ? undefined : s.team, cls: m.settings.lesson ? undefined : s.cls });
    }
    this.forget(m);
  }

  private forget(m: MatchLike): void {
    this.gone.delete(m.id);
    for (const s of m.slots) if (!this.pending.has(s.playerId)) this.steps.delete(s.playerId);
  }

  private eventFor(m: MatchLike, playerId: string, how: How): Event | undefined {
    if (m.settings.sandbox || m.state === 'ended') return undefined;
    const slot = m.slots.find((s) => s.playerId === playerId);
    if (!slot || slot.bot) return undefined;
    if (m.state === 'lobby') return { kind: 'lobby' };
    if (m.settings.lesson) return { kind: 'tutorial', lesson: m.settings.lesson, step: this.steps.get(playerId) ?? 0 };
    return { kind: 'match', minute: Math.floor((m.world?.time ?? 0) / 60), team: slot.team, cls: slot.cls, how };
  }

  private record(matchId: string, playerId: string, e: Event): void {
    if (e.kind === 'lobby') return this.store.add(e); // may come back to this lobby and play it out
    const g = this.gone.get(matchId) ?? new Set<string>();
    if (g.has(playerId)) return;
    g.add(playerId);
    this.gone.set(matchId, g);
    this.store.add(e);
    if (e.kind === 'tutorial') this.steps.delete(playerId);
  }
}
