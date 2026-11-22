import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Backups } from '../src/backup.js';

describe('database backups', () => {
  it('writes a readable copy and keeps only the newest N', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tk-bak-'));
    const db = new DatabaseSync(join(dir, 'live.db'));
    db.exec('CREATE TABLE t (v TEXT); INSERT INTO t VALUES (\'Seewolf\')');
    const b = new Backups(db, join(dir, 'bak'), 2, 24);
    for (let i = 0; i < 4; i++) b.run(new Date(Date.UTC(2026, 10, 20 + i, 3, 0, 0)));
    const files = b.list();
    expect(files.map((f) => f.file)).toEqual(['tiefenkontakt-20261123-030000.db', 'tiefenkontakt-20261122-030000.db']);
    const copy = new DatabaseSync(join(dir, 'bak', files[0]!.file));
    expect(copy.prepare('SELECT v FROM t').get()).toEqual({ v: 'Seewolf' });
  });

  it('does nothing without BACKUP_DIR', () => {
    const b = new Backups(new DatabaseSync(':memory:'), undefined);
    expect(b.enabled).toBe(false);
    expect(b.run()).toBeUndefined();
  });
});
