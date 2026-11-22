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
import { createMailer, SmtpMailer } from './mailer.js';
import { resetMail, verifyMail } from './mail-templates.js';
import { handleAdmin } from './admin.js';
import { ModerationStore } from './moderation.js';
import { Backups } from './backup.js';
import { Ratings } from './rating.js';
import { log } from './log.js';
import { Match } from './match.js';
import { clientIpFrom } from './client-ip.js';
import { metrics } from './metrics.js';
import { StatsStore, rankFor, userIdOf } from './stats.js';
import type { Conn } from './match.js';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 30;
const COOKIE = 'tk_session';

const auth = new AuthStore();
export const lobby = new Lobby();
const store = new MatchStore();
const stats = new StatsStore(auth.db);
const mod = new ModerationStore(auth.db);
const backups = new Backups(auth.db);
const ratings = new Ratings(auth.db);
backups.start();
lobby.onReport = (conn, m, from, reason) => {
  const s = m.senderOf(from);
  if (!s) return 'Absender nicht gefunden';
  if (s.playerId === conn.playerId) return 'Du kannst dich nicht selbst melden';
  const reported = m.slots.find((x) => x.playerId === s.playerId)?.callsign ?? from;
  const fresh = mod.report({ reporter: conn.callsign, reported, reportedId: s.playerId, matchId: m.id, reason, evidence: s.evidence });
  log('info', 'Meldung', { reporter: conn.callsign, reported, reason });
  return fresh ? undefined : 'Bereits gemeldet';
};
const LESSON_STEP: Record<string, string> = { klassifizieren: 'l1', tma: 'l2', angriff: 'l3', ujagd: 'l4' };
Match.recentHabits = (uid, team) => stats.recentHabits(uid, team);
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
  ratings.update(d);
};
lobby.onLessonDone = (playerId, lesson) => {
  const uid = userIdOf(playerId);
  if (uid !== undefined && LESSON_STEP[lesson]) stats.complete(uid, LESSON_STEP[lesson]!);
};
const restored = store.loadAll(lobby);
if (restored) log('info', 'Partien wiederhergestellt', { count: restored });
lobby.onDrop = (m) => store.remove(m.id);
// Running matches are saved every MATCH_SAVE_S seconds (raise it on SD cards to save writes)
const SAVE_S = Math.max(2, Number(process.env.MATCH_SAVE_S ?? 5));
setInterval(() => lobby.prune(), 5000).unref();
lobby.voice.start();
setInterval(() => store.saveAll(lobby), SAVE_S * 1000).unref();
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.saveAll(lobby);
    process.exit(0);
  });
}
const authLimiter = new RateLimiter(10, 60_000);
const errorLimiter = new RateLimiter(5, 60_000);
const mailer = createMailer();
if (mailer instanceof SmtpMailer) {
  const c = mailer.cfg;
  log('info', 'Mailversand über SMTP', { host: c.host, port: c.port, security: c.security, from: c.from, login: c.user ? 'ja' : 'nein' });
} else log('info', 'Kein Mailserver eingestellt: Bestätigungs- und Reset-Links stehen im Log');
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'http://localhost:5173';
const HOUR = 3_600_000;

