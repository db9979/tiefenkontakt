import { currentAt } from './currents.js';
import { stepFixes } from './navfix.js';
import { CLASSES } from './classes.js';
import { BAD_CO2, BAD_O2, airOf, crewOf } from './crew.js';
import { PERISCOPE_DEPTH, mastRaised, type Ship } from './entities.js';
import { MAST_MAX_KN, isSnorkeling } from './kinematics.js';
import type { ClassId } from './classes.js';
import { compsOf } from './compartments.js';
import { KN, NM, headingVec } from './math.js';
import type { World } from './world.js';
import { stepCommandRadio } from './command-radio.js';
import { stepOrders } from './orders.js';
import { stepIncidents } from './incidents.js';
import { stepAirspace } from './airspace.js';
import { stepAirDefense } from './airdef.js';
import { stepAntiShip } from './antiship.js';
import { stepLights } from './lights.js';

/**
 * Boat and crew systems, run every tick: watches and fatigue, morale and wounded, air in
 * diesel boats, dead reckoning while submerged, trim after shots, high-pressure air and
 * emergency blows, the test depth, battle stations on an alarm, the noise the crew's own
 * work makes (reloading or pumping trim under silent running, a crash dive), and the
 * knuckles (bubble fields) that hard turns at speed leave behind.
 */

const H = 3600;
/** Dead-reckoning error cap (m) and the per-boat random walk (m/√s). */
const DR_MAX = 8 * NM;
const DR_WALK = 0.25;
const KNUCKLE_LIFE_S = 240;
const KNUCKLE_COOLDOWN_S = 25;
const HP_AIR_BOTTLES = 3;
const BLOW_S = 40;
/** Air in a closed-up diesel boat (% per hour): about 0.12 % CO2 more, a little more O2 used. */
const CO2_RISE_H = 0.12;
const O2_USE_H = 0.14;
/** Battle stations called on an alarm stand down this long after the last one (s). */
const BATTLE_HOLD_S = 1200;
/** Crash dive: from near the surface, ordered this much deeper at this share of top speed or more. */
const CRASH_FROM_M = 30;
const CRASH_DEEPER_M = 30;
const CRASH_SPEED_SHARE = 0.6;

/**
 * A damaged pressure hull (cracked frames, leaking hull fittings, sprung valves) no longer
 * stands its test depth: the captain orders a reduced limit. The test depth falls by 40 % of
 * the worst compartment's damage (a wrecked compartment: 60 % of the test depth left); the
 * crush depth falls with it.
 */
export const HULL_DEPTH_LOSS = 0.4;
/** Crush depth as a multiple of the test depth (boat.ts: hull collapses at 95 % of half again). */
export const CRUSH_FACTOR = 1 + 0.5 * 0.95;

/** Worst structural damage among the compartments (0 = sound … 1 = wrecked). */
export function hullDamage(comps?: readonly { dmg: number }[]): number {
  return comps?.length ? Math.min(1, Math.max(0, ...comps.map((c) => c.dmg))) : 0;
}

/** Test depth (m) a boat of this class may use with these compartments (undamaged: the class value). */
export function depthLimitOf(cls: ClassId, comps?: readonly { dmg: number }[]): number {
  return Math.round(CLASSES[cls].maxDepth * (1 - HULL_DEPTH_LOSS * hullDamage(comps)));
}

/** Present test depth (m) of a boat after hull damage. */
export function depthLimit(s: Ship): number {
  return depthLimitOf(s.cls, s.comps);
}

/** Crush depth (m) with the present hull. */
export function crushDepth(s: Ship): number {
  return Math.round(depthLimit(s) * CRUSH_FACTOR);
}

/** Heavy sea at periscope depth: chance per second of a broach, of the snorkel head valve shutting. */
export function broachChanceS(seaState: number, kn: number): number {
  // About 3 % a minute per sea state above 4 when slow (SS6: one in some 17 minutes), a third with way on
  return seaState < 5 ? 0 : (0.03 * (seaState - 4) * (kn < 4 ? 1 : 0.3)) / 60;
}
export function headValveChanceS(seaState: number): number {
  // 15 % a minute per sea state above 3 (SS5: about every three minutes)
  return seaState < 4 ? 0 : (0.15 * (seaState - 3)) / 60;
}
/** How long a broach throws the boat up (s) and the head valve stays shut (s, 20–40). */
export const BROACH_S = 20;
const VALVE_MIN_S = 20;
const VALVE_SPREAD_S = 20;
const VALVE_SAY_GAP_S = 180;

