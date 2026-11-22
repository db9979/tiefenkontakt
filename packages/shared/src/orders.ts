import { CLASSES } from './classes.js';
import { BROADCAST_EVERY_S, BROADCAST_FIRST_S, broadcastAt } from './command-radio.js';
import { isConvoyShip, type Ship } from './entities.js';
import { KN, angleDiff, bearing, distance, headingVec, wrap360, type Vec2 } from './math.js';
import { Rng } from './rng.js';
import type { World } from './world.js';

/**
 * FLASH orders: fleet command issues one to three time-limited orders per side during a
 * match. Surface ships get them at once; submarines only with the fleet-command broadcast
 * (command-radio.ts), so a boat that misses a window reads the order 20 minutes late.
 * Every order has a deadline and a check; the result counts in the debrief and the points,
 * never for the match result itself.
 */

export type OrderKind = 'attack' | 'clear' | 'report' | 'sitrep' | 'turn' | 'search' | 'silence';
export type OrderSide = 'west' | 'east';
export type OrderStatus = 'active' | 'done' | 'missed';

export interface FlashOrder {
  id: string;
  team: OrderSide;
  kind: OrderKind;
  text: string;
  issuedAt: number;
  deadline: number;
  /** Boats: index of the broadcast that first carries the order. */
  k?: number;
  /** Area to clear or sector to search (world metres). */
  area?: { x: number; y: number; r: number };
  /** Convoy turn: the ordered course. */
  heading?: number;
  status: OrderStatus;
  doneAt?: number;
  /** When each ship of the side read the order. */
  readAt: Record<string, number>;
  /** Convoy turn: when the escort commander gave the order to the commodore. */
  executedAt?: number;
}

export interface OrdersState {
  plan: { at: number; team: OrderSide; kind: OrderKind; dur: number; issued?: boolean }[];
  orders: FlashOrder[];
  nextId: number;
  seed: number;
  /** Events already checked. */
  cursor: number;
  /** Latest broadcast each boat copied completely (a missed one doesn't count). */
  copied?: Record<string, number>;
}

/** What a player sees of an order (only once read aboard). */
export interface OrderView {
  id: string;
  kind: OrderKind;
  text: string;
  issuedAt: number;
  readAt: number;
  deadline: number;
  status: OrderStatus;
  area?: { x: number; y: number; r: number };
  heading?: number;
  /** Convoy turn waiting for the escort commander's execute. */
  canExecute?: boolean;
}

/** Debrief line per order. */
export interface OrderSummary {
  team: OrderSide;
  text: string;
  status: OrderStatus;
  issuedAt: number;
  deadline: number;
  /** Seconds the slowest ship of the side needed to read it (boats). */
  lateS?: number;
}

/** Points for the side per order: fulfilled / missed. */
export const ORDER_POINTS = { done: 10, missed: -5 } as const;
const CLEAR_R = 5000;
const SEARCH_R = 4000;
const TURN_DIVERT_S = 600;
const BOAT_ORDER_S = 2 * BROADCAST_EVERY_S;

const isBoat = (s: Ship) => CLASSES[s.cls].submarine;
/** Fighting ships of a side (no merchants, no neutrals). */
export function sideShips(w: World, team: OrderSide): Ship[] {
  return w.ships.filter((s) => s.alive && s.team === team && !isConvoyShip(s) && s.cls !== 'merchant');
}

/** Grid square of 5 km (columns A.., rows 1..), as fleet command names areas. */
export function gridRef(x: number, y: number): string {
  const col = Math.max(0, Math.min(25, Math.floor((x + 40_000) / 5000)));
  const row = Math.max(1, Math.floor((y + 10_000) / 5000) + 1);
  return `${String.fromCharCode(65 + col)}${row}`;
}

