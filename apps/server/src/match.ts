import {
  CLASSES,
  KN,
  SIM_DT,
  bearing,
  distance,
  isAtPeriscopeDepth,
  scatterConvoy,
  shipById,
  stepWorld,
  transmit,
  type AlertView,
  type ClassChoice,
  type Debrief,
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
} from '@tk/shared';
import { BotCrew, type BotState } from './bots.js';
import { Recorder, type RecorderState } from './recorder.js';
import { buildLesson, lessonResult } from './lessons.js';
import { applyCommand, type GameCommand } from './input.js';
import { computeScore, evaluate, type MatchResult } from './rules.js';
import { DEFAULT_SETTINGS, buildScenario, simTimeLimit, type ScenarioSettings } from './scenario.js';
import { buildSnapshot, classGroupKey, datalinkMates, type PlayerExtras } from './snapshot.js';

export interface Conn {
  playerId: string;
  callsign: string;
  send(msg: ServerMsg): void;
  /** Close the transport (e.g. when the same player connects again elsewhere). */
  close?(reason: string): void;
}

export const MAX_PER_TEAM = 6;
const SPECTATE_EVERY = 30; // ticks (3 s)
/** Spectators see the truth this many sim seconds late, so it can't be relayed to a team. */
export const SPECTATE_DELAY = 240;
const SNAP_EVERY = 1; // ticks -> 10 Hz (clients also extrapolate between snapshots)
const EXPLOSION_HEARING = 40_000;
/** Hearing ranges of transients (U-Jagd: tube flooding ~8 NM, launch ~35 NM). */
const TRANSIENT_RANGE = { flood: 14_800, launch: 65_000 } as const;
const TRANSIENT_TEXT = { flood: 'TRANSIENT · ROHR WIRD GEFLUTET', launch: 'TRANSIENT · MECHANISCHER STARTLÄRM' } as const;

type Side = 'west' | 'east';
type PlayableClass = Exclude<ClassId, 'merchant'>;

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
  bots: BotState[];
  recorder?: RecorderState;
  classes: [string, [string, ClassChoice][]][];
  extras: [string, Omit<PlayerExtras, 'reports'> & { reports: [string, FriendlyView][] }][];
}

