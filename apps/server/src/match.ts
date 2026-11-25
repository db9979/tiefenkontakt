import {
  CLASSES,
  SIM_DT,
  isAtPeriscopeDepth,
  mastExposed,
  mastRaised,
  shipById,
  stepWorld,
  transmit,
  type AlertView,
  type ClassChoice,
  type Debrief,
  type MatchSetup,
  type FriendlyView,
  type SavedWorld,
  restoreWorld,
  saveWorld,
  type ClassId,
  type MatchLobby,
  type MatchSummary,
  type PlayerSlot,
  type ServerMsg,
  type Ship,
  type World,
  type Habits,
  type StationId,
  legacyStation,
} from '@tk/shared';
import { BotCrew, type BotState, type SavedCrew } from './bots/index.js';
import { Recorder, type RecorderState } from './recorder.js';
import { buildLesson, lessonResult } from './lessons.js';
import { learnFrom } from './learning.js';
import { applyCommand, type GameCommand } from './input.js';
import { alertsFor, pushAlert } from './match-events.js';
import { computeScore, evaluate, type MatchResult } from './rules.js';
import { DEFAULT_SETTINGS, allowedClasses, buildScenario, isMixedClass, simTimeLimit, type PlayableClass, type ScenarioSettings } from './scenario.js';
import { resolveLobby } from './variation.js';
import { buildBriefing } from './briefing.js';
import { metrics } from './metrics.js';
import { radioToTeam, spectateView } from './match-io.js';
import { briefingRng, buildSnapshot, classGroupKey, datalinkMates, type PlayerExtras } from './snapshot.js';

export interface Conn {
  playerId: string;
  callsign: string;
  send(msg: ServerMsg): void;
  /** The link is backed up (unsent data piling up): skip this tick's snapshot. */
  congested?(): boolean;
  /** Close the transport (e.g. when the same player connects again elsewhere; 4001 = banned). */
  close?(reason: string, code?: number): void;
  /** Client address, for bans. */
  ip?: string;
  /** Naval rank of an account (shown in the lobby). */
  rank?: string;
  /** Elo rating (guests 1000). */
  rating?: number;
}

export const MAX_PER_TEAM = 6;
const SPECTATE_EVERY = 30; // ticks (3 s)
/** Spectators see the truth this many sim seconds late, so it can't be relayed to a team. */
export const SPECTATE_DELAY = 240;
/** Sandbox sim steps always run per tick; more (up to the time scale) only within the budget. */
const SANDBOX_SURE_STEPS = 4;

type Side = 'west' | 'east';

export interface SavedMatch {
  v: 1;
  id: string;
  name: string;
  seed: number;
  slots: PlayerSlot[];
  settings: ScenarioSettings;
  world: SavedWorld;
  eventCursor: number;
  tickCount: number;
  bots: SavedCrew | BotState[];
  recorder?: RecorderState;
  classes: [string, [string, ClassChoice][]][];
  extras: [string, Omit<PlayerExtras, 'reports'> & { reports: [string, FriendlyView][] }][];
}

/**
 * Matches saved before stations had ids kept the tab number (0–6) of the old seven-tab lists.
 * Map it by the ship's side: a crew member's ship is the captain's.
 */
export function migrateSlotStations(slots: PlayerSlot[]): PlayerSlot[] {
  for (const slot of slots) {
    const old = slot.station as unknown;
    if (typeof old !== 'number') continue;
    const cls = (slot.crewOf ? slots.find((x) => x.playerId === slot.crewOf)?.cls : undefined) ?? slot.cls;
    const id = legacyStation(old, !!CLASSES[cls]?.submarine);
    if (id) slot.station = id;
    else delete slot.station;
  }
  return slots;
}

