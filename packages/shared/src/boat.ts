import { CLASSES } from './classes.js';
import { BAD_CO2, BAD_O2, airOf, crewOf } from './crew.js';
import { PERISCOPE_DEPTH, mastRaised, type Ship } from './entities.js';
import { isSnorkeling } from './kinematics.js';
import { compsOf } from './compartments.js';
import { KN, NM, headingVec } from './math.js';
import type { World } from './world.js';
import { stepCommandRadio } from './command-radio.js';
import { stepOrders } from './orders.js';
import { stepIncidents } from './incidents.js';
import { stepAirspace } from './airspace.js';
import { stepLights } from './lights.js';

/**
 * Boat and crew systems, run every tick: watches and fatigue, morale and wounded, air in
 * diesel boats, dead reckoning while submerged, trim after shots, high-pressure air and
 * emergency blows, the test depth, the crew's noise mishaps, and the knuckles (bubble
 * fields) that hard turns at speed leave behind.
 */

const H = 3600;
/** Dead-reckoning error cap (m) and the per-boat random walk (m/√s). */
const DR_MAX = 8 * NM;
const DR_WALK = 0.25;
const KNUCKLE_LIFE_S = 240;
const KNUCKLE_COOLDOWN_S = 25;
const HP_AIR_BOTTLES = 3;
const BLOW_S = 40;

const cursor = new WeakMap<World, number>();
const lastHp = new WeakMap<Ship, number>();
const lastKnuckle = new WeakMap<Ship, number>();

function say(w: World, s: Ship, what: string, text: string): void {
  w.events.push({ kind: 'boat', time: w.time, shipId: s.id, what, text });
}

/** Morale and wounded from what happened since the last tick (sinkings, hits). */
function reactToEvents(w: World): void {
  const from = cursor.get(w) ?? w.events.length;
  for (let i = from; i < w.events.length; i++) {
    const e = w.events[i]!;
    // A torpedo leaving the tube makes the boat 1.5 t light and bow-up until the trim is pumped
    if (e.kind === 'weapon' && e.what === 'torpedo') {
      const shooter = w.ships.find((x) => x.id === e.sourceId);
      if (shooter && CLASSES[shooter.cls].submarine) shooter.trim = (shooter.trim ?? 0) + 1.5;
      continue;
    }
    if (e.kind !== 'sunk') continue;
    const victim = w.ships.find((x) => x.id === e.shipId);
    for (const s of w.ships) {
      if (!s.alive || s.cls === 'merchant' || !victim) continue;
      const c = crewOf(s);
      if (e.byId === s.id) c.morale = Math.min(1, c.morale + 0.12);
      else if (victim.team === s.team) c.morale = Math.max(0, c.morale - 0.06);
    }
  }
  cursor.set(w, w.events.length);
}

function stepCrew(w: World, s: Ship, dt: number): void {
  const c = crewOf(s);
  // Three watches keep a ship at a steady low fatigue; battle stations wear everyone out in ~90 min
  if (c.battle) c.fatigue = Math.min(1, c.fatigue + (0.6 / H) * dt);
  else c.fatigue += ((c.fatigue > 0.25 ? -0.12 : 0.05) / H) * dt;
  c.morale += ((0.65 - c.morale) * 0.05 * dt) / H;
  // Hits wound people; the medic gets one back on his feet every 15 minutes
  const before = lastHp.get(s) ?? s.hp;
  if (s.hp < before - 3) {
    const hurt = 1 + Math.round((before - s.hp) / 12);
    c.wounded += hurt;
    c.morale = Math.max(0, c.morale - 0.15);
    say(w, s, 'wounded', `${hurt} VERWUNDETE · SANITÄTER UNTERWEGS`);
  }
  lastHp.set(s, s.hp);
  if (c.wounded > 0 && Math.floor((w.time - dt) / 900) !== Math.floor(w.time / 900)) c.wounded--;
}