async function sendVerify(userId: number, email: string, callsign: string): Promise<void> {
  const t = auth.createToken(userId, 'verify', 48 * HOUR);
  await mailer.send(verifyMail(email, callsign, `${PUBLIC_URL}/#verify=${t}`));
  log('info', 'Bestätigungsmail gesendet', { userId });
}

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
  if (req.url?.startsWith('/api/metrics')) {
    // METRICS_TOKEN as bearer token (for a monitoring system), or a moderator session
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const ok = (!!process.env.METRICS_TOKEN && bearer === process.env.METRICS_TOKEN) || mod.isAdmin(auth.userForToken(token)?.callsign);
    if (!ok) return json(res, 403, { error: 'Nur für Moderatoren' });
    const all = lobby.allMatches();
    const extra = {
      matchesRunning: all.filter((m) => m.state === 'running').length,
      matchesLobby: all.filter((m) => m.state === 'lobby').length,
      playersConnected: all.reduce((a, m) => a + m.connected, 0),
      connections: wss.clients.size,
    };
    if (req.url.includes('format=prom')) {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(metrics.prometheus(extra));
      return;
    }
    return json(res, 200, metrics.snapshot(extra));
  }
  if (req.url === '/api/me' && req.method === 'GET') {
    const u = auth.userForToken(token);
    return u ? json(res, 200, { ...publicUser(u), email: u.email, verified: auth.isVerified(u.id), admin: mod.isAdmin(u.callsign) }) : json(res, 401, { error: 'Nicht angemeldet' });
  }
  if (req.url?.startsWith('/api/admin/')) {
    if (!mod.isAdmin(auth.userForToken(token)?.callsign)) return json(res, 403, { error: 'Nur für Moderatoren' });
    let body: unknown = {};
    if (req.method === 'POST') {
      try {
        body = await readBody(req);
      } catch {
        return json(res, 400, { error: 'Ungültige Anfrage' });
      }
    }
    if (req.url === '/api/admin/backup' && req.method === 'POST') {
      if (!backups.enabled) return json(res, 400, { error: 'BACKUP_DIR ist nicht gesetzt' });
      return json(res, 200, { file: backups.run(), backups: backups.list() });
    }
    return handleAdmin(req, body, (status, b) => json(res, status, b), lobby, mod);
  }
  if (req.url === '/api/leaderboard' && req.method === 'GET') return json(res, 200, stats.leaderboard());
  if (req.url === '/api/balance' && req.method === 'GET') return json(res, 200, stats.balance());
  if (req.url === '/api/stats' && req.method === 'GET') {
    const u = auth.userForToken(token);
    if (!u) return json(res, 401, { error: 'Nur mit Konto' });
    return json(res, 200, { summary: stats.summary(u.id), campaign: stats.campaign(u.id), rating: ratings.get(u.id) });
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'Nicht gefunden' });
  if (req.url === '/api/client-error') {
    // Browser errors from players, so problems on their devices show up in the server log
    if (!errorLimiter.allow(ip)) return json(res, 429, { ok: false });
    let b: Record<string, unknown>;
    try {
      b = (await readBody(req)) as Record<string, unknown>;
    } catch {
      return json(res, 400, { ok: false });
    }
    const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
    metrics.clientErrors++;
    log('warn', 'Client-Fehler', {
      msg: str(b.msg, 300), stack: str(b.stack, 1200), where: str(b.where, 120), ua: str(req.headers['user-agent'], 160),
      user: auth.userForToken(token)?.callsign,
    });
    return json(res, 200, { ok: true });
  }
  if (req.url === '/api/logout') {
    auth.logout(token);
    return json(res, 200, { ok: true }, sessionCookie('', 0));
  }
  const ACCOUNT = ['/api/register', '/api/login', '/api/password/forgot', '/api/password/reset', '/api/password/change', '/api/verify', '/api/verify/resend', '/api/account/delete'];
  if (!ACCOUNT.includes(req.url ?? '')) return json(res, 404, { error: 'Nicht gefunden' });
  if (!authLimiter.allow(ip)) return json(res, 429, { error: 'Zu viele Versuche, warte eine Minute' });
  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch {
    return json(res, 400, { error: 'Ungültige Anfrage' });
  }
  const me = auth.userForToken(token);
  switch (req.url) {
    case '/api/register':
    case '/api/login': {
      const r = req.url === '/api/register' ? await auth.register(body) : await auth.login(body);
      if ('error' in r) return json(res, 400, r);
      if (req.url === '/api/register') await sendVerify(r.user.id, r.user.email, r.user.callsign).catch((e) => log('warn', 'Mailversand fehlgeschlagen', { error: (e as Error).message }));
      return json(res, 200, publicUser(r.user), sessionCookie(r.token, 30 * 86_400));
    }
    case '/api/password/forgot': {
      // Same answer whether or not the address exists (no account enumeration)
      const u = auth.findByEmail(body.email);
      if (u) {
        const t = auth.createToken(u.id, 'reset', HOUR);
        await mailer.send(resetMail(u.email, u.callsign, `${PUBLIC_URL}/#reset=${t}`))
          .then(() => log('info', 'Reset-Mail gesendet', { userId: u.id }))
          .catch((e) => log('warn', 'Mailversand fehlgeschlagen', { error: (e as Error).message }));
      }
      return json(res, 200, { ok: true });
    }
    case '/api/password/reset': {
      const uid = auth.consumeToken(body.token, 'reset');
      if (uid === undefined) return json(res, 400, { error: 'Link ungültig oder abgelaufen' });
      const e = await auth.setPassword(uid, body.password);
      if (e) return json(res, 400, { error: e });
      auth.markVerified(uid); // the link proved the address
      return json(res, 200, { ok: true }, sessionCookie(auth.newSession(uid), 30 * 86_400));
    }
    case '/api/password/change': {
      if (!me) return json(res, 401, { error: 'Nicht angemeldet' });
      if (!(await auth.checkPassword(me.id, body.old))) return json(res, 400, { error: 'Altes Passwort falsch' });
      const e = await auth.setPassword(me.id, body.password);
      if (e) return json(res, 400, { error: e });
      return json(res, 200, { ok: true }, sessionCookie(auth.newSession(me.id), 30 * 86_400));
    }
    case '/api/verify': {
      const uid = auth.consumeToken(body.token, 'verify');
      if (uid === undefined) return json(res, 400, { error: 'Link ungültig oder abgelaufen' });
      auth.markVerified(uid);
      return json(res, 200, { ok: true });
    }
    case '/api/verify/resend': {
      if (!me) return json(res, 401, { error: 'Nicht angemeldet' });
      if (!auth.isVerified(me.id)) await sendVerify(me.id, me.email, me.callsign).catch((e) => log('warn', 'Mailversand fehlgeschlagen', { error: (e as Error).message }));
      return json(res, 200, { ok: true });
    }
    case '/api/account/delete': {
      if (!me) return json(res, 401, { error: 'Nicht angemeldet' });
      if (!(await auth.checkPassword(me.id, body.password))) return json(res, 400, { error: 'Passwort falsch' });
      auth.deleteUser(me.id);
      return json(res, 200, { ok: true }, sessionCookie('', 0));
    }
  }
  return json(res, 404, { error: 'Nicht gefunden' });
}

