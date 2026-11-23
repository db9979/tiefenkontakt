import { describe, expect, it } from 'vitest';
import { AlertState, Debounce, SIX_HOURS, alertRecipient, diskLow, parseDiskThreshold } from '../src/alerts.js';
import { Watchdog, watchdogConfig, type WatchdogProbes } from '../src/watchdog.js';

const H = 3_600_000;

describe('alert rate limiting', () => {
  it('mails once per kind per 6 h and sends a reminder after that', () => {
    const a = new AlertState();
    expect(a.update('disk', true, 0)?.send).toBe('alert');
    expect(a.update('disk', true, 1 * H)).toBeUndefined();
    expect(a.update('disk', true, 5.9 * H)).toBeUndefined();
    expect(a.update('disk', true, SIX_HOURS)?.send).toBe('alert');
    expect(a.update('disk', true, 7 * H)).toBeUndefined();
  });

  it('kinds are limited separately', () => {
    const a = new AlertState();
    expect(a.update('disk', true, 0)?.send).toBe('alert');
    expect(a.update('backup', true, 0)?.send).toBe('alert');
  });

  it('sends one recovered mail when a mailed condition clears', () => {
    const a = new AlertState();
    a.update('memory', true, 0);
    const r = a.update('memory', false, 2 * H);
    expect(r).toEqual({ send: 'recovered', kind: 'memory', since: 0 });
    expect(a.update('memory', false, 3 * H)).toBeUndefined();
    expect(a.activeKinds()).toEqual([]);
  });

  it('stays quiet when nothing was ever wrong', () => {
    const a = new AlertState();
    expect(a.update('lag', false, 0)).toBeUndefined();
    expect(a.update('lag', false, H)).toBeUndefined();
  });

  it('a condition that flaps back within the gap neither alerts nor recovers again', () => {
    const a = new AlertState();
    a.update('backup', true, 0);
    expect(a.update('backup', false, 1 * H)?.send).toBe('recovered');
    expect(a.update('backup', true, 2 * H)).toBeUndefined(); // rate-limited
    expect(a.activeKinds()).toEqual(['backup']);
    expect(a.update('backup', false, 3 * H)).toBeUndefined(); // no alert went out, so no all-clear either
    // Back again after the gap: a fresh alert, and then its recovery
    expect(a.update('backup', true, 7 * H)?.send).toBe('alert');
    expect(a.update('backup', false, 8 * H)).toEqual({ send: 'recovered', kind: 'backup', since: 7 * H });
  });

  it('a flapping condition still active after the gap gets its reminder', () => {
    const a = new AlertState();
    a.update('disk', true, 0);
    a.update('disk', false, 1 * H);
    expect(a.update('disk', true, 2 * H)).toBeUndefined();
    expect(a.update('disk', true, 6 * H)).toEqual({ send: 'alert', kind: 'disk', since: 2 * H });
  });
});

describe('debounce', () => {
  it('needs n readings in a row to switch on and off', () => {
    const d = new Debounce(3);
    expect([true, true, false, true, true].map((x) => d.push(x))).toEqual([false, false, false, false, false]);
    expect(d.push(true)).toBe(true);
    expect(d.push(false)).toBe(true);
    expect(d.push(true)).toBe(true);
    expect([false, false, false].map((x) => d.push(x))).toEqual([true, true, false]);
  });
});

describe('disk threshold', () => {
  it('defaults to 10 % or 1 GB', () => {
    expect(parseDiskThreshold(undefined)).toEqual({ pct: 10, bytes: 1e9 });
    expect(parseDiskThreshold('  ')).toEqual({ pct: 10, bytes: 1e9 });
  });

  it('reads percentages, units and combinations', () => {
    expect(parseDiskThreshold('15%')).toEqual({ pct: 15, bytes: 0 });
    expect(parseDiskThreshold('500MB')).toEqual({ pct: 0, bytes: 5e8 });
    expect(parseDiskThreshold('2 GB, 5 %')).toEqual({ pct: 5, bytes: 2e9 });
    expect(parseDiskThreshold('1.5g')).toEqual({ pct: 0, bytes: 1.5e9 });
    expect(parseDiskThreshold('0')).toEqual({ pct: 0, bytes: 0 });
  });

  it('rejects what it cannot read', () => {
    expect(() => parseDiskThreshold('viel')).toThrow(/ALERT_DISK_MIN/);
    expect(() => parseDiskThreshold('150%')).toThrow(/100/);
    expect(() => parseDiskThreshold('-5%')).toThrow();
  });

  it('whichever limit is hit first counts', () => {
    const t = parseDiskThreshold('10%,1GB');
    expect(diskLow(5e9, 100e9, t)).toBe(true); // 5 %
    expect(diskLow(0.8e9, 4e9, t)).toBe(true); // 20 % but under 1 GB
    expect(diskLow(20e9, 100e9, t)).toBe(false);
    expect(diskLow(1, 100, parseDiskThreshold('0'))).toBe(false);
  });
});

