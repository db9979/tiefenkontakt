import { DEFAULT_ENV, type Environment } from './acoustics.js';
import { ContactBook } from './contacts.js';
import { stepConvoy, type ConvoyState } from './convoy-ai.js';
import type { Ship } from './entities.js';
import { stepShip } from './kinematics.js';
import { Rng } from './rng.js';
import { interceptTransmission, runSensors, type Detection } from './sensors.js';
import type { WeaponsState } from './weapons.js';

export const SIM_DT = 0.1; // s, 10 Hz
export const SENSOR_INTERVAL = 1; // s

export type GameEvent =
  | { kind: 'transmission'; time: number; senderId: string; text: string }
  | { kind: 'sunk'; time: number; shipId: string; byId?: string }
  | { kind: 'arrived'; time: number; shipId: string }
  | { kind: 'torpedo_alert'; time: number; shipId: string; bearing: number };

export interface World {
  time: number;
  ships: Ship[];
  env: Environment;
  rng: Rng;
  convoy?: ConvoyState;
  weapons?: WeaponsState;
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

export function stepWorld(w: World, dt = SIM_DT): void {
  w.time += dt;
  if (w.convoy) {
    const merchants = w.ships.filter((s) => s.cls === 'merchant');
    const before = w.convoy.arrived.length;
    stepConvoy(w.convoy, merchants, dt, w.time);
    for (const id of w.convoy.arrived.slice(before)) w.events.push({ kind: 'arrived', time: w.time, shipId: id });
  }
  for (const s of w.ships) stepShip(s, dt, w.time);
  for (const sys of w.systems) sys(w, dt);

  w.sensorAccum += dt;
  if (w.sensorAccum >= SENSOR_INTERVAL - 1e-9) {
    w.sensorAccum = 0;
    w.lastDetections = runSensors({ ships: w.ships, env: w.env, time: w.time, rng: w.rng });
    ingest(w, w.lastDetections);
    for (const b of w.books.values()) b.expire(w.time);
  }
}
