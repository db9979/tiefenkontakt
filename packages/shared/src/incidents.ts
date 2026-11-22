import { CLASSES } from './classes.js';
import { createShip, isConvoyShip, type Ship } from './entities.js';
import { isSnorkeling } from './kinematics.js';
import { KN, distance, headingVec, wrap360, type Vec2 } from './math.js';
import type { Emitter } from './sensors.js';
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
  whales: { id: string; x: number; y: number; heading: number; until: number }[];
  frontAt?: number;
  neutrals: number;
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
    () => {
      const convoy = w.ships.filter((s) => isConvoyShip(s) && s.alive);
      const c = convoy.length ? convoy[0]!.pos : any.pos;
      const across = wrap360((w.convoy?.guideHeading ?? 0) + (w.rng.next() < 0.5 ? 90 : -90));
      const v = headingVec(across + 180);
      const n = createShip({
        id: `n${++st.neutrals}`, cls: 'merchant', name: 'Frachter ohne AIS', team: 'neutral',
        pos: { x: c.x + v.x * 16_000 + w.rng.gauss(0, 3000), y: c.y + v.y * 16_000 + w.rng.gauss(0, 3000) }, heading: across, speedKn: 12,
      });
      w.ships.push(n);
    },
    () => {
      const p = ahead(any, 6000 + w.rng.next() * 6000, w.rng.gauss(0, 60));
      st.whales.push({ id: `W${w.time.toFixed(0)}`, x: p.x, y: p.y, heading: w.rng.next() * 360, until: w.time + WHALE_LIFE_S });
    },
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

/** Whale pods as noise sources for passive sonar (no blades, low tonals). */
export function whaleEmitters(w: World): Emitter[] {
  const st = w.env.incidents;
  return (st?.whales ?? []).map((h) => ({ id: h.id, ownerId: '', pos: { x: h.x, y: h.y }, depth: 30, sl: 165, sig: 'bio' as const, speedKn: 3 }));
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
    h.heading = wrap360(h.heading + w.rng.gauss(0, 0.5));
    const v = headingVec(h.heading);
    h.x += v.x * 1.5 * dt;
    h.y += v.y * 1.5 * dt;
  }
  // Neutral traffic just steams across
  for (const s of w.ships) if (s.team === 'neutral' && s.alive) s.order.speedKn = 12;
}

export function installIncidents(w: World): void {
  w.env.incidents = { next: w.time + 900 + w.rng.next() * 600, nets: [], whales: [], neutrals: 0 };
}
