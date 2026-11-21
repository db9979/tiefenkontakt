import { randomUUID } from 'node:crypto';
import type { ClientMsg, ServerMsg } from '@tk/shared';
import { Match, type Conn } from './match.js';

const MAX_MATCHES = 50;

/** Registry of matches and which match each player is in. */
export class Lobby {
  private matches = new Map<string, Match>();
  private playerMatch = new Map<string, string>();
  private conns = new Map<string, Conn>();

  connect(conn: Conn): void {
    this.conns.set(conn.playerId, conn);
    conn.send(this.listMsg());
  }

  disconnect(playerId: string): void {
    this.leaveCurrent(playerId);
    this.conns.delete(playerId);
  }

  matchOf(playerId: string): Match | undefined {
    const id = this.playerMatch.get(playerId);
    return id ? this.matches.get(id) : undefined;
  }

  private listMsg(): ServerMsg {
    return { t: 'lobby', matches: [...this.matches.values()].map((m) => m.summary()) };
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
    if (m.slots.length === 0 || m.state === 'ended' || m.connected === 0) {
      m.stop();
      this.matches.delete(m.id);
    }
    this.broadcastList();
  }

  create(name: string): Match | string {
    this.prune();
    if (this.matches.size >= MAX_MATCHES) return 'Zu viele Partien';
    const m = new Match(randomUUID().slice(0, 8), name);
    m.onChange = () => this.broadcastList();
    this.matches.set(m.id, m);
    this.broadcastList();
    return m;
  }

  private prune(): void {
    for (const [id, m] of this.matches) {
      if (m.connected === 0) {
        m.stop();
        this.matches.delete(id);
      }
    }
  }

  handle(conn: Conn, msg: ClientMsg): void {
    const err = (e: string | undefined) => e && conn.send({ t: 'error', msg: e });
    switch (msg.t) {
      case 'create_match': {
        const m = this.create(msg.name);
        if (typeof m === 'string') return void err(m);
        this.leaveCurrent(conn.playerId);
        this.playerMatch.set(conn.playerId, m.id);
        return void err(m.join(conn, 'west'));
      }
      case 'join': {
        const m = this.matches.get(msg.matchId);
        if (!m) return void err('Partie nicht gefunden');
        if (this.playerMatch.get(conn.playerId) !== m.id) this.leaveCurrent(conn.playerId);
        const e = m.join(conn, msg.team);
        if (!e) this.playerMatch.set(conn.playerId, m.id);
        return void err(e);
      }
      case 'leave':
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
      case 'classify':
        return void err(m.classify(conn.playerId, msg.label, msg.choice));
      default:
        return void err(m.command(conn.playerId, msg));
    }
  }
}
