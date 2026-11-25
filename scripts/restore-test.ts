/**
 * Restore test for database backups: proves the newest backup can actually be brought back.
 *   1. picks the newest backup (a file, a folder, or BACKUP_DIR) and checks its age,
 *   2. copies it to a temp folder, opens the copy read-only and runs PRAGMA integrity_check,
 *   3. counts the rows of all tables and compares them with the live database (--live, default DB_PATH),
 *   4. starts a game server on a free port with DB_PATH = a second copy and checks
 *      /api/health and /api/leaderboard,
 *   5. prints a report (and mails it with --mail: ALERT_TO, else MAIL_FROM); exit code 1 on failure.
 * Usage (repo root, or /app in the container):
 *   node --import tsx scripts/restore-test.ts [backup file or folder] [--live db] [--no-live] [--mail] [--timeout s]
 * Weekly on the Pi: scripts/install-health-cron.sh installs it.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { alertRecipient } from '../apps/server/src/alerts.js';
import { adminMail } from '../apps/server/src/admin-mail.js';
import { restoreReport } from '../apps/server/src/admin-mails.js';
import { createMailer } from '../apps/server/src/mailer.js';

const ROOT = resolve(import.meta.dirname, '..');
const BACKUP_NAME = /^tiefenkontakt-\d{8}-\d{6}\.db$/;
/** Tables a working game database must have (accounts, results, campaign, ratings, badges). */
const REQUIRED = ['users', 'results', 'matches', 'campaign_runs', 'ratings', 'badges'];
/** Tables whose emptiness in the backup while the live DB has rows means the backup is broken. */
const MUST_HAVE_ROWS = ['users', 'results'];

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !['--live', '--timeout'].includes(args[i - 1] ?? ''));
const timeoutS = Number(opt('--timeout')) || 90;
const maxAgeH = Number(process.env.RESTORE_MAX_AGE_H) || 2 * Math.max(1, Number(process.env.BACKUP_EVERY_H) || 24) + 1;

const lines: string[] = [];
const failures: string[] = [];
const warnings: string[] = [];
const say = (s: string) => {
  lines.push(s);
  console.log(s);
};
const fail = (s: string) => {
  failures.push(s);
  say(`✗ ${s}`);
};
const warn = (s: string) => {
  warnings.push(s);
  say(`! ${s}`);
};
const ok = (s: string) => say(`✓ ${s}`);

/** Newest backup file in a folder (by the timestamp in the name). */
function newestIn(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir).filter((n) => BACKUP_NAME.test(n)).sort().reverse()[0];
  return f ? join(dir, f) : undefined;
}

function pickBackup(): string | undefined {
  const src = positional[0] ?? process.env.BACKUP_DIR;
  if (!src) {
    fail('Kein Backup angegeben und BACKUP_DIR nicht gesetzt');
    return undefined;
  }
  if (!existsSync(src)) {
    fail(`${src} gibt es nicht`);
    return undefined;
  }
  const file = statSync(src).isDirectory() ? newestIn(src) : src;
  if (!file) fail(`Kein Backup (tiefenkontakt-JJJJMMTT-hhmmss.db) in ${src}`);
  return file;
}

function tableCounts(db: DatabaseSync): Map<string, number> {
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  return new Map(names.map((n) => [n, (db.prepare(`SELECT COUNT(*) AS n FROM "${n.replaceAll('"', '""')}"`).get() as { n: number }).n]));
}

function freePort(): Promise<number> {
  return new Promise((ok, no) => {
    const s = createServer();
    s.on('error', no);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (a && typeof a === 'object' ? ok(a.port) : no(new Error('kein Port'))));
    });
  });
}

async function get(url: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) };
  } catch {
    return { status: r.status, body: text };
  }
}

