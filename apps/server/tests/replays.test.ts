import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Debrief } from '@tk/shared';
import { RateLimiter, guestPlayerId } from '../src/auth.js';
import { RecentFinished, ReplayStore, limitsFromEnv, publicDebrief } from '../src/replays.js';
import { ReplayApi, replayPageId, withOgTags, type ReplayCtx } from '../src/replays-api.js';

const GID = 'a'.repeat(32);
const GUEST = guestPlayerId(GID);

function debrief(): Debrief {
  const base = { shots: 1, rockets: 0, buoys: 0, distanceNm: 5, kills: 0, tonnageSunk: 0 };
  return {
    ships: [
      { id: 'p_u-7', name: 'Alpha', cls: 'ssk', team: 'east', player: true },
      { id: `p_${GUEST}`, name: 'Gast-123', cls: 'ffg', team: 'west', player: true },
      { id: 'p_bot-w1', name: 'KI-Geleit-1', cls: 'ffg', team: 'west', player: true },
      { id: 'm1', name: 'Frachter 1', cls: 'merchant', team: 'west', player: false },
    ],
    frames: [[0, [['p_u-7', 0, 0, 90, 1], [`p_${GUEST}`, 100, 100, 0, 1], ['m1', 5, 5, 0, 1]]], [15, [['p_u-7', 10, 0, 90, 1], [`p_${GUEST}`, 100, 110, 0, 0]]]],
    torpedoes: [[15, [['torp_p_u-7_1', 50, 50]]]],
    events: [{ t: 15, kind: 'sunk', shipId: `p_${GUEST}`, byId: 'p_u-7' }, { t: 10, kind: 'shot', shipId: 'p_u-7', what: 'torpedo' }],
    stats: [
      { ...base, playerId: 'u-7', callsign: 'Alpha', team: 'east', cls: 'ssk', survived: true, won: true, kills: 1, habits: { pd: 0.5, above: 0.2, fast: 0.1, ping: 0 } },
      { ...base, playerId: GUEST, callsign: 'Gast-123', team: 'west', cls: 'ffg', survived: false, won: false },
      { ...base, playerId: 'bot-w1', callsign: 'KI-Geleit-1', team: 'west', cls: 'ffg', survived: true, won: false },
    ],
    winner: 'east', reason: 'Konvoi versenkt', duration: 900,
    learned: ['Du fährst oft auf Sehrohrtiefe'],
    photos: [{ id: 'ph1', playerId: 'u-7', shipId: 'p_u-7', t: 5, score: 80, quality: 'gut', comment: 'x', flaws: [] }],
  };
}

function setup(opts: { now?: () => number; maxCount?: number; maxBytes?: number; perPlayer?: RateLimiter } = {}) {
  const db = new DatabaseSync(':memory:');
  const store = new ReplayStore(db, { keepDays: 90, maxBytes: opts.maxBytes ?? 2_000_000, maxCount: opts.maxCount ?? 100 }, opts.now);
  const recent = new RecentFinished();
  const api = new ReplayApi(store, recent, opts.perPlayer);
  return { db, store, recent, api };
}

interface Res { status: number; body: unknown; headers?: Record<string, string> }

async function call(api: ReplayApi, method: string, url: string, extra: Partial<ReplayCtx> & { json?: unknown } = {}): Promise<Res> {
  let out: Res = { status: 0, body: undefined };
  const handled = await api.handle({
    method, url, ip: '1.2.3.4', acceptGzip: false,
    body: async () => extra.json ?? {},
    reply: (status, body) => (out = { status, body }),
    raw: (status, headers, data) => (out = { status, headers, body: JSON.parse((headers['content-encoding'] === 'gzip' ? gunzipSync(data) : data).toString()) }),
    ...extra,
  });
  expect(handled).toBe(true);
  return out;
}

