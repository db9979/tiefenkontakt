import type { Debrief } from '@tk/shared';
import { ArenaGame, validSetup, type ArenaGameResult, type ArenaSetup } from './arena.js';

/**
 * Replay series: N bot matches of one setup, run on the server in small time slices so the
 * game loop (and a Raspberry Pi) stays responsive. One series at a time; moderators may run
 * up to 20 games, other accounts up to 3. The replays of the last series stay available.
 */

export const MAX_GAMES_ADMIN = 20;
export const MAX_GAMES_USER = 3;
/** Work at most this long, then rest as long again (≈ half a core at most). */
const SLICE_MS = 25;
const TICKS_PER_CHECK = 200;

export interface SeriesStats {
  games: number;
  westWins: number;
  eastWins: number;
  avgSunkTons: number;
  avgSubLosses: number;
  avgEscortLosses: number;
  avgMinutes: number;
  /** Mean true range of first detections (m), per detecting side. */
  avgDetectWest?: number;
  avgDetectEast?: number;
}

export interface SeriesStatus {
  state: 'idle' | 'running' | 'done';
  setup?: ArenaSetup;
  by?: string;
  total: number;
  done: number;
  games: ArenaGameResult[];
  stats?: SeriesStats;
  startedAt?: number;
  finishedAt?: number;
}

export function seriesStats(games: ArenaGameResult[]): SeriesStats {
  const n = Math.max(1, games.length);
  const avg = (f: (g: ArenaGameResult) => number) => Math.round((games.reduce((a, g) => a + f(g), 0) / n) * 10) / 10;
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined);
  return {
    games: games.length,
    westWins: games.filter((g) => g.winner === 'west').length,
    eastWins: games.filter((g) => g.winner === 'east').length,
    avgSunkTons: Math.round(avg((g) => g.sunkTons)),
    avgSubLosses: avg((g) => g.subsLost),
    avgEscortLosses: avg((g) => g.escortsLost),
    avgMinutes: Math.round(avg((g) => g.minutes)),
    avgDetectWest: mean(games.flatMap((g) => g.detect.west)),
    avgDetectEast: mean(games.flatMap((g) => g.detect.east)),
  };
}

export class SeriesRunner {
  private status: SeriesStatus = { state: 'idle', total: 0, done: 0, games: [] };
  private replays: Debrief[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  get(): SeriesStatus {
    return { ...this.status, games: [...this.status.games] };
  }

  replay(i: number): Debrief | undefined {
    return this.replays[i];
  }

  /** Start a series; returns an error text when refused. */
  start(setup: ArenaSetup, games: number, by: string, admin: boolean, seed = Date.now() & 0xffff): string | undefined {
    if (this.status.state === 'running') return 'Es läuft bereits eine Serie';
    const max = admin ? MAX_GAMES_ADMIN : MAX_GAMES_USER;
    if (!Number.isInteger(games) || games < 1 || games > max) return `1–${max} Partien`;
    const bad = validSetup(setup);
    if (bad) return bad;
    this.replays = [];
    this.status = { state: 'running', setup, by, total: games, done: 0, games: [], startedAt: Date.now() };
    let game = new ArenaGame(setup, seed, true);
    const work = () => {
      const until = Date.now() + SLICE_MS;
      while (Date.now() < until) {
        if (!game.step(TICKS_PER_CHECK)) continue;
        this.status.games.push(game.summary());
        const d = game.debrief();
        if (d) this.replays.push(d);
        this.status.done++;
        if (this.status.done >= games) {
          this.status.state = 'done';
          this.status.finishedAt = Date.now();
          this.status.stats = seriesStats(this.status.games);
          this.timer = undefined;
          return;
        }
        game = new ArenaGame(setup, seed + this.status.done, true);
      }
      this.status.stats = seriesStats(this.status.games);
      this.timer = setTimeout(work, SLICE_MS);
    };
    this.timer = setTimeout(work, 0);
    return undefined;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.status.state === 'running') {
      this.status.state = 'done';
      this.status.stats = seriesStats(this.status.games);
    }
  }
}
