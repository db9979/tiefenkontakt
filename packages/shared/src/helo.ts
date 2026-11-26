import { HELO_RANGE, HELO_SPEED, DIP_HOVER_S, DIP_PING_S, MAD_PATTERN_S, aircraftPosition, cloverleaf, dipPing, layBuoy, madLook, madReport } from './aviation.js';
import { hasHelicopter } from './classes.js';
import type { Ship } from './entities.js';
import { havenBlocks } from './haven.js';
import { bearing, clamp, distance, headingVec, type Vec2 } from './math.js';
import { depthAt } from './seabed.js';
import { dropLightweight, lightSearchDepths } from './weapons.js';
import { bookFor, type World } from './world.js';

/**
 * The ship's helicopter (C11): one airframe per ship, airborne with a task queue the crew edits
 * at any time. About 90 minutes of fuel, then 10 minutes on deck to refuel and rearm (12 buoys,
 * 2 lightweight torpedoes per load, from the ship's magazine). Tasks: lay a buoy line, dip
 * (hover and ping, then move on in the search direction), MAD run, attack the latest fix, return.
 */

export const HELO_ENDURANCE_S = 90 * 60;
export const HELO_REFUEL_S = 600;
/** Launch preparation once a task is queued and the helicopter is ready: spot, spread rotors, start engines, run-up. */
export const HELO_LAUNCH_PREP_S = 120;
export const HELO_BUOYS = 12;
export const HELO_TORPS = 2;
/** Next dip this far on in the search direction (3–5 km). */
export const DIP_STEP_M = 4000;
/** Attack: from a dip contact (dome down) to the torpedo in the water. */
export const ATTACK_FROM_DIP_S = 60;
/** Raising the dome before the helicopter can move off. */
const DOME_UP_S = 20;
/** Fuel kept for the way home on top of the flight time. */
const BINGO_RESERVE_S = 300;
const QUEUE_MAX = 8;
const FIX_MAX_AGE_S = 180;

export type HeloTaskKind = 'dip' | 'buoys' | 'mad' | 'attack' | 'return';

export interface HeloTask {
  id: number;
  kind: HeloTaskKind;
  /** dip: the current dip point; buoys: centre of the line; mad: datum; attack: aim (latest fix). */
  x: number;
  y: number;
  /** dip: search direction; buoys: direction the line runs. */
  axis?: number;
  /** dip: number of dips; buoys: number of buoys. */
  count?: number;
  /** buoys: spacing (m). */
  spacing?: number;
  /** buoys: DICASS (active) buoys. */
  active?: boolean;
  /** Single buoy from an older order: above (false) or below (true) the layer. */
  deep?: boolean;
  /** Contact label in the owner's book whose latest fix the task follows (attack, mad). */
  track?: string;
  /** attack: aim offset (AI aim error). */
  off?: Vec2;
  /** Progress: dips done / buoys laid; work phase (hover, MAD pattern) and its end. */
  step?: number;
  phase?: 'work';
  from?: number;
  until?: number;
  lastPing?: number;
  pings?: number;
  /** dip: echo from this dip (where the contact is). */
  echo?: Vec2;
  /** buoys: lay the line from its far end. */
  reverse?: boolean;
  /** attack: torpedo not before this time; fix time aimed at. */
  notBefore?: number;
  fixT?: number;
  madHit?: boolean;
}

export interface Helo {
  shipId: string;
  state: 'deck' | 'air';
  x: number;
  y: number;
  heading: number;
  /** Seconds of flight left. */
  fuel: number;
  /** On deck: refuelled and rearmed at this time. */
  readyAt: number;
  launchAt: number;
  /** On deck with a task: airborne at this time (launch preparation running). */
  prepUntil?: number;
  buoys: number;
  torps: number;
  queue: HeloTask[];
  nextTask: number;
  /** Dome in the water this tick (dip hover). */
  dipping?: boolean;
  /** Latest echo of the own dipping sonar. */
  fix?: { x: number; y: number; t: number };
}