describe('shared replays', () => {
  it('strips account ids, guest ids, habits, learned notes and photos', () => {
    const pub = publicDebrief(debrief());
    const text = JSON.stringify(pub);
    expect(text).not.toContain('u-7');
    expect(text).not.toContain(GUEST);
    expect(text).not.toContain(GUEST.slice(2));
    expect(text).not.toContain('habits');
    expect(pub.learned).toBeUndefined();
    expect(pub.photos).toBeUndefined();
    // Structure intact: callsigns kept, ids consistent between ships, frames and events
    expect(pub.stats.map((s) => s.callsign)).toEqual(['Alpha', 'Gast-123', 'KI-Geleit-1']);
    const alpha = pub.ships.find((s) => s.name === 'Alpha')!.id;
    const gast = pub.ships.find((s) => s.name === 'Gast-123')!.id;
    expect(pub.frames[1]![1].map((f) => f[0])).toEqual([alpha, gast]);
    expect(pub.events[0]).toMatchObject({ kind: 'sunk', shipId: gast, byId: alpha });
    expect(pub.torpedoes[0]![1][0]![0]).toBe('t0');
  });

  it('a player of the match creates a link; anyone fetches it; sharing again returns the same link', async () => {
    const { api, recent } = setup();
    recent.remember('abcd1234', debrief());
    const r = await call(api, 'POST', '/api/replays', { accountPlayerId: 'u-7' });
    expect(r.status).toBe(201);
    const { id, url } = r.body as { id: string; url: string };
    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(url).toBe(`/r/${id}`);
    // The guest of the same match gets the same link
    const g = await call(api, 'POST', '/api/replays', { json: { gid: GID } });
    expect(g.status).toBe(200);
    expect((g.body as { id: string }).id).toBe(id);
    const f = await call(api, 'GET', `/api/replays/${id}`);
    expect(f.status).toBe(200);
    expect((f.body as Debrief).reason).toBe('Konvoi versenkt');
    expect(JSON.stringify(f.body)).not.toContain('u-7');
    // gzip as stored for browsers that take it
    const z = await call(api, 'GET', `/api/replays/${id}`, { acceptGzip: true });
    expect(z.headers!['content-encoding']).toBe('gzip');
    expect((z.body as Debrief).duration).toBe(900);
  });

  it('only players of a finished match may share', async () => {
    const { api, recent } = setup();
    recent.remember('abcd1234', debrief());
    expect((await call(api, 'POST', '/api/replays')).status).toBe(401);
    expect((await call(api, 'POST', '/api/replays', { accountPlayerId: 'u-99' })).status).toBe(403);
    expect((await call(api, 'POST', '/api/replays', { json: { gid: 'b'.repeat(32) } })).status).toBe(403);
    expect((await call(api, 'POST', '/api/replays', { json: { gid: '../etc' } })).status).toBe(400);
    expect((await call(api, 'POST', '/api/replays', { json: { gid: GID, extra: 1 } })).status).toBe(400);
    // Bots are no members
    expect(recent.lastFor('bot-w1')).toBeUndefined();
    expect((await call(api, 'GET', '/api/replays')).status).toBe(405);
  });

  it('rate-limits sharing per player', async () => {
    const { api, recent } = setup({ perPlayer: new RateLimiter(2, 60_000) });
    recent.remember('abcd1234', debrief());
    expect((await call(api, 'POST', '/api/replays', { accountPlayerId: 'u-7' })).status).toBe(201);
    expect((await call(api, 'POST', '/api/replays', { accountPlayerId: 'u-7' })).status).toBe(200);
    expect((await call(api, 'POST', '/api/replays', { accountPlayerId: 'u-7' })).status).toBe(429);
  });

  it('rejects bad ids with 400 and unknown ids with 404 (no path traversal)', async () => {
    const { api } = setup();
    for (const bad of ['..%2F..%2Fetc%2Fpasswd', '../../etc/passwd', 'short', 'x'.repeat(17), 'abc$defghijklmno', '%00aaaaaaaaaaaaaa', '']) {
      expect((await call(api, 'GET', `/api/replays/${bad}`)).status).toBe(400);
    }
    expect((await call(api, 'GET', '/api/replays/AAAAAAAAAAAAAAAA')).status).toBe(404);
    expect(replayPageId('/r/../../etc/passwd')).toBeUndefined();
    expect(replayPageId('/r/AAAAAAAAAAAAAAAA')).toBe('AAAAAAAAAAAAAAAA');
    expect(replayPageId('/r/AAAAAAAAAAAAAAAA/x')).toBeUndefined();
  });

  it('expires after REPLAY_KEEP_DAYS and cleans up', () => {
    let now = 1_000_000;
    const { store } = setup({ now: () => now });
    const r = store.create('m1:1', debrief());
    if (!('id' in r)) throw new Error('create');
    expect(store.get(r.id)?.duration).toBe(900);
    // Link preview: human callsigns only
    expect(store.meta(r.id)?.players).toEqual(['Alpha', 'Gast-123']);
    now += 89 * 86_400_000;
    expect(store.get(r.id)).toBeDefined();
    now += 2 * 86_400_000;
    expect(store.get(r.id)).toBeUndefined();
    expect(store.count()).toBe(1);
    expect(store.cleanup()).toBe(1);
    expect(store.count()).toBe(0);
    expect(limitsFromEnv({ REPLAY_KEEP_DAYS: '7' }).keepDays).toBe(7);
    expect(limitsFromEnv({ REPLAY_KEEP_DAYS: 'nonsense' }).keepDays).toBe(90);
  });

  it('caps the total count (oldest go first) and the size', () => {
    let now = 1;
    const { store } = setup({ now: () => now++, maxCount: 3 });
    const ids = [1, 2, 3, 4].map((i) => {
      const r = store.create(`m:${i}`, debrief());
      if (!('id' in r)) throw new Error('create');
      return r.id;
    });
    expect(store.count()).toBe(3);
    expect(store.get(ids[0])).toBeUndefined();
    expect(store.get(ids[3])).toBeDefined();
    const big = debrief();
    // Random positions don't compress: well over the limit
    big.frames = Array.from({ length: 2000 }, (_, i) => [i * 15, Array.from({ length: 10 }, (_, k) => [`m${k}`, Math.random() * 1e6, Math.random() * 1e6, 0, 1] as [string, number, number, number, number])]);
    const small = setup({ maxBytes: 10_000 }).store;
    expect(small.create('big:1', big)).toMatchObject({ status: 413 });
    expect(small.count()).toBe(0);
  });

  it('adds Open Graph tags with escaped text to the replay page', () => {
    const html = '<html><head><title>Tiefenkontakt</title></head><body></body></html>';
    const out = withOgTags(html, { winner: 'west', reason: 'Konvoi <sicher>', duration: 1200, players: ['A"B'] });
    expect(out).toContain('og:title');
    expect(out).toContain('Westbund siegt');
    expect(out).toContain('Konvoi &#60;sicher&#62;');
    expect(out).toContain('A&#34;B');
    expect(out).not.toContain('<sicher>');
    expect(withOgTags(html, undefined)).toBe(html);
  });
});
