import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { log } from './log.js';

/**
 * Database backups: a consistent copy via `VACUUM INTO` (safe while the server runs),
 * every BACKUP_EVERY_H hours into BACKUP_DIR, keeping the newest BACKUP_KEEP files.
 * Disabled when BACKUP_DIR is not set.
 */
export class Backups {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private db: DatabaseSync,
    private dir = process.env.BACKUP_DIR,
    private keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 7)),
    private everyH = Math.max(1, Number(process.env.BACKUP_EVERY_H ?? 24)),
  ) {}

  get enabled(): boolean {
    return !!this.dir;
  }

  /** Files of this backup set, newest first. */
  list(): { file: string; at: number; bytes: number }[] {
    if (!this.dir || !existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => /^tiefenkontakt-\d{8}-\d{6}\.db$/.test(f))
      .map((f) => {
        const st = statSync(join(this.dir!, f));
        return { file: f, at: st.mtimeMs, bytes: st.size };
      })
      .sort((a, b) => b.file.localeCompare(a.file));
  }

  /** Write one backup now and prune old ones. Returns the file name. */
  run(now = new Date()): string | undefined {
    if (!this.dir) return undefined;
    mkdirSync(this.dir, { recursive: true });
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
    const name = `tiefenkontakt-${stamp}.db`;
    const target = resolve(this.dir, name);
    if (existsSync(target)) return name;
    // The path is built by us from digits only; quotes are doubled for SQL anyway
    this.db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    for (const old of this.list().slice(this.keep)) unlinkSync(join(this.dir, old.file));
    return name;
  }

  /** Back up on start if the newest copy is older than the interval, then check hourly. */
  start(): void {
    if (!this.dir) return;
    const due = () => {
      const newest = this.list()[0];
      if (!newest || Date.now() - newest.at > this.everyH * 3_600_000) {
        try {
          log('info', 'Backup geschrieben', { file: this.run() });
        } catch (e) {
          log('error', 'Backup fehlgeschlagen', { error: (e as Error).message });
        }
      }
    };
    due();
    this.timer = setInterval(due, 3_600_000);
    this.timer.unref();
  }
}