/** Start the real game server on the restored copy and ask it a few things. */
async function serverCheck(dbFile: string, work: string, expectUsers: number | undefined): Promise<void> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port), DB_PATH: dbFile, MATCH_DIR: join(work, 'matches'),
    // Nothing of the test server may touch the real setup: no backups, no mails, no alerts, no voice
    BACKUP_DIR: '', BACKUP_MIRROR_DIR: '', ALERT: '0', SMTP_HOST: '', SMTP_URL: '', CLIENT_DIST: '',
    LIVEKIT_URL: '', TURN_URLS: '', LOG_FORMAT: '',
  };
  const t0 = Date.now();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: join(ROOT, 'apps/server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (out += d.toString()));
  let exited: number | null | undefined;
  child.on('exit', (code) => (exited = code));
  const base = `http://127.0.0.1:${port}`;
  try {
    let healthy = false;
    while (Date.now() - t0 < timeoutS * 1000 && exited === undefined) {
      try {
        const h = await get(`${base}/api/health`);
        if (h.status === 200 && (h.body as { ok?: boolean }).ok) {
          healthy = true;
          break;
        }
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!healthy) {
      fail(exited !== undefined ? `Server mit dem Backup beendet sich sofort (Code ${exited})` : `Server antwortet nach ${timeoutS} s nicht auf /api/health`);
      const tail = out.trim().split('\n').slice(-15);
      if (tail.length) say(`  Serverausgabe:\n${tail.map((l) => `    ${l}`).join('\n')}`);
      return;
    }
    ok(`Server startet mit dem Backup (Port ${port}, ${((Date.now() - t0) / 1000).toFixed(1)} s), /api/health ok`);
    const lb = await get(`${base}/api/leaderboard`);
    if (lb.status === 200 && Array.isArray(lb.body)) ok(`/api/leaderboard liefert ${lb.body.length} Einträge`);
    else fail(`/api/leaderboard: Status ${lb.status}, ${JSON.stringify(lb.body).slice(0, 120)}`);
    const rk = await get(`${base}/api/rankings?season=current`);
    if (rk.status === 200) ok('/api/rankings (laufende Saison) ok');
    else fail(`/api/rankings: Status ${rk.status}`);
  } finally {
    if (exited === undefined) {
      child.kill('SIGTERM');
      await new Promise((r) => {
        const t = setTimeout(() => (child.kill('SIGKILL'), r(undefined)), 5000);
        child.once('exit', () => (clearTimeout(t), r(undefined)));
      });
    }
  }
  if (expectUsers !== undefined) {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const n = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    db.close();
    if (n === expectUsers) ok(`Nach dem Serverlauf noch alle ${n} Konten da`);
    else fail(`Nach dem Serverlauf ${n} statt ${expectUsers} Konten`);
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  say(`Restore-Test ${new Date().toISOString()}`);
  const file = pickBackup();
  if (!file) return;
  const st = statSync(file);
  const ageH = (Date.now() - st.mtimeMs) / 3_600_000;
  say(`Backup: ${file} (${(st.size / 1e6).toFixed(1)} MB, ${ageH.toFixed(1)} h alt)`);
  if (ageH > maxAgeH) fail(`Neuestes Backup ist ${ageH.toFixed(1)} h alt (Grenze ${maxAgeH} h): laufen die Backups noch?`);
  if (st.size === 0) return void fail('Backup-Datei ist leer');

  const mirror = process.env.BACKUP_MIRROR_DIR;
  if (mirror && !positional[0]) {
    const m = newestIn(mirror);
    if (!m) warn(`Spiegel ${mirror} enthält kein Backup`);
    else if (basename(m) !== basename(file)) warn(`Spiegel ist nicht aktuell: neuestes dort ${basename(m)}`);
    else ok(`Spiegel ${mirror} hat dasselbe neueste Backup`);
  }

  const work = mkdtempSync(join(tmpdir(), 'tk-restore-'));
  try {
    mkdirSync(join(work, 'matches'));
    const readCopy = join(work, 'check.db');
    const serveCopy = join(work, 'serve.db');
    copyFileSync(file, readCopy);
    copyFileSync(file, serveCopy);

    let counts: Map<string, number>;
    try {
      const db = new DatabaseSync(readCopy, { readOnly: true });
      const ic = (db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check);
      if (ic.length === 1 && ic[0] === 'ok') ok('integrity_check: ok');
      else fail(`integrity_check: ${ic.slice(0, 5).join('; ')}`);
      counts = tableCounts(db);
      db.close();
    } catch (e) {
      return void fail(`Backup lässt sich nicht als SQLite-Datenbank öffnen: ${(e as Error).message}`);
    }
    const missing = REQUIRED.filter((t) => !counts.has(t));
    if (missing.length) fail(`Tabellen fehlen im Backup: ${missing.join(', ')}`);
    else ok(`Alle Haupttabellen vorhanden (${counts.size} Tabellen)`);

    const livePath = flag('--no-live') ? undefined : opt('--live') ?? process.env.DB_PATH;
    let live: Map<string, number> | undefined;
    if (livePath && existsSync(livePath) && resolve(livePath) !== resolve(file)) {
      try {
        const ldb = new DatabaseSync(livePath, { readOnly: true });
        ldb.exec('PRAGMA busy_timeout = 5000');
        live = tableCounts(ldb);
        ldb.close();
      } catch (e) {
        warn(`Live-Datenbank ${livePath} nicht lesbar: ${(e as Error).message}`);
      }
    } else if (livePath && !existsSync(livePath)) warn(`Live-Datenbank ${livePath} nicht gefunden: kein Vergleich`);

    say('');
    say(live ? `Zeilen       Backup      Live   (Live: ${livePath})` : 'Zeilen       Backup');
    const names = [...new Set([...counts.keys(), ...(live?.keys() ?? [])])].sort();
    for (const t of names) {
      const b = counts.get(t);
      const l = live?.get(t);
      say(`  ${t.padEnd(16)} ${String(b ?? '–').padStart(7)}${live ? `  ${String(l ?? '–').padStart(8)}` : ''}`);
      if (!live || l === undefined) continue;
      if (b === undefined) warn(`Tabelle ${t} gibt es live, aber nicht im Backup (neu seit dem Backup?)`);
      else if (MUST_HAVE_ROWS.includes(t) && b === 0 && l > 0) fail(`${t}: Backup leer, live ${l} Zeilen`);
      else if (MUST_HAVE_ROWS.includes(t) && l >= 20 && b < l * 0.5) warn(`${t}: Backup hat nur ${b} von ${l} Zeilen`);
    }
    say('');

    await serverCheck(serveCopy, work, counts.get('users'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  say(`Dauer ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

try {
  await main();
} catch (e) {
  fail(`Abbruch: ${(e as Error).stack ?? e}`);
}
const passed = failures.length === 0;
const subject = `Tiefenkontakt Restore-Test: ${passed ? `OK${warnings.length ? ` (${warnings.length} Hinweis(e))` : ''}` : 'FEHLGESCHLAGEN'}`;
console.log(`\n${subject}`);
if (flag('--mail')) {
  const to = alertRecipient();
  if (!to) console.log('Kein Empfänger (ALERT_TO oder MAIL_FROM): nur Log');
  else {
    try {
      await createMailer().send(adminMail(to, restoreReport({ passed, failures, warnings, lines, url: process.env.PUBLIC_URL })));
      console.log(`Bericht an ${to} verschickt`);
    } catch (e) {
      console.error(`Mailversand fehlgeschlagen: ${(e as Error).message}`);
    }
  }
}
process.exit(passed ? 0 : 1);
