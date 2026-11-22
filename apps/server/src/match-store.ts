import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

  saveAll(lobby: Lobby): void {
    for (const m of lobby.allMatches()) {
      const f = this.file(m.id);
      if (!f) continue;
      const data = m.save();
      if (!data) {
        if (m.state === 'ended') this.remove(m.id);
        continue;
      }
      writeFileSync(`${f}.tmp`, JSON.stringify(data));
      renameSync(`${f}.tmp`, f);
    }
  }

  remove(id: string): void {
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