function stepAir(w: World, s: Ship, dt: number): void {
  const a = airOf(s);
  if (!a) return;
  const wasBad = a.co2 > BAD_CO2 || a.o2 < BAD_O2;
  if (s.depth <= 0.5 || isSnorkeling(s)) {
    a.co2 = Math.max(0.1, a.co2 - (6 / H) * dt);
    a.o2 = Math.min(20.9, a.o2 + (6 / H) * dt);
  } else {
    a.co2 += (0.9 / H) * dt;
    a.o2 -= (0.7 / H) * dt;
    // The crew spreads absorbent and lights oxygen candles on their own while stores last
    if (a.co2 > 2.2 && a.scrubbers > 0) {
      a.co2 -= 1.5;
      a.scrubbers--;
    }
    if (a.o2 < 19 && a.candles > 0) {
      a.o2 += 1.5;
      a.candles--;
    }
  }
  const bad = a.co2 > BAD_CO2 || a.o2 < BAD_O2;
  if (bad && !wasBad) say(w, s, 'air', 'SCHLECHTE LUFT · CREW LÄSST NACH · SCHNORCHELN ODER AUFTAUCHEN');
}

/** Dead reckoning: a set (current) and small errors move the believed position until the next fix. */
function stepNav(w: World, s: Ship, dt: number): void {
  if (!CLASSES[s.cls].submarine) return;
  const e = (s.drErr ??= { x: 0, y: 0 });
  if (mastRaised(s) || s.depth <= 0.5) {
    // Fix from the mast (radar/visual/satnav): the error melts away within a minute
    const k = Math.min(1, dt / 20);
    e.x -= e.x * k;
    e.y -= e.y * k;
    s.lastFixAt = w.time;
    return;
  }
  const cur = (w.env.current ??= (() => {
    const a = w.rng.next() * Math.PI * 2;
    const v = w.rng.next() * 0.4 * KN;
    return { x: Math.cos(a) * v, y: Math.sin(a) * v };
  })());
  // An inertial navigator (SSN) drifts only about a third as much
  const f = s.cls === 'ssn' ? 0.3 : 1;
  e.x = Math.max(-DR_MAX, Math.min(DR_MAX, e.x - cur.x * f * dt + w.rng.gauss(0, DR_WALK * f * Math.sqrt(dt))));
  e.y = Math.max(-DR_MAX, Math.min(DR_MAX, e.y - cur.y * f * dt + w.rng.gauss(0, DR_WALK * f * Math.sqrt(dt))));
}

/** Trim pumps, compressors, emergency blow and the test depth. */
function stepBoat(w: World, s: Ship, dt: number): void {
  const spec = CLASSES[s.cls];
  if (!spec.submarine) return;
  s.hpAir ??= HP_AIR_BOTTLES;
  // Auto-trim: about 1.5 t per minute; flooding keeps making the boat heavy
  const leak = s.damage?.leck ?? 0;
  s.trim = (s.trim ?? 0) - leak * 0.02 * dt;
  s.trim -= Math.sign(s.trim) * Math.min(Math.abs(s.trim), 0.025 * dt);
  // Compressors refill a bottle every 15 minutes at the surface or on the snorkel
  if ((s.depth <= 0.5 || isSnorkeling(s)) && s.hpAir < HP_AIR_BOTTLES && Math.floor((w.time - dt) / 900) !== Math.floor(w.time / 900)) s.hpAir++;
  // Below the test depth: rising risk of sheared bolts, failing seals, a cracked hull
  const test = spec.maxDepth;
  if (test > 0 && s.depth > test) {
    const over = (s.depth - test) / (0.5 * test);
    if (over >= 0.95) {
      s.hp = 0;
      say(w, s, 'crush', 'DRUCKKÖRPER KOLLABIERT');
      return;
    }
    if (w.rng.next() < (0.002 + 0.04 * over * over) * dt) {
      const [text, leakAdd, hp] = over < 0.35
        ? ['BOLZEN ABGESCHERT · WASSEREINBRUCH', 0.15, 4]
        : over < 0.7 ? ['DICHTUNG VERSAGT · STARKER WASSEREINBRUCH', 0.3, 8] : ['RISS IM DRUCKKÖRPER', 0.55, 18];
      // A seam somewhere along the hull gives way
      const comps = compsOf(s);
      const c = comps[Math.floor(w.rng.next() * comps.length)]!;
      c.leak = Math.min(1, c.leak + leakAdd);
      s.hp -= hp;
      say(w, s, 'hull', `${text} · UNTER TESTTIEFE`);
    }
  }
}

