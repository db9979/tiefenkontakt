import { radioDownReason, radioUp, voiceIntercept, voiceQuality, type ServerMsg, type Ship, type VoiceClientMsg, type VoiceLink, type VoicePeer } from '@tk/shared';
import { joinToken, setPermission } from './livekit.js';
import type { Conn, Match } from './match.js';
import { iceServers, sfuConfig } from './voice-config.js';

/**
 * Voice radio between team mates. The server owns the rules: who is on the air (surface ships
 * always, boats only surfaced or with the mast up), line-of-sight range per pair, intercom on
 * the same ship. Mesh mode relays WebRTC signalling between team mates of one match and tells
 * each client whom it may hear and whether it may send; with LiveKit configured the server
 * also grants and revokes publish/subscribe rights itself. Every push-to-talk gives the
 * enemy's ESM a bearing on the sender, repeated while the key is held.
 */

const STATE_MS = 500;
/** Seconds between DF bearings while talking, and the longest single transmission. */
const DF_EVERY_S = 6;
const MAX_PTT_S = 45;
const SIGNALS_PER_S = 60;

interface Member { ptt: boolean; pttSince: number; lastDf: number; sent?: string; perm?: string; signals: number; signalWindow: number }

export class VoiceHub {
  /** matchId → playerId → member */
  private members = new Map<string, Map<string, Member>>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(private conn: (playerId: string) => Conn | undefined, private matchOf: (playerId: string) => Match | undefined) {}

