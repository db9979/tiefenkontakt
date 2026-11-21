import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { ServerMsg } from '@tk/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { AuthStore, RateLimiter, parseCookies, type User } from './auth.js';
import { parseClientMsg } from './input.js';
import { Lobby } from './lobby.js';
import { MatchStore } from './match-store.js';
import { StatsStore, userIdOf } from './stats.js';
import type { Conn } from './match.js';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 30;
const COOKIE = 'tk_session';

const auth = new AuthStore();
export const lobby = new Lobby();
const store = new MatchStore();
const stats = new StatsStore(auth.db);
const LESSON_STEP: Record<string, string> = { klassifizieren: 'l1', tma: 'l2', angriff: 'l3', ujagd: 'l4' };
lobby.onFinish = (m, d) => {
  if (m.settings.lesson) {
    if (!d.reason.includes('geschafft')) return;
    for (const s of d.stats) {
      const uid = userIdOf(s.playerId);
      if (uid !== undefined) stats.complete(uid, LESSON_STEP[m.settings.lesson]!);
    }
    return;
  }
  stats.record(d, m.settings.mission, m.settings.timeOfDay);
};
lobby.onLessonDone = (playerId, lesson) => {
  const uid = userIdOf(playerId);
  if (uid !== undefined && LESSON_STEP[lesson]) stats.complete(uid, LESSON_STEP[lesson]!);
};
const restored = store.loadAll(lobby);
if (restored) console.log(`${restored} laufende Partie(n) wiederhergestellt`);
lobby.onDrop = (m) => store.remove(m.id);
setInterval(() => {
  lobby.prune();
  store.saveAll(lobby);
}, 5000).unref();
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.saveAll(lobby);
    process.exit(0);
  });
}
const authLimiter = new RateLimiter(10, 60_000);

function json(res: ServerResponse, status: number, body: unknown, cookie?: string): void {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie !== undefined) headers['set-cookie'] = cookie;
  res.writeHead(status, headers).end(JSON.stringify(body));
}

function sessionCookie(token: string, maxAgeS: number): string {
  // Behind an HTTPS proxy the cookie must be Secure; COOKIE_SECURE=0 allows plain HTTP tests
  const secure = (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production' ? '1' : '0')) === '1' ? '; Secure' : '';
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
  const ip = clientIp(req);
  if (req.url === '/api/health') return json(res, 200, { ok: true });
  if (req.url === '/api/me' && req.method === 'GET') {
    const u = auth.userForToken(token);
    return u ? json(res, 200, publicUser(u)) : json(res, 401, { error: 'Nicht angemeldet' });
  }
  if (req.url === '/api/leaderboard' && req.method === 'GET') return json(res, 200, stats.leaderboard());
  if (req.url === '/api/stats' && req.method === 'GET') {
    const u = auth.userForToken(token);
    if (!u) return json(res, 401, { error: 'Nur mit Konto' });
    return json(res, 200, { summary: stats.summary(u.id), campaign: stats.campaign(u.id) });
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

/** Real client address: the first X-Forwarded-For entry when TRUST_PROXY=1 (behind your reverse proxy). */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (process.env.TRUST_PROXY === '1' && typeof fwd === 'string') return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? '?';
}

const CLIENT_DIST = process.env.CLIENT_DIST ?? (process.env.NODE_ENV === 'production' ? resolve('../client/dist') : '');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

/** Serve the built client (production): static files, index.html for everything else. */
function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const root = resolve(CLIENT_DIST);
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  let file = resolve(join(root, urlPath));
  if (!file.startsWith(root + sep) && file !== root) return void res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  if (!existsSync(file)) return void res.writeHead(404).end();
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    handleApi(req, res).catch(() => json(res, 500, { error: 'Serverfehler' }));
    return;
  }
  if (CLIENT_DIST && req.method === 'GET') return serveStatic(req, res);
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG_BYTES });
// The WebSocket server re-emits listen errors; the retry above handles them
wss.on('error', () => undefined);

const GUEST_TOKEN = /^[a-f0-9]{32}$/;

/**
 * Stable identity so a reload or a dropped link rejoins the same ship.
 * Accounts: the user id. Guests: a per-tab secret token; others only ever see its hash.
 */
function identity(user: User | undefined, guestName: string | null, guestToken: string | null): { playerId: string; callsign: string } {
  if (user) return { playerId: `u-${user.id}`, callsign: user.callsign };
  const token = guestToken && GUEST_TOKEN.test(guestToken) ? guestToken : createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 32);
  const id = createHash('sha256').update(`guest:${token}`).digest('hex').slice(0, 16);
  const name = (guestName ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
  return { playerId: `g-${id}`, callsign: `${name.length >= 3 ? name : 'Gast'}-${parseInt(id.slice(0, 4), 16) % 900 + 100}` };
}

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const user = auth.userForToken(parseCookies(req.headers.cookie)[COOKIE]);
  const conn: Conn = {
    ...identity(user, url.searchParams.get('guest'), url.searchParams.get('gid')),
    send: (msg: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    close: (reason: string) => {
      if (ws.readyState === ws.OPEN) ws.close(4000, reason);
    },
  };
  const resumed = lobby.connect(conn);
  conn.send({ t: 'welcome', playerId: conn.playerId, callsign: conn.callsign, resume: resumed });
  lobby.resume(conn);

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
  ws.on('close', () => lobby.disconnect(conn));
});

// A restarting dev server may find the old process still holding the port for a moment
let listenTries = 0;
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE' && listenTries++ < 20) {
    setTimeout(() => server.listen(PORT), 500);
    return;
  }
  throw e;
});
server.listen(PORT, () => console.log(`Tiefenkontakt-Server auf http://localhost:${PORT}`));