/** Emergency blow: costs a bottle of high-pressure air, drives the boat up fast and loud. */
export function emergencyBlow(w: World, s: Ship): true | string {
  if (!CLASSES[s.cls].submarine) return 'Nur für U-Boote';
  if ((s.blowUntil ?? 0) > w.time) return 'Anblasen läuft schon';
  if ((s.hpAir ?? HP_AIR_BOTTLES) <= 0) return 'Keine Pressluft mehr';
  s.hpAir = (s.hpAir ?? HP_AIR_BOTTLES) - 1;
  s.blowUntil = w.time + BLOW_S;
  s.order.depth = 0;
  w.events.push({ kind: 'transient', time: w.time, sourceId: s.id, x: s.pos.x, y: s.pos.y, what: 'blow' });
  return true;
}

/** Crew mishaps: a dropped tool, a slammed hatch: rarer under silent running, likelier when tired or low. */
function stepMishaps(w: World, s: Ship, dt: number): void {
  if (!CLASSES[s.cls].submarine || s.depth <= 0.5) return;
  const c = crewOf(s);
  const perHour = 1.5 * (1 + 2 * c.fatigue) * (c.morale < 0.4 ? 1.5 : 1) * (c.silent ? 0.3 : 1) * (c.battle ? 0.7 : 1);
  if (w.rng.next() < (perHour / H) * dt) {
    w.events.push({ kind: 'transient', time: w.time, sourceId: s.id, x: s.pos.x, y: s.pos.y, what: 'mishap' });
    say(w, s, 'mishap', 'LÄRM IM BOOT · METALLISCHER SCHLAG');
  }
}

/** Knuckle: a hard turn at speed leaves a bubble field that blocks sound and fools active seekers. */
function stepKnuckles(w: World, s: Ship): void {
  if (!w.weapons || s.speed / KN < 10) return;
  const spec = CLASSES[s.cls];
  const maxRate = Math.min(spec.turnRateDeg, ((s.speed / spec.turnRadius) * 180) / Math.PI);
  if (Math.abs(s.yawRate ?? 0) < 0.6 * maxRate) return;
  if (w.time - (lastKnuckle.get(s) ?? -1e9) < KNUCKLE_COOLDOWN_S) return;
  lastKnuckle.set(s, w.time);
  const back = headingVec(s.heading);
  w.weapons.decoys.push({
    id: `K${w.weapons.nextId++}`, pos: { x: s.pos.x - back.x * 40, y: s.pos.y - back.y * 40 }, depth: spec.submarine ? s.depth : 4,
    sl: 0, ts: 12, knuckle: true, expiresAt: w.time + KNUCKLE_LIFE_S,
  });
}

export function boatSystem(w: World, dt: number): void {
  reactToEvents(w);
  if (Math.floor(w.time) !== Math.floor(w.time - dt)) stepLights(w);
  stepCommandRadio(w, dt);
  stepOrders(w, dt);
  stepIncidents(w, dt);
  stepAirspace(w, dt);
  for (const s of w.ships) {
    if (!s.alive || s.cls === 'merchant' || s.team === 'neutral') continue;
    stepCrew(w, s, dt);
    stepAir(w, s, dt);
    stepNav(w, s, dt);
    stepBoat(w, s, dt);
    stepMishaps(w, s, dt);
    stepKnuckles(w, s);
  }
}

export function installBoats(w: World): void {
  if (!w.systems.includes(boatSystem)) w.systems.push(boatSystem);
  cursor.set(w, w.events.length);
  for (const s of w.ships) {
    if (!CLASSES[s.cls].submarine || s.cls === 'merchant') continue;
    // Last fix about half an hour before the action
    s.lastFixAt ??= w.time - 1800;
    const a = airOf(s);
    // Boats have usually been down for hours before the action starts
    if (a && a.co2 < 0.5) {
      a.co2 = 1 + w.rng.next() * 0.8;
      a.o2 = 20.2 - w.rng.next() * 0.6;
    }
  }
}

export { PERISCOPE_DEPTH };
