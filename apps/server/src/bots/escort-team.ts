import {
  activeOrders,
  bearing,
  CLASSES,
  distance,
  executeOrder,
  gridRef,
  headingVec,
  isConvoyShip,
  isEscort,
  targetPosAt,
  wrap360,
  type ContactTrack,
  type HuntPlan,
  type Ship,
  type Vec2,
  type World,
} from '@tk/shared';
import { classify, isFriendly, latestLine, votedPeek, type BotMemory } from './common.js';
import { crossFix } from './frigate.js';
import { leadDetour, sweepStation } from './mine-cm.js';

/**
 * Escort teamwork. Once every few seconds the AI escorts of a side pool what their sensors
 * (and the datalink of human escorts) hold into one team datum, decide who leaves the
 * screen to prosecute, and pair two prosecutors into a hunter-killer team: the director
 * keeps active contact from 3-5 km, the attacker creeps in silently and fires on the
 * director's datum. The rest of the screen closes the gap on the threat side.
 */

export type EscortRole = 'screen' | 'hunter' | 'director' | 'attacker';

export interface EscortTask {
  role: EscortRole;
  /** Screen station (world metres). */
  station?: Vec2;
  /** Sector ordered by fleet command that this ship covers. */
  search?: Vec2;
}

/** Roles hold at least this long (no flapping; also gives the boat a chance between attacks). */
export const ROLE_HOLD_S = 300;
const DATUM_MAX_AGE = 900;
const PROSECUTE_MAX = 16_000;
const SCREEN_R = 4500;

const isHuman = (s: Ship) => s.id.startsWith('p_') && !s.id.startsWith('p_bot-');

function isSub(t: ContactTrack, m?: BotMemory): boolean {
  const c = m ? votedPeek(m, t) : t.classified ? (CLASSES[t.classified]?.submarine ? 'submarine' : 'other') : classify(t);
  return c === 'submarine';
}

/** Datum candidates from one escort's book: echoes and MAD (good), buoy cross-fixes, TMA. */
function candidates(w: World, s: Ship, m: BotMemory | undefined): { p: Vec2; t: number; q: number }[] {
  const out: { p: Vec2; t: number; q: number }[] = [];
  const now = w.time;
  for (const t of w.books.get(s.id)?.tracks() ?? []) {
    if (now - t.lastSeen > 120 || t.sensors.includes('esm') || !isSub(t, m) || isFriendly(w, s, t, m)) continue;
    const echo = [...t.history].reverse().find((h) => (h.sensor === 'active' || h.sensor === 'mad') && h.r !== undefined && now - h.t < 120);
    if (echo) {
      const at = echo.ox !== undefined ? { x: echo.ox, y: echo.oy! } : m ? [...m.track].reverse().find((f) => f.t <= echo.t + 3) ?? s.pos : s.pos;
      const v = headingVec(echo.b);
      out.push({ p: { x: at.x + v.x * echo.r!, y: at.y + v.y * echo.r! }, t: echo.t, q: 90 });
      continue;
    }
    const sol = m?.sols[t.label];
    if (sol && sol.q > 55 && now - sol.at < 120) {
      out.push({ p: targetPosAt(sol.sol, now), t: now, q: sol.q * 0.7 });
    }
  }
  return out;
}

/** Fresh passive bearings on submarines from each escort, for cross-fixes between ships. */
function lines(w: World, s: Ship, m: BotMemory | undefined): { o: Vec2; b: number; t: number }[] {
  return (w.books.get(s.id)?.tracks() ?? [])
    .filter((t) => w.time - t.lastSeen < 30 && !t.sensors.includes('esm') && isSub(t, m) && !isFriendly(w, s, t, m))
    .map((t) => {
      const l = m ? latestLine(t, m, s) : { origin: s.pos, b: t.bearing, t: t.lastSeen };
      return { o: l.origin, b: l.b, t: l.t };
    });
}