/** An order to the helicopter: what and where (task fields are filled in from it). */
export interface HeloOrder {
  kind: HeloTaskKind;
  at?: Vec2;
  axis?: number;
  count?: number;
  spacing?: number;
  active?: boolean;
  deep?: boolean;
  track?: string;
  off?: Vec2;
}

export function newHelo(ship: Ship, buoys: number, torps: number): Helo {
  return { shipId: ship.id, state: 'deck', x: ship.pos.x, y: ship.pos.y, heading: ship.heading, fuel: HELO_ENDURANCE_S, readyAt: 0, launchAt: 0, buoys, torps, queue: [], nextTask: 1 };
}

export function heloOf(w: World, shipId: string): Helo | undefined {
  if (!w.air) return undefined;
  migrateHelos(w);
  return w.air.helos?.[shipId];
}

/**
 * Older saves flew one sortie per task (kind undefined = buoy) and kept every buoy and torpedo
 * in the ship's stock. Turn each ship's sortie into the airborne helicopter with that task still
 * to do (then home), or into the helicopter on deck finishing its turnaround.
 */
export function migrateHelos(w: World): void {
  const air = w.air;
  if (!air) return;
  const old = air.sorties.filter((s) => s.kind !== 'mpa');
  if (air.helos && !old.length) return;
  air.helos ??= {};
  air.heloTorps ??= new Map();
  for (const ship of w.ships) {
    if (!hasHelicopter(ship.cls) || air.helos[ship.id]) continue;
    const stock = air.stock.get(ship.id) ?? 0;
    const torps = air.heloTorps.get(ship.id) ?? 0;
    const h = newHelo(ship, Math.min(HELO_BUOYS, stock), Math.min(HELO_TORPS, torps));
    air.stock.set(ship.id, stock - h.buoys);
    air.heloTorps.set(ship.id, torps - h.torps);
    air.helos[ship.id] = h;
    const s = old.find((x) => x.shipId === ship.id && w.time < x.readyAt);
    if (!s) continue;
    if (w.time >= s.landAt) {
      h.readyAt = s.readyAt;
      continue;
    }
    const p = aircraftPosition(s, w.time, ship) ?? ship.pos;
    Object.assign(h, { state: 'air', x: p.x, y: p.y, launchAt: s.launchAt, fuel: HELO_ENDURANCE_S - (w.time - s.launchAt) });
    const kind = s.kind ?? 'buoy';
    const at = { x: s.target.x, y: s.target.y };
    const task = (o: HeloOrder) => h.queue.push(makeTask(h, ship, o));
    if (!s.dropped) {
      // The buoy or torpedo of this sortie was already taken from the stock: it is aboard
      if (kind === 'buoy') { h.buoys++; task({ kind: 'buoys', at, count: 1, active: s.active }); }
      else if (kind === 'torpedo') { h.torps++; task({ kind: 'attack', at }); }
      else if (kind === 'dip' || kind === 'mad') task({ kind, at, count: 1 });
    } else if ((kind === 'dip' || kind === 'mad') && s.hoverUntil !== undefined && w.time < s.hoverUntil) {
      task({ kind, at, count: 1 });
      Object.assign(h.queue[0]!, { phase: 'work', from: s.dropAt, until: s.hoverUntil, lastPing: s.lastPing ?? -1e9, madHit: s.madHit });
    }
    task({ kind: 'return' });
  }
  air.sorties = air.sorties.filter((s) => s.kind === 'mpa');
}

function makeTask(h: Helo, ship: Ship, o: HeloOrder): HeloTask {
  const at = o.at ?? ship.pos;
  const t: HeloTask = { id: h.nextTask++, kind: o.kind, x: at.x, y: at.y };
  if (o.kind === 'dip') {
    t.count = clamp(Math.round(o.count ?? 3), 1, 8);
    t.axis = o.axis ?? bearing(ship.pos, at);
  } else if (o.kind === 'buoys') {
    t.count = clamp(Math.round(o.count ?? 4), 1, 6);
    t.spacing = clamp(o.spacing ?? 2500, 2000, 3000);
    t.axis = o.axis ?? bearing(ship.pos, at) + 90;
    if (o.active) t.active = true;
    if (o.deep !== undefined) t.deep = o.deep;
  }
  if (o.track) t.track = o.track;
  if (o.off) t.off = { ...o.off };
  return t;
}

