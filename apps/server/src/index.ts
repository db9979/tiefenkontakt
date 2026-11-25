import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { ServerMsg } from '@tk/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { lkHttp, lkUpgrade } from './lk-proxy.js';
import { AuthStore, GUEST_TOKEN, RateLimiter, guestPlayerId, parseCookies, type User } from './auth.js';
import { parseClientMsg } from './input.js';
import { MsgGate } from './msg-gate.js';
import { Lobby } from './lobby.js';
import { MatchStore } from './match-store.js';
import { createMailer, SmtpMailer } from './mailer.js';
import { resetMail, verifyMail } from './mail-templates.js';
import { handleAdmin } from './admin.js';
import { StatsAdmin } from './stats-admin.js';
import { bathyFile } from './bathy-load.js';
import { PhoneHub } from './phone.js';
import { FeedbackStore, feedbackSchema } from './feedback.js';
import { ModerationStore } from './moderation.js';
import { Backups } from './backup.js';
import { Ratings } from './rating.js';
import { BadgeStore } from './badges.js';
import { Rankings } from './rankings.js';
import { WeeklyStore, weeklyView } from './weekly.js';
import { log } from './log.js';
import { Match } from './match.js';
import { clientIpFrom } from './client-ip.js';
import { metrics } from './metrics.js';
import { StatsStore, rankFor, userIdOf } from './stats.js';
import type { Conn } from './match.js';
import { CampaignStore } from './campaign-store.js';
import { CampaignService } from './campaign-match.js';
import { SeriesRunner } from './series.js';
import { handleOps } from './ops-api.js';
import { startWatchdog } from './watchdog.js';
import { AdminNotifier, clientError, notifyConfig } from './admin-notify.js';
import { RecentFinished, ReplayStore } from './replays.js';
import { ReplayApi, replayPageId, withOgTags } from './replays-api.js';
import { PerfStore } from './perf-samples.js';
import { DropoutStore, DropoutTracker } from './dropouts.js';
import { realBalance } from './real-balance.js';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 30;
/** A player whose link can't keep up gets no new snapshot until the backlog drains. */
const SEND_BACKLOG_BYTES = 256 * 1024;
const COOKIE = 'tk_session';

