import { createHmac } from 'node:crypto';
import { log } from './log.js';
import type { SfuConfig } from './voice-config.js';

/**
 * Minimal LiveKit server API without the SDK: access tokens are HS256 JWTs with a "video"
 * grant, and permissions are changed through the RoomService Twirp endpoint. With an SFU the
 * server itself decides who may publish (talk) and subscribe (listen) — a modified client
 * can't get around the radio rules.
 */

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function jwt(cfg: SfuConfig, payload: Record<string, unknown>, ttlS: number): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: cfg.key, nbf: now - 10, exp: now + ttlS, ...payload }));
  const sig = b64url(createHmac('sha256', cfg.secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

/** Token for one player in one team room: mic only, no data channel, nothing published until granted. */
export function joinToken(cfg: SfuConfig, room: string, identity: string, name: string): string {
  return jwt(cfg, {
    sub: identity, name,
    video: { room, roomJoin: true, canPublish: false, canSubscribe: false, canPublishData: false, canPublishSources: ['microphone'] },
  }, 6 * 3600);
}

/** Grant or revoke talking and listening for a participant. Errors are logged, not thrown. */
export async function setPermission(cfg: SfuConfig, room: string, identity: string, canPublish: boolean, canSubscribe: boolean): Promise<boolean> {
  const token = jwt(cfg, { video: { room, roomAdmin: true } }, 60);
  try {
    const r = await fetch(`${cfg.apiUrl}/twirp/livekit.RoomService/UpdateParticipant`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ room, identity, permission: { canPublish, canSubscribe, canPublishData: false, canPublishSources: ['MICROPHONE'] } }),
      signal: AbortSignal.timeout(3000),
    });
    // 404: the player hasn't connected to the room yet – the next state update retries
    if (!r.ok && r.status !== 404) log('warn', 'LiveKit-Rechte nicht gesetzt', { status: r.status, room });
    return r.ok;
  } catch (e) {
    log('warn', 'LiveKit nicht erreichbar', { err: String(e) });
    return false;
  }
}