export class Match {
  /** Wall-clock budget per tick for sandbox steps past the sure ones (tests lift it for determinism). */
  static sandboxBudgetMs = 40;
  readonly id: string;
  readonly name: string;
  state: 'lobby' | 'running' | 'ended' = 'lobby';
  slots: PlayerSlot[] = [];
  settings: ScenarioSettings = { ...DEFAULT_SETTINGS };
  world?: World;
  private conns = new Map<string, Conn>();
  private radioLog: { from: string; playerId: string; text: string }[] = [];
  private extras = new Map<string, PlayerExtras>();
  private eventCursor = 0;
  private bots = new BotCrew();
  readonly recorder = new Recorder();
  private spectators = new Map<string, Conn>();
  /** Kept after the end so players reconnecting later still get the debrief. */
  private finished?: { result: MatchResult; debrief: Debrief };
  /** Classification decisions per datalink group, keyed by hidden target id. */
  private classes = new Map<string, Map<string, ClassChoice>>();
  private tickCount = 0;
  private timer?: ReturnType<typeof setInterval>;
  /** The seed came from a rematch and is shown in the lobby. */
  private fixedSeed = false;
  onChange?: () => void;

  /** Everything needed to continue this match after a server restart. */
  save(): SavedMatch | undefined {
    if (!this.world || this.state !== 'running') return undefined;
    return {
      v: 1, id: this.id, name: this.name, seed: this.seed, slots: this.slots, settings: this.settings,
      world: saveWorld(this.world), eventCursor: this.eventCursor, tickCount: this.tickCount, bots: this.bots.toJSON(),
      recorder: this.recorder.s,
      classes: [...this.classes].map(([k, m]) => [k, [...m]]),
      extras: [...this.extras].map(([k, x]) => [k, { ...x, reports: [...x.reports] }]),
    };
  }

  static restore(d: SavedMatch): Match {
    const m = new Match(d.id, d.name, d.seed);
    m.slots = migrateSlotStations(d.slots);
    m.settings = d.settings;
    m.world = restoreWorld(d.world);
    m.eventCursor = d.eventCursor;
    m.tickCount = d.tickCount;
    m.bots.restore(d.bots);
    if (d.recorder) m.recorder.s = d.recorder;
    m.classes = new Map(d.classes.map(([k, entries]) => [k, new Map(entries)]));
    m.extras = new Map(d.extras.map(([k, x]) => [k, { ...x, reports: new Map(x.reports) }]));
    m.state = 'running';
    m.emptySince = Date.now();
    m.timer = setInterval(() => metrics.timeTick(() => m.tick()), SIM_DT * 1000);
    return m;
  }

  constructor(id: string, name: string, private seed = Date.now() & 0xffff) {
    this.id = id;
    this.name = name;
  }

  get connected(): number { return this.conns.size; }

  /** Ticks so far (the store doesn't rewrite a match that hasn't moved). */
  get ticks(): number { return this.tickCount; }

  online(playerId: string): boolean { return this.conns.has(playerId); }

  /** Who sent radio under this ship name most recently, with their last lines as evidence. */
  senderOf(shipName: string): { playerId: string; evidence: string } | undefined {
    const last = [...this.radioLog].reverse().find((r) => r.from === shipName);
    if (!last) return undefined;
    const lines = this.radioLog.filter((r) => r.playerId === last.playerId).slice(-10).map((r) => `${r.from}: ${r.text}`);
    return { playerId: last.playerId, evidence: lines.join('\n') };
  }

  /** Moderator ends the match: everyone is told and returns to the lobby. */
  abort(msg: string): void {
    this.state = 'ended';
    this.stop();
    for (const c of this.conns.values()) c.send({ t: 'removed', msg });
    this.conns.clear();
  }

  /** Date.now() when the last player disconnected (paused since then). */
  emptySince = Date.now();

  /** A returning player gets their connection back; the match resumes. */
  reattach(conn: Conn): void {
    this.conns.set(conn.playerId, conn);
    // The sim was stopped when the last connected player left (a detached teammate kept it alive)
    if (this.state === 'running' && !this.timer) {
      this.timer = setInterval(() => metrics.timeTick(() => this.tick()), SIM_DT * 1000);
    }
    const x = this.extras.get(conn.playerId);
    if (x) {
      // Next snapshot is complete: full histories, evidence, recent alerts and radio
      x.histSent = undefined;
      x.evSent = undefined;
      x.alertsSent = undefined;
      x.radioSent = undefined;
      x.briefed = undefined;
    }
    conn.send({ t: 'match', match: this.lobby() });
    if (this.finished) {
      conn.send({ t: 'end', ...this.finished.result });
      conn.send({ t: 'debrief', d: this.finished.debrief });
    }
  }

