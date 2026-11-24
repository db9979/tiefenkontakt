import { currentAt } from './currents.js';
import { seesTorpedoTrack } from './lookout.js';
import { crossesLayer, passiveExcessFrom, torpedoSourceLevel, sourceLevelToward, targetStrengthToward } from './acoustics.js';
import { CLASSES, isEscort } from './classes.js';
import type { Ship } from './entities.js';
import { applyHitDamage, reloadFactor, weaponsBroken } from './damage.js';
import { createLoadout, stepReload, type Loadout } from './loadout.js';
import { KN, angleDiff, approach, bearing, clamp, distance, headingVec, wrap360, type Vec2 } from './math.js';
import { depthAt } from './seabed.js';
import { towedArrayDepth, towedArrayReady } from './sensors.js';
import { measureLayer, type World } from './world.js';

export type TorpedoKind = 'heavy' | 'light';
export type SeekerMode = 'passive' | 'active';

export interface Torpedo {
  id: string;
  kind: TorpedoKind;
  ownerId: string;
  pos: Vec2;
  depth: number;
  heading: number;
  speedKn: number;
  searchDepth: number;
  enableAfter: number; // m run before the seeker switches on
  mode: SeekerMode;
  run: number; // m travelled
  maxRun: number;
  wire: boolean;
  homingOn?: string; // target or decoy id
  launchedAt: number;
  alerted: string[]; // ship ids already warned
  /** Decoys the seeker has already classified as false targets. */
  rejected?: string[];
  /** Snake search: centre course and start time, set when the search (re)starts. */
  searchCourse?: number;
  searchSince?: number;
}

export interface Decoy {
  id: string;
  pos: Vec2;
  depth: number;
  sl: number;
  expiresAt: number;
  towedBy?: string;
  /** Active echo strength (dB); default 20 for decoys. */
  ts?: number;
  /** Knuckle (bubble field from a hard turn): a weak active echo, silent to passive seekers. */
  knuckle?: boolean;
}

export interface DelayedEffect {
  at: number;
  kind: 'rocket' | 'depthcharge';
  ownerId: string;
  pos: Vec2;
  depth: number;
}

export interface WeaponsState {
  torpedoes: Torpedo[];
  decoys: Decoy[];
  pending: DelayedEffect[];
  loadouts: Map<string, Loadout>;
  nextId: number;
}

const SPEC: Record<TorpedoKind, { speedKn: number; maxRun: number; damage: number; turn: number }> = {
  heavy: { speedKn: 40, maxRun: 25_000, damage: 80, turn: 10 },
  light: { speedKn: 45, maxRun: 8_000, damage: 55, turn: 14 },
};
const SEEKER_HALF_ANGLE = 45;
const HIT_RADIUS = 35;
const WIRE_MAX_RANGE = 18_000;
const WIRE_MAX_OWNER_KN = 12;
const ALERT_RANGE = 8_000;
const ROCKET_MAX_RANGE = 18_000;
const ROCKET_FLIGHT = 40;
const DC_SINK_RATE = 4;
const DC_LETHAL = 60;
/** ASW lightweights ignore anything shallower (surface ships, towed decoys): no attacks on the own escort. */
const LIGHT_CEILING = 10;
/** Torpedoes keep this clearance above the seabed. */
const BOTTOM_CLEARANCE = 10;
/** Flow noise deafens the seeker above this speed (dB lost per knot above it). */
const QUIET_RUN_KN = 25;
const FLOW_DB_PER_KN_PASSIVE = 0.8;
const FLOW_DB_PER_KN_ACTIVE = 0.25;
/** An active seeker sees that a noisemaker gives no hull echo once this close. */
const ACTIVE_REJECT_RANGE = 150;
/** Inside this range a running torpedo is heard through any hull, baffles or not. */
const ALERT_CLOSE = 1000;
/** Heavyweight snake search: ±25° around the search course, one swing every ~38 s. */
const SNAKE_DEG = 25;
const SNAKE_PERIOD_S = 6;


export function createWeaponsState(ships: Ship[]): WeaponsState {
  const loadouts = new Map<string, Loadout>();
  for (const s of ships) loadouts.set(s.id, createLoadout(s.cls));
  return { torpedoes: [], decoys: [], pending: [], loadouts, nextId: 1 };
}

