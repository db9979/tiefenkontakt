import { havenBlocks } from './haven.js';
import { currentAt } from './currents.js';
import { seesTorpedoTrack } from './lookout.js';
import { crossesLayer, passiveExcessFrom, torpedoSourceLevel, sourceLevelToward, targetStrengthToward } from './acoustics.js';
import { CLASSES, isEscort } from './classes.js';
import type { Ship } from './entities.js';
import { applyHitDamage, crippleIfMerchant, reloadFactor, weaponsBroken } from './damage.js';
import { createLoadout, stepReload, type Loadout } from './loadout.js';
import { KN, angleDiff, approach, bearing, clamp, distance, headingVec, wrap360, type Vec2 } from './math.js';
import { depthAt } from './seabed.js';
import { towedArrayDepth, towedArrayReady } from './sensors.js';
import { measureLayer, type World } from './world.js';
import { recordWakes, steerWake, type WakePt, type WakeSeeker } from './wake-homing.js';
import { WIRE_MAX_RANGE, stepWire, wireChannels, type WireState } from './wire.js';
import { HEAVY_FUEL, HEAVY_MAX_KN, HEAVY_MIN_KN, burnPerM, twoSpeedRange } from './torpedo-run.js';

export type TorpedoKind = 'heavy' | 'light';
/** 'wake': the east SSN's wake homer (wake-homing.ts), heavyweights only. */
export type SeekerMode = 'passive' | 'active' | 'wake';

export interface Torpedo extends WireState, WakeSeeker {
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
  homingOn?: string; // target or decoy id
  /** Heavyweights: fuel left in metres at the reference speed (heavyRange). */
  fuel?: number;
  /** Two-speed run: the speed it switches to when the seeker opens (or on acquisition); until then speedKn is the transit speed. */
  attackKn?: number;
  launchedAt: number;
  alerted: string[]; // ship ids already warned
  /** Decoys the seeker has already classified as false targets. */
  rejected?: string[];
  /** Lightweights: the two search depths (above and below the measured layer), one circle each in turn. */
  searchDepths?: [number, number];
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
  /** Surface ships' recent tracks, for wake-homing torpedoes. */
  wakes?: Map<string, WakePt[]>;
}

const SPEC: Record<TorpedoKind, { speedKn: number; maxRun: number; damage: number; turn: number }> = {
  heavy: { speedKn: HEAVY_MAX_KN, maxRun: HEAVY_FUEL, damage: 80, turn: 10 },
  light: { speedKn: 45, maxRun: 8_000, damage: 55, turn: 14 },
};
const SEEKER_HALF_ANGLE = 45;
const HIT_RADIUS = 35;
const ALERT_RANGE = 8_000;
const ROCKET_MAX_RANGE = 18_000;
/** Inside this the rocket's trajectory can't bring the torpedo down (and it would land on the own wake). */
const ROCKET_MIN_RANGE = 1800;
/**
 * ASW rocket flight time (s) by range: a short boost, then the ballistic arc and the parachute.
 * ASROC: about 10 s at 2 km, 35–40 s at 9 km; Malafon-type winged carriers ~230 m/s further out.
 */
export function rocketFlightS(rangeM: number): number {
  return 5 + rangeM / 300;
}
/**
 * Where the lightweight actually enters the water: aim point ± this (σ per axis, m). The
 * ballistic scatter grows with range (CEP about 1 % of range) on top of the parachute drift.
 */
export function rocketScatterM(rangeM: number): number {
  return 60 + 0.008 * rangeM;
}
/**
 * Ahead-throwing ASW mortar (replaces dropped depth charges): a salvo of charges laid in a line
 * 400–800 m ahead on the own heading, sinking to the set depth. Lethal within 20 m, damage to 60 m.
 */
