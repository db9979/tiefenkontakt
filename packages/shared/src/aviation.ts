import { ambientNoise, transmissionLoss, DT_ACTIVE, DT_PASSIVE, sourceLevelToward, targetStrengthToward } from './acoustics.js';
import { CLASSES, hasHelicopter, isEscort } from './classes.js';
import { dropLightweight } from './weapons.js';
import { bookFor } from './world.js';
import type { Ship } from './entities.js';
import { KN, bearing, distance, headingVec, wrap360, type Vec2 } from './math.js';
import type { Detection, SensorContext } from './sensors.js';
import { measureEvidence, sigKeyOf } from './signatures.js';
import { isCavitating } from './acoustics.js';
import { isSnorkeling } from './kinematics.js';
import { depthAt, pathDepth } from './seabed.js';
import type { World } from './world.js';

/** Frigate helicopter dropping passive DIFAR sonobuoys. */

export const HELO_SPEED = 120 * KN; // m/s
export const HELO_RANGE = 30_000; // m
export const HELO_TURNAROUND = 120; // s on deck after landing
export const BUOY_LIFE = 1800; // s
export const BUOY_BEARING_SD = 4; // deg (DIFAR)
const BUOY_SHALLOW = 30;
/** DIFAR array gain plus narrowband processing. */
const BUOY_GAIN = 10;

export interface Buoy {
  id: string;
  ownerId: string;
  pos: Vec2;
  depth: number;
  expiresAt: number;
}

export type SortieKind = 'buoy' | 'dip' | 'torpedo' | 'mpa' | 'mad';

export interface Sortie {
  kind?: SortieKind; // undefined = buoy (older saves)
  /** Dipping sonar: hover until this time, pinging every DIP_PING_S. */
  hoverUntil?: number;
  lastPing?: number;
  /** MAD has already reported a contact on this sortie. */
  madHit?: boolean;
  bearing?: number;
  shipId: string;
  from: Vec2;
  target: Vec2;
  launchAt: number;
  dropAt: number;
  landAt: number;
  readyAt: number;
  deep: boolean;
  dropped: boolean;
}

export interface AirState {
  buoys: Buoy[];
  sorties: Sortie[];
  stock: Map<string, number>;
  nextId: number;
  /** Helicopter lightweight torpedoes per frigate. */
  heloTorps?: Map<string, number>;
  /** Maritime patrol aircraft per team: ready time and buoys left. */
  mpa?: Record<string, { readyAt: number; buoys: number }>;
}

export const DIP_HOVER_S = 300;
/** MAD search: a cloverleaf at 30–60 m over the datum. */
export const MAD_PATTERN_S = 360;
const MAD_PETAL_M = 900;
const MAD_ALT_M = 50;
const MAD_SURE_M = 250;
const MAD_MAX_M = 400;
const DIP_PING_S = 20;
const DIP_RANGE = 12_000;
const MPA_SPEED = 300 * KN;
const MPA_COOLDOWN = 1800;
const MPA_PATTERN = 6;
const MPA_SPACING = 3000;

export function installAir(w: World, buoysPerFrigate = 16): AirState {
  const stock = new Map<string, number>();
  for (const s of w.ships) if (hasHelicopter(s.cls)) stock.set(s.id, buoysPerFrigate);
  const heloTorps = new Map<string, number>();
  for (const s of w.ships) if (hasHelicopter(s.cls)) heloTorps.set(s.id, 2);
  const teams = new Set(w.ships.filter((s) => isEscort(s.cls)).map((s) => s.team));
  const mpa: AirState['mpa'] = {};
  for (const t of teams) mpa[t] = { readyAt: 0, buoys: 18 };
  w.air = { buoys: [], sorties: [], stock, nextId: 1, heloTorps, mpa };
  w.systems.push(airSystem);
  return w.air;
}

/** Launch the helicopter to drop a buoy at a point. deep = below the layer. */
function heloCheck(w: World, ship: Ship, target: Vec2): string | undefined {
  const air = w.air;
  if (!air || !hasHelicopter(ship.cls)) return 'Kein Hubschrauber an Bord';
  if (!ship.alive) return 'Schiff ist gesunken';
  if (air.sorties.some((s) => s.shipId === ship.id && s.kind !== 'mpa' && w.time < s.readyAt)) return 'Hubschrauber ist unterwegs';
  if (distance(ship.pos, target) > HELO_RANGE) return 'Außer Reichweite des Hubschraubers (30 km)';
  return undefined;
}

