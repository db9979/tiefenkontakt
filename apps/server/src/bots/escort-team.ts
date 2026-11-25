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
  type EscortCmd,
  type EscortCmdKind,
  hasHelicopter,
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
  /** A datum this ship prosecutes instead of the team datum (commander's order, heard torpedo launch). */
  datum?: Vec2;
  /** Send the helicopter here (commander's order, pounce on a far datum); the ship keeps its task. */
  helo?: Vec2;
  /** The escort commander's order this task follows. */
  ordered?: EscortCmdKind;
}

/** Roles hold at least this long (no flapping; also gives the boat a chance between attacks). */
export const ROLE_HOLD_S = 300;
const DATUM_MAX_AGE = 900;
const PROSECUTE_MAX = 16_000;
/** Close screen around the convoy (m) and the towed-array ships' outer screen on the threat axis. */
export const CLOSE_SCREEN_R = 5500;
export const OUTER_SCREEN_R = 9500;
/** The helicopter pounces on a datum out to about this far from the convoy while the ships stay (m). */
export const HELO_POUNCE_R = 15_000;
/** Heard torpedo launch: guessed range down the heard bearing (m) and the datum's error radius (m). */
export const HEARD_RANGE: [number, number] = [6000, 8000];
export const HEARD_ERR: [number, number] = [1500, 2000];
/** A heard datum is prosecuted this long (s). */
const HEARD_HOLD_S = 600;
/** Commander's datum: searched this long after the ship got there, and given up after this long (s). */
const CMD_DATUM_SEARCH_S = 600;
const CMD_DATUM_MAX_S = 1800;
const CMD_HELO_MAX_S = 900;
/** A ship with a long towed array (m) stands on the outer screen. */
const LONG_ARRAY_M = 1000;

const isHuman = (s: Ship) => s.id.startsWith('p_') && !s.id.startsWith('p_bot-');

function isSub(t: ContactTrack, m?: BotMemory): boolean {
  const c = m ? votedPeek(m, t) : t.classified ? (CLASSES[t.classified]?.submarine ? 'submarine' : 'other') : classify(t);
  return c === 'submarine';
}

/** A mast or snorkel painted by an own aircraft's radar (a radar fix measured away from the ship). */
const airFix = (h: ContactTrack['history'][number]) => h.sensor === 'radar' && h.ox !== undefined && h.r !== undefined;