/** Pool the side's sensors into the best datum (fresh good fixes beat old ones). */
function updateDatum(w: World, plan: HuntPlan, escorts: Ship[], mems: Map<string, BotMemory>): void {
  const now = w.time;
  const score = (d: { t: number; q: number }) => d.q - (now - d.t) / 4;
  let best = plan.datum && now - plan.datum.t < DATUM_MAX_AGE ? plan.datum : undefined;
  const consider = (p: Vec2, t: number, q: number, by: string) => {
    if (!best || score({ t, q }) > score(best)) best = { x: p.x, y: p.y, t, q, by };
  };
  const all: { s: Ship; ls: ReturnType<typeof lines> }[] = [];
  for (const s of escorts) {
    const m = mems.get(s.id);
    for (const c of candidates(w, s, m)) consider(c.p, c.t, c.q, s.id);
    all.push({ s, ls: lines(w, s, m) });
  }
  // Two ships' bearings crossing at a good angle
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      for (const a of all[i]!.ls) for (const b of all[j]!.ls) {
        const fix = Math.abs(a.t - b.t) < 30 ? crossFix(a.o, a.b, b.o, b.b) : undefined;
        if (fix) consider(fix, Math.min(a.t, b.t), 60, all[i]!.s.id);
      }
    }
  }
  plan.datum = best;
}

function say(w: World, plan: HuntPlan, s: Ship, role: string, text: string): void {
  if (plan.said[s.id] === role) return;
  plan.said[s.id] = role;
  // Radio silence ordered: roles change without a word; and no chatter more than every 2 minutes
  const at = (plan.saidAt ??= {});
  if (activeOrders(w, s).some((o) => o.kind === 'silence') || w.time - (at[s.id] ?? -1e9) < 120) return;
  at[s.id] = w.time;
  w.events.push({ kind: 'teamradio', time: w.time, senderId: s.id, text });
}

/** Screen stations around the convoy, spread about the threat axis (or ahead). */
function stations(center: Vec2, axis: number, n: number, threat: boolean): Vec2[] {
  const spread = n <= 1 ? [0] : n === 2 ? [-50, 50] : n === 3 ? [-55, 0, 55] : [-80, -30, 30, 80];
  const r = threat ? SCREEN_R : 4600;
  return spread.slice(0, n).map((a) => {
    const v = headingVec(axis + a);
    return { x: center.x + v.x * r, y: center.y + v.y * r };
  });
}

/**
 * Plan one side. Returns the task of each AI escort; ships without an entry act alone.
 * `lastLead` is the freshest lead (ESM, transient) any AI escort holds, for the threat axis.
 */