describe('recipient', () => {
  it('ALERT_TO, else MAIL_FROM, else SMTP_USER', () => {
    expect(alertRecipient({ ALERT_TO: 'ops@x.de', MAIL_FROM: 'a@x.de' })).toBe('ops@x.de');
    expect(alertRecipient({ MAIL_FROM: 'a@x.de', SMTP_USER: 'u@x.de' })).toBe('a@x.de');
    expect(alertRecipient({ SMTP_USER: 'u@x.de' })).toBe('u@x.de');
    expect(alertRecipient({})).toBeUndefined();
  });
});

describe('watchdog', () => {
  function setup(env: NodeJS.ProcessEnv = {}) {
    const r = { free: 50e9, total: 100e9, rss: 100, lag: 10, tick: 5 as number | undefined, age: 3 as number | undefined };
    const probes: WatchdogProbes = {
      disk: () => ({ free: r.free, total: r.total }), rssMb: () => r.rss, lagMs: () => r.lag, tickMs: () => r.tick,
      backupAgeH: () => r.age, status: () => ({ Partien: 2 }),
    };
    const sent: string[] = [];
    const w = new Watchdog(probes, async (s) => void sent.push(s), watchdogConfig({ ALERT_RSS_MB: '500', ALERT_PERSIST: '3', ...env }));
    return { r, w, sent };
  }

  it('mails disk alerts and their recovery', () => {
    const { r, w, sent } = setup();
    w.check(0);
    expect(sent).toEqual([]);
    r.free = 3e9;
    w.check(60_000);
    w.check(120_000);
    expect(sent).toEqual(['Tiefenkontakt ALARM: Wenig freier Speicherplatz']);
    r.free = 40e9;
    w.check(180_000);
    expect(sent[1]).toBe('Tiefenkontakt wieder OK: Wenig freier Speicherplatz');
  });

  it('memory needs several readings in a row', () => {
    const { r, w, sent } = setup();
    r.rss = 900;
    w.check(0);
    w.check(1);
    expect(sent).toEqual([]);
    w.check(2);
    expect(sent).toEqual(['Tiefenkontakt ALARM: Hoher Speicherverbrauch']);
  });

  it('reports failed backups and stale ones', () => {
    const { r, w, sent } = setup({ BACKUP_EVERY_H: '24' });
    w.backupResult({ ok: false, error: 'disk I/O error' }, 0);
    w.backupResult({ ok: false, error: 'disk I/O error' }, H);
    w.backupResult({ ok: true, file: 'tiefenkontakt-x.db', mirrorError: 'ENOENT' }, 2 * H);
    expect(sent).toEqual([
      'Tiefenkontakt ALARM: Backup fehlgeschlagen',
      'Tiefenkontakt wieder OK: Backup fehlgeschlagen',
      'Tiefenkontakt ALARM: Backup-Spiegel fehlgeschlagen',
    ]);
    r.age = 60;
    w.check(3 * H);
    expect(sent.at(-1)).toBe('Tiefenkontakt ALARM: Kein frisches Backup');
  });

  it('sends the daily summary once a day after the set hour', () => {
    const { w, sent } = setup({ ALERT_DAILY: '1', ALERT_DAILY_HOUR: '7' });
    const day = Date.UTC(2026, 10, 23);
    w.check(day + 6 * H);
    expect(sent).toEqual([]);
    w.check(day + 7 * H);
    w.check(day + 8 * H);
    expect(sent).toEqual(['Tiefenkontakt Tagesbericht: alles OK']);
    w.check(day + 31 * H);
    expect(sent).toHaveLength(2);
  });
});