const auth = new AuthStore();
export const lobby = new Lobby();
const store = new MatchStore();
const stats = new StatsStore(auth.db);
const statsAdmin = new StatsAdmin(auth.db);
const mod = new ModerationStore(auth.db);
const backups = new Backups(auth.db);
const ratings = new Ratings(auth.db);
const campaigns = new CampaignStore(auth.db);
const campaign = new CampaignService(campaigns);
const badges = new BadgeStore(auth.db);
const rankings = new Rankings(auth.db, stats, badges);
const weekly = new WeeklyStore(auth.db);
const feedback = new FeedbackStore(auth.db);
const phones = new PhoneHub();
rankings.init();
campaign.onRunSaved = (uid, run) => rankings.afterCampaign(uid, run);
const series = new SeriesRunner();
const replays = new ReplayStore(auth.db);
const perfStore = new PerfStore(auth.db);
const dropouts = new DropoutStore(auth.db);
lobby.dropouts = new DropoutTracker(dropouts);
const recentFinished = new RecentFinished();
const replayApi = new ReplayApi(replays, recentFinished);
replays.cleanup();
setInterval(() => replays.cleanup(), 3_600_000).unref();
lobby.onCampaignStart = (conn) => campaign.plan(conn);
lobby.onReport = (conn, m, from, reason) => {
  const s = m.senderOf(from);
  if (!s) return 'Absender nicht gefunden';
  if (s.playerId === conn.playerId) return 'Du kannst dich nicht selbst melden';
  const reported = m.slots.find((x) => x.playerId === s.playerId)?.callsign ?? from;
  const fresh = mod.report({ reporter: conn.callsign, reported, reportedId: s.playerId, matchId: m.id, reason, evidence: s.evidence });
  log('info', 'Meldung', { reporter: conn.callsign, reported, reason });
  if (fresh) notify.report({ at: Date.now(), reporter: conn.callsign, reported, reportedId: s.playerId, matchId: m.id, reason, evidence: s.evidence });
  return fresh ? undefined : 'Bereits gemeldet';
};
const LESSON_STEP: Record<string, string> = { klassifizieren: 'l1', tma: 'l2', angriff: 'l3', ujagd: 'l4' };
Match.recentHabits = (uid, team) => stats.recentHabits(uid, team);
lobby.onFinish = (m, d) => {
  recentFinished.remember(m.id, d); // its players may share the replay by link
  if (m.settings.lesson) {
    if (!d.reason.includes('geschafft')) return;
    for (const s of d.stats) {
      const uid = userIdOf(s.playerId);
      if (uid !== undefined) stats.complete(uid, LESSON_STEP[m.settings.lesson]!);
    }
    return;
  }
  campaign.finish(m, d);
  if (m.settings.weekly) weekly.record(m.settings.weekly, d);
  if (m.settings.sandbox) return; // training: no results, no rating
  stats.record(d, m.settings.mission, m.settings.timeOfDay);
  ratings.update(d);
  rankings.afterMatch(d);
};
lobby.onLessonDone = (playerId, lesson) => {
  const uid = userIdOf(playerId);
  if (uid !== undefined && LESSON_STEP[lesson]) stats.complete(uid, LESSON_STEP[lesson]!);
};
const restored = store.loadAll(lobby);
if (restored) log('info', 'Partien wiederhergestellt', { count: restored });
lobby.onDrop = (m) => {
  store.remove(m.id);
  if (m.state !== 'ended') campaign.finish(m); // left before the end: the sortie counts as aborted
};
// Running matches are saved every MATCH_SAVE_S seconds (raise it on SD cards to save writes)
const SAVE_S = Math.max(2, Number(process.env.MATCH_SAVE_S ?? 5));
setInterval(() => lobby.prune(), 5000).unref();
lobby.voice.start();
lobby.sandbox.start();
setInterval(() => void store.saveAllAsync(lobby), SAVE_S * 1000).unref();
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.saveAll(lobby);
    process.exit(0);
  });
}
const authLimiter = new RateLimiter(10, 60_000);
const errorLimiter = new RateLimiter(5, 60_000);
const feedbackLimiter = new RateLimiter(3, 60_000);
const perfLimiter = new RateLimiter(6, 60_000);
const mailer = createMailer();
if (mailer instanceof SmtpMailer) {
  const c = mailer.cfg;
  log('info', 'Mailversand über SMTP', { host: c.host, port: c.port, security: c.security, from: c.from, login: c.user ? 'ja' : 'nein' });
} else log('info', 'Kein Mailserver eingestellt: Bestätigungs- und Reset-Links stehen im Log');
const notify = new AdminNotifier(mailer, notifyConfig()); // feedback, reports, browser errors to the admin
// Operator alerts (failed backups, disk, memory, lag); hooked in before the first backup run
startWatchdog(mailer, backups, () => {
  const all = lobby.allMatches();
  return {
    Laufzeit: `${Math.round(process.uptime() / 3600)} h`,
    'Partien (laufend/Lobby)': `${all.filter((m) => m.state === 'running').length}/${all.filter((m) => m.state === 'lobby').length}`,
    'Spieler verbunden': all.reduce((a, m) => a + m.connected, 0),
    Verbindungen: wss.clients.size,
    Backups: backups.enabled ? backups.list().length : 'aus',
  };
});
backups.start();
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
    if (req.url === '/api/admin/feedback' && req.method === 'GET') return json(res, 200, feedback.list());
    // Graphics performance of real devices, drop-outs and balance from real matches
    if (req.url === '/api/admin/insights' && req.method === 'GET') {
      return json(res, 200, { perf: perfStore.rows(), dropouts: dropouts.view(), balance: realBalance(auth.db) });
    }
    if (req.url === '/api/admin/backup' && req.method === 'POST') {
      if (!backups.enabled) return json(res, 400, { error: 'BACKUP_DIR ist nicht gesetzt' });
      return json(res, 200, { file: backups.run(), backups: backups.list() });
    }
    return handleAdmin(req, body, (status, b) => json(res, status, b), lobby, mod, statsAdmin);
  }
  if (req.url?.startsWith('/api/replays') && await replayApi.handle({
    method: req.method ?? 'GET', url: req.url ?? '', ip, accountPlayerId: ((u) => (u ? `u-${u.id}` : undefined))(auth.userForToken(token)),
    acceptGzip: /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')), body: () => readBody(req), reply: (st: number, b: unknown) => json(res, st, b),
    raw: (st: number, hd: Record<string, string>, data: Buffer) => void res.writeHead(st, hd).end(req.method === 'HEAD' ? undefined : data),
  })) return;
  if (rankings.handle(req.method ?? 'GET', req.url ?? '', (st, b) => json(res, st, b))) return;
  if (req.url?.startsWith('/api/bathy/') && req.method === 'GET') {
    // Bathymetry of a real sea area for the client's chart (gzipped grid, unpacked by the browser)
    const file = bathyFile(req.url.slice('/api/bathy/'.length));
    if (!file) return json(res, 404, { error: 'Unbekanntes Seegebiet' });
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=86400' }).end(file);
    return;
  }
  if (req.url === '/api/weekly' && req.method === 'GET') return json(res, 200, weeklyView(weekly));
  if (req.url === '/api/balance' && req.method === 'GET') return json(res, 200, stats.balance());
  if (req.url === '/api/stats' && req.method === 'GET') {
    const u = auth.userForToken(token);
    if (!u) return json(res, 401, { error: 'Nur mit Konto' });
    return json(res, 200, { summary: stats.summary(u.id), campaign: stats.campaign(u.id), rating: ratings.get(u.id), badges: badges.of(u.id) });
  }
  const opsUser = req.url?.startsWith('/api/campaign') || req.url?.startsWith('/api/series') ? auth.userForToken(token) : undefined;
  const opsCtx = { method: req.method ?? 'GET', url: req.url ?? '', user: opsUser, admin: mod.isAdmin(opsUser?.callsign), body: () => readBody(req), reply: (st: number, b: unknown) => json(res, st, b) };
  if (await handleOps(opsCtx, campaigns, series)) return;
  if (req.method !== 'POST') return json(res, 404, { error: 'Nicht gefunden' });
  if (req.url === '/api/feedback') {
    // A player's feedback after a game (test evenings)
    if (!feedbackLimiter.allow(ip)) return json(res, 429, { ok: false });
    let parsed;
    try {
      parsed = feedbackSchema.safeParse(await readBody(req));
    } catch {
      return json(res, 400, { ok: false });
    }
    if (!parsed.success) return json(res, 400, { ok: false });
    const callsign = auth.userForToken(token)?.callsign;
    feedback.add(parsed.data, callsign);
    notify.feedback(parsed.data, callsign);
    return json(res, 200, { ok: true });
  }
  if (req.url === '/api/perf') {
    // Anonymous frame-time sample from a 3D view (sendBeacon); the address only feeds the rate limit
    if (!perfLimiter.allow(ip)) return json(res, 429, { ok: false });
    let b: unknown;
    try {
      b = await readBody(req);
    } catch {
      return json(res, 400, { ok: false });
    }
    return perfStore.add(b) ? json(res, 200, { ok: true }) : json(res, 400, { ok: false });
  }
  if (req.url === '/api/client-error') {
    // Browser errors from players, so problems on their devices show up in the server log
    if (!errorLimiter.allow(ip)) return json(res, 429, { ok: false });
    const b = await readBody(req).catch(() => undefined);
    if (!b || typeof b !== 'object') return json(res, 400, { ok: false });
    const err = clientError(b as Record<string, unknown>, req.headers['user-agent'], auth.userForToken(token)?.callsign);
    metrics.clientErrors++;
    log('warn', 'Client-Fehler', { msg: err.msg, stack: err.stack, where: err.where, ua: err.ua, user: err.user });
    notify.clientError(err);
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
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg',
};

