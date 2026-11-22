import { CLASSES } from './classes.js';
import { type Ship } from './entities.js';
import { isSnorkeling } from './kinematics.js';
import { KN, distance, headingVec, wrap360, type Vec2 } from './math.js';
import type { Emitter } from './sensors.js';
import type { BioKind } from './signatures.js';
import { BIO_SOURCE, installTraffic, spawnBio, spawnNeutral, stepTraffic } from './traffic.js';
import { installAirspace } from './airspace.js';
import { depthAt } from './seabed.js';
import type { World } from './world.js';

/**
 * Incidents at sea, every 15–30 minutes, for both sides alike: a driftnet that tears off
 * towed arrays and fouls shallow boats, a forecast weather front, a merchant without AIS
 * crossing the area, a pod of whales on the sonar, a jammed rudder, and on diesel boats a
 * snorkel valve stuck open or hydrogen in the battery.
 */

export interface IncidentState {
  next: number;
  nets: { x: number; y: number; r: number; until: number }[];
  whales: { id: string; x: number; y: number; heading: number; until: number; kind?: BioKind }[];
  frontAt?: number;
  neutrals: number;
  /** Neutral ships kept in the area, and the next time traffic looks ahead. */
  traffic?: number;
  nextLook?: number;
}

const NET_R = 900;
const NET_LIFE_S = 1800;
const WHALE_LIFE_S = 2400;

function say(w: World, s: Ship, what: string, text: string): void {
  w.events.push({ kind: 'boat', time: w.time, shipId: s.id, what, text });
}

function combatants(w: World): Ship[] {
  return w.ships.filter((s) => s.alive && s.cls !== 'merchant' && s.team !== 'neutral');
}

function ahead(s: Ship, m: number, side = 0): Vec2 {
  const v = headingVec(s.heading + side);
  return { x: s.pos.x + v.x * m, y: s.pos.y + v.y * m };
}

/** Pick and start one incident that fits the current situation. */
function trigger(w: World, st: IncidentState): void {
  const ships = combatants(w);
  if (!ships.length) return;
  const any = ships[Math.floor(w.rng.next() * ships.length)]!;
  const subs = ships.filter((s) => CLASSES[s.cls].submarine);
  const snorkelers = subs.filter((s) => isSnorkeling(s) && !!CLASSES[s.cls].battery);
  const options: (() => void)[] = [
    () => {
      const p = ahead(any, 2500 + w.rng.next() * 3000, w.rng.gauss(0, 25));
      st.nets.push({ x: p.x, y: p.y, r: NET_R, until: w.time + NET_LIFE_S });
    },
    () => {
      st.frontAt = w.time + 1200;
      for (const s of ships) say(w, s, 'front', 'WETTERWARNUNG · FRONT IN 20 MIN · SEEGANG STEIGT, REGEN');
    },
    // A ship that wasn't expected: extra neutral traffic crossing the area
    () => void spawnNeutral(w),
    // Sea life: whales, dolphins or a snapping-shrimp bed, depending on the water
    () => spawnBio(w, w.time + WHALE_LIFE_S),
    () => {
      any.rudderJamUntil = w.time + 60;
      sayRudder(w, any);
    },
  ];
  if (snorkelers.length) {
    const s = snorkelers[Math.floor(w.rng.next() * snorkelers.length)]!;
    options.push(() => {
      s.snorkelStuckUntil = w.time + 45;
      say(w, s, 'valve', 'SCHNORCHELKOPFVENTIL KLEMMT · SCHNORCHEL BLEIBT 45 S OBEN');
    });
    options.push(() => {
      s.batteryGasUntil = w.time + 300;
      say(w, s, 'gas', 'WASSERSTOFF IN DER BATTERIE · 5 MIN WEITER SCHNORCHELN UND LÜFTEN');
    });
  }
  options[Math.floor(w.rng.next() * options.length)]!();
}