  /** Called once with the debrief when the match ends (statistics, rankings). */
  onFinish?: (d: Debrief) => void;
  /** Habits of account players (set by the server): the AI adapts to them. */
  static recentHabits?: (userId: number, team: string) => Habits[];
  private learned: string[] = [];

  /** Link lost mid-match: keep the slot and ship; pause when nobody is left. */
  detach(playerId: string): void {
    this.conns.delete(playerId);
    if (this.conns.size === 0) this.emptySince = Date.now();
  }

  summary(): MatchSummary {
    return { id: this.id, name: this.name, state: this.state, players: this.slots.length, maxPlayers: MAX_PER_TEAM * 2 };
  }

  lobby(): MatchLobby {
    const { asSet: _asSet, ...settings } = this.settings;
    return { ...this.summary(), slots: this.slots.map((s) => ({ ...s })), settings: { ...settings, lage: this.fixedSeed ? this.seed : undefined }, chat: [...this.chat] };
  }

  private chat: { from: string; text: string; at: number }[] = [];
  /** Lobby chat for everyone in the match before it starts. */
  lobbyChat(playerId: string, text: string): string | undefined {
    const slot = this.slots.find((s) => s.playerId === playerId);
    if (!slot || this.state !== 'lobby') return 'Nur in der Lobby möglich';
    this.chat.push({ from: slot.callsign, text, at: Date.now() });
    if (this.chat.length > 30) this.chat.shift();
    this.broadcastLobby();
    return undefined;
  }

  join(conn: Conn, team: Side): string | undefined {
    if (this.state !== 'lobby') return 'Partie läuft bereits';
    const existing = this.slots.find((s) => s.playerId === conn.playerId);
    if (!existing && this.slots.filter((s) => s.team === team).length >= MAX_PER_TEAM) return 'Team ist voll';
    const cls: PlayableClass = allowedClasses(this.settings.mission, team)[0]!;
    if (existing) Object.assign(existing, { team, cls, ready: false, crewOf: undefined });
    else this.slots.push({ playerId: conn.playerId, callsign: conn.callsign, team, cls, ready: false, rank: conn.rank, rating: conn.rating });
    this.conns.set(conn.playerId, conn);
    this.broadcastLobby();
    return undefined;
  }

  leave(playerId: string): void {
    this.conns.delete(playerId);
    if (this.state === 'lobby') {
      this.slots = this.slots.filter((s) => s.playerId !== playerId);
      for (const s of this.slots) if (s.crewOf === playerId) s.crewOf = undefined;
    }
    this.broadcastLobby();
    if (this.conns.size === 0) this.stop();
  }

  /** Rematch: the same seed and lobby choices as a finished match. Changing settings unfixes the seed. */
  fixSetup(setup: MatchSetup): void {
    this.seed = setup.seed;
    this.fixedSeed = true;
    Object.assign(this.settings, setup.settings);
  }

  /** Seed and lobby choices for a rematch (convoy battles only). */
  private setup(): MatchSetup | undefined {
    const s = this.settings;
    if (s.lesson || s.campaign || s.sandbox || !s.asSet) return undefined;
    return { seed: this.seed, settings: s.asSet };
  }