const cursor = new WeakMap<World, number>();
const lastLimit = new WeakMap<Ship, number>();
const valveSaid = new WeakMap<Ship, number>();
const lastHp = new WeakMap<Ship, number>();
const lastKnuckle = new WeakMap<Ship, number>();
/** Last alarm that called battle stations (only when the crew called them itself). */
const autoBattle = new WeakMap<Ship, number>();
/** Noise from the crew's work: tubes being reloaded, trim pumps running, crash dive under way. */
const work = new WeakMap<Ship, { reloading: number; pumping: boolean; crashing: boolean }>();

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
    // An alarm (torpedo in the water, a hit) sends the crew to battle stations on its own
    if ((e.kind === 'torpedo_alert' || e.kind === 'hit') && e.shipId) {
      const s = w.ships.find((x) => x.id === e.shipId);
      if (s?.alive && s.cls !== 'merchant' && s.team !== 'neutral') {
        const c = crewOf(s);
        if (!c.battle) {
          c.battle = true;
          say(w, s, 'battle', 'GEFECHTSSTATIONEN · ALARM');
          autoBattle.set(s, w.time);
        } else if (autoBattle.has(s)) autoBattle.set(s, w.time);
      }
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
  // Battle stations the crew called on an alarm end when it has been quiet for a while
  const since = autoBattle.get(s);
  if (since !== undefined && (!c.battle || w.time - since > BATTLE_HOLD_S)) {
    autoBattle.delete(s);
    if (c.battle) {
      c.battle = false;
      say(w, s, 'battle', 'GEFECHTSSTATIONEN AUFGEHOBEN');
    }
  }
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
    a.co2 += (CO2_RISE_H / H) * dt;
    a.o2 -= (O2_USE_H / H) * dt;
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
  w.env.current ??= (() => {
    const a = w.rng.next() * Math.PI * 2;
    const v = w.rng.next() * 0.4 * KN;
    return { x: Math.cos(a) * v, y: Math.sin(a) * v };
  })();
  // The boat is set by the current without knowing it: the believed position stays behind
  const cur = currentAt(w.env, s.pos, s.depth, w.time);
  // An inertial navigator (SSN) drifts only about a third as much
  const f = s.cls === 'ssn' ? 0.3 : 1;
  e.x = Math.max(-DR_MAX, Math.min(DR_MAX, e.x - cur.x * f * dt + w.rng.gauss(0, DR_WALK * f * Math.sqrt(dt))));
  e.y = Math.max(-DR_MAX, Math.min(DR_MAX, e.y - cur.y * f * dt + w.rng.gauss(0, DR_WALK * f * Math.sqrt(dt))));
  // The navigator's estimate grows with the unknown set (about a quarter knot) and the walk
  s.navSigma = Math.min(DR_MAX, (s.navSigma ?? 60) + 0.25 * KN * f * dt);
  // A fix needs a method: land in sight, a satellite pass, stars (navfix.ts)
  stepFixes(w, s, dt);
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
  // A damaged hull: the captain is told the new limit as soon as it drops
  const test = depthLimit(s);
  const before = lastLimit.get(s) ?? spec.maxDepth;
  if (test <= before - 5) say(w, s, 'depthlimit', `TIEFENBESCHRÄNKUNG ${test} M · DRUCKKÖRPER BESCHÄDIGT`);
  if (test <= before - 5 || test > before) lastLimit.set(s, test);
  // Below the test depth: rising risk of sheared bolts, failing seals, a cracked hull
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

/**
 * Heavy sea at periscope depth (sea state 5 and more): the swell may throw a slow boat up until
 * her conning tower breaks the surface (seen by radar and lookouts, kinematics.ts lifts her), and
 * from sea state 4 a wave over the snorkel head shuts its valve: the diesels stop, the boat's air
 * is sucked into them (ears pop) and the charge is lost for 20–40 s.
 */
function stepHeavySea(w: World, s: Ship, dt: number): void {
  if (!CLASSES[s.cls].submarine || s.depth <= 0.5 || s.depth > PERISCOPE_DEPTH + 0.5) return;
  const ss = w.env.seaState;
  const kn = s.speed / KN;
  const p = broachChanceS(ss, kn);
  if (p > 0 && (s.broachUntil ?? 0) <= w.time && s.order.depth <= PERISCOPE_DEPTH + 1 && w.rng.next() < p * dt) {
    s.broachUntil = w.time + BROACH_S;
    say(w, s, 'broach', `BOOT BRICHT DURCH · TURM ÜBER WASSER · SEEGANG ${ss}`);
  }
  const v = headValveChanceS(ss);
  if (v > 0 && isSnorkeling(s) && (s.headValveUntil ?? 0) <= w.time && w.rng.next() < v * dt) {
    s.headValveUntil = w.time + VALVE_MIN_S + w.rng.next() * VALVE_SPREAD_S;
    if (w.time - (valveSaid.get(s) ?? -1e9) >= VALVE_SAY_GAP_S) {
      valveSaid.set(s, w.time);
      say(w, s, 'headvalve', 'KOPFVENTIL SCHLÄGT ZU · DIESEL AUS · LADUNG UNTERBROCHEN');
    }
  }
}

/** Mast and periscope can't stand above MAST_MAX_KN: the crew lowers them and reports it. */
function stepMastSpeed(w: World, s: Ship): void {
  if (!CLASSES[s.cls].submarine || !s.mastUp || s.speed / KN <= MAST_MAX_KN + 0.05) return;
  s.mastUp = false;
  s.radarOn = false;
  say(w, s, 'mast', 'MAST EINGEFAHREN · ÜBER 10 KN BRICHT ER AB');
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

function transient(w: World, s: Ship, text: string): void {
  w.events.push({ kind: 'transient', time: w.time, sourceId: s.id, x: s.pos.x, y: s.pos.y, what: 'mishap' });
  say(w, s, 'mishap', text);
}

/**
 * The crew's own work makes the noise, not chance: under silent running a reload starting in
 * the torpedo room and the trim pumps starting up are heard outside; a crash dive (flooding
 * vents, planes hard down at speed) always is.
 */
function stepWorkNoise(w: World, s: Ship): void {
  const spec = CLASSES[s.cls];
  if (!spec.submarine) return;
  const silent = !!s.crew?.silent;
  const st = work.get(s) ?? { reloading: 0, pumping: false, crashing: false };
  const reloading = w.weapons?.loadouts.get(s.id)?.tubes.filter((t) => !t.loaded && t.reloadDoneAt > 0).length ?? 0;
  if (silent && s.depth > 0.5 && reloading > st.reloading) transient(w, s, 'NACHLADEN IST LAUT · RUHE IM BOOT GESTÖRT');
  const pumping = Math.abs(s.trim ?? 0) > 0.2;
  if (silent && s.depth > 0.5 && pumping && !st.pumping) transient(w, s, 'TRIMMPUMPEN LAUFEN · HÖRBAR');
  const crashing = s.depth < CRASH_FROM_M && s.order.depth >= s.depth + CRASH_DEEPER_M && s.order.speedKn >= spec.maxSpeedKn * CRASH_SPEED_SHARE;
  if (crashing && !st.crashing) transient(w, s, 'SCHNELLTAUCHEN · FLUTEN UND KLAPPERN IM BOOT');
  // A crash dive counts once until the boat is back near the surface
  work.set(s, { reloading, pumping, crashing: crashing || (st.crashing && s.depth < CRASH_FROM_M + CRASH_DEEPER_M) });
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
  stepAirDefense(w, dt);
  stepAntiShip(w, dt);
  for (const s of w.ships) {
    if (!s.alive || s.cls === 'merchant' || s.team === 'neutral') continue;
    stepCrew(w, s, dt);
    stepAir(w, s, dt);
    stepNav(w, s, dt);
    stepBoat(w, s, dt);
    stepHeavySea(w, s, dt);
    stepMastSpeed(w, s);
    stepWorkNoise(w, s);
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
    s.navSigma ??= 60 + 1800 * 0.25 * KN * (s.cls === 'ssn' ? 0.3 : 1);
    const a = airOf(s);
    // Boats have usually been down for hours before the action starts
    if (a && a.co2 < 0.5) {
      a.co2 = 1 + w.rng.next() * 0.8;
      a.o2 = 20.2 - w.rng.next() * 0.6;
    }
  }
}

export { PERISCOPE_DEPTH };