function launchHelo(w: World, ship: Ship, target: Vec2, kind: SortieKind, deep: boolean): void {
  const flight = distance(ship.pos, target) / HELO_SPEED;
  const hover = kind === 'dip' ? DIP_HOVER_S : kind === 'mad' ? MAD_PATTERN_S : 0;
  w.air!.sorties.push({
    kind, shipId: ship.id, from: { ...ship.pos }, target: { ...target }, launchAt: w.time, dropAt: w.time + flight,
    hoverUntil: kind === 'dip' || kind === 'mad' ? w.time + flight + hover : undefined,
    landAt: w.time + 2 * flight + hover, readyAt: w.time + 2 * flight + hover + HELO_TURNAROUND, deep, dropped: false,
  });
}

/** Dipping sonar: the helicopter hovers and pings from above or below the layer. */
export function sendDip(w: World, ship: Ship, target: Vec2, deep: boolean): true | string {
  const e = heloCheck(w, ship, target);
  if (e) return e;
  launchHelo(w, ship, target, 'dip', deep);
  return true;
}

/** MAD search: the helicopter flies a low cloverleaf over a datum; a hull close below it is detected. */
export function sendMad(w: World, ship: Ship, target: Vec2): true | string {
  const e = heloCheck(w, ship, target);
  if (e) return e;
  launchHelo(w, ship, target, 'mad', false);
  return true;
}

/** Four-petal rose around the datum, one petal per 90 s. */
function cloverleaf(center: Vec2, t: number): Vec2 {
  const th = (t / MAD_PATTERN_S) * Math.PI * 2;
  const r = MAD_PETAL_M * Math.abs(Math.sin(2 * th));
  return { x: center.x + r * Math.cos(th), y: center.y + r * Math.sin(th) };
}

/** Once a second: every low-flying MAD sortie and patrol aircraft checks for a hull below it. */
function madSweep(w: World): void {
  const air = w.air!;
  for (const s of air.sorties) {
    if (s.kind !== 'mad' && s.kind !== 'mpa') continue;
    const owner = w.ships.find((x) => x.id === s.shipId);
    if (!owner?.alive) continue;
    const p = aircraftPosition(s, w.time, owner);
    if (!p) continue;
    for (const sub of w.ships) {
      if (!sub.alive || !CLASSES[sub.cls].submarine || sub.team === owner.team) continue;
      const horiz = distance(p, sub.pos);
      const slant = Math.hypot(horiz, sub.depth + MAD_ALT_M);
      if (slant > MAD_MAX_M || (slant > MAD_SURE_M && w.rng.next() > 0.3)) continue;
      const det: Detection = {
        observerId: owner.id, targetId: sub.id, sensor: 'mad', time: w.time,
        bearing: wrap360(bearing(p, sub.pos) + w.rng.gauss(0, 4)), range: Math.max(20, horiz + w.rng.gauss(0, 40)), se: 15,
        originX: p.x, originY: p.y,
      };
      w.lastDetections.push(det);
      bookFor(w, owner.id).ingest(det);
      if (!s.madHit) w.events.push({ kind: 'boat', time: w.time, shipId: owner.id, what: 'mad', text: 'MAD-KONTAKT · MAGNETISCHE ANOMALIE UNTER DEM HUBSCHRAUBER' });
      s.madHit = true;
    }
  }
}

/** Helicopter drops a lightweight torpedo at a point. */
export function sendHeloTorpedo(w: World, ship: Ship, target: Vec2): true | string {
  const e = heloCheck(w, ship, target);
  if (e) return e;
  const left = w.air!.heloTorps?.get(ship.id) ?? 0;
  if (left <= 0) return 'Keine Hubschrauber-Torpedos mehr';
  w.air!.heloTorps!.set(ship.id, left - 1);
  w.events.push({ kind: 'weapon', time: w.time, sourceId: ship.id, what: 'rocket' });
  launchHelo(w, ship, target, 'torpedo', false);
  return true;
}

