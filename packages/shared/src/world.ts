import { DEFAULT_ENV, torpedoSourceLevel, type Environment } from './acoustics.js';
import { ContactBook } from './contacts.js';
import { applyHitDamage, stepDamage } from './damage.js';
import { CLASSES } from './classes.js';
import { KN } from './math.js';
import { depthAt } from './seabed.js';
import { stepWeather } from './weather.js';
import { stepConvoy, type ConvoyState } from './convoy-ai.js';
import type { Ship } from './entities.js';
import { stepShip } from './kinematics.js';
import { Rng } from './rng.js';
import { interceptTransmission, runSensors, type Detection, type Emitter } from './sensors.js';
import type { WeaponsState } from './weapons.js';
import { buoySensors, type AirState } from './aviation.js';

export const SIM_DT = 0.1; // s, 10 Hz
export const SENSOR_INTERVAL = 1; // s

export type GameEvent =
  | { kind: 'transmission'; time: number; senderId: string; text: string }
  | { kind: 'sunk'; time: number; shipId: string; byId?: string }
  | { kind: 'arrived'; time: number; shipId: string }
  | { kind: 'torpedo_alert'; time: number; shipId: string; bearing: number }
  | { kind: 'transient'; time: number; sourceId: string; x: number; y: number; what: 'flood' | 'launch' }
  | { kind: 'weapon'; time: number; sourceId: string; what: 'torpedo' | 'rocket' | 'dc' | 'buoy' }
  | { kind: 'grounded'; time: number; shipId: string };

export interface World {
  time: number;
  ships: Ship[];
  env: Environment;
  rng: Rng;
  convoy?: ConvoyState;
  weapons?: WeaponsState;
  air?: AirState;
  books: Map<string, ContactBook>;
  /** Detections of the latest sensor cycle (server-side truth, filter before sending). */
  lastDetections: Detection[];
  events: GameEvent[];
  sensorAccum: number;
  /** Extension hooks run every tick (weapons, rules). */
  systems: Array<(w: World, dt: number) => void>;
}

export function createWorld(ships: Ship[], seed = 1, env: Environment = DEFAULT_ENV): World {
  return {
    time: 0, ships, env: { ...env }, rng: new Rng(seed), books: new Map(),
    lastDetections: [], events: [], sensorAccum: 0, systems: [],
  };
}

export function bookFor(w: World, shipId: string): ContactBook {
  let b = w.books.get(shipId);
  if (!b) {
    b = new ContactBook();
    w.books.set(shipId, b);
  }
  return b;
}

export function shipById(w: World, id: string): Ship | undefined {
  return w.ships.find((s) => s.id === id);
}

function ingest(w: World, dets: Detection[]): void {
  for (const d of dets) bookFor(w, d.observerId).ingest(d);
}

/** Send a radio message; enemies with antennas up get an ESM bearing on the sender. */
export function transmit(w: World, sender: Ship, text: string): void {
  w.events.push({ kind: 'transmission', time: w.time, senderId: sender.id, text });
  const dets = interceptTransmission(sender, { ships: w.ships, env: w.env, time: w.time, rng: w.rng });
  w.lastDetections.push(...dets);
  ingest(w, dets);
}

const groundedAt = new WeakMap<Ship, number>();

/** Seabed and shoals: a boat can't dive into the ground; ships run aground in shallows. */
function checkGround(w: World, s: Ship): void {
  if (!s.alive || !w.env.seabed) return;
  const bottom = depthAt(w.env.seabed, s.pos.x, s.pos.y);
  const sub = CLASSES[s.cls].submarine;
  const limit = sub ? bottom - 8 : bottom - CLASSES[s.cls].draft - 1;
  if (sub ? s.depth <= limit : limit > 0) return;
  if (sub) {
    s.depth = Math.max(0, limit);
    if (s.order.depth > s.depth) s.order.depth = s.depth;
  } else {
    s.order.speedKn = 0;
    s.speed = Math.min(s.speed, 0.3);
  }
  const last = groundedAt.get(s) ?? -1e9;
  if (w.time - last > 60 && (s.speed / KN > 2 || !sub)) {
    groundedAt.set(s, w.time);
    s.hp -= 8;
    applyHitDamage(s, 25, w.rng);
    w.events.push({ kind: 'grounded', time: w.time, shipId: s.id });
  }
}

/** A submarine's hull thermometer reveals the layer when the boat crosses it. */
function learnLayer(w: World, s: Ship): void {
  if (!s.alive || s.depth < 1 || w.env.layerDepth <= 0 || s.cls === 'ffg' || s.cls === 'merchant') return;
  const side = s.depth > w.env.layerDepth ? 'below' : 'above';
  if (s.layerSide && s.layerSide !== side) s.btLayer = Math.round(w.env.layerDepth + w.rng.gauss(0, 3));
  s.layerSide = side;
}

/** Bathythermograph: an expendable probe (frigate) measures the layer depth. */
export function measureLayer(w: World, s: Ship): void {
  s.btLayer = w.env.layerDepth > 0 ? Math.round(w.env.layerDepth + w.rng.gauss(0, 4)) : 0;
}

/** Running torpedoes are loud noise sources that every sonar can hear. */
function torpedoEmitters(w: World): Emitter[] {
  return (w.weapons?.torpedoes ?? []).map((t) => ({
    id: t.id, ownerId: t.ownerId, pos: t.pos, depth: t.depth, sig: 'torpedo' as const,
    speedKn: t.speedKn, sl: torpedoSourceLevel(t.speedKn),
  }));
}

export function stepWorld(w: World, dt = SIM_DT): void {
  w.time += dt;
  if (w.convoy) {
    const merchants = w.ships.filter((s) => s.cls === 'merchant');
    const before = w.convoy.arrived.length;
    stepConvoy(w.convoy, merchants, dt, w.time);
    for (const id of w.convoy.arrived.slice(before)) w.events.push({ kind: 'arrived', time: w.time, shipId: id });
  }
  stepWeather(w.env, w.time, dt, w.rng);
  for (const s of w.ships) stepShip(s, dt, w.time);
  for (const s of w.ships) {
    checkGround(w, s);
    learnLayer(w, s);
    stepDamage(s, dt);
    if (s.alive && s.hp <= 0) {
      s.alive = false;
      s.order.speedKn = 0;
      w.events.push({ kind: 'sunk', time: w.time, shipId: s.id });
    }
  }
  for (const sys of w.systems) sys(w, dt);

  w.sensorAccum += dt;
  if (w.sensorAccum >= SENSOR_INTERVAL - 1e-9) {
    w.sensorAccum = 0;
    const ctx = { ships: w.ships, emitters: torpedoEmitters(w), env: w.env, time: w.time, rng: w.rng };
    w.lastDetections = runSensors(ctx);
    if (w.air) w.lastDetections.push(...buoySensors(w.air.buoys, ctx));
    ingest(w, w.lastDetections);
    for (const b of w.books.values()) b.expire(w.time);
  }
}
