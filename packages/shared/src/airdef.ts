import { planesFor, type Plane } from './airspace.js';
import type { ClassId, Team } from './classes.js';
import { weaponsBroken } from './damage.js';
import type { Ship } from './entities.js';
import { mastRaised } from './entities.js';
import { CLASSES } from './classes.js';
import { KN, clamp, distance, headingVec, type Vec2 } from './math.js';
import { leadBearing } from './weapons.js';
import type { World } from './world.js';

/**
 * Escort air defence against the Ostpakt's reconnaissance aircraft: ship-launched
 * surface-to-air missiles (they need the ship's own radar track, so the radar must
 * be on and can be heard by ESM), and interceptor fighters called from land.
 * Envelopes and kill probabilities are era-plausible game-balance values.
 */

export interface SamSpec {
  name: string;
  magazine: number;
  minRange: number;
  maxRange: number;
  minAlt: number;
  maxAlt: number;
  /** Average speed over the flight (m/s). */
  speedMs: number;
  /** Single-shot kill probability in the heart of the envelope. */
  pk: number;
  /** Launcher cycle: seconds between two shots. */
  cycleS: number;
}

export const SAM_SPECS: Partial<Record<ClassId, SamSpec>> = {
  // F-12: single-arm launcher forward, medium-range semi-active missile (Standard-1-type)
  ffg: { name: 'Einarmstarter · Mittelstrecke', magazine: 16, minRange: 2500, maxRange: 32_000, minAlt: 30, maxAlt: 18_000, speedMs: 750, pk: 0.75, cycleS: 10 },
  // F-30: short-range point-defence launcher on the hangar (Sea-Sparrow type)
  ffv: { name: 'Nahbereich · Hangar', magazine: 8, minRange: 1000, maxRange: 11_000, minAlt: 10, maxAlt: 5000, speedMs: 700, pk: 0.8, cycleS: 6 },
  // K-7: twin pop-up launcher from its deck bin (Osa-M type)
  ffk: { name: 'Versenkstarter (zwei)', magazine: 40, minRange: 1500, maxRange: 12_000, minAlt: 10, maxAlt: 5000, speedMs: 600, pk: 0.65, cycleS: 6 },
  kor: { name: 'Versenkstarter', magazine: 20, minRange: 1500, maxRange: 12_000, minAlt: 10, maxAlt: 5000, speedMs: 600, pk: 0.65, cycleS: 8 },
};

export interface Sam {
  id: string;
  ownerId: string;
  cls: ClassId;
  team: Team;
  targetId: string;
  pos: Vec2;
  alt: number;
  from: Vec2;
  launchedAt: number;
  maxFlight: number;
  done?: 'hit' | 'miss';
  doneAt?: number;
}

export interface FighterState {
  left: number;
  readyAt: number;
  arriveAt?: number;
  capUntil?: number;
  nextTry?: number;
  at?: Vec2;
  killed?: boolean;
}

export interface AirDefState {
  sams: Sam[];
  nextId: number;
  /** Recon aircraft lost so far: later ones stay higher and further out. */
  reconLosses: number;
  fighter: Partial<Record<'west' | 'east', FighterState>>;
  lastShot: Record<string, number>;
}

/** Interceptors: two sorties per match, about 12 minutes from the airfield, 10 minutes on station. */
export const FIGHTER_SORTIES = 2;
export const FIGHTER_DELAY_S = 720;
export const FIGHTER_CAP_S = 600;
export const FIGHTER_TURNAROUND_S = 1500;
const FIGHTER_PK = 0.6;
const FIGHTER_REACH = 90_000;
/** Missiles in the air per ship at once (fire-control channels). */
const CHANNELS = 2;
/** An evading aircraft: hard turn away from the launcher and down into the sea clutter. */
export const EVADE_S = 90;

export function airDefOf(w: World): AirDefState {
  return (w.env.airdef ??= { sams: [], nextId: 1, reconLosses: 0, fighter: {}, lastShot: {} });
}