  /** Lobby settings: anyone in the lobby may change them; everyone's ready flag resets. */
  configure(playerId: string, s: Partial<Pick<ScenarioSettings, 'mission' | 'area' | 'timeOfDay' | 'seaState' | 'timeLimitMin' | 'timeScale' | 'fillBots' | 'botSkill' | 'weather' | 'season' | 'custom' | 'merchants' | 'variation'>>): string | undefined {
    if (this.state !== 'lobby' || !this.slots.some((x) => x.playerId === playerId)) return 'Nur in der Lobby möglich';
    for (const [k, v] of Object.entries(s)) if (v !== undefined) (this.settings as unknown as Record<string, unknown>)[k] = v;
    // A mission change without an area of its own goes back to the mission's home area
    if (s.mission !== undefined && s.area === undefined) this.settings.area = undefined;
    this.fixedSeed = false;
    for (const x of this.slots) {
      x.ready = false;
      const allowed = allowedClasses(this.settings.mission, x.team);
      if (!allowed.includes(x.cls)) x.cls = allowed[0]!;
    }
    this.broadcastLobby();
    return undefined;
  }

  /** The station a player mans (shown to everyone aboard). */
  setStation(playerId: string, id: StationId): void {
    const slot = this.slots.find((s) => s.playerId === playerId);
    if (slot) slot.station = id;
  }

  addSpectator(conn: Conn): string | undefined {
    if (this.state !== 'running' || !this.world) return 'Zuschauen geht nur bei laufenden Partien';
    if (this.settings.lesson) return 'Ausbildungen sind privat';
    this.spectators.set(conn.playerId, conn);
    conn.send({ t: 'spectate', delayS: SPECTATE_DELAY, d: spectateView(this.recorder, this.world, this.slots, SPECTATE_DELAY) });
    return undefined;
  }

  removeSpectator(playerId: string): void { this.spectators.delete(playerId); }

  /** Sandbox time controls: 0 pauses the sim; the clients' extrapolation follows the scale. */
  setTimeScale(n: number): void {
    this.settings.timeScale = n;
    for (const x of this.extras.values()) x.timeScale = n;
  }

  /** Join a teammate's ship as crew (or leave the crew with null). */
  setCrew(playerId: string, captainId: string | null): string | undefined {
    const slot = this.slots.find((s) => s.playerId === playerId);
    if (!slot || this.state !== 'lobby') return 'Nicht in der Lobby';
    if (captainId === null) {
      slot.crewOf = undefined;
    } else {
      const cap = this.slots.find((s) => s.playerId === captainId);
      if (!cap || cap.team !== slot.team || cap.crewOf || cap.bot || cap.playerId === playerId) return 'Dieses Schiff kann keine Besatzung aufnehmen';
      if (this.slots.some((s) => s.crewOf === playerId)) return 'Du hast selbst Besatzung an Bord';
      slot.crewOf = captainId;
      slot.cls = cap.cls;
    }
    slot.ready = false;
    this.broadcastLobby();
    return undefined;
  }

  pickClass(playerId: string, cls: PlayableClass): string | undefined {
    const slot = this.slots.find((s) => s.playerId === playerId);
    if (!slot || this.state !== 'lobby') return 'Nicht in der Lobby';
    if (!allowedClasses(this.settings.mission, slot.team).includes(cls)) return 'Klasse passt nicht zum Team';
    if (isMixedClass(cls) && this.settings.mission !== 'duell' &&
      this.slots.some((s) => s.team === slot.team && s.playerId !== playerId && !s.crewOf && isMixedClass(s.cls))) return 'Nur ein gemischter Platz je Team';
    slot.cls = cls;
    for (const s of this.slots) if (s.crewOf === playerId) s.cls = cls;
    this.broadcastLobby();
    return undefined;
  }

  setReady(playerId: string, ready: boolean): void {
    const slot = this.slots.find((s) => s.playerId === playerId);
    if (!slot || this.state !== 'lobby') return;
    slot.ready = ready;
    this.broadcastLobby();
    if (this.slots.length > 0 && this.slots.every((s) => s.ready)) this.start();
  }