/** Datum candidates from one escort's book: echoes and MAD (good), aircraft radar fixes, buoy cross-fixes, TMA. */
function candidates(w: World, s: Ship, m: BotMemory | undefined): { p: Vec2; t: number; q: number }[] {
  const out: { p: Vec2; t: number; q: number }[] = [];
  const now = w.time;
  for (const t of w.books.get(s.id)?.tracks() ?? []) {
    if (now - t.lastSeen > 120 || t.sensors.includes('esm') || isFriendly(w, s, t, m)) continue;
    // An aircraft that paints a snorkel or periscope has seen a boat: a datum about 1 km off
    const air = [...t.history].reverse().find((h) => airFix(h) && now - h.t < 120);
    if (air) {
      const v = headingVec(air.b);
      out.push({ p: { x: air.ox! + v.x * air.r!, y: air.oy! + v.y * air.r! }, t: air.t, q: 70 });
    }
    if (!isSub(t, m)) continue;
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
  // A heard torpedo launch: a rough datum down the heard bearing (below echoes and cross-fixes)
  const h = plan.heard;
  if (h && now - h.t < HEARD_HOLD_S) consider(h, h.t, 50, h.victim ?? 'heard');
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

/** Close-screen stations around the convoy (5–6 km), spread about the threat axis (or ahead). */
function stations(center: Vec2, axis: number, n: number, r = CLOSE_SCREEN_R): Vec2[] {
  const spread = n <= 1 ? [0] : n === 2 ? [-50, 50] : n === 3 ? [-55, 0, 55] : [-80, -30, 30, 80];
  return spread.slice(0, n).map((a) => {
    const v = headingVec(axis + a);
    return { x: center.x + v.x * r, y: center.y + v.y * r };
  });
}

/** Outer-screen stations of the towed-array ships: 9–10 km out on the threat axis, a little spread. */
function outerStations(center: Vec2, axis: number, n: number): Vec2[] {
  const spread = n <= 1 ? [0] : n === 2 ? [-20, 20] : [-30, 0, 30];
  return spread.slice(0, n).map((a) => {
    const v = headingVec(axis + a);
    return { x: center.x + v.x * OUTER_SCREEN_R, y: center.y + v.y * OUTER_SCREEN_R };
  });
}

const longArray = (s: Ship) => (CLASSES[s.cls].towed?.maxLength ?? 0) >= LONG_ARRAY_M;

/**
 * Screen layout: one ship always on the close screen (5–6 km); the other long-array ships take
 * the outer screen (9–10 km on the threat axis, or ahead), the rest the close screen. Around an
 * anchorage (no convoy under way) everyone stays on the close screen.
 */
export function screenStations(center: Vec2, axis: number, ships: Ship[], outerScreen = true): Map<string, Vec2> {
  const out = new Map<string, Vec2>();
  if (!ships.length) return out;
  const sorted = [...ships].sort((a, b) => a.id.localeCompare(b.id));
  // The close screen keeps at least one ship: the shortest array (or the first) stays in
  const keeper = [...sorted].sort((a, b) => Number(longArray(a)) - Number(longArray(b)))[0]!;
  const outer = sorted.filter((s) => outerScreen && s !== keeper && longArray(s)).slice(0, 3);
  const close = sorted.filter((s) => !outer.includes(s));
  const assign = (group: Ship[], pts: Vec2[]) => {
    const free = [...pts];
    for (const s of group) {
      const i = free.reduce((bi, p, j) => (distance(s.pos, p) < distance(s.pos, free[bi]!) ? j : bi), 0);
      out.set(s.id, free.splice(i, 1)[0]!);
    }
  };
  assign(close, stations(center, axis, close.length));
  assign(outer, outerStations(center, axis, outer.length));
  return out;
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
  // Ships under the escort commander's order (other than "helicopter there") leave the planner's hands
  expireCommands(w, plan, ai, center);
  const cmds = plan.cmds ?? {};
  const free = ai.filter((s) => !cmds[s.id] || cmds[s.id]!.kind === 'helo');
  const stationed = ai.some((s) => cmds[s.id]?.kind === 'station');

  // Who prosecutes: ships holding their own fresh contact, or close to the datum
  const holds = (s: Ship) => lines(w, s, mems.get(s.id)).length > 0 || candidates(w, s, mems.get(s.id)).some((c) => now - c.t < 60);
  const led = (s: Ship) => { const l = mems.get(s.id)?.lead; return !!l && now - l.t < 900; };
  const near = (s: Ship) => (center ? distance(s.pos, center) < PROSECUTE_MAX : true);
  const close = datumOk && (!center || distance(center, d!) < 12_000);
  // Screen discipline: one escort always stays on the screen (a ship on a commanded station counts);
  // a datum inside the close screen itself may take both of two (hunting it there is screening)
  const n = free.length;
  const inner = datumOk && !!center && distance(center, d!) < CLOSE_SCREEN_R + 1500;
  const max = !center || stationed ? n : n >= 3 ? n - 1 : inner ? n : Math.min(1, n);
  const key = (s: Ship) => (datumOk ? distance(s.pos, d!) : Number(!holds(s)));
  // The ship a heard torpedo runs at evades: she doesn't prosecute
  const evading = plan.heard && now - plan.heard.t < 180 ? plan.heard.victim : undefined;
  let hunters = free.filter((s) => s.id !== evading && near(s) && (holds(s) || led(s) || (datumOk && (distance(s.pos, d!) < 6000 || plan.hunters.includes(s.id)))))
    .sort((a, b) => key(a) - key(b)).slice(0, max);
  // A good datum close to the convoy but only one ship on it: the nearest free escort joins the hunt
  if (hunters.length === 1 && max >= 2 && close) {
    const extra = free.filter((s) => !hunters.includes(s) && s.id !== evading).sort((a, b) => distance(a.pos, d!) - distance(b.pos, d!))[0];
    if (extra && distance(extra.pos, d!) < 12_000) hunters = [...hunters, extra];
  }
  // A torpedo launch heard: the threatened ship evades, another escort prosecutes the heard datum
  const heard = plan.heard && now - plan.heard.t < HEARD_HOLD_S ? plan.heard : undefined;
  let heardBy: Ship | undefined;
  if (heard && !hunters.some((s) => s.id !== heard.victim && distance(s.pos, heard) < 12_000)) {
    heardBy = free.filter((s) => s.id !== heard.victim && !hunters.includes(s) && now >= (mems.get(s.id)?.evadeUntil ?? 0))
      .sort((a, b) => distance(a.pos, heard) - distance(b.pos, heard))[0];
    // Never strip the screen bare: one ship stays unless another escort (human, commanded) holds it
    const room = !center || stationed || escorts.length > n ? n : n - 1;
    if (heardBy && (hunters.length + 1 > room || distance(heardBy.pos, heard) > PROSECUTE_MAX)) heardBy = undefined;
    if (heardBy) hunters = [...hunters, heardBy];
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
    if (s === heardBy && role === 'hunter') {
      tasks.set(s.id, { role, datum: { x: heard!.x, y: heard!.y } });
      say(w, plan, s, 'heard', `TORPEDOABSCHUSS GEHÖRT · VERFOLGE DATUM ${gridRef(heard!.x, heard!.y)}`);
      continue;
    }
    tasks.set(s.id, { role });
    say(w, plan, s, role, role === 'director' ? `HALTE KONTAKT · DATUM ${grid} · AKTIV` : role === 'attacker' ? `ÜBERNEHME ANGRIFF · DATUM ${grid} · LAUTLOS` : `VERFOLGE U-BOOT-KONTAKT · DATUM ${grid}`);
  }

  // Screen: the others take stations on the threat axis (or ahead): one close, long arrays outside
  const screens = free.filter((s) => !tasks.has(s.id));
  if (center && screens.length) {
    const ahead = w.convoy?.guideHeading ?? 0;
    const threat = d && now - d.t < DATUM_MAX_AGE ? bearing(center, d) : undefined;
    const st = screenStations(center, threat ?? ahead, screens, !!w.convoy);
    // In mine water one screen sweeps the track close ahead with its mine-avoidance sonar (the
    // barrage-laying boat is ahead on the track too)
    const sweep = sweepStation(w, center);
    const sweeper = sweep ? [...screens].sort((a, b) => distance(a.pos, sweep) - distance(b.pos, sweep))[0] : undefined;
    for (const s of screens) {
      tasks.set(s.id, { role: 'screen', station: s === sweeper ? sweep : st.get(s.id) });
      if (plan.said[s.id] && plan.said[s.id] !== 'screen') say(w, plan, s, 'screen', 'ZURÜCK IN DIE SICHERUNG');
      else plan.said[s.id] ??= 'screen';
    }
    // The helicopter pounces on a datum too far out for a ship to leave the screen
    const far = d && now - d.t < 600 && distance(center, d) > 10_000 && distance(center, d) < HELO_POUNCE_R + 3000 ? d : undefined;
    const helo = far && !hunters.length && w.convoy ? screens.filter((s) => hasHelicopter(s.cls)).sort((a, b) => distance(a.pos, far) - distance(b.pos, far))[0] : undefined;
    if (helo) tasks.get(helo.id)!.helo = { x: far!.x, y: far!.y };
  }
  // A helicopter (of a ship that stays, or the hunter's own) goes for the heard datum
  if (heard && now - heard.t < 300) {
    const carrier = free.filter((s) => hasHelicopter(s.cls) && s.id !== heard.victim && !tasks.get(s.id)?.helo)
      .sort((a, b) => distance(a.pos, heard) - distance(b.pos, heard))[0];
    if (carrier && distance(carrier.pos, heard) < 30_000) {
      const t = tasks.get(carrier.id) ?? { role: 'screen' as const };
      t.helo = { x: heard.x, y: heard.y };
      tasks.set(carrier.id, t);
    }
  }
  obeyEscortOrders(w, team, free, tasks, center);
  obeyCommander(w, plan, ai, tasks, center);
  plan.roles = Object.fromEntries([...tasks].map(([id, t]) => [id, t.ordered ?? t.role]));
  leadDetour(w, team, ai);
  return tasks;
}

/**
 * A torpedo is running at one of the side's surface ships: put a datum where the launch was
 * heard. The freshest launch transient an AI escort heard (bearing line from where it heard it)
 * or else the alerted ship's own bearing to the running torpedo, with a guessed range of 6–8 km
 * down that bearing: the datum's error is 1.5–2 km and it never uses the true launch position.
 */
export function heardLaunchDatum(w: World, victim: Ship, alertBearing: number, mems: Map<string, BotMemory>): void {
  const team = victim.team as 'west' | 'east';
  const own = w.ships.filter((s) => s.alive && s.team === team && isEscort(s.cls) && mems.has(s.id));
  if (!own.length) return;
  const plan = ((w.env.hunt ??= {})[team] ??= { rolesAt: -1e9, hunters: [], helo: {}, said: {} });
  const now = w.time;
  // One datum per salvo: the alerts of the other torpedoes and ships don't move it again
  if (plan.heard && now - plan.heard.t < 60) return;
  const line = own.map((s) => mems.get(s.id)!.launchHeard).filter((l): l is NonNullable<typeof l> => !!l && now - l.t < 180).sort((a, b) => b.t - a.t)[0]
    ?? { x: victim.pos.x, y: victim.pos.y, b: alertBearing, t: now };
  const r = HEARD_RANGE[0] + w.rng.next() * (HEARD_RANGE[1] - HEARD_RANGE[0]);
  const v = headingVec(line.b);
  plan.heard = { x: line.x + v.x * r, y: line.y + v.y * r, t: now, err: Math.round(HEARD_ERR[0] + w.rng.next() * (HEARD_ERR[1] - HEARD_ERR[0])), victim: victim.id };
}

/** Where a commanded station lies now: bearing relative to the convoy's course and range from its centre. */
export function cmdStation(w: World, c: EscortCmd, center: Vec2): Vec2 {
  const v = headingVec((w.convoy?.guideHeading ?? 0) + (c.rel ?? 0));
  return { x: center.x + v.x * (c.r ?? CLOSE_SCREEN_R), y: center.y + v.y * (c.r ?? CLOSE_SCREEN_R) };
}

/**
 * Orders that are done or void: the ship is gone, a datum searched for ten minutes after she got
 * there (or given up after half an hour), the helicopter committed where it was sent.
 */
function expireCommands(w: World, plan: HuntPlan, ai: Ship[], center?: Vec2): void {
  const cmds = plan.cmds;
  if (!cmds) return;
  const now = w.time;
  for (const [id, c] of Object.entries(cmds)) {
    const s = ai.find((x) => x.id === id);
    if (!s || (c.kind === 'station' && !center)) {
      delete cmds[id];
      continue;
    }
    const p = { x: c.x ?? s.pos.x, y: c.y ?? s.pos.y };
    if (c.kind === 'datum') {
      if (c.reachedAt === undefined && distance(s.pos, p) < 2000) c.reachedAt = now;
      if ((c.reachedAt !== undefined && now - c.reachedAt > CMD_DATUM_SEARCH_S) || now - c.at > CMD_DATUM_MAX_S) {
        delete cmds[id];
        say(w, plan, s, 'cmd-done', `DATUM ${gridRef(p.x, p.y)} ABGESUCHT · ZURÜCK IN DIE SICHERUNG`);
      }
    } else if (c.kind === 'helo') {
      // Done once the helicopter is committed there after the order (the team helicopter API)
      const h = plan.helo[id];
      const committed = !!h && h.until > now && distance(h, p) < 1500 && (plan.heloAt?.[id] ?? -1e9) >= c.at;
      if (committed || now - c.at > CMD_HELO_MAX_S) delete cmds[id];
    }
  }
}

/**
 * The escort commander's orders: station (moves with the convoy), sector (patrol it, the
 * helicopter dips it), datum (prosecute it) and "helicopter there" (the ship keeps her task).
 * Honoured until cancelled or done (expireCommands).
 */
function obeyCommander(w: World, plan: HuntPlan, ai: Ship[], tasks: Map<string, EscortTask>, center?: Vec2): void {
  for (const [id, c] of Object.entries(plan.cmds ?? {})) {
    const s = ai.find((x) => x.id === id);
    if (!s) continue;
    const p = { x: c.x ?? s.pos.x, y: c.y ?? s.pos.y };
    if (c.kind === 'station' && center) tasks.set(id, { role: 'screen', station: cmdStation(w, c, center), ordered: 'station' });
    else if (c.kind === 'sector') tasks.set(id, { role: 'screen', station: p, search: p, ordered: 'sector' });
    else if (c.kind === 'datum') tasks.set(id, { role: 'hunter', datum: p, ordered: 'datum' });
    else if (c.kind === 'helo') {
      const t = tasks.get(id) ?? { role: 'screen' as const };
      t.helo = p;
      t.ordered = 'helo';
      tasks.set(id, t);
    }
  }
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
  if (plan && Object.entries(plan.helo).some(([id, h]) => id !== s.id && h.until > w.time && distance(h, p) < 4000)) return true;
  // Or another ship's helicopter (AI or human crew) is airborne with its current task there
  return Object.values(w.air?.helos ?? {}).some((h) => {
    const t = h.queue[0];
    const mate = w.ships.find((x) => x.id === h.shipId);
    return h.shipId !== s.id && mate?.team === s.team && h.state === 'air' && !!t && t.kind !== 'return' && distance(t, p) < 4000;
  });
}

export function commitHelo(w: World, s: Ship, p: Vec2, forS: number): void {
  const plan = w.env.hunt?.[s.team as 'west' | 'east'];
  if (!plan) return;
  plan.helo[s.id] = { x: p.x, y: p.y, until: w.time + forS };
  (plan.heloAt ??= {})[s.id] = w.time;
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
