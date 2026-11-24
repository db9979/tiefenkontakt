import { z } from 'zod';
import { CAMPAIGN_MISSIONS, briefingLines, crewLevel, dockDays, dockyard, enemySkill, fullStock, newRun, nextMission } from './campaign-state.js';
import type { CampaignStore } from './campaign-store.js';
import type { SeriesRunner } from './series.js';

/** HTTP routes for the campaign screen and replay series (accounts only; series size by role). */

type Reply = (status: number, body: unknown) => void;
export interface OpsCtx {
  method: string;
  url: string;
  user?: { id: number; callsign: string };
  admin: boolean;
  body: () => Promise<unknown>;
  reply: Reply;
}

const playable = z.enum(['ssn', 'ssk', 'ssc', 'ssa', 'ssw', 'ffg', 'kor', 'ffv', 'ffk']);
const dockSchema = z.object({ repair: z.enum(['keine', 'notdienst', 'voll']), resupply: z.boolean() });
const seriesSchema = z.object({
  games: z.number().int().min(1).max(20),
  setup: z.object({
    mission: z.enum(['groenland', 'schelf', 'fjord', 'duell', 'hafen', 'meerenge']),
    timeOfDay: z.enum(['tag', 'daemmerung', 'nacht']),
    botSkill: z.enum(['leicht', 'normal', 'schwer']),
    west: z.array(playable).min(1).max(3),
    east: z.array(playable).min(1).max(3),
    timeLimitMin: z.number().int().min(10).max(60),
  }),
});

/** The campaign screen's view of a run: state, crew level, briefing and dockyard costs. */
export function campaignView(store: CampaignStore, userId: number) {
  const cur = store.active(userId);
  const past = store.past(userId);
  if (!cur) return { run: null, past };
  const run = cur.run;
  const m = nextMission(run);
  return {
    run, past,
    crewLevel: crewLevel(run.crew.xp),
    full: fullStock(run.ship.cls),
    missions: CAMPAIGN_MISSIONS[run.side].map((x) => x.title),
    next: m ? { ...m, enemy: enemySkill(run), lines: briefingLines(run) } : null,
    dockCost: {
      keine: dockDays(run.ship, { repair: 'keine', resupply: false }),
      notdienst: dockDays(run.ship, { repair: 'notdienst', resupply: false }),
      voll: dockDays(run.ship, { repair: 'voll', resupply: false }),
    },
  };
}

async function parse<T>(ctx: OpsCtx, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    const r = schema.safeParse(await ctx.body());
    if (r.success) return r.data;
  } catch {
    /* fall through */
  }
  ctx.reply(400, { error: 'Ungültige Anfrage' });
  return undefined;
}

/** Returns true when the route was handled. */
export async function handleOps(ctx: OpsCtx, store: CampaignStore, series: SeriesRunner): Promise<boolean> {
  const { method, url, user } = ctx;
  const done = (status: number, body: unknown) => (ctx.reply(status, body), true);
  if (!url.startsWith('/api/campaign') && !url.startsWith('/api/series')) return false;
  if (!user) return done(401, { error: 'Nur mit Konto' });
  if (url === '/api/campaign' && method === 'GET') return done(200, campaignView(store, user.id));
  if (url === '/api/campaign/new' && method === 'POST') {
    const b = await parse(ctx, z.object({ cls: playable }));
    if (!b) return true;
    const cur = store.active(user.id);
    if (cur?.run.status === 'sea') return done(400, { error: 'Das Schiff ist auf See' });
    store.create(user.id, newRun(b.cls));
    return done(200, campaignView(store, user.id));
  }
  if (url === '/api/campaign/dock' && method === 'POST') {
    const b = await parse(ctx, dockSchema);
    if (!b) return true;
    const cur = store.active(user.id);
    if (!cur) return done(400, { error: 'Keine laufende Kampagne' });
    const r = dockyard(cur.run, b);
    if (typeof r === 'string') return done(400, { error: r });
    store.save(cur.id, r);
    return done(200, campaignView(store, user.id));
  }
  if (url === '/api/campaign/abandon' && method === 'POST') {
    store.close(user.id);
    return done(200, campaignView(store, user.id));
  }
  if (url === '/api/series' && method === 'GET') return done(200, { ...series.get(), admin: ctx.admin });
  if (url === '/api/series' && method === 'POST') {
    const b = await parse(ctx, seriesSchema);
    if (!b) return true;
    const e = series.start(b.setup, b.games, user.callsign, ctx.admin);
    return e ? done(400, { error: e }) : done(200, series.get());
  }
  const rp = /^\/api\/series\/replay\/(\d{1,2})$/.exec(url);
  if (rp && method === 'GET') {
    const d = series.replay(Number(rp[1]));
    return d ? done(200, d) : done(404, { error: 'Keine Aufzeichnung' });
  }
  return done(404, { error: 'Nicht gefunden' });
}
