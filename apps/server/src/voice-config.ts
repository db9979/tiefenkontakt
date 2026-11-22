import { createHmac } from 'node:crypto';
import type { IceServerConfig } from '@tk/shared';

/**
 * Voice radio infrastructure from the environment:
 *  - TURN_URLS + TURN_SECRET: own coturn relay with short-lived credentials (coturn
 *    "use-auth-secret": username = expiry:id, password = base64 HMAC-SHA1). The same server
 *    answers STUN, so no third-party service sees the players' addresses.
 *  - STUN_URLS: extra STUN servers (optional, e.g. a public one if no TURN is run).
 *  - LIVEKIT_URL + LIVEKIT_KEY + LIVEKIT_SECRET: selective forwarding unit; then the server
 *    grants or revokes sending and listening itself (see livekit.ts).
 */

const TURN_TTL_S = 6 * 3600;

const list = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function iceServers(playerId: string, now = Date.now()): IceServerConfig[] {
  const out: IceServerConfig[] = [];
  const turn = list(process.env.TURN_URLS);
  const secret = process.env.TURN_SECRET;
  if (turn.length && secret) {
    const username = `${Math.floor(now / 1000) + TURN_TTL_S}:${playerId}`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    // The TURN host doubles as STUN server
    out.push({ urls: turn.filter((u) => u.startsWith('turn')).map((u) => u.replace(/^turns?:/, 'stun:').replace(/\?.*$/, '')).slice(0, 1) });
    out.push({ urls: turn, username, credential });
  }
  const stun = list(process.env.STUN_URLS);
  if (stun.length) out.push({ urls: stun });
  return out;
}

export interface SfuConfig { url: string; key: string; secret: string; apiUrl: string }

/** LiveKit settings, if configured. url = what browsers connect to, apiUrl = server-to-server. */
export function sfuConfig(): SfuConfig | undefined {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_KEY;
  const secret = process.env.LIVEKIT_SECRET;
  if (!url || !key || !secret) return undefined;
  return { url, key, secret, apiUrl: process.env.LIVEKIT_API_URL || 'http://livekit:7880' };
}