export function planSide(w: World, team: 'west' | 'east', mems: Map<string, BotMemory>): Map<string, EscortTask> {
  const tasks = new Map<string, EscortTask>();
  const now = w.time;
  const escorts = w.ships.filter((s) => s.alive && s.team === team && isEscort(s.cls));
  const ai = escorts.filter((s) => mems.has(s.id) && !mems.get(s.id)!.passive);
  if (!ai.length) return tasks;
  const hunt = (w.env.hunt ??= {});
  const plan = (hunt[team] ??= { rolesAt: -1e9, hunters: [], helo: {}, said: {} });
  updateDatum(w, plan, escorts, mems);
  const merchants = w.ships.filter((x) => x.alive && x.team === team && (isConvoyShip(x) || x.cls === 'merchant'));
  const center = merchants.length ? { x: merchants.reduce((a, x) => a + x.pos.x, 0) / merchants.length, y: merchants.reduce((a, x) => a + x.pos.y, 0) / merchants.length } : undefined;
  const d = plan.datum;
  const datumOk = !!d && now - d.t < 600 && (!center || distance(center, d) < PROSECUTE_MAX);

  // Who prosecutes: ships holding their own fresh contact, or close to the datum
  const holds = (s: Ship) => lines(w, s, mems.get(s.id)).length > 0 || candidates(w, s, mems.get(s.id)).some((c) => now - c.t < 60);
  const led = (s: Ship) => { const l = mems.get(s.id)?.lead; return !!l && now - l.t < 900; };
  const near = (s: Ship) => (center ? distance(s.pos, center) < PROSECUTE_MAX : true);
  const close = datumOk && (!center || distance(center, d!) < 12_000);
  // Screen discipline: with three or more escorts one always stays; with two, both only on a close datum
  const max = !center ? ai.length : ai.length >= 3 ? ai.length - 1 : close ? ai.length : 1;
  const key = (s: Ship) => (datumOk ? distance(s.pos, d!) : Number(!holds(s)));
  let hunters = ai.filter((s) => near(s) && (holds(s) || led(s) || (datumOk && (distance(s.pos, d!) < 6000 || plan.hunters.includes(s.id)))))
    .sort((a, b) => key(a) - key(b)).slice(0, max);
  // A good datum close to the convoy but only one ship on it: the nearest free escort joins the hunt
  if (hunters.length === 1 && max >= 2 && close) {
    const extra = ai.filter((s) => !hunters.includes(s)).sort((a, b) => distance(a.pos, d!) - distance(b.pos, d!))[0];
    if (extra && distance(extra.pos, d!) < 12_000) hunters = [...hunters, extra];
  }
  plan.hunters = hunters.map((s) => s.id);

  // Hunter-killer pair: keep roles for a while; the director is the one with the best contact
  if (hunters.length >= 2 && datumOk) {
    const alive = (id?: string) => hunters.some((s) => s.id === id);
    const expired = now - plan.rolesAt > ROLE_HOLD_S;
    const dirHolds = alive(plan.director) && holds(w.ships.find((s) => s.id === plan.director)!);
    if (!alive(plan.director) || !alive(plan.attacker) || (expired && !dirHolds)) {
      const byContact = [...hunters].sort((a, b) => Number(holds(b)) - Number(holds(a)) || distance(a.pos, d!) - distance(b.pos, d!));
      const dir = byContact[0]!;
      const att = hunters.filter((s) => s !== dir).sort((a, b) => distance(a.pos, d!) - distance(b.pos, d!))[0]!;
      if (dir.id !== plan.director || att.id !== plan.attacker) plan.rolesAt = now;
      plan.director = dir.id;
      plan.attacker = att.id;
    }
  } else {
    plan.director = plan.attacker = undefined;
  }
  const grid = d ? gridRef(d.x, d.y) : '';
  for (const s of hunters) {
    const role: EscortRole = s.id === plan.director ? 'director' : s.id === plan.attacker ? 'attacker' : 'hunter';
    tasks.set(s.id, { role });
    say(w, plan, s, role, role === 'director' ? `HALTE KONTAKT · DATUM ${grid} · AKTIV` : role === 'attacker' ? `ÜBERNEHME ANGRIFF · DATUM ${grid} · LAUTLOS` : `VERFOLGE U-BOOT-KONTAKT · DATUM ${grid}`);
  }

  // Screen: the others take stations on the threat axis (or ahead), nearest station first
  const screens = ai.filter((s) => !tasks.has(s.id));
  if (center && screens.length) {
    const ahead = w.convoy?.guideHeading ?? 0;
    const threat = d && now - d.t < DATUM_MAX_AGE ? bearing(center, d) : undefined;
    const st = stations(center, threat ?? ahead, screens.length, threat !== undefined);
    // In mine water one screen sweeps the track close ahead with its mine-avoidance sonar (the
    // barrage-laying boat is ahead on the track too)
    const sweep = sweepStation(w, center);
    if (sweep) st[0] = sweep;
    const free = [...st];
    for (const s of [...screens].sort((a, b) => a.id.localeCompare(b.id))) {
      const i = free.reduce((bi, p, j) => (distance(s.pos, p) < distance(s.pos, free[bi]!) ? j : bi), 0);
      tasks.set(s.id, { role: 'screen', station: free.splice(i, 1)[0] });
      if (plan.said[s.id] && plan.said[s.id] !== 'screen') say(w, plan, s, 'screen', 'ZURÜCK IN DIE SICHERUNG');
      else plan.said[s.id] ??= 'screen';
    }
  }
  obeyEscortOrders(w, team, ai, tasks, center);
  leadDetour(w, team, ai);
  return tasks;
}