function ws(w: World): WeaponsState {
  if (!w.weapons) throw new Error('weapons system not installed');
  return w.weapons;
}

export interface FireOptions {
  heading: number;
  enableAfter?: number;
  mode?: SeekerMode;
  searchDepth?: number;
  speedKn?: number;
}

/** Fire a torpedo from a loaded tube. Returns the torpedo or an error string. */
export function fireTorpedo(w: World, shooter: Ship, o: FireOptions): Torpedo | string {
  const st = ws(w);
  const l = st.loadouts.get(shooter.id);
  if (!shooter.alive || !l) return 'Schiff kann nicht feuern';
  if (w.env.weaponsTight === shooter.team) return 'Waffen gesperrt: Fühlung halten, nicht schießen';
  if (weaponsBroken(shooter)) return 'Waffenanlage ausgefallen';
  const tube = l.tubes.find((t) => t.loaded);
  if (!tube) return 'Kein Rohr geladen';
  tube.loaded = false;
  const kind: TorpedoKind = CLASSES[shooter.cls].submarine ? 'heavy' : 'light';
  const sp = SPEC[kind];
  const t: Torpedo = {
    id: `T${st.nextId++}`, kind, ownerId: shooter.id, pos: { ...shooter.pos },
    depth: Math.max(shooter.depth, 10), heading: wrap360(o.heading),
    speedKn: clamp(o.speedKn ?? sp.speedKn, 25, sp.speedKn),
    searchDepth: o.searchDepth ?? (kind === 'heavy' ? shooter.depth : 100),
    enableAfter: Math.max(o.enableAfter ?? 1500, 500), mode: o.mode ?? 'passive',
    run: 0, maxRun: sp.maxRun, wire: kind === 'heavy', launchedAt: w.time, alerted: [shooter.id],
  };
  st.torpedoes.push(t);
  const at = { x: shooter.pos.x, y: shooter.pos.y };
  if (kind === 'heavy') w.events.push({ kind: 'transient', time: w.time, sourceId: shooter.id, ...at, what: 'flood' });
  w.events.push({ kind: 'transient', time: w.time, sourceId: shooter.id, ...at, what: 'launch' });
  w.events.push({ kind: 'weapon', time: w.time, sourceId: shooter.id, what: 'torpedo' });
  return t;
}

export function dropXbt(w: World, ship: Ship): true | string {
  const l = ws(w).loadouts.get(ship.id);
  if (!l || l.xbt <= 0) return 'Keine Bathythermographen';
  l.xbt -= 1;
  measureLayer(w, ship);
  return true;
}

/** Wire-guided course correction. */
export function steerTorpedo(w: World, shooter: Ship, torpId: string, heading: number, enableAfter?: number): boolean {
  const t = ws(w).torpedoes.find((x) => x.id === torpId && x.ownerId === shooter.id);
  if (!t || !t.wire) return false;
  t.heading = wrap360(heading);
  t.homingOn = undefined;
  t.searchCourse = undefined;
  if (enableAfter !== undefined) t.enableAfter = Math.max(t.run + 200, enableAfter);
  return true;
}

export function launchAswRocket(w: World, shooter: Ship, aim: Vec2): true | string {
  const l = ws(w).loadouts.get(shooter.id);
  if (!l || l.rockets <= 0) return 'Keine Raketen';
  if (distance(shooter.pos, aim) > ROCKET_MAX_RANGE) return 'Ziel außer Reichweite';
  l.rockets -= 1;
  w.events.push({ kind: 'weapon', time: w.time, sourceId: shooter.id, what: 'rocket' });
  ws(w).pending.push({ at: w.time + ROCKET_FLIGHT, kind: 'rocket', ownerId: shooter.id, pos: { ...aim }, depth: 0 });
  return true;
}

export function dropDepthCharge(w: World, shooter: Ship, depth: number): true | string {
  const l = ws(w).loadouts.get(shooter.id);
  if (!l || l.depthCharges <= 0) return 'Keine Wasserbomben';
  l.depthCharges -= 1;
  w.events.push({ kind: 'weapon', time: w.time, sourceId: shooter.id, what: 'dc' });
  const d = clamp(depth, 20, 400);
  ws(w).pending.push({ at: w.time + d / DC_SINK_RATE, kind: 'depthcharge', ownerId: shooter.id, pos: { ...shooter.pos }, depth: d });
  return true;
}