  start(): void {
    this.timer ??= setInterval(() => this.tick(), STATE_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private team(m: Match, playerId: string): string | undefined {
    return m.slots.find((s) => s.playerId === playerId)?.team;
  }

  handle(c: Conn, msg: VoiceClientMsg): string | undefined {
    const m = this.matchOf(c.playerId);
    if (!m || m.state !== 'running') return msg.op === 'leave' ? undefined : 'Sprechfunk nur in einer laufenden Partie';
    const team = this.team(m, c.playerId);
    if (!team) return 'Nicht in dieser Partie';
    const room = (this.members.get(m.id) ?? new Map<string, Member>());
    if (msg.op === 'join') {
      room.set(c.playerId, { ptt: false, pttSince: 0, lastDf: 0, signals: 0, signalWindow: Date.now() });
      this.members.set(m.id, room);
      const sfu = sfuConfig();
      const ship = m.shipOf(c.playerId);
      c.send({
        t: 'voice', op: 'config', ice: iceServers(c.playerId),
        sfu: sfu ? { url: sfu.url, room: `${m.id}-${team}`, token: joinToken(sfu, `${m.id}-${team}`, c.playerId, `${c.callsign} · ${ship?.name ?? ''}`) } : undefined,
      });
      this.broadcastPeers(m);
      return undefined;
    }
    const me = room.get(c.playerId);
    if (msg.op === 'leave') {
      room.delete(c.playerId);
      this.broadcastPeers(m);
      return undefined;
    }
    if (!me) return 'Sprechfunk ist aus';
    if (msg.op === 'signal') {
      // Signalling only between voice members of the same team in the same match, rate-limited
      const now = Date.now();
      if (now - me.signalWindow > 1000) [me.signals, me.signalWindow] = [0, now];
      if (++me.signals > SIGNALS_PER_S) return undefined;
      if (!room.has(msg.to) || this.team(m, msg.to) !== team || msg.to === c.playerId) return undefined;
      this.conn(msg.to)?.send({ t: 'voice', op: 'signal', from: c.playerId, data: msg.data });
      return undefined;
    }
    // Push-to-talk: refused (with the reason) when neither radio nor intercom can carry it
    const ship = m.shipOf(c.playerId);
    if (msg.on && ship && !radioUp(ship) && !this.intercom(m, c.playerId, room)) {
      me.ptt = false;
      this.pushState(m, c.playerId, room, true);
      return radioDownReason(ship);
    }
    me.ptt = msg.on;
    me.pttSince = Date.now();
    if (msg.on && ship && m.world) this.df(m, ship, me);
    // Everyone's "talking" lights change at once, not only the sender's
    for (const pid of room.keys()) this.pushState(m, pid, room, pid === c.playerId);
    return undefined;
  }

  /** A player left the match or the server: drop them from voice. */
  drop(playerId: string): void {
    for (const [id, room] of this.members) {
      if (!room.delete(playerId)) continue;
      const m = this.matchOf(playerId);
      if (m && m.id === id) this.broadcastPeers(m);
      if (!room.size) this.members.delete(id);
    }
  }

  /** Another voice member serves on the same ship (intercom works even submerged). */
  private intercom(m: Match, pid: string, room: Map<string, Member>): boolean {
    const ship = m.shipOf(pid);
    return !!ship?.alive && [...room.keys()].some((o) => o !== pid && m.shipOf(o)?.id === ship.id);
  }

  /** On the air: the enemy's ESM takes a bearing. Intercom alone radiates nothing. */
  private df(m: Match, ship: Ship, me: Member): void {
    if (!m.world || !radioUp(ship)) return;
    voiceIntercept(m.world, ship);
    me.lastDf = m.world.time;
  }

  private broadcastPeers(m: Match): void {
    const room = this.members.get(m.id);
    if (!room) return;
    for (const pid of room.keys()) {
      const team = this.team(m, pid);
      const myShip = m.shipOf(pid);
      const peers: VoicePeer[] = [...room.keys()].filter((o) => o !== pid && this.team(m, o) === team).map((o) => {
        const slot = m.slots.find((s) => s.playerId === o)!;
        const ship = m.shipOf(o);
        return { playerId: o, callsign: slot.callsign, ship: ship?.name ?? '', sameShip: !!ship && ship.id === myShip?.id };
      });
      this.conn(pid)?.send({ t: 'voice', op: 'peers', peers });
    }
  }

  private links(m: Match, pid: string, room: Map<string, Member>): { msg: Extract<ServerMsg, { op: 'state' }>; tx: boolean; rx: boolean } {
    const team = this.team(m, pid);
    const ship = m.shipOf(pid);
    const me = room.get(pid)!;
    const up = !!ship && radioUp(ship);
    const links: VoiceLink[] = [];
    for (const [o, other] of room) {
      if (o === pid || this.team(m, o) !== team) continue;
      const os = m.shipOf(o);
      const q = ship && os ? Math.round(voiceQuality(ship, os) * 100) / 100 : 0;
      // Talking reaches me over the intercom (same ship) or over the air (both up, in range: q > 0)
      const theirsUp = !!os && (os.id === ship?.id || radioUp(os));
      links.push({ playerId: o, q, talking: other.ptt && theirsUp && q > 0 });
    }
    const intercom = this.intercom(m, pid, room);
    return {
      msg: { t: 'voice', op: 'state', canTx: up || intercom, reason: ship ? radioDownReason(ship) : 'Kein Schiff', ptt: me.ptt && (up || intercom), links },
      tx: up || intercom, rx: up || intercom,
    };
  }

  private pushState(m: Match, pid: string, room: Map<string, Member>, force = false): void {
    const me = room.get(pid);
    if (!me) return;
    const { msg, tx, rx } = this.links(m, pid, room);
    const key = JSON.stringify(msg);
    if (force || key !== me.sent) {
      me.sent = key;
      this.conn(pid)?.send(msg);
    }
    // SFU: the server itself allows or forbids talking and listening
    const sfu = sfuConfig();
    const perm = `${tx && me.ptt}|${rx}`;
    if (sfu && perm !== me.perm) {
      const team = this.team(m, pid);
      void setPermission(sfu, `${m.id}-${team}`, pid, tx && me.ptt, rx).then((ok) => {
        me.perm = ok ? perm : undefined;
      });
    }
  }

  private tick(): void {
    const now = Date.now();
    for (const [id, room] of this.members) {
      const any = room.keys().next().value;
      const m = any ? this.matchOf(any) : undefined;
      if (!m || m.id !== id || m.state !== 'running') {
        if (!m || m.id !== id || m.state === 'ended') this.members.delete(id);
        continue;
      }
      for (const [pid, me] of room) {
        if (!this.conn(pid)) {
          room.delete(pid);
          continue;
        }
        const ship = m.shipOf(pid);
        if (me.ptt && (!ship || (!radioUp(ship) && !this.intercom(m, pid, room)) || now - me.pttSince > MAX_PTT_S * 1000)) me.ptt = false;
        if (me.ptt && ship && m.world && m.world.time - me.lastDf >= DF_EVERY_S) this.df(m, ship, me);
        this.pushState(m, pid, room);
      }
    }
  }
}