/** Serve the built client (production): static files, index.html for everything else. */
function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const root = resolve(CLIENT_DIST);
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  let file = resolve(join(root, urlPath));
  if (!file.startsWith(root + sep) && file !== root) return void res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  // Shared replay page: index.html with link-preview tags
  const rid = replayPageId(urlPath);
  if (rid && existsSync(file)) {
    res.writeHead(200, { 'content-type': TYPES['.html']!, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    return void res.end(req.method === 'HEAD' ? undefined : withOgTags(readFileSync(file, 'utf8'), replays.meta(rid)));
  }
  if (!existsSync(file)) return void res.writeHead(404).end();
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  // Precompressed at build time (.br / .gz next to the file): no compression work on the Pi
  const accept = String(req.headers['accept-encoding'] ?? '');
  const enc = /\bbr\b/.test(accept) && existsSync(`${file}.br`) ? 'br' : /\bgzip\b/.test(accept) && existsSync(`${file}.gz`) ? 'gzip' : undefined;
  res.writeHead(200, {
    'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff', vary: 'accept-encoding',
    ...(enc ? { 'content-encoding': enc } : {}),
  });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(enc ? `${file}.${enc === 'br' ? 'br' : 'gz'}` : file).pipe(res);
}

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    handleApi(req, res).catch(() => json(res, 500, { error: 'Serverfehler' }));
    return;
  }
  if (req.url?.startsWith('/lk/')) return lkHttp(req, res);
  if (CLIENT_DIST && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(req, res);
  res.writeHead(404).end();
});