export const MORTAR_MIN = 400;
export const MORTAR_MAX = 800;
const MORTAR_CHARGES = 6;
const MORTAR_LATERAL = 40;
const MORTAR_FLIGHT_S = 8;
/** Sink rate of the mortar charges (m/s): Limbo about 13, RBU-6000 about 11.5. */
export const DC_SINK_RATE = 12;
const DC_LETHAL = 20;
const DC_DAMAGE_R = 60;
/** Lightweight search: one circle (8°/s) at each of the two depths in turn. */
const LIGHT_CIRCLE_S = 45;
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
/** A heavyweight on a merchant: one hit cripples (110 hp), two sink; escorts take the class damage. */
const MERCHANT_HIT = 95;
/**
 * F19: a heavyweight's influence fuse fires under the keel of an escort (the torpedo passes
 * below the keel, within UNDER_KEEL_WINDOW m): the gas bubble breaks the hull girder (Khukri
 * 1971). Contact hits on the side (torpedo set shallower than the keel) keep the class damage.
 */
export const UNDER_KEEL_FACTOR = 1.5;
const UNDER_KEEL_WINDOW = 15;
/** A heavyweight set deeper than the keel holds at most this far below it on the attack (m). */
const UNDER_KEEL_RUN = 8;
/** Launch envelope of a submarine: tubes can't be fired faster or deeper than this. */
export const LAUNCH_MAX_KN = 15;
export const LAUNCH_DEPTH_FRAC = 0.8;
/** Most torpedoes in one salvo, and the widest angle between two of them (deg). */
export const SALVO_MAX = 4;
export const SPREAD_MAX_DEG = 10;

/** Why a submarine can't fire now, with the limit that would make it possible; undefined = clear to fire. */
export function launchBlock(cls: Ship['cls'], speedKn: number, depth: number): { why: 'speed' | 'depth'; limit: number } | undefined {
  const spec = CLASSES[cls];
  if (!spec.submarine) return undefined;
  if (speedKn > LAUNCH_MAX_KN + 0.05) return { why: 'speed', limit: LAUNCH_MAX_KN };
  const deepest = Math.floor(spec.maxDepth * LAUNCH_DEPTH_FRAC);
  if (depth > deepest + 0.5) return { why: 'depth', limit: deepest };
  return undefined;
}

/**
 * Default angle between the torpedoes of a salvo (deg): the target's length seen at that range
 * plus the TMA's bearing error, kept between 2° and 4°.
 */
export function defaultSpreadDeg(rangeM: number, tmaErrDeg = 1, targetLengthM = 150): number {
  const seen = (Math.atan2(targetLengthM, Math.max(500, rangeM)) * 180) / Math.PI;
  return clamp(seen + tmaErrDeg, 2, 4);
}

/** For the recognition book's threat page (ranges as the simulation uses them). */
export { SPEC as TORPEDO_SPECS, ROCKET_MAX_RANGE, ROCKET_MIN_RANGE, WIRE_MAX_RANGE, DC_LETHAL, DC_DAMAGE_R };

/**
 * Lightweight search depths from the ship's measured layer: just above it (≈40 m) and 40 m
 * below it. No measurement: 40 and 120 m (the old fixed depth).
 */
export function lightSearchDepths(btLayer: number | undefined): [number, number] {
  if (!btLayer || btLayer <= 0) return [40, 120];
  return [Math.max(15, Math.min(40, btLayer - 10)), btLayer + 40];
}


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
  /** Heavyweights: the attack/search speed; with `transitKn` the speed once the seeker opens. */
  speedKn?: number;
  /** Heavyweights: a slower transit speed until the seeker opens (default: speedKn). */
  transitKn?: number;
}