/** Real client address: the entry your reverse proxy appended to X-Forwarded-For (TRUST_PROXY = number of proxies). */
function clientIp(req: IncomingMessage): string {
  return clientIpFrom(req.headers['x-forwarded-for'], req.socket.remoteAddress);
}

const CLIENT_DIST = process.env.CLIENT_DIST ?? (process.env.NODE_ENV === 'production' ? resolve('../client/dist') : '');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
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

// permessage-deflate: snapshots are repetitive JSON and shrink several-fold on the wire
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: MAX_MSG_BYTES,
  perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 3 }, serverNoContextTakeover: false },
});
// The WebSocket server re-emits listen errors; the retry above handles them
wss.on('error', () => undefined);

const GUEST_TOKEN = /^[a-f0-9]{32}$/;

/** Wire format: two decimals are plenty (cm, 0.01°) and halve the payload. */
function roundNumbers(_k: string, v: unknown): unknown {
  return typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v;
}

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
      if (ws.readyState !== ws.OPEN) return;
      const text = JSON.stringify(msg, roundNumbers);
      metrics.sent(text.length);
      ws.send(text);
    },
    close: (reason: string, code = 4000) => {
      if (ws.readyState === ws.OPEN) ws.close(code, reason);
    },
    ip: clientIp(req),
    rank: user ? rankFor(stats.summary(user.id)?.points ?? 0) : undefined,
    rating: ratings.get(user?.id),
  };
  const ban = mod.bannedFor(conn.playerId, conn.ip);
  if (ban) {
    conn.send({ t: 'removed', msg: `Gesperrt bis ${new Date(ban.until).toLocaleString('de-DE')}: ${ban.reason}` });
    return conn.close!('banned', 4001);
  }
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
    metrics.msgsReceived++;
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
server.listen(PORT, () => log('info', `Tiefenkontakt-Server auf http://localhost:${PORT}`, { port: PORT }));
