import { currentAt } from './currents.js';
import { ambientNoise, reverbLevel, transmissionLoss, DT_ACTIVE, DT_PASSIVE, sourceLevelToward, targetStrengthToward } from './acoustics.js';
import { dbSum } from './math.js';
import { CLASSES, hasHelicopter, isEscort } from './classes.js';
import { HELO_BUOYS, HELO_TORPS, newHelo, stepHelos, type Helo } from './helo.js';
import { bookFor } from './world.js';
import type { Ship } from './entities.js';
import { KN, bearing, distance, headingVec, wrap360, type Vec2 } from './math.js';
import type { Detection, SensorContext } from './sensors.js';
import { measureEvidence, sigKeyOf } from './signatures.js';
import { isCavitating } from './acoustics.js';
import { isSnorkeling } from './kinematics.js';
import { depthAt } from './seabed.js';
import { aircraftRadarSweep } from './airspace.js';
import { soundPathDepth as pathDepth, terrainLossDb } from './terrain.js';
import type { World } from './world.js';

/**
 * Air wing: sonobuoys (passive DIFAR, active DICASS), the patrol aircraft's buoy lines, MAD and
 * active pings from the water. The ship's helicopter and its task queue live in helo.ts.
 */

export const HELO_SPEED = 120 * KN; // m/s
/** Farthest task point from the own ship. */
export const HELO_RANGE = 50_000; // m
export const BUOY_LIFE = 1800; // s
export const BUOY_BEARING_SD = 4; // deg (DIFAR)
const BUOY_SHALLOW = 30;
/** DIFAR array gain plus narrowband processing (LOFAR on the buoy's tonals). */
export const BUOY_GAIN = 16;

export interface Buoy {
  id: string;
  ownerId: string;
  pos: Vec2;
  depth: number;
  expiresAt: number;
  /** DICASS: pings itself every 45 s (range fix, but every boat around hears it). */
  active?: boolean;
  nextPing?: number;
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
  /** Buoy sorties: drop an active (DICASS) buoy. */
  active?: boolean;
  dropped: boolean;
}

export interface AirState {
  buoys: Buoy[];
  /** Patrol aircraft (older saves: helicopter sorties too, migrated on the next step). */
  sorties: Sortie[];
  /** Ship's magazine of sonobuoys (not yet loaded into the helicopter). */
  stock: Map<string, number>;
  nextId: number;
  /** Ship's magazine of helicopter lightweight torpedoes (not yet loaded). */
  heloTorps?: Map<string, number>;
  /** Maritime patrol aircraft per team: ready time and buoys left. */
  mpa?: Record<string, { readyAt: number; buoys: number }>;
  /** The ship's helicopter with its task queue, per ship id (helo.ts). Missing in older saves. */
  helos?: Record<string, Helo>;
}

/** Dipping sonar: search time per dip with the dome down (half above, half below the layer). */
export const DIP_HOVER_S = 180;
/**
 * Dip cycle (F15), after the AQS-13F/AQS-18 drill: about 20 s from cruise to the coupled hover
 * over the dip point, the dome reeled down at about 4,5 m/s, searched at the first depth, shifted
 * to the second, reeled up at about 6 m/s. With the layer at 40/160 m one dip takes about 4,5 min.
 */
export const DIP_TRANSITION_S = 20;
export const DOME_LOWER_MS = 4.5;
export const DOME_RAISE_MS = 6;

/** Timeline of one dip from arrival over the point (s): search windows at depth d1, then d2; end with the dome up. */
export function dipTimeline(d1: number, d2: number): { s1: number; e1: number; s2: number; e2: number; end: number } {
  const s1 = DIP_TRANSITION_S + d1 / DOME_LOWER_MS;
  const e1 = s1 + DIP_HOVER_S / 2;
  const s2 = e1 + Math.abs(d2 - d1) / DOME_LOWER_MS;
  const e2 = s2 + DIP_HOVER_S / 2;
  return { s1, e1, s2, e2, end: e2 + d2 / DOME_RAISE_MS };
}

/** Dome depth (m) at time u after arrival over the dip point. */
export function domeDepthAt(d1: number, d2: number, u: number): number {
  const t = dipTimeline(d1, d2);
  if (u < DIP_TRANSITION_S) return 0;
  if (u < t.s1) return (u - DIP_TRANSITION_S) * DOME_LOWER_MS;
  if (u < t.e1) return d1;
  if (u < t.s2) return d1 + Math.sign(d2 - d1) * (u - t.e1) * DOME_LOWER_MS;
  if (u < t.e2) return d2;
  return Math.max(0, d2 - (u - t.e2) * DOME_RAISE_MS);
}