/** Fire a torpedo from a loaded tube. Returns the torpedo or an error string. */
export function fireTorpedo(w: World, shooter: Ship, o: FireOptions): Torpedo | string {
  const st = ws(w);
  const l = st.loadouts.get(shooter.id);
  if (!shooter.alive || !l) return 'Schiff kann nicht feuern';
  if (w.env.weaponsTight === shooter.team) return 'Waffen gesperrt: Fühlung halten, nicht schießen';
  if (weaponsBroken(shooter)) return 'Waffenanlage ausgefallen';
  const block = launchBlock(shooter.cls, shooter.speed / KN, shooter.depth);
  if (block) {
    return block.why === 'speed'
      ? `Abschuss nur bis ${block.limit} kn (jetzt ${Math.round(shooter.speed / KN)} kn)`
      : `Abschuss nur bis ${block.limit} m Tiefe (jetzt ${Math.round(shooter.depth)} m)`;
  }
  const kind: TorpedoKind = CLASSES[shooter.cls].submarine ? 'heavy' : 'light';
  const wake = o.mode === 'wake' && kind === 'heavy';
  if (wake && !(l.wake ?? 0)) return 'Keine Kielwassertorpedos an Bord';
  const tube = l.tubes.find((t) => t.loaded);
  if (!tube) return 'Kein Rohr geladen';
  tube.loaded = false;
  // The wake homer goes in place of the tube's heavyweight, which goes back on the rack
  if (wake) {
    l.wake! -= 1;
    l.heavy += 1;
  }
  const sp = SPEC[kind];
  const attackKn = clamp(o.speedKn ?? sp.speedKn, HEAVY_MIN_KN, sp.speedKn);
  // The wake homer runs one speed (no wire to order the sprint); lightweights always one
  const transitKn = kind === 'heavy' && !wake ? clamp(o.transitKn ?? attackKn, HEAVY_MIN_KN, sp.speedKn) : attackKn;
  const t: Torpedo = {
    id: `T${st.nextId++}`, kind, ownerId: shooter.id, pos: { ...shooter.pos },
    depth: Math.max(shooter.depth, 10), heading: wrap360(o.heading),
    speedKn: transitKn,
    searchDepth: o.searchDepth ?? (kind === 'heavy' ? shooter.depth : 100),
    enableAfter: Math.max(o.enableAfter ?? 1500, 500), mode: wake ? 'wake' : o.mode === 'active' ? 'active' : 'passive',
    run: 0, maxRun: sp.maxRun, wire: kind === 'heavy' && !wake, launchedAt: w.time, alerted: [shooter.id],
  };
  if (kind === 'heavy') {
    t.fuel = HEAVY_FUEL;
    if (transitKn !== attackKn) t.attackKn = attackKn;
    t.maxRun = twoSpeedRange(transitKn, attackKn, t.enableAfter);
    // The wake sensor looks up at the trail from just under the keels
    if (wake) t.searchDepth = clamp(o.searchDepth ?? 12, 8, 20);
    // F16: the console guides only so many wires; a further torpedo leaves without one
    const guided = st.torpedoes.filter((x) => x.ownerId === shooter.id && x.wire).length;
    if (t.wire && guided >= wireChannels(shooter.cls)) {
      t.wire = false;
      t.wireLost = { at: w.time, why: `OHNE DRAHT · FEUERLEITUNG FÜHRT NUR ${wireChannels(shooter.cls)}`, x: t.pos.x, y: t.pos.y };
    } else if (wake) t.wireLost = { at: w.time, why: 'KIELWASSERTORPEDO · OHNE DRAHT', x: t.pos.x, y: t.pos.y };
  } else {
    t.searchDepths = lightSearchDepths(shooter.btLayer);
    t.searchDepth = t.searchDepths[0];
  }
  st.torpedoes.push(t);
  const at = { x: shooter.pos.x, y: shooter.pos.y };
  if (kind === 'heavy') w.events.push({ kind: 'transient', time: w.time, sourceId: shooter.id, ...at, what: 'flood' });
  w.events.push({ kind: 'transient', time: w.time, sourceId: shooter.id, ...at, what: 'launch' });
  w.events.push({ kind: 'weapon', time: w.time, sourceId: shooter.id, what: 'torpedo' });
  return t;
}

/**
 * A salvo of 1–4 torpedoes fanned symmetrically about the ordered heading, `spreadDeg` apart.
 * Fires as many as tubes are loaded; an error only when not even the first one could go.
 */
export function fireSalvo(w: World, shooter: Ship, o: FireOptions, count: number, spreadDeg: number): Torpedo[] | string {
  const n = clamp(Math.round(count), 1, SALVO_MAX);
  const spread = clamp(spreadDeg, 0, SPREAD_MAX_DEG);
  const out: Torpedo[] = [];
  for (let i = 0; i < n; i++) {
    const r = fireTorpedo(w, shooter, { ...o, heading: o.heading + (i - (n - 1) / 2) * spread });
    if (typeof r === 'string') {
      if (!out.length) return r;
      break;
    }
    out.push(r);
  }
  return out;
}