export class Match {
  readonly id: string;
  readonly name: string;
  state: 'lobby' | 'running' | 'ended' = 'lobby';
  slots: PlayerSlot[] = [];
  settings: ScenarioSettings = { ...DEFAULT_SETTINGS };
  world?: World;
  private conns = new Map<string, Conn>();
  private extras = new Map<string, PlayerExtras>();
  private eventCursor = 0;
  private bots = new BotCrew();
  private recorder = new Recorder();
  private spectators = new Map<string, Conn>();
  /** Kept after the end so players reconnecting later still get the debrief. */
  private finished?: { result: MatchResult; debrief: Debrief };
  /** Classification decisions per datalink group, keyed by hidden target id. */
  private classes = new Map<string, Map<string, ClassChoice>>();
  private tickCount = 0;
  private timer?: ReturnType<typeof setInterval>;
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
    m.slots = d.slots;
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
    m.timer = setInterval(() => m.tick(), SIM_DT * 1000);
    return m;
  }

  constructor(id: string, name: string, private seed = Date.now() & 0xffff) {
    this.id = id;
    this.name = name;
  }

  get connected(): number {
    return this.conns.size;
  }

  /** Date.now() when the last player disconnected (paused since then). */
  emptySince = Date.now();

  /** A returning player gets their connection back; the match resumes. */
  reattach(conn: Conn): void {
    this.conns.set(conn.playerId, conn);
    conn.send({ t: 'match', match: this.lobby() });
    if (this.finished) {
      conn.send({ t: 'end', ...this.finished.result });
      conn.send({ t: 'debrief', d: this.finished.debrief });
    }
  }

  /** Called once with the debrief when the match ends (statistics, rankings). */
  onFinish?: (d: Debrief) => void;

  /** Link lost mid-match: keep the slot and ship; pause when nobody is left. */
  detach(playerId: string): void {
    this.conns.delete(playerId);
    if (this.conns.size === 0) this.emptySince = Date.now();
  }

  summary(): MatchSummary {
    return { id: this.id, name: this.name, state: this.state, players: this.slots.length, maxPlayers: MAX_PER_TEAM * 2 };
  }

  lobby(): MatchLobby {
    return { ...this.summary(), slots: this.slots.map((s) => ({ ...s })), settings: { ...this.settings } };
  }

  join(conn: Conn, team: Side): string | undefined {
    if (this.state !== 'lobby') return 'Partie läuft bereits';
    const existing = this.slots.find((s) => s.playerId === conn.playerId);
    if (!existing && this.slots.filter((s) => s.team === team).length >= MAX_PER_TEAM) return 'Team ist voll';
    const cls: PlayableClass = team === 'west' ? 'ffg' : 'ssk';
    if (existing) Object.assign(existing, { team, cls, ready: false, crewOf: undefined });
    else this.slots.push({ playerId: conn.playerId, callsign: conn.callsign, team, cls, ready: false });
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

  /** Lobby settings: anyone in the lobby may change them; everyone's ready flag resets. */
  configure(playerId: string, s: Partial<Pick<ScenarioSettings, 'mission' | 'timeOfDay' | 'seaState' | 'timeLimitMin' | 'fillBots'>>): string | undefined {
    if (this.state !== 'lobby' || !this.slots.some((x) => x.playerId === playerId)) return 'Nur in der Lobby möglich';
    for (const [k, v] of Object.entries(s)) if (v !== undefined) (this.settings as unknown as Record<string, unknown>)[k] = v;
    for (const x of this.slots) x.ready = false;
    this.broadcastLobby();
    return undefined;
  }

  /** The station a player mans (shown to everyone aboard). */
  setStation(playerId: string, index: number): void {
    const slot = this.slots.find((s) => s.playerId === playerId);
    if (slot) slot.station = index;
  }

  addSpectator(conn: Conn): string | undefined {
    if (this.state !== 'running' || !this.world) return 'Zuschauen geht nur bei laufenden Partien';
    if (this.settings.lesson) return 'Ausbildungen sind privat';
    this.spectators.set(conn.playerId, conn);
    this.sendSpectate(conn);
    return undefined;
  }

  removeSpectator(playerId: string): void {
    this.spectators.delete(playerId);
  }

  private sendSpectate(conn: Conn): void {
    const w = this.world;
    if (!w) return;
    const cutoff = w.time - SPECTATE_DELAY;
    const full = this.recorder.debrief(w, this.slots, { winner: 'west', reason: 'LIVE' });
    conn.send({
      t: 'spectate', delayS: SPECTATE_DELAY,
      d: {
        ...full, stats: [], reason: 'Live, verzögert', duration: Math.max(0, Math.round(cutoff)),
        frames: full.frames.filter((f) => f[0] <= cutoff),
        torpedoes: full.torpedoes.filter((f) => f[0] <= cutoff),
        events: full.events.filter((e) => e.t <= cutoff && e.kind !== 'shot'),
      },
    });
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
    const side = CLASSES[cls].team;
    if (side !== slot.team) return 'Klasse passt nicht zum Team';
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
      out.push({ playerId: 'bot-w1', callsign: 'KI-Geleit-1', team: 'west', cls: 'ffg', ready: true, bot: true });
    }
    return out;
  }

  start(): void {
    if (this.settings.lesson) {
      const built = buildLesson(this.settings.lesson, this.slots[0]!, this.seed);
      this.world = built.world;
      for (const id of built.passiveBots) this.bots.add(id, true);
    } else {
      const bots = this.botSlots();
      this.slots.push(...bots);
      this.world = buildScenario(this.slots, this.settings, this.seed);
      for (const b of bots) this.bots.add(`p_${b.playerId}`);
    }
    for (const s of this.slots) this.extras.set(s.playerId, { alerts: [], radio: [], reports: new Map(), timeScale: this.settings.timeScale });
    this.state = 'running';
    this.broadcastLobby();
    this.timer = setInterval(() => this.tick(), SIM_DT * 1000);
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
  classify(playerId: string, label: string, choice: ClassChoice): string | undefined {
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
    if (choice === 'unknown') map.delete(tid);
    else map.set(tid, choice);
    return undefined;
  }

  /** Team radio. Submarines must be at periscope depth with the mast up, and are DF'd. */
  radio(playerId: string, text: string): string | undefined {
    const w = this.world;
    const ship = this.shipOf(playerId);
    if (!w || !ship?.alive) return 'Kein Funk möglich';
    if (CLASSES[ship.cls].submarine && !(ship.mastUp && isAtPeriscopeDepth(ship))) return 'Funkmast muss ausgefahren sein';
    transmit(w, ship, text);
    for (const mate of this.slots.filter((s) => s.team === ship.team)) {
      const x = this.extras.get(mate.playerId);
      if (!x) continue;
      x.radio.push({ time: w.time, from: ship.name, text });
      if (this.shipOf(mate.playerId)?.id !== ship.id) {
        x.reports.set(ship.id, {
          id: ship.id, name: ship.name, cls: ship.cls, x: ship.pos.x, y: ship.pos.y, heading: ship.heading,
          speedKn: ship.speed / KN, reportedAt: w.time, alive: ship.alive,
        });
      }
    }
    return undefined;
  }

  private alert(playerId: string, a: AlertView): void {
    const x = this.extras.get(playerId);
    if (x) {
      x.alerts.push(a);
      if (x.alerts.length > 40) x.alerts.shift();
    }
  }

  private processEvents(w: World): void {
    const fresh = w.events.slice(this.eventCursor);
    this.eventCursor = w.events.length;
    for (const e of fresh) {
      if (e.kind === 'grounded') {
        for (const slot of this.aboard(e.shipId)) this.alert(slot.playerId, { time: e.time, kind: 'sunk', text: 'AUF GRUND GELAUFEN · SCHÄDEN' });
      } else if (e.kind === 'torpedo_alert') {
        for (const slot of this.aboard(e.shipId)) {
          this.alert(slot.playerId, { time: e.time, kind: 'torpedo', bearing: e.bearing, text: `TORPEDO PEILUNG ${e.bearing.toFixed(0).padStart(3, '0')}` });
        }
      } else if (e.kind === 'sunk') {
        const victim = shipById(w, e.shipId);
        if (!victim) continue;
        if (victim.cls === 'merchant' && w.convoy) scatterConvoy(w.convoy, victim.pos, w.time);
        for (const s of this.slots) {
          const own = this.shipOf(s.playerId);
          if (!own) continue;
          if (own.id === victim.id) this.alert(s.playerId, { time: e.time, kind: 'sunk', text: 'SCHIFF SINKT' });
          else if (distance(own.pos, victim.pos) < EXPLOSION_HEARING) {
            const b = bearing(own.pos, victim.pos);
            this.alert(s.playerId, { time: e.time, kind: 'hit', bearing: b, text: `EXPLOSION / SINKGERÄUSCHE PEILUNG ${b.toFixed(0).padStart(3, '0')}` });
          }
        }
      }
    }
    for (const e of fresh) {
      if (e.kind !== 'transient') continue;
      for (const s of this.slots) {
        const own = this.shipOf(s.playerId);
        if (!own?.alive || own.id === e.sourceId) continue;
        const reach = TRANSIENT_RANGE[e.what] * (1 - 0.05 * w.env.seaState) * (own.speed / KN > 15 ? 0.5 : 1);
        if (distance(own.pos, e) > reach) continue;
        const b = (bearing(own.pos, e) + w.rng.gauss(0, 2) + 360) % 360;
        this.alert(s.playerId, { time: e.time, kind: 'transient', bearing: b, text: `${TRANSIENT_TEXT[e.what]} · PEILUNG ${b.toFixed(0).padStart(3, '0')}` });
      }
    }
    for (const d of w.lastDetections) {
      if (d.time !== w.time || (d.sensor !== 'intercept' && d.sensor !== 'esm')) continue;
      const kind = d.sensor === 'intercept' ? 'ping' : 'esm';
      const b = d.bearing.toFixed(0).padStart(3, '0');
      for (const slot of this.aboard(d.observerId)) {
        this.alert(slot.playerId, { time: d.time, kind, bearing: d.bearing, text: kind === 'ping' ? `AKTIVSONAR PEILUNG ${b}` : `ESM PEILUNG ${b}` });
      }
    }
  }

  tick(): void {
    const w = this.world;
    if (!w || this.state !== 'running') return;
    // Paused while no human is connected (reload, lost link, server restart)
    if (this.conns.size === 0) return;
    for (let i = 0; i < this.settings.timeScale; i++) {
      stepWorld(w);
      this.recorder.step(w);
      this.bots.step(w);
      this.processEvents(w);
    }
    for (const s of this.slots) {
      const x = this.extras.get(s.playerId);
      const ship = this.shipOf(s.playerId);
      if (!x || !ship) continue;
      if (ship.mastUp) x.mastUpSince ??= w.time;
      else x.mastUpSince = undefined;
    }
    if (this.spectators.size && this.tickCount % SPECTATE_EVERY === 0) for (const c of this.spectators.values()) this.sendSpectate(c);
    const limit = simTimeLimit(this.settings);
    const result = this.settings.lesson ? lessonResult(w, this.settings.lesson, limit) : evaluate(w, limit);
    this.tickCount++;
    if (this.tickCount % SNAP_EVERY === 0 || result) {
      const score = { ...computeScore(w), timeLeftS: Math.max(0, limit - w.time) };
      for (const s of this.slots) {
        const ship = this.shipOf(s.playerId);
        const x = this.extras.get(s.playerId);
        const c = this.conns.get(s.playerId);
        if (ship && x && c) {
          const snap = buildSnapshot(w, ship, x, score, this.classes.get(classGroupKey(ship)));
          snap.crew = this.aboard(ship.id).map((a) => a.callsign);
          snap.lesson = this.settings.lesson;
          snap.stations = this.aboard(ship.id).filter((a) => a.station !== undefined).map((a) => ({ callsign: a.callsign, station: a.station! }));
          c.send({ t: 'snap', s: snap });
        }
      }
    }
    if (result) {
      this.state = 'ended';
      this.stop();
      this.finished = { result, debrief: this.recorder.debrief(w, this.slots, result) };
      for (const c of this.conns.values()) {
        c.send({ t: 'end', ...result });
        c.send({ t: 'debrief', d: this.finished.debrief });
      }
      this.onFinish?.(this.finished.debrief);
      this.onChange?.();
    }
  }

  private broadcastLobby(): void {
    const m = this.lobby();
    for (const c of this.conns.values()) c.send({ t: 'match', match: m });
    this.onChange?.();
  }
}