/** A typical dip (layer at 40/150 m), for ETAs before the depths are known (s). */
export const DIP_CYCLE_TYPICAL_S = Math.round(dipTimeline(40, 150).end);
/** MAD search: a cloverleaf at 30–60 m over the datum. */
export const MAD_PATTERN_S = 360;
const MAD_PETAL_M = 900;
const MAD_ALT_M = 50;
const MAD_SURE_M = 250;
const MAD_MAX_M = 400;
export const DIP_PING_S = 20;
const DIP_RANGE = 12_000;
export { DIP_RANGE };
const MPA_SPEED = 300 * KN;
const MPA_COOLDOWN = 1800;
const MPA_PATTERN = 6;
const MPA_SPACING = 3000;

/**
 * Air wing of the match. Every ship with a helicopter starts with it on deck, fuelled and loaded
 * (HELO_BUOYS buoys, HELO_TORPS torpedoes), and one reload of each in the ship's magazine
 * (`magazineBuoys`, HELO_TORPS).
 */
export function installAir(w: World, magazineBuoys = HELO_BUOYS): AirState {
  const stock = new Map<string, number>();
  const heloTorps = new Map<string, number>();
  for (const s of w.ships) {
    if (!hasHelicopter(s.cls)) continue;
    stock.set(s.id, magazineBuoys);
    heloTorps.set(s.id, HELO_TORPS);
  }
  const teams = new Set(w.ships.filter((s) => isEscort(s.cls)).map((s) => s.team));
  const mpa: AirState['mpa'] = {};
  for (const t of teams) mpa[t] = { readyAt: 0, buoys: 18 };
  w.air = { buoys: [], sorties: [], stock, nextId: 1, heloTorps, mpa, helos: {} };
  for (const s of w.ships) if (hasHelicopter(s.cls)) w.air.helos![s.id] = newHelo(s, HELO_BUOYS, HELO_TORPS);
  w.systems.push(airSystem);
  return w.air;
}

/** Four-petal rose around the datum, one petal per 90 s. */
export function cloverleaf(center: Vec2, t: number): Vec2 {
  const th = (t / MAD_PATTERN_S) * Math.PI * 2;
  const r = MAD_PETAL_M * Math.abs(Math.sin(2 * th));
  return { x: center.x + r * Math.cos(th), y: center.y + r * Math.sin(th) };
}

/**
 * One MAD look from a low aircraft at p: every enemy hull close below it is detected and goes
 * into the owner's book. Returns whether anything was found.
 */
export function madLook(w: World, owner: Ship, p: Vec2): boolean {
  let hit = false;
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
    hit = true;
  }
  return hit;
}

/** The MAD-contact report to the crew. */
export function madReport(w: World, owner: Ship): void {
  w.events.push({ kind: 'boat', time: w.time, shipId: owner.id, what: 'mad', text: 'MAD-KONTAKT · MAGNETISCHE ANOMALIE UNTER DEM HUBSCHRAUBER' });
}