/** Ship's clock at sim time t, "HH:MM". */
export function clockAt(w: World, t: number): string {
  const base = w.env.weather?.clock ?? 12;
  const h = (((base + (t - w.time) / 3600) % 24) + 24) % 24;
  const m = Math.floor((h % 1) * 60);
  return `${String(Math.floor(h)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Order kinds that fit the mission for a side (boats or surface escorts). */
export function orderPool(mission: string, boats: boolean, convoy: boolean): OrderKind[] {
  if (boats) {
    if (mission === 'meerenge' || mission === 'aufklaerung') return ['sitrep', 'clear'];
    if (mission === 'fuehlung' || mission === 'duell' || !convoy) return ['report', 'sitrep', 'clear'];
    return ['attack', 'clear', 'report', 'sitrep'];
  }
  if (mission === 'meerenge' || !convoy || mission === 'hafen') return ['search', 'silence'];
  return ['turn', 'search', 'silence'];
}

/**
 * Plan the orders of a match: 1-3 per side. Boats' orders go out with a broadcast window
 * and run two windows long (a boat that misses one still has a chance); escorts' orders
 * come at any time and run 10-25 minutes (shorter in short matches). Drawn from a private generator (seeded by the
 * match), so the simulation's own random numbers are not disturbed.
 */
export function installOrders(w: World, limitS: number): OrdersState {
  const seed = ((w.env.seed ?? 1) * 7919 + 17) >>> 0;
  const rng = new Rng(seed);
  const mission = w.env.mission ?? 'groenland';
  const convoy = w.ships.some(isConvoyShip);
  const plan: OrdersState['plan'] = [];
  for (const team of ['west', 'east'] as const) {
    const ships = sideShips(w, team);
    if (!ships.length) continue;
    const boats = ships.every(isBoat);
    const pool = [...orderPool(mission, boats, convoy)];
    const n = 1 + Math.floor(rng.next() * 3);
    const times: number[] = [];
    // Short matches: shorter orders (boats keep at least one window and a bit)
    const scale = Math.min(1, limitS / 7200);
    if (boats) {
      const ks: number[] = [];
      for (let k = 0; BROADCAST_FIRST_S + k * BROADCAST_EVERY_S + 900 <= limitS - 60; k++) ks.push(k);
      while (ks.length && times.length < n) times.push(BROADCAST_FIRST_S + ks.splice(Math.floor(rng.next() * ks.length), 1)[0]! * BROADCAST_EVERY_S);
    } else {
      const lo = 900 * scale;
      const hi = limitS - 1560 * scale;
      for (let i = 0; i < n && hi > lo; i++) times.push(Math.round(lo + ((hi - lo) * (i + rng.next())) / n));
    }
    for (const at of times.sort((a, b) => a - b)) {
      if (!pool.length) break;
      const kind = pool.splice(Math.floor(rng.next() * pool.length), 1)[0]!;
      const dur = boats ? Math.min(BOAT_ORDER_S, limitS - 60 - at) : Math.round((kind === 'turn' ? 600 : kind === 'silence' ? 1200 : 1500) * scale);
      plan.push({ at, team, kind, dur });
    }
  }
  w.env.orders = { plan, orders: [], nextId: 1, seed, cursor: w.events.length };
  return w.env.orders;
}

function convoyCenter(w: World): Vec2 | undefined {
  const m = w.ships.filter((s) => isConvoyShip(s) && s.alive);
  if (!m.length) return undefined;
  return { x: m.reduce((a, s) => a + s.pos.x, 0) / m.length, y: m.reduce((a, s) => a + s.pos.y, 0) / m.length };
}

function mean(ps: Vec2[]): Vec2 {
  return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
}

/** Make the concrete order from the plan entry and what command knows now. */
function issue(w: World, st: OrdersState, p: OrdersState['plan'][number]): FlashOrder | undefined {
  const rng = new Rng(st.seed + st.nextId * 101);
  const own = sideShips(w, p.team);
  const enemy = sideShips(w, p.team === 'west' ? 'east' : 'west');
  if (!own.length) return undefined;
  const deadline = w.time + p.dur;
  const until = clockAt(w, deadline);
  const o: FlashOrder = { id: `F${st.nextId++}`, team: p.team, kind: p.kind, text: '', issuedAt: w.time, deadline, status: 'active', readAt: {} };
  if (own.every(isBoat)) o.k = Math.floor((w.time + 1 - BROADCAST_FIRST_S) / BROADCAST_EVERY_S);
  const center = convoyCenter(w);
  switch (p.kind) {
    case 'attack':
      o.text = `KONVOI BIS ${until} ANGREIFEN`;
      break;
    case 'report':
      o.text = `FEINDMELDUNG BIS ${until} ABSETZEN`;
      break;
    case 'sitrep':
      o.text = `AUF SEHROHRTIEFE GEHEN UND BIS ${until} LAGEBERICHT SENDEN`;
      break;
    case 'clear': {
      // Own minefield or air strike near the pack's patrol area: may or may not hold a boat
      const c = mean(own.map((s) => s.pos));
      o.area = { x: Math.round(c.x + rng.gauss(0, 4000)), y: Math.round(c.y + rng.gauss(0, 4000)), r: CLEAR_R };
      o.text = `GEBIET UM PLANQUADRAT ${gridRef(o.area.x, o.area.y)} (${CLEAR_R / 1000} KM) BIS ${until} RÄUMEN`;
      break;
    }
    case 'turn': {
      if (!w.convoy || !center) return undefined;
      // Away from the side where command suspects the boats (its intelligence is right half the time)
      const base = w.convoy.guideHeading;
      const threat = enemy.length && rng.next() < 0.5 ? bearing(center, mean(enemy.map((s) => s.pos))) : base + (rng.next() < 0.5 ? 90 : -90);
      o.heading = Math.round(wrap360(base + (angleDiff(base, threat) > 0 ? -40 : 40)));
      o.text = `KONVOI BIS ${until} AUF KURS ${String(o.heading).padStart(3, '0')} DREHEN`;
      break;
    }
    case 'search': {
      // A long-range lead (SOSUS, intercept) near a boat, or the route ahead of the convoy
      const lead = enemy.length && rng.next() < 0.35 ? enemy[Math.floor(rng.next() * enemy.length)]!.pos : undefined;
      const ahead = center && w.convoy ? headingVec(w.convoy.guideHeading + rng.gauss(0, 30)) : headingVec(rng.next() * 360);
      const from = center ?? mean(own.map((s) => s.pos));
      const c = lead ? { x: lead.x + rng.gauss(0, 4000), y: lead.y + rng.gauss(0, 4000) } : { x: from.x + ahead.x * 10_000, y: from.y + ahead.y * 10_000 };
      o.area = { x: Math.round(c.x), y: Math.round(c.y), r: SEARCH_R };
      o.text = `SEKTOR UM PLANQUADRAT ${gridRef(o.area.x, o.area.y)} (${SEARCH_R / 1000} KM) BIS ${until} ABSUCHEN`;
      break;
    }
    case 'silence':
      o.text = `FUNKSTILLE BIS ${until}`;
      break;
  }
  return o;
}

/** Escort commander passes the convoy turn to the commodore: a diversion leg on the ordered course. */
export function executeOrder(w: World, s: Ship, id: string): true | string {
  const o = w.env.orders?.orders.find((x) => x.id === id);
  if (!o || o.team !== s.team || o.readAt[s.id] === undefined) return 'Kein solcher Befehl';
  if (o.kind !== 'turn' || o.heading === undefined) return 'Dieser Befehl braucht keine Ausführung';
  if (o.executedAt !== undefined || o.status !== 'active') return 'Befehl ist bereits ausgeführt';
  const c = w.convoy;
  if (!c) return 'Kein Konvoi';
  const v = headingVec(o.heading);
  const leg = c.baseSpeedKn * KN * TURN_DIVERT_S;
  c.waypoints.splice(c.wpIndex, 0, { x: c.guide.x + v.x * leg, y: c.guide.y + v.y * leg });
  o.executedAt = w.time;
  return true;
}

function finish(w: World, o: FlashOrder, status: 'done' | 'missed'): void {
  o.status = status;
  o.doneAt = w.time;
  for (const id of Object.keys(o.readAt)) {
    w.events.push({ kind: 'flash', time: w.time, shipId: id, orderId: o.id, text: `FÜHRUNG: BEFEHL ${status === 'done' ? 'ERFÜLLT' : 'NICHT ERFÜLLT'} · ${o.text}`, status });
  }
}

/** A boat that radioed while holding a fresh track on an enemy (an enemy report). */
function enemyReport(w: World, sender: Ship, t: number): boolean {
  const enemies = new Set(w.ships.filter((x) => x.team !== sender.team && x.team !== 'neutral').map((x) => x.id));
  return !!w.books.get(sender.id)?.entries().some(([id, tr]) => enemies.has(id) && t - tr.lastSeen < 120);
}

function check(w: World, o: FlashOrder, fresh: World['events']): void {
  const mine = (id: string | undefined) => !!id && w.ships.some((s) => s.id === id && s.team === o.team);
  for (const e of fresh) {
    if (e.time < o.issuedAt) continue;
    if (o.kind === 'attack' && ((e.kind === 'weapon' && e.what === 'torpedo' && mine(e.sourceId)) || (e.kind === 'sunk' && mine(e.byId)))) return finish(w, o, 'done');
    if (e.kind === 'transmission' || e.kind === 'teamradio') {
      if (!mine(e.senderId)) continue;
      if (o.kind === 'silence') return finish(w, o, 'missed');
      if (e.kind !== 'transmission') continue;
      if (o.kind === 'sitrep') return finish(w, o, 'done');
      const sender = w.ships.find((s) => s.id === e.senderId)!;
      if (o.kind === 'report' && enemyReport(w, sender, e.time)) return finish(w, o, 'done');
    }
  }
  const area = o.area;
  if (o.kind === 'turn' && o.executedAt !== undefined) return finish(w, o, 'done');
  if (o.kind === 'search' && area) {
    const inside = (p: Vec2) => distance(p, area) <= area.r;
    const air = w.air;
    const byShip = sideShips(w, o.team).some((s) => inside(s.pos));
    const byAir = !!air && (air.buoys.some((b) => mine(b.ownerId) && inside(b.pos)) ||
      air.sorties.some((x) => x.kind === 'dip' && mine(x.shipId) && w.time >= x.dropAt && w.time < (x.hoverUntil ?? 0) && inside(x.target)));
    if (byShip || byAir) return finish(w, o, 'done');
  }
  if (w.time < o.deadline) return;
  if (o.kind === 'silence') return finish(w, o, 'done');
  if (o.kind === 'clear' && area) return finish(w, o, sideShips(w, o.team).some((s) => distance(s.pos, area) < area.r) ? 'missed' : 'done');
  finish(w, o, 'missed');
}

/** Once a second: issue due orders, deliver them (boats via the broadcast), check them. */
export function stepOrders(w: World, dt: number): void {
  const st = w.env.orders;
  if (!st || Math.floor(w.time) === Math.floor(w.time - dt)) return;
  for (const p of st.plan) {
    if (p.issued || w.time < p.at) continue;
    p.issued = true;
    const o = issue(w, st, p);
    if (o) st.orders.push(o);
  }
  const fresh = w.events.slice(st.cursor);
  st.cursor = w.events.length;
  const copied = (st.copied ??= {});
  for (const e of fresh) if (e.kind === 'boat' && e.what === 'command') copied[e.shipId] = broadcastAt(e.time) ?? copied[e.shipId] ?? -1;
  for (const o of st.orders) {
    for (const s of sideShips(w, o.team)) {
      if (o.readAt[s.id] !== undefined) continue;
      // Surface ships at once; boats when they copy this or a later broadcast
      if (isBoat(s) && (o.k === undefined || (copied[s.id] ?? -1) < o.k)) continue;
      o.readAt[s.id] = w.time;
      const late = o.status !== 'active' ? ` · ${o.status === 'done' ? 'BEREITS ERFÜLLT' : 'FRIST ABGELAUFEN'}` : '';
      w.events.push({ kind: 'flash', time: w.time, shipId: s.id, orderId: o.id, text: `FLASH · FÜHRUNG: ${o.text}${late}` });
    }
  }
  for (const o of st.orders) if (o.status === 'active') check(w, o, fresh);
}

/** Orders read aboard this ship, for its snapshot. */
export function ordersFor(w: World, s: Ship): OrderView[] | undefined {
  const st = w.env.orders;
  if (!st) return undefined;
  return st.orders.filter((o) => o.team === s.team && o.readAt[s.id] !== undefined).map((o) => ({
    id: o.id, kind: o.kind, text: o.text, issuedAt: o.issuedAt, readAt: o.readAt[s.id]!, deadline: o.deadline, status: o.status,
    area: o.area, heading: o.heading, canExecute: o.kind === 'turn' && o.status === 'active' && o.executedAt === undefined ? true : undefined,
  }));
}

/** All orders for the debrief, and the points each side earned with them. */
export function orderResults(w: World): { list: OrderSummary[]; points: Record<OrderSide, number> } {
  const points = { west: 0, east: 0 };
  const list = (w.env.orders?.orders ?? []).map((o) => {
    if (o.status !== 'active') points[o.team] += ORDER_POINTS[o.status];
    const reads = Object.values(o.readAt);
    return { team: o.team, text: o.text, status: o.status, issuedAt: Math.round(o.issuedAt), deadline: Math.round(o.deadline),
      lateS: reads.length ? Math.round(Math.max(...reads) - o.issuedAt) : undefined };
  });
  return { list, points };
}

/** The active orders a side has read (any ship), for the AI captains. */
export function activeOrders(w: World, s: Ship): FlashOrder[] {
  return (w.env.orders?.orders ?? []).filter((o) => o.team === s.team && o.status === 'active' && o.readAt[s.id] !== undefined);
}

/** AI escorts' shared hunt of one side (kept in the world so the plot can show the datum). */
export interface HuntPlan {
  /** Best fix of the team on a submarine: where, when, quality 0..100, who made it. */
  datum?: { x: number; y: number; t: number; q: number; by: string };
  /** Hunter-killer roles: the director keeps contact, the attacker closes silently. */
  director?: string;
  attacker?: string;
  rolesAt: number;
  /** Ships that left the screen to prosecute. */
  hunters: string[];
  /** Helicopter commitments per ship: where and until when. */
  helo: Record<string, { x: number; y: number; until: number }>;
  /** Last patrol aircraft call. */
  mpaAt?: number;
  /** Last role each ship announced on team radio. */
  said: Record<string, string>;
  saidAt?: Record<string, number>;
}
