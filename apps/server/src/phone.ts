import { randomBytes } from 'node:crypto';
import type { ServerMsg } from '@tk/shared';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Conn } from './match.js';

/**
 * The 3D view on a phone. The player's client asks for a one-time code (shown as a QR code);
 * the phone connects with it on its own socket (/ws?phone=<code>) and from then on receives
 * the same snapshots as its player (same fog of war). It can only look: where it points, a
 * selected contact and a photo request go to the player's client, which acts on them like on
 * its own input. Codes live ten minutes and work once.
 */

const CODE_MS = 10 * 60_000;
const MAX_PHONE_MSGS_PER_SEC = 12;
/** What a phone mirrors of its player's messages. */
const MIRRORED = new Set<ServerMsg['t']>(['snap', 'end', 'welcome']);

const phoneMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('look'), bearing: z.number().finite().min(-720).max(720), elev: z.number().finite().min(-90).max(90), mag: z.number().finite().min(1).max(20), glass: z.boolean() }),
  z.object({ t: z.literal('select'), label: z.string().max(24) }),
  z.object({ t: z.literal('photo') }),
]);

export class PhoneHub {
  private codes = new Map<string, { playerId: string; until: number }>();
  private phones = new Map<string, Set<WebSocket>>();
  private mains = new Map<string, Conn>();

  /** The player's current game connection (where the phone's input goes). */
  main(conn: Conn): void {
    this.mains.set(conn.playerId, conn);
    if (this.phones.get(conn.playerId)?.size) conn.send({ t: 'phone', ev: 'on' });
  }

  /** A fresh one-time code for this player. */
  link(conn: Conn, now = Date.now()): string {
    for (const [c, v] of this.codes) if (v.until < now) this.codes.delete(c);
    this.main(conn);
    const code = randomBytes(9).toString('base64url');
    this.codes.set(code, { playerId: conn.playerId, until: now + CODE_MS });
    return code;
  }

  /** A player's message: the phone gets a copy of what it shows (snapshots, the end). */
  mirror(playerId: string, msg: ServerMsg, text: string): void {
    const set = this.phones.get(playerId);
    if (!set?.size || !MIRRORED.has(msg.t)) return;
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(text);
  }

  /** A phone connecting with a code: false (and closed) when the code is unknown, used or expired. */
  attach(ws: WebSocket, code: string, now = Date.now()): boolean {
    const v = this.codes.get(code);
    this.codes.delete(code);
    if (!v || v.until < now) {
      ws.close(4003, 'code');
      return false;
    }
    const { playerId } = v;
    const set = this.phones.get(playerId) ?? new Set();
    set.add(ws);
    this.phones.set(playerId, set);
    this.mains.get(playerId)?.send({ t: 'phone', ev: 'on' });
    let windowStart = now;
    let count = 0;
    ws.on('message', (data) => {
      const t = Date.now();
      if (t - windowStart > 1000) [windowStart, count] = [t, 0];
      if (++count > MAX_PHONE_MSGS_PER_SEC) return;
      let parsed;
      try {
        parsed = phoneMsg.safeParse(JSON.parse(String(data)));
      } catch {
        return;
      }
      if (parsed.success) this.forward(playerId, parsed.data);
    });
    ws.on('close', () => {
      set.delete(ws);
      if (!set.size) this.mains.get(playerId)?.send({ t: 'phone', ev: 'off' });
    });
    return true;
  }

  private forward(playerId: string, m: z.infer<typeof phoneMsg>): void {
    const main = this.mains.get(playerId);
    if (!main) return;
    if (m.t === 'look') main.send({ t: 'phone_look', bearing: m.bearing, elev: m.elev, mag: m.mag, glass: m.glass });
    else if (m.t === 'select') main.send({ t: 'phone_select', label: m.label });
    else main.send({ t: 'phone_photo' });
  }
}