function sayRudder(w: World, s: Ship): void {
  say(w, s, 'rudder', 'RUDERVERSAGER · RUDER KLEMMT · NOTSTEUERUNG IN 60 S');
}

/** Whales, dolphins and shrimp beds as noise sources for passive sonar. */
export function whaleEmitters(w: World): Emitter[] {
  const st = w.env.incidents;
  return (st?.whales ?? []).map((h) => {
    const b = BIO_SOURCE[h.kind ?? 'bio'];
    const depth = b.depth >= 0 ? b.depth : Math.max(5, (w.env.seabed ? depthAt(w.env.seabed, h.x, h.y) : 30) - 2);
    return { id: h.id, ownerId: '', pos: { x: h.x, y: h.y }, depth, sl: b.sl, sig: h.kind ?? ('bio' as const), speedKn: b.kn };
  });
}

export function stepIncidents(w: World, dt: number): void {
  const st = w.env.incidents;
  if (!st) return;
  if (w.time >= st.next) {
    st.next = w.time + 900 + w.rng.next() * 900;
    trigger(w, st);
  }
  // Weather front arrives
  if (st.frontAt !== undefined && w.time >= st.frontAt) {
    st.frontAt = undefined;
    w.env.seaState = Math.min(6, w.env.seaState + 2);
    if (w.env.weather) w.env.weather.rainUntil = w.time + 1800;
    w.env.rain = true;
  }
  // Nets: tear off towed arrays, foul shallow boats for 20 s
  st.nets = st.nets.filter((n) => n.until > w.time);
  for (const s of combatants(w)) {
    s.snagged = (s.snagUntil ?? 0) > w.time;
    if (s.snagged) s.speed = Math.min(s.speed, 1 * KN);
    for (const n of st.nets) {
      if (distance(s.pos, n) > n.r) continue;
      if (s.towedLength > 0) {
        s.towedLength = 0;
        s.towedOrder = 0;
        s.towedLostUntil = w.time + 900;
        say(w, s, 'net', 'SCHLEPPSONAR IM TREIBNETZ ABGERISSEN · ERSATZ IN 15 MIN');
      }
      if (CLASSES[s.cls].submarine && s.depth < 20 && !s.snagged && (s.snagUntil ?? -1e9) < w.time - 120) {
        s.snagUntil = w.time + 20;
        say(w, s, 'net', 'IM TREIBNETZ VERFANGEN · BOOT HÄNGT FEST UND MACHT LÄRM');
      }
    }
    // Battery gas: stopping the ventilation (diving off the snorkel) too early ignites it
    if (s.batteryGasUntil !== undefined) {
      if (w.time >= s.batteryGasUntil) s.batteryGasUntil = undefined;
      else if (!isSnorkeling(s) && s.depth > 0.5) {
        s.batteryGasUntil = undefined;
        s.hp -= 8;
        const d = (s.damage ??= { antrieb: 0, sonar: 0, waffen: 0, leck: 0 });
        d.antrieb = Math.min(1, d.antrieb + 0.35);
        say(w, s, 'gas', 'BATTERIEGAS VERPUFFT · BRAND IM BATTERIERAUM · ANTRIEB BESCHÄDIGT');
      }
    }
    if ((s.snorkelStuckUntil ?? 0) > w.time) s.snorkel = true;
  }
  // Whales wander slowly
  st.whales = st.whales.filter((h) => h.until > w.time);
  for (const h of st.whales) {
    const kn = BIO_SOURCE[h.kind ?? 'bio'].kn;
    if (!kn) continue;
    h.heading = wrap360(h.heading + w.rng.gauss(0, 0.5));
    const v = headingVec(h.heading);
    h.x += v.x * kn * 0.5144 * dt;
    h.y += v.y * kn * 0.5144 * dt;
  }
  stepTraffic(w);
}

export function installIncidents(w: World): void {
  w.env.incidents = { next: w.time + 900 + w.rng.next() * 600, nets: [], whales: [], neutrals: 0 };
  installTraffic(w);
  installAirspace(w);
}
