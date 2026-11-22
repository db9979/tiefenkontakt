import { randomUUID } from 'node:crypto';
import type { ClientMsg, Debrief, ServerMsg } from '@tk/shared';
import { LESSONS, lessonSlot, type LessonId } from './lessons.js';
import { MAX_PER_TEAM, Match, type Conn } from './match.js';
import { VoiceHub } from './voice.js';

const MAX_MATCHES = 50;
/** A running match with nobody connected stays (paused) this long before it is dropped. */
export const ABANDON_MS = 15 * 60_000;

/** Registry of matches and which match each player is in. */
export class Lobby {
  private matches = new Map<string, Match>();
  private playerMatch = new Map<string, string>();
  private conns = new Map<string, Conn>();
  private watching = new Map<string, string>();
  /** Voice radio between team mates (signalling, radio rules, push-to-talk). */
  readonly voice = new VoiceHub((id) => this.conns.get(id), (id) => this.matchOf(id));

  /** Register a connection. Returns true when the player rejoins a match. Replaces an older tab. */
  connect(conn: Conn): boolean {
    const old = this.conns.get(conn.playerId);
    if (old && old !== conn) {
      old.send({ t: 'error', msg: 'Du hast das Spiel in einem anderen Fenster geöffnet' });
      old.close?.('replaced');
    }
    this.conns.set(conn.playerId, conn);
    return this.playerMatch.has(conn.playerId);
  }

  /** After the welcome: put a returning player back into their match, others see the list. */
  resume(conn: Conn): void {
    const m = this.matchOf(conn.playerId);
    if (m) m.reattach(conn);
    else conn.send(this.listMsg());
  }

  /** A dropped link keeps the player's ship in a running match; in the lobby they leave. */
  disconnect(conn: Conn): void {
    if (this.conns.get(conn.playerId) !== conn) return;
    this.conns.delete(conn.playerId);
    this.voice.drop(conn.playerId);
    this.stopWatching(conn.playerId);
    const m = this.matchOf(conn.playerId);
    if (!m) return;
    if (m.state === 'running') m.detach(conn.playerId);
    else this.leaveCurrent(conn.playerId);
  }

  private stopWatching(playerId: string): void {
    const id = this.watching.get(playerId);
    if (id) this.matches.get(id)?.removeSpectator(playerId);
    this.watching.delete(playerId);
  }

  /** Quick match: join the open lobby with room, on the team that needs players; else open one. */
  private quick(conn: Conn): string | undefined {
    const open = [...this.matches.values()].filter((m) => m.state === 'lobby' && !m.settings.lesson && !m.settings.private && m.slots.length < MAX_PER_TEAM * 2);
    // Skill matchmaking: prefer lobbies whose players are close to my rating, then fuller ones
    const mine = conn.rating ?? 1000;
    const avg = (m: Match) => {
      const r = m.slots.filter((s) => !s.bot).map((s) => s.rating ?? 1000);
      return r.length ? r.reduce((a, b) => a + b, 0) / r.length : mine;
    };
    const score = (m: Match) => Math.abs(avg(m) - mine) - 40 * m.slots.length;
    open.sort((a, b) => score(a) - score(b));
    const m = open[0];
    if (!m) {
      const created = this.create('Schnelles Spiel');
      if (typeof created === 'string') return created;
      this.playerMatch.set(conn.playerId, created.id);
      return created.join(conn, Math.random() < 0.5 ? 'west' : 'east');
    }
    const west = m.slots.filter((s) => s.team === 'west').length;
    const east = m.slots.filter((s) => s.team === 'east').length;
    const e = m.join(conn, west <= east ? 'west' : 'east');
    if (!e) this.playerMatch.set(conn.playerId, m.id);
    return e;
  }

  /** Register a match restored from disk. */
  adopt(m: Match): void {
    this.hook(m);
    this.matches.set(m.id, m);
    for (const s of m.slots) if (!s.bot) this.playerMatch.set(s.playerId, m.id);
  }

  allMatches(): Match[] {
    return [...this.matches.values()];
  }

