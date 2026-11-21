import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ServerMsg } from '@tk/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { AuthStore, RateLimiter, parseCookies, type User } from './auth.js';
import { parseClientMsg } from './input.js';
import { Lobby } from './lobby.js';
import type { Conn } from './match.js';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 30;
const COOKIE = 'tk_session';

export const lobby = new Lobby();
const auth = new AuthStore();
const authLimiter = new RateLimiter(10, 60_000);

function json(res: ServerResponse, status: number, body: unknown, cookie?: string): void {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie !== undefined) headers['set-cookie'] = cookie;
  res.writeHead(status, headers).end(JSON.stringify(body));
}

function sessionCookie(token: string, maxAgeS: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeS}${secure}`;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 8192) throw new Error('too large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const publicUser = (u: User) => ({ callsign: u.callsign, faction: u.faction });

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const ip = req.socket.remoteAddress ?? '?';
  if (req.url === '/api/health') return json(res, 200, { ok: true });
  if (req.url === '/api/me' && req.method === 'GET') {
    const u = auth.userForToken(token);
    return u ? json(res, 200, publicUser(u)) : json(res, 401, { error: 'Nicht angemeldet' });
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'Nicht gefunden' });
  if (req.url === '/api/logout') {
    auth.logout(token);
    return json(res, 200, { ok: true }, sessionCookie('', 0));
  }
  if (req.url !== '/api/register' && req.url !== '/api/login') return json(res, 404, { error: 'Nicht gefunden' });
  if (!authLimiter.allow(ip)) return json(res, 429, { error: 'Zu viele Versuche, warte eine Minute' });
  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Ungültige Anfrage' });
  }
  const r = req.url === '/api/register' ? await auth.register(body) : await auth.login(body);
  if ('error' in r) return json(res, 400, r);
  return json(res, 200, publicUser(r.user), sessionCookie(r.token, 30 * 86_400));
}

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    handleApi(req, res).catch(() => json(res, 500, { error: 'Serverfehler' }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG_BYTES });

function guestCallsign(raw: string | null): string {
  const s = (raw ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
  return `${s.length >= 3 ? s : 'Gast'}-${Math.floor(Math.random() * 900 + 100)}`;
}

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const user = auth.userForToken(parseCookies(req.headers.cookie)[COOKIE]);
  const conn: Conn = {
    playerId: randomUUID(),
    callsign: user ? user.callsign : guestCallsign(url.searchParams.get('guest')),
    send: (msg: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  conn.send({ t: 'welcome', playerId: conn.playerId, callsign: conn.callsign });
  lobby.connect(conn);

  let windowStart = Date.now();
  let count = 0;
  ws.on('message', (data) => {
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > MAX_MSGS_PER_SEC) return;
    const msg = parseClientMsg(data.toString());
    if (!msg) return conn.send({ t: 'error', msg: 'Ungültige Nachricht' });
    lobby.handle(conn, msg);
  });
  ws.on('close', () => lobby.disconnect(conn.playerId));
});

server.listen(PORT, () => console.log(`Tiefenkontakt-Server auf http://localhost:${PORT}`));