/** Can the helicopter take this order? An error text, or undefined. */
function orderCheck(w: World, ship: Ship, h: Helo | undefined, o: HeloOrder, queued: number): string | undefined {
  if (!h || !hasHelicopter(ship.cls)) return 'Kein Hubschrauber an Bord';
  if (!ship.alive) return 'Schiff ist gesunken';
  if (o.kind === 'return') return undefined;
  if (!o.at) return 'Kein Zielpunkt';
  if (distance(ship.pos, o.at) > HELO_RANGE) return `Außer Reichweite des Hubschraubers (${HELO_RANGE / 1000} km)`;
  if (queued >= QUEUE_MAX) return 'Auftragsliste voll';
  const air = w.air!;
  if (o.kind === 'buoys' && h.buoys + (air.stock.get(ship.id) ?? 0) <= 0) return 'Keine Sonarbojen mehr';
  if (o.kind === 'attack') {
    if (h.torps + (air.heloTorps?.get(ship.id) ?? 0) <= 0) return 'Keine Hubschrauber-Torpedos mehr';
    const haven = havenBlocks(w, ship.team, o.at);
    if (haven) return haven;
  }
  return undefined;
}

/**
 * Give the helicopter a task: 'add' puts it at the end of the queue, 'now' drops everything
 * else and does it at once. On deck the helicopter takes off as soon as it is ready.
 */
export function heloOrder(w: World, ship: Ship, op: 'add' | 'now', o: HeloOrder): true | string {
  const h = heloOf(w, ship.id);
  const e = orderCheck(w, ship, h, o, op === 'now' ? 0 : h?.queue.length ?? 0);
  if (e) return e;
  const t = makeTask(h!, ship, o);
  if (op === 'now') h!.queue = [t];
  else h!.queue.push(t);
  return true;
}

/** Strike one task from the queue (the current one too: the helicopter goes on with the next). */
export function heloRemove(w: World, ship: Ship, id: number): true | string {
  const h = heloOf(w, ship.id);
  if (!h) return 'Kein Hubschrauber an Bord';
  const i = h.queue.findIndex((t) => t.id === id);
  if (i < 0) return 'Auftrag nicht mehr in der Liste';
  h.queue.splice(i, 1);
  if (i === 0) restart(h);
  return true;
}

/** Clear the queue: airborne, the helicopter comes home. */
export function heloClear(w: World, ship: Ship): true | string {
  const h = heloOf(w, ship.id);
  if (!h) return 'Kein Hubschrauber an Bord';
  h.queue = h.state === 'air' ? [makeTask(h, ship, { kind: 'return' })] : [];
  return true;
}

// Older single-task orders (map menu, older clients): one task at the end of the queue

/** Dipping sonar at a point (one dip; the depth is chosen from the measured layer). */
export function sendDip(w: World, ship: Ship, target: Vec2, _deep?: boolean): true | string {
  return heloOrder(w, ship, 'add', { kind: 'dip', at: target, count: 1 });
}

/** MAD search: a low cloverleaf over a datum; a hull close below it is detected. */
export function sendMad(w: World, ship: Ship, target: Vec2): true | string {
  return heloOrder(w, ship, 'add', { kind: 'mad', at: target });
}

/** One buoy at a point (active: DICASS). */
export function sendBuoy(w: World, ship: Ship, target: Vec2, deep?: boolean, active = false): true | string {
  return heloOrder(w, ship, 'add', { kind: 'buoys', at: target, count: 1, active, deep });
}

/** A lightweight torpedo at a point (follows a fresh dip echo near it). */
export function sendHeloTorpedo(w: World, ship: Ship, target: Vec2): true | string {
  return heloOrder(w, ship, 'add', { kind: 'attack', at: target });
}

/** Points of a buoy line: `count` buoys `spacing` apart along `axis`, centred on the task point. */
export function buoyLine(t: Pick<HeloTask, 'x' | 'y' | 'axis' | 'count' | 'spacing'>): Vec2[] {
  const n = t.count ?? 1;
  const v = headingVec(t.axis ?? 0);
  const sp = t.spacing ?? 2500;
  return Array.from({ length: n }, (_, i) => {
    const off = (i - (n - 1) / 2) * sp;
    return { x: t.x + v.x * off, y: t.y + v.y * off };
  });
}