/** Seconds a torpedo still runs before its fuel is gone (a pending sprint counted at its speed). */
export function runTimeLeft(t: Pick<Torpedo, 'run' | 'maxRun' | 'speedKn'> & Partial<Pick<Torpedo, 'attackKn' | 'enableAfter'>>): number {
  const left = Math.max(0, t.maxRun - t.run);
  if (t.attackKn === undefined || t.enableAfter === undefined) return left / (t.speedKn * KN);
  const transit = Math.min(left, Math.max(0, t.enableAfter - t.run));
  return transit / (t.speedKn * KN) + (left - transit) / (t.attackKn * KN);
}

/** Planned reach (m) from the fuel left: the rest of the transit, then the sprint. */
function plannedRun(t: Torpedo): number {
  if (t.fuel === undefined) return t.maxRun;
  const burnNow = burnPerM(t.kind, t.speedKn);
  if (t.attackKn === undefined) return t.run + t.fuel / burnNow;
  const transit = Math.max(0, t.enableAfter - t.run);
  if (transit * burnNow >= t.fuel) return t.run + t.fuel / burnNow;
  return t.run + transit + (t.fuel - transit * burnNow) / burnPerM(t.kind, t.attackKn);
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
  if (enableAfter !== undefined) {
    t.enableAfter = Math.max(t.run + 200, enableAfter);
    t.maxRun = plannedRun(t);
  }
  return true;
}

export function launchAswRocket(w: World, shooter: Ship, aim: Vec2): true | string {
  const l = ws(w).loadouts.get(shooter.id);
  if (!l || l.rockets <= 0) return 'Keine Raketen';
  const r = distance(shooter.pos, aim);
  if (r > ROCKET_MAX_RANGE) return 'Ziel außer Reichweite';
  if (r < ROCKET_MIN_RANGE) return 'Ziel zu nah: U-Jagd-Rakete erst ab 1,8 km';
  const haven = havenBlocks(w, shooter.team, aim);
  if (haven) return haven;
  l.rockets -= 1;
  w.events.push({ kind: 'weapon', time: w.time, sourceId: shooter.id, what: 'rocket' });
  // The rocket's ballistics and the parachute scatter the drop point around the aim, more the further out
  const sd = rocketScatterM(r);
  const drop = { x: aim.x + w.rng.gauss(0, sd), y: aim.y + w.rng.gauss(0, sd) };
  ws(w).pending.push({ at: w.time + rocketFlightS(r), kind: 'rocket', ownerId: shooter.id, pos: drop, depth: 0 });
  return true;
}

/**
 * ASW mortar salvo: MORTAR_CHARGES charges thrown in a line 400–800 m ahead on the own
 * heading (alternately a little to port and starboard), fused for `depth`.
 */