/** Fleet command's orders: execute the convoy turn, send someone to the ordered sector. */
function obeyEscortOrders(w: World, team: string, ai: Ship[], tasks: Map<string, EscortTask>, center?: Vec2): void {
  const humans = w.ships.some((s) => s.alive && s.team === team && isHuman(s) && !CLASSES[s.cls].submarine);
  for (const s of ai) {
    for (const o of activeOrders(w, s)) {
      const read = o.readAt[s.id]!;
      // Leave a human escort commander time to decide; then the AI passes it on
      if (o.kind === 'turn' && w.time - read > (humans ? 240 : 60)) executeOrder(w, s, o.id);
    }
  }
  const search = ai.length ? activeOrders(w, ai[0]!).find((o) => o.kind === 'search' && o.area) : undefined;
  if (!search?.area) return;
  const area = search.area;
  const pick = ai.filter((s) => tasks.get(s.id)?.role === 'screen' || !tasks.has(s.id))
    .sort((a, b) => distance(a.pos, area) - distance(b.pos, area))[0];
  if (!pick) return;
  // Too far from the convoy for a frigate to leave the screen: its helicopter goes, else the ship
  const t = tasks.get(pick.id) ?? { role: 'screen' as const };
  t.search = { x: area.x, y: area.y };
  if (!center || distance(center, area) < PROSECUTE_MAX) t.station = { x: area.x, y: area.y };
  tasks.set(pick.id, t);
}

/** Team helicopter discipline: is another ship's helicopter already working near this point? */
export function heloCovered(w: World, s: Ship, p: Vec2): boolean {
  const plan = w.env.hunt?.[s.team as 'west' | 'east'];
  if (!plan) return false;
  return Object.entries(plan.helo).some(([id, h]) => id !== s.id && h.until > w.time && distance(h, p) < 4000);
}

export function commitHelo(w: World, s: Ship, p: Vec2, forS: number): void {
  const plan = w.env.hunt?.[s.team as 'west' | 'east'];
  if (plan) plan.helo[s.id] = { x: p.x, y: p.y, until: w.time + forS };
}

/** Heading to keep 3-5 km from the datum, circling it (director). */
export function directorCourse(s: Ship, d: Vec2, legSign: number): { heading: number; speedKn: number } {
  const r = distance(s.pos, d);
  const to = bearing(s.pos, d);
  if (r > 5000) return { heading: to, speedKn: r > 9000 ? 18 : 12 };
  if (r < 3000) return { heading: wrap360(to + 180 - 40 * legSign), speedKn: 10 };
  return { heading: wrap360(to + 90 * legSign), speedKn: 10 };
}

/** What a surface ship's crew sees of the team hunt over the datalink (datum, who directs, who attacks). */
export function huntFor(w: World, own: Ship): { datum?: { x: number; y: number; t: number; q: number }; director?: string; attacker?: string } | undefined {
  const plan = w.env.hunt?.[own.team as 'west' | 'east'];
  if (!plan || CLASSES[own.cls].submarine) return undefined;
  const d = plan.datum && w.time - plan.datum.t < DATUM_MAX_AGE ? plan.datum : undefined;
  const name = (id?: string) => w.ships.find((s) => s.id === id && s.alive)?.name;
  if (!d && !plan.director) return undefined;
  return {
    datum: d && { x: Math.round(d.x), y: Math.round(d.y), t: Math.round(d.t), q: Math.round(d.q) },
    director: name(plan.director), attacker: name(plan.attacker),
  };
}
