import { isConvoyShip } from './entities.js';
import { DEFAULT_ENV, torpedoSourceLevel, type Environment } from './acoustics.js';
import { ContactBook } from './contacts.js';
import { applyHitDamage, stepDamage } from './damage.js';
import { CLASSES } from './classes.js';
import { KN, headingVec } from './math.js';
import { depthAt } from './seabed.js';
import { keepOffShoals, shoalWarning } from './navigation.js';
import { stepWeather } from './weather.js';
import { stepMet } from './met-step.js';
import { stepConvoy, type ConvoyState } from './convoy-ai.js';
import type { Ship } from './entities.js';
import { stepShip } from './kinematics.js';
import { currentAt } from './currents.js';
import { Rng } from './rng.js';
import { interceptTransmission, runSensors, type Detection, type Emitter } from './sensors.js';
import type { Sighting } from './lookout.js';
import { whaleEmitters } from './incidents.js';
import type { WeaponsState } from './weapons.js';
import { buoySensors, type AirState } from './aviation.js';

export const SIM_DT = 0.1; // s, 10 Hz
export const SENSOR_INTERVAL = 1; // s

export type GameEvent =
  | { kind: 'transmission'; time: number; senderId: string; text: string }
  | { kind: 'sunk'; time: number; shipId: string; byId?: string }
  | { kind: 'arrived'; time: number; shipId: string }
  | { kind: 'torpedo_alert'; time: number; shipId: string; bearing: number }
  | { kind: 'transient'; time: number; sourceId: string; x: number; y: number; what: 'flood' | 'launch' | 'mishap' | 'blow' | 'splash' | 'sam' | 'mine' | 'sounding' }
  /** Something the crew reports aboard (air, wounded, hull failure, incidents). */
  | { kind: 'boat'; time: number; shipId: string; what: string; text: string }
  | { kind: 'weapon'; time: number; sourceId: string; what: 'torpedo' | 'rocket' | 'dc' | 'buoy' | 'ssm' }
  | { kind: 'grounded'; time: number; shipId: string }
  /** A warhead struck a ship (torpedo or depth charge) at x, y. */
  | { kind: 'hit'; time: number; shipId: string; byId?: string; x: number; y: number }
  /** Bridge lookout reports a new sighting (start of an episode, not every sweep). */
  | { kind: 'sighting'; time: number; shipId: string; label: string; bearing: number; range: number; what: Sighting }
  /** The Ostpakt's reconnaissance aircraft reports the convoy (fleet command passes it to the boats). */
  | { kind: 'recon'; time: number; x: number; y: number; course: number; speedKn: number }
  /** FLASH order read aboard, or its result (orders.ts). */
  | { kind: 'flash'; time: number; shipId: string; orderId: string; text: string; status?: 'done' | 'missed' }
  /** Team radio between surface ships (UHF line of sight, not DF'd like HF): AI escorts announce roles. */
  | { kind: 'teamradio'; time: number; senderId: string; text: string }
  /** Air defence: missile launched / hit / missed, interceptor fighters out, kill or no target. */
  | { kind: 'airdef'; time: number; what: 'launch' | 'kill' | 'miss' | 'fighter_out' | 'fighter_kill' | 'fighter_none'; team: 'west' | 'east'; shipId?: string; x: number; y: number }
  /** Naval mines: detected by an escort's sonar, or detonated under a ship. */
  | { kind: 'mine'; time: number; what: 'detected' | 'detonated'; mineId: string; team: 'west' | 'east'; shipId: string; x: number; y: number };

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
  for (const d of dets) {
    const tr = bookFor(w, d.observerId).ingest(d);
    if (d.sighting && tr.sightingSince === d.time) {
      w.events.push({ kind: 'sighting', time: d.time, shipId: d.observerId, label: tr.label, bearing: d.bearing, range: d.range ?? 0, what: d.sighting });
    }
  }
}

/** Send a radio message; enemies with antennas up get an ESM bearing on the sender. */
export function transmit(w: World, sender: Ship, text: string): void {
  w.events.push({ kind: 'transmission', time: w.time, senderId: sender.id, text });
  const dets = interceptTransmission(sender, { ships: w.ships, env: w.env, time: w.time, rng: w.rng });
  w.lastDetections.push(...dets);
  ingest(w, dets);
}