/** Missiles left in a ship's magazine (full magazine until the first shot). */
export function samsLeft(w: World, s: Ship): number {
  const spec = SAM_SPECS[s.cls];
  if (!spec) return 0;
  const l = w.weapons?.loadouts.get(s.id);
  return l?.sams ?? spec.magazine;
}

export function inEnvelope(spec: SamSpec, range: number, alt: number): boolean {
  return range >= spec.minRange && range <= spec.maxRange && alt >= spec.minAlt && alt <= spec.maxAlt;
}

/** Kill probability of one missile at the intercept: falls off toward the edge of the envelope, low down and against a jinking target. */
export function hitChance(spec: SamSpec, range: number, alt: number, evading: boolean): number {
  if (range > spec.maxRange * 1.15 || alt > spec.maxAlt) return 0;
  let p = spec.pk;
  const frac = range / spec.maxRange;
  if (frac > 0.6) p *= 1 - (0.5 * Math.min(1, frac - 0.6)) / 0.4;
  if (alt < 150) p *= 0.75;
  if (alt > spec.maxAlt * 0.8) p *= 0.85;
  if (evading) p *= 0.7;
  return clamp(p, 0.05, 0.95);
}

/** Fire one missile at an aircraft the ship holds on its own radar. */
export function fireSam(w: World, ship: Ship, planeId: string): true | string {
  const spec = SAM_SPECS[ship.cls];
  if (!spec) return 'Keine Flugabwehrraketen an Bord';
  if (!ship.alive) return 'Schiff kann nicht feuern';
  if (weaponsBroken(ship)) return 'Waffenanlage ausgefallen';
  const left = samsLeft(w, ship);
  if (left <= 0) return 'Flugabwehrmagazin leer';
  const view = planesFor(w, ship).find((p) => p.id === planeId);
  if (!view || !view.via.includes('radar')) return ship.radarOn ? 'Kein Radarziel · Ziel nicht erfasst' : 'Radar einschalten: Feuerleitung braucht eine Radarspur';
  if (view.side !== 'hostile') return 'Ziel nicht feindlich';
  const plane = w.env.airspace?.planes.find((p) => p.id === planeId);
  if (!plane) return 'Ziel nicht bekämpfbar';
  const range = distance(ship.pos, plane.pos);
  if (range < spec.minRange) return 'Ziel zu nah';
  if (range > spec.maxRange) return `Ziel außer Reichweite (max. ${Math.round(spec.maxRange / 1000)} km)`;
  if (plane.alt > spec.maxAlt) return 'Ziel zu hoch';
  if (plane.alt < spec.minAlt) return 'Ziel zu tief';
  const st = airDefOf(w);
  if (w.time - (st.lastShot[ship.id] ?? -1e9) < spec.cycleS) return 'Starter lädt nach';
  if (st.sams.filter((m) => m.ownerId === ship.id && !m.done).length >= CHANNELS) return 'Alle Feuerleitkanäle belegt';
  const l = w.weapons?.loadouts.get(ship.id);
  if (l) l.sams = left - 1;
  st.lastShot[ship.id] = w.time;
  st.sams.push({
    id: `S${st.nextId++}`, ownerId: ship.id, cls: ship.cls, team: ship.team, targetId: plane.id, pos: { ...ship.pos }, alt: 15,
    from: { ...ship.pos }, launchedAt: w.time, maxFlight: (spec.maxRange * 1.3) / spec.speedMs,
  });
  // The aircraft's warning receiver hears the guidance radar lock on: it breaks away while the
  // missile flies, then presses on with its mission
  plane.evadeUntil = w.time + Math.min(EVADE_S, range / spec.speedMs + 10);
  plane.evadeFrom = { ...ship.pos };
  w.events.push({ kind: 'transient', time: w.time, sourceId: ship.id, x: ship.pos.x, y: ship.pos.y, what: 'sam' });
  w.events.push({ kind: 'airdef', time: w.time, what: 'launch', team: ship.team as 'west' | 'east', shipId: ship.id, x: plane.pos.x, y: plane.pos.y });
  return true;
}

