/**
 * Building blocks for operator alerts (see watchdog.ts): who gets them, rate limiting with a
 * "recovered" notice, debouncing of noisy readings, and the disk threshold format.
 * No timers and no I/O here, so the logic is easy to test.
 */

/** Recipient of operator mails: ALERT_TO, else MAIL_FROM, else SMTP_USER; undefined = log only. */
export function alertRecipient(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.ALERT_TO?.trim() || env.MAIL_FROM?.trim() || env.SMTP_USER?.trim() || undefined;
}

export const SIX_HOURS = 6 * 3_600_000;

interface KindState {
  active: boolean;
  /** Last alert mail of this kind (for the rate limit). */
  mailedAt?: number;
  /** An alert mail went out for the current episode, so its end gets a "recovered" mail. */
  notified: boolean;
  since?: number;
}

export type AlertAction = { send: 'alert' | 'recovered'; kind: string; since: number } | undefined;

/**
 * Per kind (backup, disk, memory, …): at most one alert mail per `minGapMs`, and one
 * "recovered" mail when a condition that was mailed about clears. A condition that comes back
 * within the gap stays quiet (no alert, so no recovered either); if it is still active when
 * the gap is over, the reminder goes out then.
 */
export class AlertState {
  private kinds = new Map<string, KindState>();

  constructor(private minGapMs = SIX_HOURS) {}

  /** Feed the current state of one condition; returns the mail to send, if any. */
  update(kind: string, active: boolean, now = Date.now()): AlertAction {
    let s = this.kinds.get(kind);
    if (!s) this.kinds.set(kind, (s = { active: false, notified: false }));
    if (active) {
      if (!s.active) {
        s.active = true;
        s.since = now;
      }
      if (s.mailedAt === undefined || now - s.mailedAt >= this.minGapMs) {
        s.mailedAt = now;
        s.notified = true;
        return { send: 'alert', kind, since: s.since! };
      }
      return undefined;
    }
    if (!s.active) return undefined;
    s.active = false;
    const since = s.since ?? now;
    s.since = undefined;
    if (!s.notified) return undefined;
    s.notified = false;
    return { send: 'recovered', kind, since };
  }

  /** Kinds that are currently active (for the daily summary). */
  activeKinds(): string[] {
    return [...this.kinds].filter(([, s]) => s.active).map(([k]) => k);
  }
}

/**
 * Turns noisy readings into a steady state: it becomes active after `n` readings in a row
 * over the limit, and clears again after `n` readings in a row under it.
 */
export class Debounce {
  private over = 0;
  private under = 0;
  active = false;

  constructor(private n: number) {}

  push(isOver: boolean): boolean {
    if (isOver) {
      this.over++;
      this.under = 0;
      if (this.over >= this.n) this.active = true;
    } else {
      this.under++;
      this.over = 0;
      if (this.under >= this.n) this.active = false;
    }
    return this.active;
  }
}

export interface DiskThreshold {
  /** Alert when free space is below this share of the disk (0–100); 0 = off. */
  pct: number;
  /** Alert when free space is below this many bytes; 0 = off. */
  bytes: number;
}

const UNITS: Record<string, number> = { '': 1, b: 1, k: 1e3, kb: 1e3, m: 1e6, mb: 1e6, g: 1e9, gb: 1e9, t: 1e12, tb: 1e12 };

/**
 * ALERT_DISK_MIN: comma-separated limits, e.g. "10%,1GB" (the default), "15%", "500MB", or "0"
 * to switch the disk check off. Whichever limit is hit first raises the alert.
 * Throws on anything it can't read, so a typo shows up at start instead of never alerting.
 */
export function parseDiskThreshold(raw: string | undefined): DiskThreshold {
  if (raw === undefined || raw.trim() === '') return { pct: 10, bytes: 1e9 };
  const out: DiskThreshold = { pct: 0, bytes: 0 };
  for (const part of raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)\s*(%|[kmgt]?b?)$/.exec(part);
    if (!m) throw new Error(`ALERT_DISK_MIN: „${part}“ nicht lesbar (Beispiel: 10%,1GB)`);
    const v = Number(m[1]);
    if (m[2] === '%') {
      if (v > 100) throw new Error(`ALERT_DISK_MIN: ${part} ist mehr als 100 %`);
      out.pct = v;
    } else out.bytes = v * UNITS[m[2]!]!;
  }
  return out;
}

/** Is the free space below the threshold? */
export function diskLow(freeBytes: number, totalBytes: number, t: DiskThreshold): boolean {
  if (t.bytes > 0 && freeBytes < t.bytes) return true;
  return t.pct > 0 && totalBytes > 0 && (freeBytes / totalBytes) * 100 < t.pct;
}

/** "3 h 12 min" for mails. */
export function duration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} Tage ${h % 24} h`;
}

export const fmtBytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