/** Latest position of a contact from the owner's book: a sample with range, from where it was measured. */
export function trackFix(w: World, owner: Ship, label: string, maxAge = FIX_MAX_AGE_S): { pos: Vec2; t: number } | undefined {
  const tr = w.books.get(owner.id)?.tracks().find((x) => x.label === label);
  if (!tr) return undefined;
  for (let i = tr.history.length - 1; i >= 0; i--) {
    const s = tr.history[i]!;
    if (w.time - s.t > maxAge) break;
    if (s.r === undefined || s.alt !== undefined) continue;
    // Hull sonar samples have no origin: the ship's own position, if fresh
    const o = s.ox !== undefined ? { x: s.ox, y: s.oy! } : w.time - s.t < 30 ? owner.pos : undefined;
    if (!o) continue;
    const v = headingVec(s.b);
    return { pos: { x: o.x + v.x * s.r, y: o.y + v.y * s.r }, t: s.t };
  }
  return undefined;
}

/** Move toward p at helicopter speed; true when there. */
function flyTo(h: Helo, p: Vec2, dt: number): boolean {
  const d = distance(h, p);
  const step = HELO_SPEED * dt;
  if (d > 1) h.heading = bearing(h, p);
  if (d <= step) {
    h.x = p.x;
    h.y = p.y;
    return true;
  }
  h.x += ((p.x - h.x) / d) * step;
  h.y += ((p.y - h.y) / d) * step;
  return false;
}

/** The next task in the queue starts from the beginning of its flight. */
function restart(h: Helo): void {
  const t = h.queue[0];
  if (t?.phase === 'work' && t.kind !== 'attack') t.phase = undefined;
}

function finish(h: Helo): void {
  h.queue.shift();
  restart(h);
}

function say(w: World, ship: Ship, text: string): void {
  w.events.push({ kind: 'boat', time: w.time, shipId: ship.id, what: 'helo', text: `HUBSCHRAUBER · ${text}` });
}

/** Back home first to rearm (the task stays in the queue behind the landing). */
function rearmFirst(w: World, h: Helo, ship: Ship, what: string): void {
  const air = w.air!;
  const mag = what === 'buoys' ? air.stock.get(ship.id) ?? 0 : air.heloTorps?.get(ship.id) ?? 0;
  if (mag <= 0) {
    say(w, ship, what === 'buoys' ? 'KEINE BOJEN MEHR' : 'KEIN TORPEDO MEHR');
    finish(h);
    return;
  }
  say(w, ship, 'LEER · KEHRT ZUM AUFMUNITIONIEREN ZURÜCK');
  h.queue.unshift(makeTask(h, ship, { kind: 'return' }));
}

/** Dome depths: just above and below the ship's measured layer, at least 10 m off the bottom. */
export function dipDepth(w: World, owner: Ship, p: Vec2, deep: boolean): number {
  const bottom = depthAt(w.env.seabed, p.x, p.y);
  return Math.max(10, Math.min(lightSearchDepths(owner.btLayer)[deep ? 1 : 0], bottom - 10));
}