function shootDown(w: World, plane: Plane): void {
  const air = w.env.airspace;
  if (air) air.planes = air.planes.filter((p) => p !== plane);
  if (plane.kind === 'recon') airDefOf(w).reconLosses++;
}

function stepSam(w: World, m: Sam, dt: number): void {
  const plane = w.env.airspace?.planes.find((p) => p.id === m.targetId);
  const spec = SAM_SPECS[m.cls]!;
  const finish = (how: 'hit' | 'miss') => {
    m.done = how;
    m.doneAt = w.time;
    w.events.push({ kind: 'airdef', time: w.time, what: how === 'hit' ? 'kill' : 'miss', team: m.team as 'west' | 'east', shipId: m.ownerId, x: m.pos.x, y: m.pos.y });
  };
  // Target gone (shot down by another missile, out of the area) or the motor burnt out: self-destruct
  if (!plane || w.time - m.launchedAt > m.maxFlight) return finish('miss');
  const v = headingVec(plane.heading);
  const vel = { x: v.x * plane.speedKn * KN, y: v.y * plane.speedKn * KN };
  const dxy = distance(m.pos, plane.pos);
  const dz = plane.alt - m.alt;
  const d3 = Math.hypot(dxy, dz);
  const step = spec.speedMs * dt;
  if (d3 <= step + 40) {
    m.pos = { ...plane.pos };
    m.alt = plane.alt;
    const evading = (plane.evadeUntil ?? 0) > w.time;
    if (w.rng.next() < hitChance(spec, distance(m.from, plane.pos), plane.alt, evading)) {
      shootDown(w, plane);
      return finish('hit');
    }
    return finish('miss');
  }
  const aim = headingVec(leadBearing(m.pos, spec.speedMs * (dxy / Math.max(1, d3)), plane.pos, vel));
  const hStep = step * (dxy / d3);
  m.pos = { x: m.pos.x + aim.x * hStep, y: m.pos.y + aim.y * hStep };
  m.alt += step * (dz / d3);
}

/** Hostile aircraft (not neutral, not own) the interceptors may engage near a point. */
function huntable(w: World, team: Team, near: Vec2): Plane[] {
  return (w.env.airspace?.planes ?? []).filter((p) => p.team !== team && p.team !== 'neutral' && distance(p.pos, near) < FIGHTER_REACH);
}

/** Ask the air force for interceptors: limited sorties, minutes from the airfield. */
export function callFighter(w: World, ship: Ship): true | string {
  if (!ship.alive || CLASSES[ship.cls].submarine) return 'Kein Abfangjäger verfügbar';
  const st = airDefOf(w);
  const team = ship.team as 'west' | 'east';
  const f = (st.fighter[team] ??= { left: FIGHTER_SORTIES, readyAt: 0 });
  if (f.arriveAt !== undefined) return 'Abfangjäger bereits im Einsatz';
  if (f.left <= 0) return 'Keine Abfangjäger mehr verfügbar';
  if (w.time < f.readyAt) return `Abfangjäger wieder bereit in ${Math.ceil((f.readyAt - w.time) / 60)} min`;
  if (!planesFor(w, ship).some((p) => p.side === 'hostile')) return 'Kein feindliches Luftziel gemeldet';
  f.left--;
  f.arriveAt = w.time + FIGHTER_DELAY_S;
  f.capUntil = f.arriveAt + FIGHTER_CAP_S;
  f.readyAt = f.capUntil + FIGHTER_TURNAROUND_S;
  f.at = { ...ship.pos };
  f.killed = false;
  w.events.push({ kind: 'airdef', time: w.time, what: 'fighter_out', team, shipId: ship.id, x: ship.pos.x, y: ship.pos.y });
  return true;
}