export function dropDepthCharge(w: World, shooter: Ship, depth: number): true | string {
  const l = ws(w).loadouts.get(shooter.id);
  if (!l || l.depthCharges <= 0) return 'Werfer leer';
  const ahead = headingVec(shooter.heading);
  const side = headingVec(shooter.heading + 90);
  const mid = (MORTAR_MIN + MORTAR_MAX) / 2;
  const centre = { x: shooter.pos.x + ahead.x * mid, y: shooter.pos.y + ahead.y * mid };
  const haven = havenBlocks(w, shooter.team, centre);
  if (haven) return haven;
  l.depthCharges -= 1;
  w.events.push({ kind: 'weapon', time: w.time, sourceId: shooter.id, what: 'dc' });
  const d = clamp(depth, 20, 400);
  for (let i = 0; i < MORTAR_CHARGES; i++) {
    const along = MORTAR_MIN + ((MORTAR_MAX - MORTAR_MIN) * i) / (MORTAR_CHARGES - 1);
    const lat = (i % 2 ? 1 : -1) * MORTAR_LATERAL;
    const pos = { x: shooter.pos.x + ahead.x * along + side.x * lat, y: shooter.pos.y + ahead.y * along + side.y * lat };
    ws(w).pending.push({ at: w.time + MORTAR_FLIGHT_S + d / DC_SINK_RATE, kind: 'depthcharge', ownerId: shooter.id, pos, depth: d });
  }
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
  // Mirrored on the ship: its noise in the own sonars and the 25 kn tow limit (acoustics, kinematics)
  ship.nixie = on || undefined;
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
  // A sinking hit still opens the hull where it struck (the damage panel and the wreck show it);
  // only the crew's reports stay quiet, the ship is going down
  applyHitDamage(target, amount, w.rng, { at, byId, w: target.hp > 0 ? w : undefined });
  target.lastHitBy = byId;
  crippleIfMerchant(target, w.time);
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    target.order.speedKn = 0;
    w.events.push({ kind: 'sunk', time: w.time, shipId: target.id, byId });
  }
}

/** The common hit entry point for other weapons (mines): hull damage, system damage, sinking. */
export { damage as weaponHit };

/**
 * Damage of a torpedo hit. A heavyweight passing under an escort's keel fires its influence
 * fuse there (×UNDER_KEEL_FACTOR); a contact hit on the side, or any other target, takes the
 * class damage (merchants: MERCHANT_HIT).
 */
export function torpedoDamage(kind: TorpedoKind, torpDepth: number, ship: Pick<Ship, 'cls' | 'depth'>): { amount: number; underKeel: boolean } {
  if (kind !== 'heavy') return { amount: SPEC[kind].damage, underKeel: false };
  if (ship.cls === 'merchant') return { amount: MERCHANT_HIT, underKeel: false };
  const below = torpDepth - ship.depth;
  const underKeel = isEscort(ship.cls) && !CLASSES[ship.cls].submarine && below > 1 && below <= UNDER_KEEL_WINDOW;
  return { amount: SPEC.heavy.damage * (underKeel ? UNDER_KEEL_FACTOR : 1), underKeel };
}

function torpedoHits(w: World, t: Torpedo, ship: Ship): void {
  const d = torpedoDamage(t.kind, t.depth, ship);
  damage(w, ship, d.amount, t.ownerId, t.pos);
  if (d.underKeel && ship.alive) w.events.push({ kind: 'boat', time: w.time, shipId: ship.id, what: 'underkeel', text: 'TORPEDOTREFFER UNTER DEM KIEL · SCHWERE SCHÄDEN' });
}

/** Attack depth on a ship: under the keel when set deeper than it (influence fuse), else the ship's depth. */
function attackDepth(t: Torpedo, target: { depth: number; decoy: boolean; id: string }, w: World): number {
  if (t.kind !== 'heavy' || target.decoy) return target.depth;
  const ship = w.ships.find((s) => s.id === target.id);
  if (!ship || CLASSES[ship.cls].submarine) return target.depth;
  return t.searchDepth > target.depth + 1 ? Math.min(t.searchDepth, target.depth + UNDER_KEEL_RUN) : target.depth;
}

/** F16: wire guidance per tick; a break is logged aboard the boat with its reason. */
function stepTorpedoWire(w: World, t: Torpedo, dt: number): void {
  if (!t.wire) return;
  const owner = w.ships.find((s) => s.id === t.ownerId);
  const why = stepWire(t, owner, t.pos, dt);
  if (!why) return;
  t.wire = false;
  t.wireWarn = undefined;
  t.wireLost = { at: w.time, why, x: t.pos.x, y: t.pos.y };
  if (owner?.alive) w.events.push({ kind: 'boat', time: w.time, shipId: owner.id, what: 'wire', text: `DRAHT GERISSEN · ${t.id} · ${why}` });
}