export function launchNoisemaker(w: World, ship: Ship): true | string {
  const st = ws(w);
  const l = st.loadouts.get(ship.id);
  if (!l || l.noisemakers <= 0) return 'Keine Täuschkörper';
  l.noisemakers -= 1;
  st.decoys.push({ id: `D${st.nextId++}`, pos: { ...ship.pos }, depth: ship.depth, sl: 150, expiresAt: w.time + 240 });
  return true;
}

export function setTowedDecoy(w: World, ship: Ship, on: boolean): void {
  const st = ws(w);
  const l = st.loadouts.get(ship.id);
  if (!l || !isEscort(ship.cls)) return;
  l.towedDecoy = on;
  st.decoys = st.decoys.filter((d) => d.towedBy !== ship.id);
  if (on) st.decoys.push({ id: `D${st.nextId++}`, pos: { ...ship.pos }, depth: 5, sl: 155, expiresAt: Number.MAX_SAFE_INTEGER, towedBy: ship.id });
}

interface Candidate {
  id: string;
  pos: Vec2;
  vel: Vec2;
  depth: number;
  score: number;
  decoy: boolean;
}

/** Acquisition range of the seeker against a target (m). The faster the run, the deafer the seeker. */
export function seekerRange(t: Pick<Torpedo, 'mode' | 'speedKn'>, sl: number, ts: number): number {
  const fast = Math.max(0, t.speedKn - QUIET_RUN_KN);
  return t.mode === 'active'
    ? Math.max(0, 2000 + (ts - 15 - fast * FLOW_DB_PER_KN_ACTIVE) * 80)
    : Math.max(0, (sl - 100 - fast * FLOW_DB_PER_KN_PASSIVE) * 40);
}

/** Lead pursuit: the heading that meets a target moving with velocity `vel` (m/s); direct if unreachable. */
export function leadBearing(from: Vec2, speedMs: number, pos: Vec2, vel: Vec2): number {
  const d = { x: pos.x - from.x, y: pos.y - from.y };
  const a = vel.x * vel.x + vel.y * vel.y - speedMs * speedMs;
  const b = 2 * (d.x * vel.x + d.y * vel.y);
  const c = d.x * d.x + d.y * d.y;
  const disc = b * b - 4 * a * c;
  if (a >= 0 || disc < 0) return bearing(from, pos);
  const tHit = (-b - Math.sqrt(disc)) / (2 * a);
  if (!(tHit > 0)) return bearing(from, pos);
  return bearing(from, { x: pos.x + vel.x * tHit, y: pos.y + vel.y * tHit });
}

function velocityOf(s: Ship): Vec2 {
  const v = headingVec(s.heading);
  return { x: v.x * s.speed, y: v.y * s.speed };
}

function seek(w: World, t: Torpedo): Candidate | undefined {
  const st = ws(w);
  let best: Candidate | undefined;
  const consider = (id: string, pos: Vec2, vel: Vec2, depth: number, sl: number, ts: number, bonus: number, decoy: boolean) => {
    if (t.kind === 'light' && depth < LIGHT_CEILING) return;
    const r = distance(t.pos, pos);
    if (r < 1) return;
    if (Math.abs(angleDiff(t.heading, bearing(t.pos, pos))) > SEEKER_HALF_ANGLE) return;
    let reach = seekerRange(t, sl, ts);
    if (crossesLayer(t.depth, depth, w.env)) reach *= 0.5;
    if (r > reach) return;
    const score = (reach / r) * bonus;
    if (!best || score > best.score) best = { id, pos, vel, depth, score, decoy };
  };
  for (const s of w.ships) {
    if (!s.alive) continue;
    // Anti-circular-run: a torpedo never homes on the boat that fired it
    if (s.id === t.ownerId) continue;
    consider(s.id, s.pos, velocityOf(s), s.depth, sourceLevelToward(s, t.pos), targetStrengthToward(s, t.pos), 1, false);
  }
  for (const d of st.decoys) {
    if (t.rejected?.includes(d.id)) continue;
    const tower = d.towedBy ? w.ships.find((s) => s.id === d.towedBy) : undefined;
    consider(d.id, d.pos, tower ? velocityOf(tower) : { x: 0, y: 0 }, d.depth, d.sl, d.ts ?? 20, d.knuckle ? 1 : 1.3, true);
  }
  return best;
}

