import { CLASSES, distance, isConvoyShip, stepWorld, type Debrief, type PlayerSlot, type World } from '@tk/shared';
import { BotCrew } from './bots/index.js';
import { Recorder } from './recorder.js';
import { evaluate, computeScore, type MatchResult } from './rules.js';
import { DEFAULT_SETTINGS, allowedClasses, buildScenario, simTimeLimit, type MissionId, type PlayableClass, type ScenarioSettings } from './scenario.js';
import { resolveLobby } from './variation.js';

/** Bot-vs-bot matches without a server: used by the arena script and by replay series. */

export interface ArenaSetup {
  mission: MissionId;
  timeOfDay: ScenarioSettings['timeOfDay'];
  botSkill: ScenarioSettings['botSkill'];
  west: PlayableClass[];
  east: PlayableClass[];
  timeLimitMin: number;
  /** Per-match variation (default: as in the lobby, leicht). */
  variation?: ScenarioSettings['variation'];
  /** Sea area (default: the mission's home area). */
  area?: ScenarioSettings['area'];
}

export const DEFAULT_ARENA: ArenaSetup = { mission: 'groenland', timeOfDay: 'tag', botSkill: 'normal', west: ['ffg', 'ffg'], east: ['ssk', 'ssn'], timeLimitMin: 40 };

export function arenaSlots(setup: ArenaSetup): PlayerSlot[] {
  const mk = (team: 'west' | 'east', cls: PlayableClass, i: number): PlayerSlot => ({
    playerId: `bot-${team[0]}${i + 1}`, callsign: `${team === 'west' ? 'W' : 'O'}${i + 1}`, team, cls, ready: true, bot: true,
  });
  return [...setup.west.map((c, i) => mk('west', c, i)), ...setup.east.map((c, i) => mk('east', c, i))];
}

/** Check a setup (classes fit the mission and sides, sizes are sane). */
export function validSetup(s: ArenaSetup): string | undefined {
  if (s.west.length < 1 || s.east.length < 1 || s.west.length > 3 || s.east.length > 3) return '1–3 Schiffe je Seite';
  if (!s.west.every((c) => allowedClasses(s.mission, 'west').includes(c))) return 'Klasse passt nicht zum Westbund';
  if (!s.east.every((c) => allowedClasses(s.mission, 'east').includes(c))) return 'Klasse passt nicht zum Ostpakt';
  return undefined;
}

export interface ArenaGameResult {
  seed: number;
  winner: 'west' | 'east';
  reason: string;
  minutes: number;
  sunkTons: number;
  merchantsSunk: number;
  subsLost: number;
  escortsLost: number;
  torpedoes: number;
  /** True range (m) at which each side first detected each enemy unit. */
  detect: { west: number[]; east: number[] };
}

/** One bot match, stepped in slices by the caller. */
export class ArenaGame {
  readonly world: World;
  readonly settings: ScenarioSettings;
  private crew: BotCrew;
  private recorder?: Recorder;
  private limit: number;
  private seen = new Set<string>();
  private detect = { west: [] as number[], east: [] as number[] };
  result?: MatchResult;

  constructor(readonly setup: ArenaSetup, readonly seed: number, record = false) {
    this.settings = resolveLobby({
      ...DEFAULT_SETTINGS, mission: setup.mission, timeOfDay: setup.timeOfDay, botSkill: setup.botSkill, timeLimitMin: setup.timeLimitMin,
      variation: setup.variation ?? DEFAULT_SETTINGS.variation, area: setup.area,
    }, seed);
    const slots = arenaSlots(setup);
    this.world = buildScenario(slots, this.settings, seed);
    this.crew = new BotCrew(setup.botSkill);
    for (const s of slots) this.crew.add(`p_${s.playerId}`);
    this.limit = simTimeLimit(this.settings);
    if (record) this.recorder = new Recorder();
  }

  /** Advance up to n sim ticks; true once the match is decided. */
  step(n: number): boolean {
    const w = this.world;
    for (let i = 0; i < n && !this.result; i++) {
      stepWorld(w);
      this.recorder?.step(w);
      this.crew.step(w);
      if (Math.round(w.time * 10) % 10 === 0) this.sampleDetections();
      this.result = evaluate(w, this.limit, this.settings.mission);
    }
    return !!this.result;
  }

  /** Note the true range when an observer first holds a track on an enemy unit. */
  private sampleDetections(): void {
    const w = this.world;
    for (const obs of w.ships) {
      if (!obs.alive || !obs.id.startsWith('p_') || obs.team === 'neutral') continue;
      for (const [tid] of w.books.get(obs.id)?.entries() ?? []) {
        const key = `${obs.id}>${tid}`;
        if (this.seen.has(key)) continue;
        const tgt = w.ships.find((s) => s.id === tid);
        if (!tgt || tgt.team === obs.team || tgt.team === 'neutral' || isConvoyShip(tgt)) continue;
        this.seen.add(key);
        this.detect[obs.team].push(Math.round(distance(obs.pos, tgt.pos)));
      }
    }
  }

  summary(): ArenaGameResult {
    const w = this.world;
    const r = this.result ?? { winner: 'west', reason: 'nicht beendet' };
    return {
      seed: this.seed, winner: r.winner, reason: r.reason, minutes: Math.round(w.time / 60),
      sunkTons: computeScore(w).sunkTons,
      merchantsSunk: w.ships.filter((s) => isConvoyShip(s) && !s.alive).length,
      subsLost: w.ships.filter((s) => s.id.startsWith('p_') && CLASSES[s.cls].submarine && s.team === 'east' && !s.alive).length,
      escortsLost: w.ships.filter((s) => s.id.startsWith('p_') && s.team === 'west' && !s.alive).length,
      torpedoes: w.events.filter((e) => e.kind === 'weapon' && e.what === 'torpedo').length,
      detect: { west: [...this.detect.west], east: [...this.detect.east] },
    };
  }

  /** The full replay (truth) for the debrief viewer; only when recording was on. */
  debrief(): Debrief | undefined {
    if (!this.recorder || !this.result) return undefined;
    return this.recorder.debrief(this.world, arenaSlots(this.setup), this.result);
  }
}
