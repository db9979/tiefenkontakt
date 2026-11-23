import { statfsSync } from 'node:fs';
import { totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { AlertState, Debounce, alertRecipient, diskLow, duration, fmtBytes, parseDiskThreshold, type AlertAction, type DiskThreshold } from './alerts.js';
import type { BackupResult, Backups } from './backup.js';
import type { Mailer } from './mailer.js';
import { log } from './log.js';
import { metrics } from './metrics.js';

/**
 * Operator alerts by mail (ALERT_TO, else MAIL_FROM): failed backups, no fresh backup, low disk
 * space, high memory, a stuck event loop or slow match ticks. One mail per kind per 6 h at
 * most, plus a "recovered" mail when it clears; optionally a daily OK summary (ALERT_DAILY=1).
 * The server can't report its own death: scripts/healthcheck.sh on the host covers that.
 */

export interface WatchdogConfig {
  checkS: number;
  /** Readings in a row over (or under) the limit before memory/lag/tick alerts start (or clear). */
  persist: number;
  disk: DiskThreshold;
  diskPath: string;
  rssMb: number;
  lagMs: number;
  tickMs: number;
  /** Newest backup older than this many hours = alert; 0 = off. */
  backupMaxAgeH: number;
  daily: boolean;
  dailyHourUtc: number;
  gapMs: number;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** A typo in ALERT_DISK_MIN must not stop the game: log it and use the default. */
function diskSetting(raw: string | undefined): DiskThreshold {
  try {
    return parseDiskThreshold(raw);
  } catch (e) {
    log('error', (e as Error).message);
    return parseDiskThreshold(undefined);
  }
}

/** Settings from the environment (see .env.example). */
export function watchdogConfig(env: NodeJS.ProcessEnv = process.env): WatchdogConfig {
  const cm = process.constrainedMemory?.() ?? 0;
  const memMb = Math.min(totalmem(), cm > 0 ? cm : Infinity) / 1e6;
  return {
    checkS: Math.max(5, num(env.ALERT_CHECK_S, 60)),
    persist: Math.max(1, Math.round(num(env.ALERT_PERSIST, 5))),
    disk: diskSetting(env.ALERT_DISK_MIN),
    diskPath: env.ALERT_DISK_PATH || dirname(resolve(env.DB_PATH ?? 'tiefenkontakt.db')),
    rssMb: num(env.ALERT_RSS_MB, Math.round(Math.min(1024, memMb / 2))),
    lagMs: num(env.ALERT_LAG_MS, 200),
    tickMs: num(env.ALERT_TICK_MS, 50),
    backupMaxAgeH: num(env.ALERT_BACKUP_MAX_AGE_H, 2 * Math.max(1, num(env.BACKUP_EVERY_H, 24)) + 1),
    daily: env.ALERT_DAILY === '1',
    dailyHourUtc: Math.min(23, Math.max(0, Math.round(num(env.ALERT_DAILY_HOUR, 7)))),
    gapMs: Math.max(0, num(env.ALERT_GAP_H, 6)) * 3_600_000,
  };
}

/** What the watchdog reads each check; replaced by fakes in tests. */
export interface WatchdogProbes {
  disk(): { free: number; total: number } | undefined;
  rssMb(): number;
  /** p99 event-loop lag since the last call. */
  lagMs(): number;
  /** p95 tick time since the last call; undefined when no match ticked. */
  tickMs(): number | undefined;
  /** Age of the newest backup in hours; undefined when backups are off or none exist yet. */
  backupAgeH(): number | undefined;
  /** Extra lines for the daily summary (matches, players, …). */
  status(): Record<string, string | number>;
}

const LABEL: Record<string, string> = {
  backup: 'Backup fehlgeschlagen',
  'backup-mirror': 'Backup-Spiegel fehlgeschlagen',
  'backup-stale': 'Kein frisches Backup',
  disk: 'Wenig freier Speicherplatz',
  memory: 'Hoher Speicherverbrauch',
  lag: 'Server reagiert verzögert (Event-Loop)',
  tick: 'Spieltakt zu langsam',
};

export type SendFn = (subject: string, text: string) => Promise<void>;

export class Watchdog {
  readonly alerts: AlertState;
  private detail = new Map<string, string>();
  private mem: Debounce;
  private lag: Debounce;
  private tick: Debounce;
  private lastDaily?: string;
  private dailyInit = false;
  private timer?: ReturnType<typeof setInterval>;
  private last: Record<string, string> = {};
  /** Mails in flight (tests await them). */
  pending: Promise<void>[] = [];

  constructor(private probes: WatchdogProbes, private send: SendFn, readonly cfg: WatchdogConfig, private site = 'Tiefenkontakt') {
    this.alerts = new AlertState(cfg.gapMs);
    this.mem = new Debounce(cfg.persist);
    this.lag = new Debounce(cfg.persist);
    this.tick = new Debounce(cfg.persist);
  }

  /** Report the current state of one condition; mails (rate-limited) when it starts or clears. */
  set(kind: string, active: boolean, detail: string, now = Date.now()): AlertAction {
    if (active) this.detail.set(kind, detail);
    const a = this.alerts.update(kind, active, now);
    if (!a) return a;
    const label = LABEL[kind] ?? kind;
    if (a.send === 'alert') {
      log('warn', `Alarm: ${label}`, { kind, detail });
      this.mail(`${this.site} ALARM: ${label}`, [
        `${label}.`, '', detail, '',
        `Seit: ${new Date(a.since).toISOString()}`,
        `Weitere Mails zu diesem Punkt frühestens in ${Math.round(this.cfg.gapMs / 3_600_000)} h; eine Entwarnung kommt, sobald es wieder passt.`,
      ].join('\n'));
    } else {
      log('info', `Entwarnung: ${label}`, { kind, detail });
      this.mail(`${this.site} wieder OK: ${label}`, [
        `Entwarnung: ${label} ist behoben.`, '', `Jetzt: ${detail}`,
        `Vorher: ${this.detail.get(kind) ?? '?'}`, `Dauer: ${duration(now - a.since)}`,
      ].join('\n'));
    }
    return a;
  }

  /** Hook for Backups.onResult. */
  backupResult(r: BackupResult, now = Date.now()): void {
    this.set('backup', !r.ok, r.ok ? `Backup ${r.file} geschrieben` : `Fehler: ${r.error}`, now);
    if (r.ok) this.set('backup-mirror', !!r.mirrorError, r.mirrorError ? `Hauptkopie ${r.file} ok, Spiegel: ${r.mirrorError}` : `Spiegel von ${r.file} ok`, now);
  }

  /** One round of readings. */
  check(now = Date.now()): void {
    const c = this.cfg;
    const d = this.probes.disk();
    if (d) {
      const low = diskLow(d.free, d.total, c.disk);
      const pct = d.total ? ((d.free / d.total) * 100).toFixed(1) : '?';
      this.last.disk = `${fmtBytes(d.free)} frei von ${fmtBytes(d.total)} (${pct} %) in ${c.diskPath}`;
      this.set('disk', low, `${this.last.disk}; Grenze: ${[c.disk.pct ? `${c.disk.pct} %` : '', c.disk.bytes ? fmtBytes(c.disk.bytes) : ''].filter(Boolean).join(' / ')}`, now);
    }
    const rss = this.probes.rssMb();
    this.last.memory = `${rss} MB RSS`;
    this.set('memory', this.mem.push(rss > c.rssMb), `${rss} MB RSS (Grenze ${c.rssMb} MB)`, now);
    const lag = this.probes.lagMs();
    this.last.lag = `${lag.toFixed(0)} ms (p99)`;
    this.set('lag', this.lag.push(lag > c.lagMs), `Event-Loop-Verzögerung ${lag.toFixed(0)} ms (p99, Grenze ${c.lagMs} ms, ${c.persist} Messungen in Folge)`, now);
    const tick = this.probes.tickMs();
    if (tick !== undefined) this.last.tick = `${tick.toFixed(1)} ms (p95)`;
    this.set('tick', this.tick.push(tick !== undefined && tick > c.tickMs),
      tick === undefined ? 'keine laufende Partie' : `Spieltakt ${tick.toFixed(1)} ms (p95, Grenze ${c.tickMs} ms bei 100 ms Takt)`, now);
    const age = this.probes.backupAgeH();
    if (age !== undefined) {
      this.last.backup = `${age.toFixed(1)} h alt`;
      if (c.backupMaxAgeH > 0) this.set('backup-stale', age > c.backupMaxAgeH, `Neuestes Backup ist ${age.toFixed(1)} h alt (Grenze ${c.backupMaxAgeH} h)`, now);
    }
    this.daily(now);
  }

  private daily(now: number): void {
    if (!this.cfg.daily) return;
    const t = new Date(now);
    const day = t.toISOString().slice(0, 10);
    if (!this.dailyInit) {
      this.dailyInit = true;
      if (t.getUTCHours() >= this.cfg.dailyHourUtc) this.lastDaily = day; // started after the hour: from tomorrow
    }
    if (this.lastDaily === day || t.getUTCHours() < this.cfg.dailyHourUtc) return;
    this.lastDaily = day;
    const active = this.alerts.activeKinds();
    const status = this.probes.status();
    this.mail(`${this.site} Tagesbericht: ${active.length ? `${active.length} offene Warnung(en)` : 'alles OK'}`, [
      active.length ? `Offene Warnungen: ${active.map((k) => LABEL[k] ?? k).join(', ')}` : 'Keine offenen Warnungen.', '',
      ...Object.entries(status).map(([k, v]) => `${k}: ${v}`),
      `Speicherplatz: ${this.last.disk ?? '?'}`, `Speicher: ${this.last.memory ?? '?'}`,
      `Event-Loop: ${this.last.lag ?? '?'}`, `Spieltakt: ${this.last.tick ?? 'keine Partie'}`, `Backup: ${this.last.backup ?? 'aus'}`,
    ].join('\n'));
  }

  private mail(subject: string, text: string): void {
    const p = this.send(subject, text).catch((e) => log('error', 'Alarm-Mail fehlgeschlagen', { subject, error: (e as Error).message }));
    this.pending.push(p);
    if (this.pending.length > 20) this.pending.splice(0, this.pending.length - 20);
  }

  start(): void {
    this.timer = setInterval(() => {
      try {
        this.check();
      } catch (e) {
        log('error', 'Watchdog-Prüfung fehlgeschlagen', { error: (e as Error).message });
      }
    }, this.cfg.checkS * 1000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

/** Real readings of this process. */
export function processProbes(cfg: WatchdogConfig, backups: Backups | undefined, status: () => Record<string, string | number>): WatchdogProbes {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  return {
    disk: () => {
      try {
        const s = statfsSync(cfg.diskPath);
        return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
      } catch {
        return undefined;
      }
    },
    rssMb: () => Math.round(process.memoryUsage().rss / 1e6),
    lagMs: () => {
      const v = loop.count ? loop.percentile(99) / 1e6 : 0;
      loop.reset();
      return v;
    },
    tickMs: () => {
      const t = metrics.takeTicks().sort((a, b) => a - b);
      return t.length ? t[Math.min(t.length - 1, Math.floor(0.95 * t.length))] : undefined;
    },
    backupAgeH: () => {
      if (!backups?.enabled) return undefined;
      const newest = backups.list()[0];
      return newest ? (Date.now() - newest.at) / 3_600_000 : undefined;
    },
    status,
  };
}

/**
 * Wire the watchdog into the running server (ALERT=0 switches it off). Mails go through the
 * server's mailer; without a recipient they only appear in the log.
 */
export function startWatchdog(mailer: Mailer, backups: Backups, status: () => Record<string, string | number>, env = process.env): Watchdog | undefined {
  if (env.ALERT === '0') return undefined;
  const cfg = watchdogConfig(env);
  const to = alertRecipient(env);
  let site = 'Tiefenkontakt';
  try {
    if (env.PUBLIC_URL) site = `Tiefenkontakt (${new URL(env.PUBLIC_URL).host})`;
  } catch { /* keep the plain name */ }
  const send: SendFn = async (subject, text) => {
    if (to) await mailer.send({ to, subject, text });
  };
  const w = new Watchdog(processProbes(cfg, backups, status), send, cfg, site);
  backups.onResult = (r) => w.backupResult(r);
  w.start();
  log('info', 'Watchdog aktiv', {
    to: to ?? '(kein Empfänger: nur Log)', disk: cfg.diskPath, rssMb: cfg.rssMb, lagMs: cfg.lagMs, tickMs: cfg.tickMs, daily: cfg.daily,
  });
  return w;
}