  matchOf(playerId: string): Match | undefined {
    const id = this.playerMatch.get(playerId);
    return id ? this.matches.get(id) : undefined;
  }

  private listMsg(): ServerMsg {
    return { t: 'lobby', matches: [...this.matches.values()].filter((m) => !m.settings.lesson && !m.settings.private).map((m) => m.summary()) };
  }

  private broadcastList(): void {
    const msg = this.listMsg();
    for (const c of this.conns.values()) if (!this.playerMatch.has(c.playerId)) c.send(msg);
  }

  private leaveCurrent(playerId: string): void {
    const m = this.matchOf(playerId);
    if (!m) return;
    m.leave(playerId);
    this.playerMatch.delete(playerId);
    // Dropped when empty, finished, or when no human player still belongs to it (all left on purpose)
    const anyoneLeft = [...this.playerMatch.values()].includes(m.id);
    if (m.slots.length === 0 || m.state === 'ended' || (m.connected === 0 && (m.state !== 'running' || !anyoneLeft))) this.drop(m);
    this.broadcastList();
  }

  create(name: string, lesson?: LessonId): Match | string {
    this.prune();
    if (this.matches.size >= MAX_MATCHES) return 'Zu viele Partien';
    const m = new Match(randomUUID().slice(0, 8), name);
    if (lesson) Object.assign(m.settings, { lesson, fillBots: false, timeLimitMin: 30 });
    this.hook(m);
    this.matches.set(m.id, m);
    this.broadcastList();
    return m;
  }

  onDrop?: (m: Match) => void;
  /** Statistics hooks (set by the server entry point). */
  onFinish?: (m: Match, d: Debrief) => void;
  onLessonDone?: (playerId: string, lesson: string) => void;
  /** Moderation hook: a player reports a radio sender. Returns an error text. */
  onReport?: (conn: Conn, m: Match, from: string, reason: string) => string | undefined;

  /** Moderator view of all matches with their human players. */
  adminView() {
    return [...this.matches.values()].map((m) => ({
      id: m.id, name: m.name, state: m.state, mission: m.settings.mission, lesson: m.settings.lesson ?? null,
      players: m.slots.filter((s) => !s.bot).map((s) => ({ playerId: s.playerId, callsign: s.callsign, team: s.team, online: m.online(s.playerId) })),
    }));
  }

  /** Moderator: end a match for everyone. */
  endMatch(id: string): boolean {
    const m = this.matches.get(id);
    if (!m) return false;
    const players = [...this.playerMatch].filter(([, mid]) => mid === id).map(([pid]) => pid);
    m.abort('Partie von der Moderation beendet');
    this.drop(m);
    for (const pid of players) this.conns.get(pid)?.send(this.listMsg());
    this.broadcastList();
    return true;
  }

  /** Moderator: remove a player from their match; with `ban` also cut the connection. */
  kick(playerId: string, ban = false): { callsign: string; ip?: string } | undefined {
    const conn = this.conns.get(playerId);
    const m = this.matchOf(playerId);
    const slot = m?.slots.find((s) => s.playerId === playerId);
    if (!conn && !slot) return undefined;
    this.leaveCurrent(playerId);
    if (conn) {
      conn.send({ t: 'removed', msg: ban ? 'Du wurdest gesperrt' : 'Du wurdest von der Moderation aus der Partie entfernt' });
      if (ban) conn.close?.('banned', 4001);
      else conn.send(this.listMsg());
    }
    return { callsign: conn?.callsign ?? slot!.callsign, ip: conn?.ip };
  }

  private hook(m: Match): void {
    m.onChange = () => this.broadcastList();
    m.onFinish = (d) => this.onFinish?.(m, d);
  }

  private drop(m: Match): void {
    m.stop();
    this.matches.delete(m.id);
    for (const [pid, mid] of this.playerMatch) if (mid === m.id) this.playerMatch.delete(pid);
    this.onDrop?.(m);
  }

  /** Remove empty lobbies, finished matches and running matches abandoned for too long. */
  prune(now = Date.now()): void {
    for (const m of [...this.matches.values()]) {
      if (m.connected > 0) continue;
      if (m.state !== 'running' || now - m.emptySince > ABANDON_MS) this.drop(m);
    }
  }