function stepFighter(w: World, team: 'west' | 'east', f: FighterState): void {
  if (f.arriveAt === undefined || w.time < f.arriveAt) return;
  const at = f.at ?? { x: 0, y: 0 };
  if (w.time >= (f.capUntil ?? 0)) {
    if (!f.killed) w.events.push({ kind: 'airdef', time: w.time, what: 'fighter_none', team, x: at.x, y: at.y });
    f.arriveAt = undefined;
    return;
  }
  if (w.time < (f.nextTry ?? 0)) return;
  const target = huntable(w, team, at)[0];
  if (!target) return;
  // One firing pass a minute; a miss lets the aircraft jink away and try to run
  f.nextTry = w.time + 60;
  if (w.rng.next() < FIGHTER_PK) {
    shootDown(w, target);
    f.killed = true;
    w.events.push({ kind: 'airdef', time: w.time, what: 'fighter_kill', team, x: target.pos.x, y: target.pos.y });
  } else {
    target.evadeUntil = w.time + EVADE_S;
    target.evadeFrom = { ...at };
  }
}

/** Advance missiles and interceptors (run with the airspace). */
export function stepAirDefense(w: World, dt: number): void {
  const st = w.env.airdef;
  if (!st) return;
  for (const m of st.sams) if (!m.done) stepSam(w, m, dt);
  st.sams = st.sams.filter((m) => !m.done || w.time - (m.doneAt ?? 0) < 20);
  for (const team of ['west', 'east'] as const) {
    const f = st.fighter[team];
    if (f) stepFighter(w, team, f);
  }
}

export interface SamView {
  id: string;
  x: number;
  y: number;
  alt: number;
  fromX: number;
  fromY: number;
  heading: number;
  own: boolean;
  targetId: string;
  done?: 'hit' | 'miss';
  age: number;
}

export interface AirDefView {
  /** Own launcher: missiles left, envelope, seconds until the launcher is ready. */
  sam?: { left: number; name: string; minRange: number; maxRange: number; minAlt: number; maxAlt: number; readyInS: number; speedMs: number; pk: number };
  fighter?: { left: number; readyInS: number; arriveInS?: number; onStation: boolean };
  missiles: SamView[];
  /** Losses of the enemy's reconnaissance so far (escorts only). */
  reconLosses?: number;
}

/** Missiles a ship can see: its own team's on the datalink, others by eye (smoke trail, flame). */
export function airDefFor(w: World, own: Ship): AirDefView | undefined {
  const st = w.env.airdef;
  const spec = SAM_SPECS[own.cls];
  const sub = CLASSES[own.cls].submarine;
  const eye = sub ? mastRaised(own) : true;
  const seeRange = (w.env.light ?? 1) > 0.4 ? 25_000 : 35_000;
  const missiles: SamView[] = [];
  for (const m of st?.sams ?? []) {
    const team = m.team === own.team && !sub;
    if (!team && !(eye && distance(own.pos, m.pos) < seeRange * (w.env.rain ? 0.4 : 1))) continue;
    const d = { x: m.pos.x - m.from.x, y: m.pos.y - m.from.y };
    missiles.push({
      id: m.id, x: Math.round(m.pos.x), y: Math.round(m.pos.y), alt: Math.round(m.alt), fromX: Math.round(m.from.x), fromY: Math.round(m.from.y),
      heading: Math.round((Math.atan2(d.x, d.y) * 180) / Math.PI + 360) % 360, own: m.ownerId === own.id, targetId: m.targetId, done: m.done,
      age: Math.round(w.time - m.launchedAt),
    });
  }
  if (sub) return missiles.length ? { missiles } : undefined;
  const f = st?.fighter[own.team as 'west' | 'east'];
  return {
    missiles,
    reconLosses: st?.reconLosses,
    sam: spec && {
      left: samsLeft(w, own), name: spec.name, minRange: spec.minRange, maxRange: spec.maxRange, minAlt: spec.minAlt, maxAlt: spec.maxAlt,
      readyInS: Math.max(0, spec.cycleS - (w.time - (st?.lastShot[own.id] ?? -1e9))), speedMs: spec.speedMs, pk: spec.pk,
    },
    fighter: {
      left: f?.left ?? FIGHTER_SORTIES, readyInS: Math.max(0, (f?.readyAt ?? 0) - w.time),
      arriveInS: f?.arriveAt !== undefined ? Math.max(0, f.arriveAt - w.time) : undefined,
      onStation: f?.arriveAt !== undefined && w.time >= f.arriveAt,
    },
  };
}