/** Maritime patrol aircraft: lays a line of buoys across a bearing, then needs 30 min to return. */
export function callMpa(w: World, ship: Ship, center: Vec2, acrossBearing: number): true | string {
  const team = w.air?.mpa?.[ship.team];
  if (!team || !ship.alive) return 'Kein Seefernaufklärer verfügbar';
  if (w.time < team.readyAt) return `Seefernaufklärer wieder bereit in ${Math.ceil((team.readyAt - w.time) / 60)} min`;
  if (team.buoys < MPA_PATTERN) return 'Seefernaufklärer hat keine Bojen mehr';
  team.buoys -= MPA_PATTERN;
  team.readyAt = w.time + MPA_COOLDOWN;
  const from = { x: ship.pos.x, y: ship.pos.y - 40_000 };
  const flight = distance(from, center) / MPA_SPEED;
  w.air!.sorties.push({
    kind: 'mpa', shipId: ship.id, from, target: { ...center }, bearing: acrossBearing, launchAt: w.time,
    dropAt: w.time + flight, landAt: w.time + 2 * flight, readyAt: w.time + 2 * flight, deep: (w.env.layerDepth ?? 0) > 0, dropped: false,
  });
  w.events.push({ kind: 'weapon', time: w.time, sourceId: ship.id, what: 'buoy' });
  return true;
}

export function sendBuoy(w: World, ship: Ship, target: Vec2, deep: boolean): true | string {
  const e = heloCheck(w, ship, target);
  if (e) return e;
  const air = w.air!;
  const left = air.stock.get(ship.id) ?? 0;
  if (left <= 0) return 'Keine Sonarbojen mehr';
  const d = distance(ship.pos, target);
  air.stock.set(ship.id, left - 1);
  w.events.push({ kind: 'weapon', time: w.time, sourceId: ship.id, what: 'buoy' });
  void d;
  launchHelo(w, ship, target, 'buoy', deep);
  return true;
}

/** Helicopter position while airborne (straight out and back). */
export function heloPosition(s: Sortie, now: number, ship: Ship): Vec2 | undefined {
  if (now < s.launchAt || now > s.landAt) return undefined;
  if (now <= s.dropAt) {
    const f = (now - s.launchAt) / Math.max(1, s.dropAt - s.launchAt);
    return { x: s.from.x + (s.target.x - s.from.x) * f, y: s.from.y + (s.target.y - s.from.y) * f };
  }
  const f = (now - s.dropAt) / Math.max(1, s.landAt - s.dropAt);
  return { x: s.target.x + (ship.pos.x - s.target.x) * f, y: s.target.y + (ship.pos.y - s.target.y) * f };
}

export function airSystem(w: World): void {
  const air = w.air!;
  const buoyDepth = (p: Vec2, deep: boolean) => {
    const bottom = depthAt(w.env.seabed, p.x, p.y);
    return Math.max(10, Math.min(deep ? (w.env.layerDepth > 0 ? w.env.layerDepth + 40 : 150) : BUOY_SHALLOW, bottom - 10));
  };
  for (const s of air.sorties) {
    const owner = w.ships.find((x) => x.id === s.shipId);
    if (s.kind === 'dip' && owner?.alive && w.time >= s.dropAt && w.time < (s.hoverUntil ?? 0) && w.time - (s.lastPing ?? -1e9) >= DIP_PING_S) {
      s.lastPing = w.time;
      const dets = dipPing(w, s, owner, buoyDepth(s.target, s.deep));
      w.lastDetections.push(...dets);
      for (const d of dets) bookFor(w, d.observerId).ingest(d);
    }
    if (s.dropped || w.time < s.dropAt) continue;
    s.dropped = true;
    const kind = s.kind ?? 'buoy';
    // A buoy hitting the water is a sharp transient that boats nearby can hear
    if (kind === 'buoy' || kind === 'torpedo') w.events.push({ kind: 'transient', time: w.time, sourceId: s.shipId, x: s.target.x, y: s.target.y, what: 'splash' });
    if (kind === 'buoy') air.buoys.push({ id: `B${air.nextId++}`, ownerId: s.shipId, pos: s.target, depth: buoyDepth(s.target, s.deep), expiresAt: w.time + BUOY_LIFE });
    else if (kind === 'torpedo') dropLightweight(w, s.shipId, s.target);
    else if (kind === 'mpa') {
      const across = headingVec((s.bearing ?? 0) + 90);
      for (let i = 0; i < MPA_PATTERN; i++) {
        const off = (i - (MPA_PATTERN - 1) / 2) * MPA_SPACING;
        const p = { x: s.target.x + across.x * off, y: s.target.y + across.y * off };
        air.buoys.push({ id: `B${air.nextId++}`, ownerId: s.shipId, pos: p, depth: buoyDepth(p, s.deep), expiresAt: w.time + BUOY_LIFE * 1.5 });
      }
    }
  }
  if (Math.floor(w.time) !== Math.floor(w.time - 0.1)) madSweep(w);
  air.sorties = air.sorties.filter((s) => w.time < s.readyAt + 1);
  air.buoys = air.buoys.filter((b) => w.time < b.expiresAt && w.ships.some((s) => s.id === b.ownerId && s.alive));
}