/** The wake homer after its seeker opens: up the trail, then into the stern. False = it hit. */
function stepWakeHomer(w: World, t: Torpedo, dt: number): boolean {
  const st = ws(w);
  if (!(st.wakes instanceof Map)) st.wakes = new Map();
  const g = steerWake(t, w.ships, st.wakes, w.time, w.rng);
  if (g.want !== undefined) t.heading = wrap360(t.heading + clamp(angleDiff(t.heading, g.want), -SPEC.heavy.turn * dt, SPEC.heavy.turn * dt));
  t.depth = approach(t.depth, t.searchDepth, 5 * dt);
  if (g.target && Math.hypot(distance(t.pos, g.target.pos), t.depth - g.target.depth) < HIT_RADIUS) {
    torpedoHits(w, t, g.target);
    return false;
  }
  return true;
}

function stepTorpedo(w: World, t: Torpedo, dt: number): boolean {
  const sp = SPEC[t.kind];
  stepTorpedoWire(w, t, dt);
  // Two-speed run: the sprint starts when the seeker opens
  if (t.attackKn !== undefined && t.speedKn !== t.attackKn && t.run >= t.enableAfter) t.speedKn = t.attackKn;
  if (t.mode === 'wake') {
    if (t.run < t.enableAfter) t.depth = approach(t.depth, t.searchDepth, 5 * dt);
    else if (!stepWakeHomer(w, t, dt)) return false;
  } else if (t.run >= t.enableAfter) {
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
      t.depth = approach(t.depth, attackDepth(t, c, w), 8 * dt);
      if (Math.hypot(r, t.depth - c.depth) < HIT_RADIUS) {
        const ship = w.ships.find((s) => s.id === c.id);
        if (ship) torpedoHits(w, t, ship);
        return false;
      }
    } else {
      t.homingOn = undefined;
      // Search pattern: lightweights circle, heavyweights snake ±SNAKE_DEG around the course they had when the search began
      if (t.kind === 'light') {
        t.heading = wrap360(t.heading + 8 * dt);
        if (t.searchDepths) t.searchDepth = t.searchDepths[Math.floor((w.time - t.launchedAt) / LIGHT_CIRCLE_S) % 2]!;
      }
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
  if (t.fuel !== undefined) {
    t.fuel -= step * burnPerM(t.kind, t.speedKn);
    t.maxRun = plannedRun(t);
  }
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

/**
 * A lightweight torpedo entering the water at a point (ASW rocket, helicopter) and searching in
 * circles, alternately above and below the layer the dropping ship measured.
 */
export function dropLightweight(w: World, ownerId: string, pos: Vec2): void {
  const st = ws(w);
  const owner = w.ships.find((s) => s.id === ownerId);
  const depths = lightSearchDepths(owner?.btLayer);
  st.torpedoes.push({
    id: `T${st.nextId++}`, kind: 'light', ownerId, pos: { ...pos }, depth: 10,
    heading: w.rng.range(0, 360), speedKn: SPEC.light.speedKn, searchDepth: depths[0], searchDepths: depths, enableAfter: 0,
    mode: 'active', run: 0, maxRun: SPEC.light.maxRun, wire: false, launchedAt: w.time, alerted: [ownerId],
  });
}

function resolvePending(w: World, e: DelayedEffect): void {
  if (e.kind === 'rocket') return dropLightweight(w, e.ownerId, e.pos);
  // The blast is heard far and wide (players only: the AI ignores 'charge' transients)
  w.events.push({ kind: 'transient', time: w.time, sourceId: e.ownerId, x: e.pos.x, y: e.pos.y, what: 'charge' });
  for (const s of w.ships) {
    if (!s.alive) continue;
    const r3 = Math.hypot(distance(s.pos, e.pos), s.depth - e.depth);
    if (r3 < DC_DAMAGE_R) damage(w, s, r3 < DC_LETHAL ? 100 : 30, e.ownerId, e.pos);
  }
}

/** World system: advances torpedoes, decoys, rockets, depth charges and reloads. */
export function weaponsSystem(w: World, dt: number): void {
  const st = ws(w);
  // (A restored save carries the map as a plain object: the trails rebuild within minutes)
  if (!(st.wakes instanceof Map)) st.wakes = new Map();
  recordWakes(st.wakes, w.ships, w.time);
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
