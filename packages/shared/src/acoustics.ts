import { CLASSES } from './classes.js';
import { sonarPenaltyDb } from './damage.js';
import type { Ship } from './entities.js';
import { isSnorkeling } from './kinematics.js';
import { crewNoiseDb } from './crew.js';
import { KN, angleDiff, bearing, dbSum, distance, type Vec2 } from './math.js';
import { DEEP_M, SHALLOW_M, type SeabedSpec } from './seabed.js';
import { RAIN_NOISE_DB, type WeatherState } from './weather.js';

export interface Environment {
  layerDepth: number; // m, thermocline; 0 = no layer
  layerLoss: number; // dB penalty when crossing the layer one way
  seaState: number; // 0..6
  /** Seabed; absent = deep open ocean everywhere. */
  seabed?: SeabedSpec;
  /** Daylight 0..1 (night reduces visual ranges). */
  light?: number;
  /** Rain squall: louder ambient noise, poorer visibility. */
  rain?: boolean;
  weather?: WeatherState;
  /** Set (current) in m/s; moves submerged boats' dead reckoning off. */
  current?: { x: number; y: number };
}

export const DEFAULT_ENV: Environment = { layerDepth: 120, layerLoss: 12, seaState: 3 };

/** Detection threshold dB (broadband, operator + processing). */
export const DT_PASSIVE = 10;
export const DT_ACTIVE = 10;

/** Transition range from spherical to cylindrical spreading. */
const R0 = 1000;
const ALPHA_PASSIVE = 0.2; // dB/km broadband
const ALPHA_ACTIVE = 2.5; // dB/km at active sonar frequencies (incl. reverberation losses)
const CAVITATION_DB = 15;
const SNORKEL_DB = 28;

export function cavitationSpeedKn(s: Ship): number {
  const spec = CLASSES[s.cls];
  if (spec.cavKn === undefined) return Infinity;
  return spec.cavKn + ((spec.cavDepthKn ?? 0) * s.depth) / 100;
}

export function isCavitating(s: Ship): boolean {
  return s.speed / KN > cavitationSpeedKn(s);
}

/** Broadband radiated source level dB re 1 uPa @ 1 m. */
export function sourceLevel(s: Ship): number {
  const spec = CLASSES[s.cls];
  if (!s.alive) return spec.slBase - 30;
  const kn = Math.max(s.speed / KN, 1);
  let sl = spec.slBase + spec.slSlope * Math.log10(kn / spec.slRefKn);
  if (isCavitating(s)) sl += CAVITATION_DB;
  if (isSnorkeling(s)) sl += SNORKEL_DB;
  sl += crewNoiseDb(s);
  // Ships at anchor still run generators and pumps
  if (s.cls === 'merchant') sl = Math.max(sl, 132);
  return sl;
}

/**
 * Radiated-noise pattern relative to beam aspect: the hull shades the propeller from
 * ahead (up to −4 dB), the screw is heard best from astern (up to +5 dB).
 */
const RAD_BOW_DB = 4;
const RAD_STERN_DB = 5;
/** Active target strength: a hull broadside reflects far more than bow or stern. */
const TS_ASPECT_DB = 4;

/** Angle off the ship's bow toward a point, 0 = dead ahead, 180 = dead astern; undefined if co-located. */
export function aspectOffBow(s: Ship, from: Vec2): number | undefined {
  if (distance(s.pos, from) < 1) return undefined;
  return Math.abs(angleDiff(s.heading, bearing(s.pos, from)));
}

/** Directivity of the radiated noise toward a listener, dB relative to beam aspect. */
export function radiatedAspectDb(s: Ship, from: Vec2): number {
  const a = aspectOffBow(s, from);
  if (a === undefined) return 0;
  const c = Math.cos((a * Math.PI) / 180);
  return c >= 0 ? -RAD_BOW_DB * c : RAD_STERN_DB * -c;
}

/** Broadband source level as heard from a given position (with the radiation pattern). */
export function sourceLevelToward(s: Ship, from: Vec2): number {
  return sourceLevel(s) + radiatedAspectDb(s, from);
}

/** Active target strength seen from a given position: beam +4 dB, bow/stern −4 dB. */
export function targetStrengthToward(s: Ship, from: Vec2): number {
  const ts = CLASSES[s.cls].targetStrength;
  const a = aspectOffBow(s, from);
  if (a === undefined) return ts;
  return ts + TS_ASPECT_DB * (2 * Math.abs(Math.sin((a * Math.PI) / 180)) - 1);
}

/** Radiated noise of a running torpedo (dB re 1 uPa @ 1 m). */
export function torpedoSourceLevel(speedKn: number): number {
  return 150 + 20 * Math.log10(Math.max(speedKn, 1) / 40);
}

/** Whether source and receiver are on opposite sides of the layer. */
export function crossesLayer(depthA: number, depthB: number, env: Environment): boolean {
  if (env.layerDepth <= 0) return false;
  return depthA < env.layerDepth !== depthB < env.layerDepth;
}

