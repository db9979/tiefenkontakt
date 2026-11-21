import { ambientNoise, transmissionLoss, DT_PASSIVE, sourceLevel } from './acoustics.js';
import type { Ship } from './entities.js';
import { KN, bearing, distance, wrap360, type Vec2 } from './math.js';
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

export interface Sortie {
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
}

export function installAir(w: World, buoysPerFrigate = 16): AirState {
  const stock = new Map<string, number>();
  for (const s of w.ships) if (s.cls === 'ffg') stock.set(s.id, buoysPerFrigate);
  w.air = { buoys: [], sorties: [], stock, nextId: 1 };
  w.systems.push(airSystem);
  return w.air;
}

/** Launch the helicopter to drop a buoy at a point. deep = below the layer. */
export function sendBuoy(w: World, ship: Ship, target: Vec2, deep: boolean): true | string {
  const air = w.air;
  if (!air || ship.cls !== 'ffg') return 'Kein Hubschrauber an Bord';
  if (!ship.alive) return 'Schiff ist gesunken';
  const left = air.stock.get(ship.id) ?? 0;
  if (left <= 0) return 'Keine Sonarbojen mehr';
  if (air.sorties.some((s) => s.shipId === ship.id && w.time < s.readyAt)) return 'Hubschrauber ist unterwegs';
  const d = distance(ship.pos, target);
  if (d > HELO_RANGE) return 'Außer Reichweite des Hubschraubers (30 km)';
  air.stock.set(ship.id, left - 1);
  w.events.push({ kind: 'weapon', time: w.time, sourceId: ship.id, what: 'buoy' });
  const flight = d / HELO_SPEED;
  air.sorties.push({
    shipId: ship.id, from: { ...ship.pos }, target: { ...target }, launchAt: w.time,
    dropAt: w.time + flight, landAt: w.time + 2 * flight, readyAt: w.time + 2 * flight + HELO_TURNAROUND, deep, dropped: false,
  });
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
  for (const s of air.sorties) {
    if (!s.dropped && w.time >= s.dropAt) {
      s.dropped = true;
      const bottom = depthAt(w.env.seabed, s.target.x, s.target.y);
      const depth = Math.max(10, Math.min(s.deep ? (w.env.layerDepth > 0 ? w.env.layerDepth + 40 : 150) : BUOY_SHALLOW, bottom - 10));
      air.buoys.push({ id: `B${air.nextId++}`, ownerId: s.shipId, pos: s.target, depth, expiresAt: w.time + BUOY_LIFE });
    }
  }
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
      const se = sourceLevel(tgt) - transmissionLoss(range, tgt.depth, b.depth, ctx.env, undefined, pathDepth(ctx.env.seabed, b.pos, tgt.pos)) - (nl - BUOY_GAIN) - DT_PASSIVE + ctx.rng.gauss(0, 2);
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
