import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Lobby } from './lobby.js';
import { log } from './log.js';
import { Match, type SavedMatch } from './match.js';

/** Running matches are written to disk so a server restart doesn't end them. */

const SAFE_ID = /^[a-f0-9-]{8}$/;

export class MatchStore {
  constructor(private dir = process.env.MATCH_DIR ?? '.matches') {
    mkdirSync(this.dir, { recursive: true });
  }

  private file(id: string): string | undefined {
    return SAFE_ID.test(id) ? join(this.dir, `${id}.json`) : undefined;
  }

  /** Sim tick each match was last written at: a paused match (nobody online) isn't rewritten. */
  private savedAt = new Map<string, number>();
  /** Matches with a write in flight (the periodic save skips them rather than piling up). */
  private writing = new Set<string>();
  /** Removed while a write was in flight: that write must not bring the file back. */
  private dropped = new Set<string>();

  /** What to write for a match now, or undefined (unchanged, ended, not saveable). */
  private due(m: ReturnType<Lobby['allMatches']>[number], force: boolean): { f: string; text: string } | undefined {
    const f = this.file(m.id);
    if (!f) return undefined;
    if (m.state === 'ended') {
      this.remove(m.id);
      return undefined;
    }
    if (!force && this.savedAt.get(m.id) === m.ticks) return undefined;
    const data = m.save();
    if (!data) return undefined;
    this.savedAt.set(m.id, m.ticks);
    return { f, text: JSON.stringify(data) };
  }

  /** Synchronous save of every running match (shutdown, tests). */
  saveAll(lobby: Lobby): void {
    for (const m of lobby.allMatches()) {
      const d = this.due(m, true);
      if (!d) continue;
      writeFileSync(`${d.f}.tmp`, d.text);
      renameSync(`${d.f}.tmp`, d.f);
    }
  }

  /**
   * The periodic save: the file writes don't block the game loop (a running match is several
   * hundred KB, slow on an SD card). Still atomic: written to .tmp, then renamed.
   */
  async saveAllAsync(lobby: Lobby): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const m of lobby.allMatches()) {
      if (this.writing.has(m.id)) continue;
      const d = this.due(m, false);
      if (!d) continue;
      const id = m.id;
      this.writing.add(id);
      this.dropped.delete(id);
      jobs.push((async () => {
        try {
          await writeFile(`${d.f}.tmp`, d.text);
          if (this.dropped.has(id)) await rm(`${d.f}.tmp`, { force: true });
          else await rename(`${d.f}.tmp`, d.f);
        } catch (e) {
          this.savedAt.delete(id); // try again next round
          log('warn', 'Spielstand nicht gespeichert', { match: id, error: (e as Error).message });
        } finally {
          this.writing.delete(id);
        }
      })());
    }
    await Promise.all(jobs);
  }

  remove(id: string): void {
    this.savedAt.delete(id);
    if (this.writing.has(id)) this.dropped.add(id);
    const f = this.file(id);
    if (f) rmSync(f, { force: true });
  }

  loadAll(lobby: Lobby): number {
    let n = 0;
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue;
      const f = this.file(name.slice(0, -5));
      if (!f) continue;
      try {
        const data = JSON.parse(readFileSync(f, 'utf8')) as SavedMatch;
        if (data.v !== 1) continue;
        lobby.adopt(Match.restore(data));
        n++;
      } catch (e) {
        log('warn', 'Spielstand nicht lesbar, wird verworfen', { file: name, error: (e as Error).message });
        rmSync(f, { force: true });
      }
    }
    return n;
  }
}