  /** AI captains for teams without human players. */
  private botSlots(): PlayerSlot[] {
    if (!this.settings.fillBots) return [];
    const out: PlayerSlot[] = [];
    if (!this.slots.some((s) => s.team === 'east')) {
      out.push({ playerId: 'bot-e1', callsign: 'KI-Wolf-1', team: 'east', cls: 'ssk', ready: true, bot: true });
      out.push({ playerId: 'bot-e2', callsign: 'KI-Wolf-2', team: 'east', cls: 'ssn', ready: true, bot: true });
    }
    if (!this.slots.some((s) => s.team === 'west')) {
      out.push({ playerId: 'bot-w1', callsign: 'KI-Geleit-1', team: 'west', cls: this.settings.mission === 'duell' ? 'ssn' : 'ffg', ready: true, bot: true });
    }
    return out;
  }

  start(): void {
    this.bots.setSkill(this.settings.botSkill ?? 'normal');
    if (this.settings.lesson) {
      const built = buildLesson(this.settings.lesson, this.slots[0]!, this.seed);
      this.world = built.world;
      for (const id of built.passiveBots) this.bots.add(id, true);
    } else {
      const bots = this.botSlots();
      this.slots.push(...bots);
      this.settings = resolveLobby(this.settings, this.seed);
      this.world = buildScenario(this.slots, this.settings, this.seed);
      for (const b of bots) this.bots.add(`p_${b.playerId}`);
      if (Match.recentHabits && bots.length) {
        const l = learnFrom(this.slots, Match.recentHabits);
        this.world.env.adapt = l.adapt;
        this.learned = l.notes;
      }
    }
    for (const s of this.slots) this.extras.set(s.playerId, { alerts: [], radio: [], reports: new Map(), timeScale: this.settings.timeScale });
    this.state = 'running';
    this.broadcastLobby();
    this.timer = setInterval(() => metrics.timeTick(() => this.tick()), SIM_DT * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  shipOf(playerId: string): Ship | undefined {
    const slot = this.slots.find((s) => s.playerId === playerId);
    return this.world ? shipById(this.world, `p_${slot?.crewOf ?? playerId}`) : undefined;
  }

  /** Everyone aboard a ship (captain and crew). */
  private aboard(shipId: string): PlayerSlot[] {
    return this.slots.filter((s) => `p_${s.crewOf ?? s.playerId}` === shipId);
  }

  command(playerId: string, msg: GameCommand): string | undefined {
    const ship = this.shipOf(playerId);
    if (!this.world || !ship || this.state !== 'running') return 'Keine laufende Partie';
    return applyCommand(this.world, ship, msg);
  }

  /** Record the player's classification of one of their (or their datalink's) contacts. */
  classify(playerId: string, label: string, choice: ClassChoice, cls?: ClassId): string | undefined {
    const w = this.world;
    const ship = this.shipOf(playerId);
    if (!w || !ship) return 'Keine laufende Partie';
    let bookOwner: Ship | undefined = ship;
    let local = label;
    const m = /^L(\d+)-(.+)$/.exec(label);
    if (m) {
      bookOwner = datalinkMates(w, ship)[Number(m[1]) - 1];
      local = m[2]!;
    }
    const tid = bookOwner ? w.books.get(bookOwner.id)?.targetIdOf(local) : undefined;
    if (!tid) return 'Kontakt nicht gefunden';
    const key = classGroupKey(ship);
    let map = this.classes.get(key);
    if (!map) this.classes.set(key, (map = new Map()));
    this.recorder.ident(key, tid, choice === 'unknown' ? undefined : cls);
    return void (choice === 'unknown' ? map.delete(tid) : map.set(tid, choice));
  }

  /** Team radio. Submarines must be at periscope depth with the mast up, and are DF'd. */
  radio(playerId: string, text: string): string | undefined {
    const w = this.world;
    const ship = this.shipOf(playerId);
    if (!w || !ship?.alive) return 'Kein Funk möglich';
    if (CLASSES[ship.cls].submarine && !mastRaised(ship)) return 'Funkmast muss ausgefahren sein';
    transmit(w, ship, text);
    this.radioLog.push({ from: ship.name, playerId, text });
    if (this.radioLog.length > 200) this.radioLog.shift();
    radioToTeam(w, ship, text, this.slots, this.extras, (id) => this.shipOf(id));
    return undefined;
  }

  private processEvents(w: World): void {
    const fresh = w.events.slice(this.eventCursor);
    this.eventCursor = w.events.length;
    alertsFor(w, fresh, { slots: this.slots, shipOf: (id) => this.shipOf(id), aboard: (id) => this.aboard(id), alert: (id, a) => pushAlert(this.extras.get(id), a), radio: (id, r) => this.extras.get(id)?.radio.push(r) });
  }

  tick(): void {
    const w = this.world;
    if (!w || this.state !== 'running') return;
    // Paused while no human is connected (reload, lost link, server restart)
    if (this.conns.size === 0) return;
    // Sandbox ×10: past the first steps only while the tick is cheap (one sandbox can't starve the server)
    const started = performance.now();
    for (let i = 0; i < this.settings.timeScale; i++) {
      if (this.settings.sandbox && i >= SANDBOX_SURE_STEPS && performance.now() - started > Match.sandboxBudgetMs) break;
      stepWorld(w);
      this.recorder.step(w);
      this.bots.step(w);
      this.processEvents(w);
    }
    for (const s of this.slots) {
      const x = this.extras.get(s.playerId);
      const ship = this.shipOf(s.playerId);
      if (!x || !ship) continue;
      if (mastExposed(ship)) x.mastUpSince ??= w.time;
      else x.mastUpSince = undefined;
    }
    if (this.spectators.size && this.tickCount % SPECTATE_EVERY === 0) {
      // One view for all spectators (it rebuilds the whole debrief so far)
      const d = spectateView(this.recorder, w, this.slots, SPECTATE_DELAY);
      for (const c of this.spectators.values()) c.send({ t: 'spectate', delayS: SPECTATE_DELAY, d });
    }
    const limit = simTimeLimit(this.settings);
    const result = this.settings.lesson ? lessonResult(w, this.settings.lesson, limit) : evaluate(w, limit, this.settings.mission);
    this.tickCount++;
    this.sendSnapshots(w, limit);
    if (result) {
      this.state = 'ended';
      this.stop();
      this.finished = { result, debrief: { ...this.recorder.debrief(w, this.slots, result), learned: this.learned.length ? this.learned : undefined, setup: this.setup() } };
      for (const c of this.conns.values()) {
        c.send({ t: 'end', ...result });
        c.send({ t: 'debrief', d: this.finished.debrief });
      }
      this.onFinish?.(this.finished.debrief);
      this.onChange?.();
    }
  }

  /** Each connected player's view of the world (10 Hz; clients extrapolate in between). */
  private sendSnapshots(w: World, limit: number): void {
    const score = { ...computeScore(w), timeLeftS: Math.max(0, limit - w.time) };
    for (const s of this.slots) {
      const ship = this.shipOf(s.playerId);
      const x = this.extras.get(s.playerId);
      const c = this.conns.get(s.playerId);
      // A congested link is skipped before building, so the delta bookkeeping only advances for what was sent
      if (!ship || !x || !c || c.congested?.()) continue;
      const full = !x.histSent;
      const snap = buildSnapshot(w, ship, x, score, this.classes.get(classGroupKey(ship)), this.recorder.s.ident?.[classGroupKey(ship)]);
      snap.full = full;
      snap.crew = this.aboard(ship.id).map((a) => a.callsign);
      snap.lesson = this.settings.lesson;
      if (!x.briefed && !this.settings.lesson) {
        snap.briefing = buildBriefing(w, ship, this.settings, briefingRng(this.seed, ship.id));
        x.briefed = true;
      }
      snap.stations = this.aboard(ship.id).filter((a) => a.station !== undefined).map((a) => ({ callsign: a.callsign, station: a.station! }));
      c.send({ t: 'snap', s: snap });
    }
  }

  private broadcastLobby(): void {
    const m = this.lobby();
    for (const c of this.conns.values()) c.send({ t: 'match', match: m });
    this.onChange?.();
  }
}
