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
  type ClassId,
  type MatchLobby,
  type MatchSummary,
  type PlayerSlot,
  type ServerMsg,
  type Ship,
  type World,
} from '@tk/shared';
import { BotCrew } from './bots.js';
import { applyCommand, type GameCommand } from './input.js';
import { computeScore, evaluate } from './rules.js';
import { DEFAULT_SETTINGS, buildScenario, simTimeLimit, type ScenarioSettings } from './scenario.js';
import { buildSnapshot, classGroupKey, datalinkMates, type PlayerExtras } from './snapshot.js';

export interface Conn {
  playerId: string;
  callsign: string;
  send(msg: ServerMsg): void;
}

export const MAX_PER_TEAM = 6;
const SNAP_EVERY = 2; // ticks -> 5 Hz
const EXPLOSION_HEARING = 40_000;
/** Hearing ranges of transients (U-Jagd: tube flooding ~8 NM, launch ~35 NM). */
const TRANSIENT_RANGE = { flood: 14_800, launch: 65_000 } as const;
const TRANSIENT_TEXT = { flood: 'TRANSIENT · ROHR WIRD GEFLUTET', launch: 'TRANSIENT · MECHANISCHER STARTLÄRM' } as const;

type Side = 'west' | 'east';
type PlayableClass = Exclude<ClassId, 'merchant'>;

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
  /** Classification decisions per datalink group, keyed by hidden target id. */
  private classes = new Map<string, Map<string, ClassChoice>>();
  private tickCount = 0;
  private timer?: ReturnType<typeof setInterval>;
  onChange?: () => void;

  constructor(id: string, name: string, private seed = Date.now() & 0xffff) {
    this.id = id;
    this.name = name;
  }

  get connected(): number {
    return this.conns.size;
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
    const bots = this.botSlots();
    this.slots.push(...bots);
    this.world = buildScenario(this.slots, this.settings, this.seed);
    for (const b of bots) this.bots.add(`p_${b.playerId}`);
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
      if (e.kind === 'torpedo_alert') {
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
    for (let i = 0; i < this.settings.timeScale; i++) {
      stepWorld(w);
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
    const limit = simTimeLimit(this.settings);
    const result = evaluate(w, limit);
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
          c.send({ t: 'snap', s: snap });
        }
      }
    }
    if (result) {
      this.state = 'ended';
      this.stop();
      for (const c of this.conns.values()) c.send({ t: 'end', ...result });
      this.onChange?.();
    }
  }

  private broadcastLobby(): void {
    const m = this.lobby();
    for (const c of this.conns.values()) c.send({ t: 'match', match: m });
    this.onChange?.();
  }
}