/** One-way transmission loss in dB. */
export function transmissionLoss(
  range: number,
  depthA: number,
  depthB: number,
  env: Environment,
  alphaDbPerKm = ALPHA_PASSIVE,
  bottom = 3000,
): number {
  const r = Math.max(range, 1);
  const spread = r <= R0 ? 20 * Math.log10(r) : 20 * Math.log10(R0) + 10 * Math.log10(r / R0);
  const absorb = (alphaDbPerKm * r) / 1000;
  const shallow = bottom < SHALLOW_M;
  // Shallow water: bottom bounce fills the shadow zone (weaker layer) but the bottom absorbs energy
  const layer = crossesLayer(depthA, depthB, env) ? env.layerLoss * (shallow ? 0.5 : 1) : 0;
  const bottomLoss = shallow && r > 2000 ? 3 + (2 * (SHALLOW_M - bottom)) / SHALLOW_M : 0;
  // Deep water: the first convergence zone refocuses sound around 55 km
  const cz = bottom > DEEP_M && r > 50_000 && r < 62_000 ? 12 : 0;
  return spread + absorb + layer + bottomLoss - cz;
}

export function ambientNoise(env: Environment): number {
  return 60 + 3 * env.seaState + (env.rain ? RAIN_NOISE_DB : 0);
}

/** Self noise of the hull array of a receiver at its current speed. */
export function hullSelfNoise(s: Ship): number {
  const h = CLASSES[s.cls].hull;
  const kn = Math.max(s.speed / KN, 1);
  let n = h.selfNoiseBase + 40 * Math.log10(kn / h.selfNoiseRefKn) + sonarPenaltyDb(s);
  if (isSnorkeling(s)) n += 15;
  return n;
}

export function towedSelfNoise(s: Ship): number {
  const t = CLASSES[s.cls].towed;
  if (!t) return Infinity;
  const kn = s.speed / KN;
  const overspeed = Math.max(0, kn - t.maxSpeedKn);
  return t.selfNoise + overspeed * 6;
}

/** Signal excess for passive detection of target by receiver on the given array. */
export function passiveSignalExcess(
  target: Ship,
  receiver: Ship,
  range: number,
  array: 'hull' | 'towed',
  env: Environment,
  receiverDepth = receiver.depth,
  bottom = 3000,
): number {
  return passiveExcessFrom(sourceLevelToward(target, receiver.pos), target.depth, receiver, range, array, env, receiverDepth, bottom);
}

/** Passive signal excess for any noise source with a given level and depth. */
export function passiveExcessFrom(
  sl: number,
  sourceDepth: number,
  receiver: Ship,
  range: number,
  array: 'hull' | 'towed',
  env: Environment,
  receiverDepth = receiver.depth,
  bottom = 3000,
): number {
  const spec = CLASSES[receiver.cls];
  const di = array === 'hull' ? spec.hull.di : (spec.towed?.di ?? 0);
  const self = array === 'hull' ? hullSelfNoise(receiver) : towedSelfNoise(receiver);
  const nl = dbSum(ambientNoise(env), self);
  const tl = transmissionLoss(range, sourceDepth, receiverDepth, env, undefined, bottom);
  return sl - tl - (nl - di) - DT_PASSIVE;
}

/** Signal excess of an active sonar echo (monostatic). */
export function activeSignalExcess(target: Ship, pinger: Ship, range: number, env: Environment, bottom = 3000): number {
  const spec = CLASSES[pinger.cls];
  const sl = spec.hull.activeSl;
  if (sl === undefined) return -Infinity;
  const tl = transmissionLoss(range, pinger.depth, target.depth, env, ALPHA_ACTIVE, Math.min(bottom, 2000));
  const nl = dbSum(ambientNoise(env), hullSelfNoise(pinger));
  const ts = targetStrengthToward(target, pinger.pos);
  return sl - 2 * tl + ts - (nl - spec.hull.di) - DT_ACTIVE;
}

/** Echo excess from a point reflector (knuckle, wreck) with a fixed target strength. */
export function pointEchoExcess(pinger: Ship, range: number, depth: number, ts: number, env: Environment, bottom = 3000): number {
  const spec = CLASSES[pinger.cls];
  const sl = spec.hull.activeSl;
  if (sl === undefined) return -Infinity;
  const tl = transmissionLoss(range, pinger.depth, depth, env, ALPHA_ACTIVE, Math.min(bottom, 2000));
  const nl = dbSum(ambientNoise(env), hullSelfNoise(pinger));
  return sl - 2 * tl + ts - (nl - spec.hull.di) - DT_ACTIVE;
}

/** Signal excess for a target hearing someone else's ping (counter-detection, one-way). */
export function pingInterceptExcess(pinger: Ship, listener: Ship, range: number, env: Environment): number {
  const sl = CLASSES[pinger.cls].hull.activeSl;
  if (sl === undefined) return -Infinity;
  const tl = transmissionLoss(range, pinger.depth, listener.depth, env, ALPHA_ACTIVE);
  const nl = dbSum(ambientNoise(env), hullSelfNoise(listener));
  return sl - tl - nl - DT_PASSIVE;
}

/** Bearing measurement standard deviation in degrees for a given signal excess. */
export function bearingSigma(se: number): number {
  return 0.4 + 4 * Math.exp(-Math.max(se, 0) / 6);
}