// permessage-deflate: snapshots are repetitive JSON and shrink several-fold on the wire
const wss = new WebSocketServer({
  noServer: true, path: '/ws', maxPayload: MAX_MSG_BYTES,
  perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 3 }, serverNoContextTakeover: false },
});
wss.on('error', () => undefined);
// Upgrades: /ws is the game, /lk/ the voice server's signalling (when configured)
server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/lk/')) return lkUpgrade(req, socket, head);
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

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
  const playerId = guestPlayerId(token);
  const id = playerId.slice(2);
  const name = (guestName ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
  return { playerId, callsign: `${name.length >= 3 ? name : 'Gast'}-${parseInt(id.slice(0, 4), 16) % 900 + 100}` };
}

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // A paired phone (3D view only): its own small protocol, phone.ts
  const phoneCode = url.searchParams.get('phone');
  if (phoneCode !== null) return void phones.attach(ws, phoneCode);
  const user = auth.userForToken(parseCookies(req.headers.cookie)[COOKIE]);
  const conn: Conn = {
    ...identity(user, url.searchParams.get('guest'), url.searchParams.get('gid')),
    send: (msg: ServerMsg) => {
      if (ws.readyState !== ws.OPEN) return;
      const text = JSON.stringify(msg, roundNumbers);
      metrics.sent(text.length);
      ws.send(text);
      phones.mirror(conn.playerId, msg, text);
    },
    congested: () => ws.bufferedAmount > SEND_BACKLOG_BYTES,
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
  phones.main(conn);
  const resumed = lobby.connect(conn);
  conn.send({ t: 'welcome', playerId: conn.playerId, callsign: conn.callsign, resume: resumed });
  lobby.resume(conn);

  const gate = new MsgGate(MAX_MSGS_PER_SEC, (msg) => {
    metrics.msgsReceived++;
    if (msg.t === 'phone_link') return conn.send({ t: 'phone_link', code: phones.link(conn) });
    lobby.handle(conn, msg);
  }, () => conn.send({ t: 'error', msg: 'Zu viele Befehle, kurz warten' }));
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  ws.on('message', (data) => {
    if (gate.flooding()) return;
    // One bad message (or a bug in its handler) must not take the server down
    try {
      const msg = parseClientMsg(data.toString());
      if (!msg) {
        if (gate.invalid()) conn.send({ t: 'error', msg: 'Ungültige Nachricht' });
        return;
      }
      gate.offer(msg);
    } catch (e) {
      log('error', 'Nachricht nicht verarbeitet', { player: conn.playerId, error: (e as Error).message, stack: (e as Error).stack });
    }
  });
  ws.on('close', () => {
    gate.close();
    lobby.disconnect(conn);
  });
});

/**
 * Heartbeat: a link that died without a close (phone in a tunnel, NAT timeout) would keep its
 * seat "online" and its socket buffering forever. Every 15 s each socket must answer a ping.
 */
const HEARTBEAT_MS = 15_000;
const alive = new WeakSet<WebSocket>();
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, HEARTBEAT_MS).unref();

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