function doDip(w: World, h: Helo, t: HeloTask, owner: Ship, dt: number): void {
  if (t.phase !== 'work') {
    if (!flyTo(h, t, dt)) return;
    Object.assign(t, { phase: 'work', from: w.time, until: w.time + DIP_HOVER_S, lastPing: -1e9, pings: 0, echo: undefined });
  }
  h.dipping = true;
  if (w.time - (t.lastPing ?? -1e9) >= DIP_PING_S) {
    t.lastPing = w.time;
    // Alternately above and below the layer
    const deep = (t.pings ?? 0) % 2 === 1;
    t.pings = (t.pings ?? 0) + 1;
    const dets = dipPing(w, t, owner, dipDepth(w, owner, t, deep));
    w.lastDetections.push(...dets);
    for (const d of dets) {
      bookFor(w, d.observerId).ingest(d);
      if (d.observerId !== owner.id || d.sensor !== 'active' || d.range === undefined) continue;
      const v = headingVec(d.bearing);
      t.echo = { x: t.x + v.x * d.range, y: t.y + v.y * d.range };
      h.fix = { ...t.echo, t: w.time };
    }
  }
  if (w.time < (t.until ?? 0)) return;
  t.step = (t.step ?? 0) + 1;
  if (t.step >= (t.count ?? 1)) return finish(h);
  // Next dip: onto the contact if this dip held one, else on in the search direction
  const next = t.echo && distance(t, t.echo) < 6000 ? t.echo : { x: t.x + headingVec(t.axis ?? 0).x * DIP_STEP_M, y: t.y + headingVec(t.axis ?? 0).y * DIP_STEP_M };
  if (t.echo) t.axis = bearing(t, t.echo);
  Object.assign(t, { x: next.x, y: next.y, phase: undefined, echo: undefined });
}

function doBuoys(w: World, h: Helo, t: HeloTask, owner: Ship, dt: number): void {
  if (h.buoys <= 0) return rearmFirst(w, h, owner, 'buoys');
  const pts = buoyLine(t);
  t.reverse ??= distance(h, pts[pts.length - 1]!) < distance(h, pts[0]!);
  const i = t.step ?? 0;
  const idx = t.reverse ? pts.length - 1 - i : i;
  if (!flyTo(h, pts[idx]!, dt)) return;
  h.buoys--;
  // Every other buoy below the layer, the first one deep
  layBuoy(w, owner.id, pts[idx]!, dipDepth(w, owner, pts[idx]!, t.deep ?? idx % 2 === 0), t.active);
  w.events.push({ kind: 'weapon', time: w.time, sourceId: owner.id, what: 'buoy' });
  t.step = i + 1;
  if (t.step >= pts.length) finish(h);
}

function doMad(w: World, h: Helo, t: HeloTask, owner: Ship, dt: number): void {
  if (t.phase !== 'work') {
    const fix = t.track ? trackFix(w, owner, t.track) : undefined;
    if (fix) Object.assign(t, fix.pos);
    if (!flyTo(h, t, dt)) return;
    Object.assign(t, { phase: 'work', from: w.time, until: w.time + MAD_PATTERN_S });
  }
  const p = cloverleaf(t, w.time - (t.from ?? w.time));
  h.heading = bearing(h, p);
  h.x = p.x;
  h.y = p.y;
  if (Math.floor(w.time) !== Math.floor(w.time - dt) && madLook(w, owner, p)) {
    if (!t.madHit) madReport(w, owner);
    t.madHit = true;
  }
  if (w.time >= (t.until ?? 0)) finish(h);
}

function doAttack(w: World, h: Helo, t: HeloTask, owner: Ship, dt: number, wasDipping: boolean): void {
  if (h.torps <= 0) return rearmFirst(w, h, owner, 'torps');
  // From the hover the dome comes up first; the torpedo goes in a minute after the contact
  if (t.notBefore === undefined) {
    t.notBefore = w.time + (wasDipping ? ATTACK_FROM_DIP_S : 0);
    t.from = w.time + (wasDipping ? DOME_UP_S : 0);
  }
  // Aim at the latest fix held: the contact's track, or the own dipping sonar's echo near the aim
  const fix = t.track ? trackFix(w, owner, t.track) : undefined;
  const echo = h.fix && w.time - h.fix.t < 120 && distance(h.fix, t) < 4000 ? { pos: h.fix, t: h.fix.t } : undefined;
  const best = fix && (!echo || fix.t >= echo.t) ? fix : echo;
  if (best && best.t > (t.fixT ?? -1e9)) {
    t.x = best.pos.x + (t.off?.x ?? 0);
    t.y = best.pos.y + (t.off?.y ?? 0);
    t.fixT = best.t;
  }
  if (w.time < (t.from ?? 0)) {
    h.dipping = true;
    return;
  }
  if (!flyTo(h, t, dt) || w.time < t.notBefore) return;
  // The pilot holds fire if an own boat has come into the haven meanwhile
  const haven = havenBlocks(w, owner.team, t);
  if (haven) say(w, owner, 'SPERRGEBIET · KEIN ABWURF');
  else {
    h.torps--;
    dropLightweight(w, owner.id, { x: t.x, y: t.y });
    w.events.push({ kind: 'weapon', time: w.time, sourceId: owner.id, what: 'rocket' });
    w.events.push({ kind: 'transient', time: w.time, sourceId: owner.id, x: t.x, y: t.y, what: 'splash' });
    say(w, owner, 'TORPEDO IM WASSER');
  }
  finish(h);
}