function damage(w: World, target: Ship, amount: number, byId: string, at?: Vec2): void {
  target.hp -= amount;
  w.events.push({ kind: 'hit', time: w.time, shipId: target.id, byId, x: at?.x ?? target.pos.x, y: at?.y ?? target.pos.y });
  if (target.hp > 0) applyHitDamage(target, amount, w.rng, { at, byId, w });
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    target.order.speedKn = 0;
    w.events.push({ kind: 'sunk', time: w.time, shipId: target.id, byId });
  }
}

/** The common hit entry point for other weapons (mines): hull damage, system damage, sinking. */
export { damage as weaponHit };

function stepTorpedo(w: World, t: Torpedo, dt: number): boolean {
  const sp = SPEC[t.kind];
  const owner = w.ships.find((s) => s.id === t.ownerId);
  if (t.wire && (!owner?.alive || distance(owner.pos, t.pos) > WIRE_MAX_RANGE || owner.speed / KN > WIRE_MAX_OWNER_KN)) {
    t.wire = false;
  }
  if (t.run >= t.enableAfter) {
    const c = seek(w, t);
    const r = c ? distance(t.pos, c.pos) : Infinity;
    // A decoy is unmasked when the torpedo runs through it, or earlier by an active seeker (no hull echo)
    if (c?.decoy && (Math.hypot(r, t.depth - c.depth) < HIT_RADIUS || (t.mode === 'active' && r < ACTIVE_REJECT_RANGE))) {
      // Lightweights: a knuckle (no hull echo, no noise source) is always seen through; a noisemaker
      // spends the small seeker half the time. Heavyweights always re-attack
      const knuckle = ws(w).decoys.find((d) => d.id === c.id)?.knuckle;
      if (t.kind === 'light' && !knuckle && w.rng.next() < 0.5) return false;
      (t.rejected ??= []).push(c.id);
      t.homingOn = undefined;
    } else if (c) {
      t.homingOn = c.id;
      t.searchCourse = undefined;
      const want = leadBearing(t.pos, t.speedKn * KN, c.pos, c.vel);
      t.heading = wrap360(t.heading + clamp(angleDiff(t.heading, want), -sp.turn * dt, sp.turn * dt));
      t.depth = approach(t.depth, c.depth, 8 * dt);
      if (Math.hypot(r, t.depth - c.depth) < HIT_RADIUS) {
        const ship = w.ships.find((s) => s.id === c.id);
        if (ship) damage(w, ship, sp.damage, t.ownerId, t.pos);
        return false;
      }
    } else {
      t.homingOn = undefined;
      // Search pattern: lightweights circle, heavyweights snake ±SNAKE_DEG around the course they had when the search began
      if (t.kind === 'light') t.heading = wrap360(t.heading + 8 * dt);
      else {
        if (t.searchCourse === undefined) {
          t.searchCourse = t.heading;
          t.searchSince = w.time;
        }
        const want = t.searchCourse + SNAKE_DEG * Math.sin((w.time - (t.searchSince ?? w.time)) / SNAKE_PERIOD_S);
        t.heading = wrap360(t.heading + clamp(angleDiff(t.heading, want), -sp.turn * dt, sp.turn * dt));
      }
      t.depth = approach(t.depth, t.searchDepth, 5 * dt);
    }
  } else {
    t.depth = approach(t.depth, t.searchDepth, 5 * dt);
  }
  // Bottom avoidance: in shallow water the torpedo runs no deeper than the seabed allows
  t.depth = Math.max(0, Math.min(t.depth, depthAt(w.env.seabed, t.pos.x, t.pos.y) - BOTTOM_CLEARANCE));
  const v = headingVec(t.heading);
  const step = t.speedKn * KN * dt;
  const c = currentAt(w.env, t.pos, t.depth, w.time);
  t.pos.x += v.x * step + c.x * dt;
  t.pos.y += v.y * step + c.y * dt;
  t.run += step;
  // Into the shore: the torpedo strikes the rocks and detonates there
  if (w.env.seabed && depthAt(w.env.seabed, t.pos.x, t.pos.y) < 2) {
    w.events.push({ kind: 'transient', time: w.time, sourceId: t.ownerId, x: t.pos.x, y: t.pos.y, what: 'blow' });
    return false;
  }

  for (const s of w.ships) {
    if (!s.alive || t.alerted.includes(s.id) || s.cls === 'merchant') continue;
    const r = distance(s.pos, t.pos);
    if (r < ALERT_RANGE && (r < ALERT_CLOSE || hearsTorpedo(w, s, t, r) || seesTorpedoTrack(s, r, w.env))) {
      t.alerted.push(s.id);
      w.events.push({ kind: 'torpedo_alert', time: w.time, shipId: s.id, bearing: bearing(s.pos, t.pos) });
    }
  }
  return t.run < t.maxRun;
}