/** Passive omni buoys: bearings from the buoy's position, reported to the owner. */
export function buoySensors(buoys: readonly Buoy[], ctx: SensorContext): Detection[] {
  const out: Detection[] = [];
  const nl = ambientNoise(ctx.env);
  for (const b of buoys) {
    for (const tgt of ctx.ships) {
      if (!tgt.alive || tgt.id === b.ownerId) continue;
      const range = distance(b.pos, tgt.pos);
      const se = sourceLevelToward(tgt, b.pos) - transmissionLoss(range, tgt.depth, b.depth, ctx.env, undefined, pathDepth(ctx.env.seabed, b.pos, tgt.pos)) - (nl - BUOY_GAIN) - DT_PASSIVE + ctx.rng.gauss(0, 2);
      if (se <= 0) continue;
      out.push({
        observerId: b.ownerId, targetId: tgt.id, sensor: 'buoy', time: ctx.time,
        bearing: wrap360(bearing(b.pos, tgt.pos) + ctx.rng.gauss(0, BUOY_BEARING_SD)), se,
        originX: b.pos.x, originY: b.pos.y,
        evidence: measureEvidence(sigKeyOf(tgt.cls), tgt.speed / KN, se, { cavitating: isCavitating(tgt), snorkel: isSnorkeling(tgt) }, ctx.rng),
      });
    }
  }
  return out;
}

/** One dipping-sonar ping: echoes (with range) for the frigate, intercepts for every listening boat. */
function dipPing(w: World, s: Sortie, owner: Ship, depth: number): Detection[] {
  const out: Detection[] = [];
  const nl = ambientNoise(w.env);
  for (const tgt of w.ships) {
    if (!tgt.alive || tgt.team === owner.team) continue;
    const range = distance(s.target, tgt.pos);
    if (range > DIP_RANGE * 2) continue;
    const tl = transmissionLoss(range, depth, tgt.depth, w.env, 2.5, pathDepth(w.env.seabed, s.target, tgt.pos));
    const se = 212 - 2 * tl + targetStrengthToward(tgt, s.target) - (nl - 12) - DT_ACTIVE + w.rng.gauss(0, 2);
    if (se > 0 && range < DIP_RANGE) {
      out.push({
        observerId: owner.id, targetId: tgt.id, sensor: 'active', time: w.time,
        bearing: wrap360(bearing(s.target, tgt.pos) + w.rng.gauss(0, 1)), range: Math.max(10, range + w.rng.gauss(0, 15)),
        se, originX: s.target.x, originY: s.target.y,
      });
    }
    const heard = 212 - tl - nl - DT_PASSIVE;
    if (heard > 0 && CLASSES[tgt.cls].hull.di > 0) {
      out.push({
        observerId: tgt.id, targetId: `H-${owner.id}`, sensor: 'intercept', time: w.time, source: 'dip',
        bearing: wrap360(bearing(tgt.pos, s.target) + w.rng.gauss(0, 2)), se: heard,
      });
    }
  }
  return out;
}

/** Aircraft position for display: helicopter out-hover-back, patrol aircraft out and back. */
export function aircraftPosition(s: Sortie, now: number, ship: Ship): Vec2 | undefined {
  if (now < s.launchAt || now > s.landAt) return undefined;
  if (now <= s.dropAt) {
    const f = (now - s.launchAt) / Math.max(1, s.dropAt - s.launchAt);
    return { x: s.from.x + (s.target.x - s.from.x) * f, y: s.from.y + (s.target.y - s.from.y) * f };
  }
  if (s.hoverUntil !== undefined && now <= s.hoverUntil) return s.kind === 'mad' ? cloverleaf(s.target, now - s.dropAt) : { ...s.target };
  const start = s.hoverUntil ?? s.dropAt;
  const home = s.kind === 'mpa' ? s.from : ship.pos;
  const f = (now - start) / Math.max(1, s.landAt - start);
  return { x: s.target.x + (home.x - s.target.x) * f, y: s.target.y + (home.y - s.target.y) * f };
}