  handle(conn: Conn, msg: ClientMsg): void {
    const err = (e: string | undefined) => e && conn.send({ t: 'error', msg: e });
    if (msg.t === 'voice') return void err(this.voice.handle(conn, msg));
    switch (msg.t) {
      case 'create_match': {
        const m = this.create(msg.name);
        if (typeof m === 'string') return void err(m);
        if (msg.private) m.settings.private = true;
        this.leaveCurrent(conn.playerId);
        this.playerMatch.set(conn.playerId, m.id);
        return void err(m.join(conn, 'west'));
      }
      case 'join_code': {
        // Invite link: join the team with fewer human players
        const m = this.matches.get(msg.matchId);
        if (!m || m.state !== 'lobby') return void err('Einladung ungültig oder Partie läuft schon');
        const humans = (t: string) => m.slots.filter((s) => s.team === t && !s.bot).length;
        if (this.playerMatch.get(conn.playerId) !== m.id) this.leaveCurrent(conn.playerId);
        const e = m.join(conn, humans('west') <= humans('east') ? 'west' : 'east');
        if (!e) this.playerMatch.set(conn.playerId, m.id);
        return void err(e);
      }
      case 'join': {
        const m = this.matches.get(msg.matchId);
        if (!m) return void err('Partie nicht gefunden');
        if (this.playerMatch.get(conn.playerId) !== m.id) this.leaveCurrent(conn.playerId);
        const e = m.join(conn, msg.team);
        if (!e) this.playerMatch.set(conn.playerId, m.id);
        return void err(e);
      }
      case 'quick':
        this.leaveCurrent(conn.playerId);
        return void err(this.quick(conn));
      case 'spectate': {
        const target = this.matches.get(msg.matchId);
        if (!target) return void err('Partie nicht gefunden');
        this.stopWatching(conn.playerId);
        const e = target.addSpectator(conn);
        if (!e) this.watching.set(conn.playerId, target.id);
        return void err(e);
      }
      case 'training': {
        this.leaveCurrent(conn.playerId);
        const m = this.create(`Ausbildung: ${LESSONS[msg.lesson].title}`, msg.lesson);
        if (typeof m === 'string') return void err(m);
        this.playerMatch.set(conn.playerId, m.id);
        m.slots.push(lessonSlot(msg.lesson, conn.playerId, conn.callsign));
        m.reattach(conn);
        m.start();
        return;
      }
      case 'leave':
        this.voice.drop(conn.playerId);
        this.stopWatching(conn.playerId);
        this.leaveCurrent(conn.playerId);
        return void conn.send(this.listMsg());
      default:
        break;
    }
    const m = this.matchOf(conn.playerId);
    if (!m) return void err('Du bist in keiner Partie');
    switch (msg.t) {
      case 'pick_class':
        return void err(m.pickClass(conn.playerId, msg.cls));
      case 'ready':
        return void m.setReady(conn.playerId, msg.ready);
      case 'radio':
        return void err(m.radio(conn.playerId, msg.text));
      case 'lobby_chat':
        return void err(m.lobbyChat(conn.playerId, msg.text));
      case 'report': {
        const e = this.onReport?.(conn, m, msg.from, msg.reason);
        return void conn.send({ t: 'error', msg: e ?? 'Meldung an die Moderation gesendet' });
      }
      case 'station':
        return void m.setStation(conn.playerId, msg.index);
      case 'lesson_done':
        if (m.settings.lesson === 'klassifizieren' || m.settings.lesson === 'tma') this.onLessonDone?.(conn.playerId, m.settings.lesson);
        return;
      case 'settings': {
        const { t: _t, ...rest } = msg;
        return void err(m.configure(conn.playerId, rest));
      }
      case 'crew':
        return void err(m.setCrew(conn.playerId, msg.captainId));
      case 'classify':
        return void err(m.classify(conn.playerId, msg.label, msg.choice));
      default:
        return void err(m.command(conn.playerId, msg));
    }
  }
}