function land(w: World, h: Helo, owner: Ship): void {
  const air = w.air!;
  const take = (have: number, full: number, mag: Map<string, number> | undefined) => {
    const n = Math.max(0, Math.min(full - have, mag?.get(owner.id) ?? 0));
    mag?.set(owner.id, (mag.get(owner.id) ?? 0) - n);
    return have + n;
  };
  h.state = 'deck';
  h.readyAt = w.time + HELO_REFUEL_S;
  h.fuel = HELO_ENDURANCE_S;
  h.buoys = take(h.buoys, HELO_BUOYS, air.stock);
  h.torps = take(h.torps, HELO_TORPS, air.heloTorps);
  h.fix = undefined;
  say(w, owner, 'GELANDET · TANKEN UND AUFMUNITIONIEREN 10 MIN');
}

function stepHelo(w: World, h: Helo, owner: Ship, dt: number): void {
  if (h.state === 'deck') {
    h.x = owner.pos.x;
    h.y = owner.pos.y;
    while (h.queue[0]?.kind === 'return') h.queue.shift();
    if (!h.queue.length || w.time < h.readyAt) {
      h.prepUntil = undefined;
      return;
    }
    // Launch preparation (about 2 min) before it lifts off
    h.prepUntil ??= w.time + HELO_LAUNCH_PREP_S;
    if (w.time < h.prepUntil) return;
    h.prepUntil = undefined;
    h.state = 'air';
    h.launchAt = w.time;
    restart(h);
    return;
  }
  const wasDipping = !!h.dipping;
  h.dipping = false;
  h.fuel -= dt;
  // Bingo fuel: home now, the rest of the queue waits behind the landing
  const home = distance(h, owner.pos) / HELO_SPEED + BINGO_RESERVE_S;
  if (h.fuel <= home && h.queue[0]?.kind !== 'return') {
    say(w, owner, 'KRAFTSTOFF KNAPP · KEHRT ZURÜCK');
    h.queue.unshift(makeTask(h, owner, { kind: 'return' }));
    if (h.queue[1]) h.queue[1].phase = undefined;
  }
  const t = h.queue[0];
  if (!t) return; // loiters where it is
  if (t.kind === 'dip') doDip(w, h, t, owner, dt);
  else if (t.kind === 'buoys') doBuoys(w, h, t, owner, dt);
  else if (t.kind === 'mad') doMad(w, h, t, owner, dt);
  else if (t.kind === 'attack') doAttack(w, h, t, owner, dt, wasDipping);
  else if (flyTo(h, owner.pos, dt)) {
    finish(h);
    land(w, h, owner);
  }
}

/** Every tick: fly and work every helicopter. A helicopter whose ship is lost is lost with it. */
export function stepHelos(w: World, dt: number): void {
  migrateHelos(w);
  const helos = w.air?.helos;
  if (!helos) return;
  for (const [id, h] of Object.entries(helos)) {
    const owner = w.ships.find((s) => s.id === id);
    if (!owner?.alive) {
      delete helos[id];
      continue;
    }
    stepHelo(w, h, owner, dt);
  }
}

/** Airborne and working low: hovering with the dome down, or flying the MAD pattern. */
export function heloLow(h: Helo): 'dip' | 'mad' | undefined {
  if (h.state !== 'air') return undefined;
  const t = h.queue[0];
  if (h.dipping || (t?.kind === 'dip' && t.phase === 'work')) return 'dip';
  return t?.kind === 'mad' && t.phase === 'work' ? 'mad' : undefined;
}