/** Whether a ship's own sonar can hear the torpedo (hull array outside the baffles, or a settled towed array). */
function hearsTorpedo(w: World, s: Ship, t: Torpedo, r: number): boolean {
  const sl = torpedoSourceLevel(t.speedKn);
  const spec = CLASSES[s.cls];
  const rel = Math.abs(angleDiff(s.heading, bearing(s.pos, t.pos)));
  if (spec.hull.di > 0 && rel < 180 - spec.hull.baffleHalfAngle && passiveExcessFrom(sl, t.depth, s, r, 'hull', w.env) > 0) return true;
  return towedArrayReady(s, w.time) && passiveExcessFrom(sl, t.depth, s, r, 'towed', w.env, towedArrayDepth(s)) > 0;
}

/** A lightweight torpedo entering the water at a point (ASW rocket, helicopter) and searching in circles. */
export function dropLightweight(w: World, ownerId: string, pos: Vec2): void {
  const st = ws(w);
  st.torpedoes.push({
    id: `T${st.nextId++}`, kind: 'light', ownerId, pos: { ...pos }, depth: 10,
    heading: w.rng.range(0, 360), speedKn: SPEC.light.speedKn, searchDepth: 120, enableAfter: 0,
    mode: 'active', run: 0, maxRun: SPEC.light.maxRun, wire: false, launchedAt: w.time, alerted: [ownerId],
  });
}

function resolvePending(w: World, e: DelayedEffect): void {
  if (e.kind === 'rocket') return dropLightweight(w, e.ownerId, e.pos);
  for (const s of w.ships) {
    if (!s.alive) continue;
    const r3 = Math.hypot(distance(s.pos, e.pos), s.depth - e.depth);
    if (r3 < DC_LETHAL * 3) damage(w, s, r3 < DC_LETHAL ? 60 : 15, e.ownerId, e.pos);
  }
}

/** World system: advances torpedoes, decoys, rockets, depth charges and reloads. */
export function weaponsSystem(w: World, dt: number): void {
  const st = ws(w);
  st.torpedoes = st.torpedoes.filter((t) => stepTorpedo(w, t, dt));
  const due = st.pending.filter((e) => e.at <= w.time);
  st.pending = st.pending.filter((e) => e.at > w.time);
  for (const e of due) resolvePending(w, e);
  for (const d of st.decoys) {
    const tower = d.towedBy ? w.ships.find((s) => s.id === d.towedBy) : undefined;
    if (tower) {
      const back = headingVec(tower.heading + 180);
      d.pos = { x: tower.pos.x + back.x * 400, y: tower.pos.y + back.y * 400 };
      if (!tower.alive) d.expiresAt = w.time;
    }
  }
  st.decoys = st.decoys.filter((d) => d.expiresAt > w.time);
  for (const s of w.ships) {
    const l = st.loadouts.get(s.id);
    if (l && s.alive) stepReload(l, s.cls, w.time, reloadFactor(s));
  }
}

export function installWeapons(w: World): WeaponsState {
  w.weapons = createWeaponsState(w.ships);
  w.systems.push(weaponsSystem);
  return w.weapons;
}