/** A voice transmission: no text, but every enemy ESM receiver in reach gets a bearing. */
export function voiceIntercept(w: World, sender: Ship): void {
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
  // A submarine in water too shallow to float her runs aground like a ship, she does not sail over land
  const stranded = sub && bottom < CLASSES[s.cls].draft + 1;
  if (!stranded && (sub ? s.depth <= limit : limit > 0)) return;
  // How fast she struck (before the ground stops her)
  const struckKn = s.speed / KN;
  if (sub && !stranded) {
    s.depth = Math.max(0, limit);
    if (s.order.depth > s.depth) s.order.depth = s.depth;
  } else {
    if (sub) s.depth = s.order.depth = 0;
    // She can work herself off, dead slow, where the water ahead is deeper; otherwise she sits fast
    const v = headingVec(s.heading);
    const ahead = depthAt(w.env.seabed, s.pos.x + v.x * 60, s.pos.y + v.y * 60);
    if (ahead > bottom + 0.3) s.speed = Math.min(s.speed, 1);
    else {
      s.order.speedKn = 0;
      s.speed = Math.min(s.speed, 0.3);
    }
  }
  const last = groundedAt.get(s) ?? -1e9;
  // Damage and the report come with the strike, not every minute while she sits on the ground
  if (w.time - last > 60 && struckKn > (sub ? 2 : 1)) {
    groundedAt.set(s, w.time);
    s.hp -= 8;
    applyHitDamage(s, 25, w.rng, { u: 0.03, fireChance: 0.05, w });
    w.events.push({ kind: 'grounded', time: w.time, shipId: s.id });
  }
}

/** A submarine's hull thermometer reveals the layer when the boat crosses it. */
function learnLayer(w: World, s: Ship): void {
  if (!s.alive || s.depth < 1 || w.env.layerDepth <= 0 || !CLASSES[s.cls].submarine) return;
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
    const merchants = w.ships.filter(isConvoyShip);
    const before = w.convoy.arrived.length;
    stepConvoy(w.convoy, merchants, dt, w.time);
    for (const id of w.convoy.arrived.slice(before)) w.events.push({ kind: 'arrived', time: w.time, shipId: id });
  }
  stepWeather(w.env, w.time, dt, w.rng);
  stepMet(w, dt);
  // Off the rocks: computer crews steer clear, players' navigators warn
  for (const s of w.ships) {
    if (s.autoNav) keepOffShoals(w, s);
    else if (s.playerId) shoalWarning(w, s);
  }
  for (const s of w.ships) {
    stepShip(s, dt, w.time);
    // Everything afloat drifts with the current at its depth (tide, two-layer straits)
    if (s.alive) {
      const c = currentAt(w.env, s.pos, s.depth, w.time);
      s.pos.x += c.x * dt;
      s.pos.y += c.y * dt;
    }
  }
  for (const s of w.ships) {
    checkGround(w, s);
    learnLayer(w, s);
    stepDamage(s, dt, w);
    if (s.alive && s.hp <= 0) {
      s.alive = false;
      s.order.speedKn = 0;
      w.events.push({ kind: 'sunk', time: w.time, shipId: s.id, byId: s.lastHitBy });
    }
  }
  for (const sys of w.systems) sys(w, dt);

  w.sensorAccum += dt;
  if (w.sensorAccum >= SENSOR_INTERVAL - 1e-9) {
    w.sensorAccum = 0;
    const knuckles = w.weapons?.decoys.filter((d) => d.knuckle);
    const ctx = { ships: w.ships, emitters: [...torpedoEmitters(w), ...whaleEmitters(w)], env: w.env, time: w.time, rng: w.rng, knuckles };
    w.lastDetections = runSensors(ctx);
    if (w.air) w.lastDetections.push(...buoySensors(w.air.buoys, ctx));
    ingest(w, w.lastDetections);
    for (const b of w.books.values()) b.expire(w.time);
  }
}