/** Once a second: every patrol aircraft checks for a hull below it. */
function madSweep(w: World): void {
  for (const s of w.air!.sorties) {
    if (s.kind !== 'mpa') continue;
    const owner = w.ships.find((x) => x.id === s.shipId);
    const p = owner?.alive ? aircraftPosition(s, w.time, owner) : undefined;
    if (!owner || !p || !madLook(w, owner, p)) continue;
    if (!s.madHit) madReport(w, owner);
    s.madHit = true;
  }
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

/** Depth for a buoy at p: shallow (30 m) or below the layer, at least 10 m off the bottom. */
function buoyDepthAt(w: World, p: Vec2, deep: boolean): number {
  const bottom = depthAt(w.env.seabed, p.x, p.y);
  return Math.max(10, Math.min(deep ? (w.env.layerDepth > 0 ? w.env.layerDepth + 40 : 150) : BUOY_SHALLOW, bottom - 10));
}

/** A sonobuoy into the water at p (passive 30 min, active 15 min); the splash can be heard. */
export function layBuoy(w: World, ownerId: string, p: Vec2, depth: number, active = false): Buoy {
  const air = w.air!;
  const b: Buoy = { id: `B${air.nextId++}`, ownerId, pos: { ...p }, depth, expiresAt: w.time + (active ? BUOY_LIFE / 2 : BUOY_LIFE), active: active || undefined };
  air.buoys.push(b);
  w.events.push({ kind: 'transient', time: w.time, sourceId: ownerId, x: p.x, y: p.y, what: 'splash' });
  return b;
}

export function airSystem(w: World, dt = 0.1): void {
  const air = w.air!;
  stepHelos(w, dt);
  // Patrol aircraft: the buoy line goes in across the bearing when it is over the point
  for (const s of air.sorties) {
    if (s.kind !== 'mpa' || s.dropped || w.time < s.dropAt) continue;
    s.dropped = true;
    const across = headingVec((s.bearing ?? 0) + 90);
    for (let i = 0; i < MPA_PATTERN; i++) {
      const off = (i - (MPA_PATTERN - 1) / 2) * MPA_SPACING;
      const p = { x: s.target.x + across.x * off, y: s.target.y + across.y * off };
      air.buoys.push({ id: `B${air.nextId++}`, ownerId: s.shipId, pos: p, depth: buoyDepthAt(w, p, s.deep), expiresAt: w.time + BUOY_LIFE * 1.5 });
    }
  }
  if (Math.floor(w.time) !== Math.floor(w.time - dt)) {
    madSweep(w);
    aircraftRadarSweep(w);
  }
  air.sorties = air.sorties.filter((s) => w.time < s.readyAt + 1);
  air.buoys = air.buoys.filter((b) => w.time < b.expiresAt && w.ships.some((s) => s.id === b.ownerId && s.alive));
  // Buoys drift with the current; active ones ping on their own
  for (const b of air.buoys) {
    const cur = currentAt(w.env, b.pos, b.depth, w.time);
    b.pos.x += cur.x * dt;
    b.pos.y += cur.y * dt;
    if (b.active && w.time >= (b.nextPing ?? 0)) {
      b.nextPing = w.time + 45;
      const owner = w.ships.find((x) => x.id === b.ownerId);
      if (!owner) continue;
      const dets = activePing(w, b.pos, b.depth, owner, 205, 'buoy', 6000);
      w.lastDetections.push(...dets);
      for (const d of dets) bookFor(w, d.observerId).ingest(d);
    }
  }
}

/** Passive omni buoys: bearings from the buoy's position, reported to the owner. */
export function buoySensors(buoys: readonly Buoy[], ctx: SensorContext): Detection[] {
  const out: Detection[] = [];
  for (const b of buoys) {
    const nl = ambientNoise(ctx.env, b.pos);
    for (const tgt of ctx.ships) {
      if (!tgt.alive || tgt.id === b.ownerId) continue;
      const range = distance(b.pos, tgt.pos);
      const se = sourceLevelToward(tgt, b.pos) - transmissionLoss(range, tgt.depth, b.depth, ctx.env, undefined, pathDepth(ctx.env.seabed, b.pos, tgt.pos)) -
        terrainLossDb(ctx.env.seabed, tgt.pos, tgt.depth, b.pos, b.depth) - (nl - BUOY_GAIN) - DT_PASSIVE + ctx.rng.gauss(0, 2);
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
export function dipPing(w: World, at: Vec2, owner: Ship, depth: number): Detection[] {
  return activePing(w, at, depth, owner, 212, 'dip', DIP_RANGE);
}

/**
 * An active ping from a point in the water (dipping sonar, DICASS buoy): range and bearing
 * from that point for the owner, and an intercept for every boat that hears it.
 */
export function activePing(w: World, from: Vec2, depth: number, owner: Ship, sl: number, source: 'dip' | 'buoy', maxRange: number): Detection[] {
  const out: Detection[] = [];
  const nl = ambientNoise(w.env, from);
  const s = { target: from };
  for (const tgt of w.ships) {
    if (!tgt.alive || tgt.team === owner.team) continue;
    const range = distance(s.target, tgt.pos);
    if (range > maxRange * 2) continue;
    const bottom = pathDepth(w.env.seabed, s.target, tgt.pos);
    // Dipping sonar: higher frequency (more absorption), LFM-like processing, and reverberation like the hull sonar
    const tl = transmissionLoss(range, depth, tgt.depth, w.env, 1.8, bottom);
    const se = sl - 2 * tl + targetStrengthToward(tgt, s.target) - dbSum(nl - 12, reverbLevel(sl, range, w.env, bottom, { lfm: true })) - DT_ACTIVE + w.rng.gauss(0, 2) -
      2 * terrainLossDb(w.env.seabed, s.target, depth, tgt.pos, tgt.depth);
    if (se > 0 && range < maxRange) {
      out.push({
        observerId: owner.id, targetId: tgt.id, sensor: 'active', time: w.time,
        bearing: wrap360(bearing(s.target, tgt.pos) + w.rng.gauss(0, 1)), range: Math.max(10, range + w.rng.gauss(0, 15)),
        se, originX: s.target.x, originY: s.target.y,
      });
    }
    const heard = sl - tl - nl - DT_PASSIVE;
    if (heard > 0 && CLASSES[tgt.cls].hull.di > 0) {
      out.push({
        observerId: tgt.id, targetId: source === 'dip' ? `H-${owner.id}` : `AB-${owner.id}`, sensor: 'intercept', time: w.time, source,
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
