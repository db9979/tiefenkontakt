import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { GUEST_TOKEN, RateLimiter, guestPlayerId } from './auth.js';
import { REPLAY_ID, type RecentFinished, type ReplayMeta, type ReplayStore } from './replays.js';

/**
 * HTTP routes for shared replays:
 *   POST /api/replays      share the caller's last finished match (players of that match only)
 *   GET  /api/replays/:id  the public debrief (JSON, gzip when the browser takes it)
 * plus the Open Graph tags for the /r/:id page.
 */

export interface ReplayCtx {
  method: string;
  url: string;
  ip: string;
  /** Player id of the logged-in account (`u-…`), if any. */
  accountPlayerId?: string;
  acceptGzip: boolean;
  body: () => Promise<unknown>;
  reply: (status: number, body: unknown) => void;
  raw: (status: number, headers: Record<string, string>, data: Buffer) => void;
}

const createSchema = z.object({ gid: z.string().regex(GUEST_TOKEN).optional() }).strict();

export class ReplayApi {
  constructor(
    private store: ReplayStore,
    private recent: RecentFinished,
    private perPlayer = new RateLimiter(10, 3_600_000),
    private perIp = new RateLimiter(30, 3_600_000),
  ) {}

  /** Returns true when the route was handled. */
  async handle(ctx: ReplayCtx): Promise<boolean> {
    const path = ctx.url.split('?')[0]!;
    if (path !== '/api/replays' && !path.startsWith('/api/replays/')) return false;
    if (path === '/api/replays') {
      if (ctx.method !== 'POST') return ctx.reply(405, { error: 'Nicht erlaubt' }), true;
      await this.create(ctx);
      return true;
    }
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return ctx.reply(405, { error: 'Nicht erlaubt' }), true;
    const id = path.slice('/api/replays/'.length);
    if (!REPLAY_ID.test(id)) return ctx.reply(400, { error: 'Ungültige Kennung' }), true;
    const gz = this.store.gz(id);
    if (!gz) return ctx.reply(404, { error: 'Wiederholung nicht gefunden oder abgelaufen' }), true;
    const headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=600', 'x-content-type-options': 'nosniff', vary: 'accept-encoding' };
    if (ctx.acceptGzip) ctx.raw(200, { ...headers, 'content-encoding': 'gzip' }, gz);
    else ctx.raw(200, headers, gunzipSync(gz));
    return true;
  }

  private async create(ctx: ReplayCtx): Promise<void> {
    let body: z.infer<typeof createSchema>;
    try {
      const r = createSchema.safeParse(await ctx.body());
      if (!r.success) return ctx.reply(400, { error: 'Ungültige Anfrage' });
      body = r.data;
    } catch {
      return ctx.reply(400, { error: 'Ungültige Anfrage' });
    }
    // Who is asking: the account, or a guest proving their identity with the per-tab secret
    const candidates = [ctx.accountPlayerId, body.gid ? guestPlayerId(body.gid) : undefined].filter((x): x is string => !!x);
    if (!candidates.length) return ctx.reply(401, { error: 'Nicht angemeldet' });
    if (!this.perIp.allow(ctx.ip)) return ctx.reply(429, { error: 'Zu viele Anfragen, versuch es später' });
    const found = candidates.map((p) => ({ p, m: this.recent.lastFor(p) })).find((x) => x.m);
    if (!found?.m) return ctx.reply(403, { error: 'Keine beendete Partie von dir zum Teilen' });
    if (!this.perPlayer.allow(found.p)) return ctx.reply(429, { error: 'Zu viele Anfragen, versuch es später' });
    const r = this.store.create(found.m.key, found.m.d);
    if ('error' in r) return ctx.reply(r.status, { error: r.error });
    ctx.reply(r.existing ? 200 : 201, { id: r.id, url: `/r/${r.id}` });
  }
}

/** Path of a shared replay page, or undefined. */
export function replayPageId(urlPath: string): string | undefined {
  const m = /^\/r\/([^/?#]+)\/?$/.exec(urlPath);
  return m && REPLAY_ID.test(m[1]!) ? m[1] : undefined;
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** index.html with Open Graph title/description for a shared replay (link previews in chats). */
export function withOgTags(indexHtml: string, meta: ReplayMeta | undefined): string {
  if (!meta) return indexHtml;
  const side = meta.winner === 'west' ? 'Westbund' : 'Ostpakt';
  const title = `Tiefenkontakt · Wiederholung: ${side} siegt`;
  const who = meta.players.length ? meta.players.slice(0, 6).join(', ') : 'KI';
  const desc = `${meta.reason} · ${Math.round(meta.duration / 60)} min · mit ${who}`;
  const tags = `<meta property="og:type" content="website" />
    <meta property="og:title" content="${escHtml(title)}" />
    <meta property="og:description" content="${escHtml(desc)}" />
    <meta name="robots" content="noindex" />\n  </head>`;
  return indexHtml.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`).replace('</head>', tags);
}
