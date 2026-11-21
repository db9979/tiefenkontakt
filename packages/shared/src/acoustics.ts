import { CLASSES } from './classes.js';
import { sonarPenaltyDb } from './damage.js';
import type { Ship } from './entities.js';
import { isSnorkeling } from './kinematics.js';
import { KN, dbSum } from './math.js';

export interface Environment {
  layerDepth: number; // m, thermocline; 0 = no layer
  layerLoss: number; // dB penalty when crossing the layer one way
  seaState: number; // 0..6
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
  return sl;
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
): number {
  const r = Math.max(range, 1);
  const spread = r <= R0 ? 20 * Math.log10(r) : 20 * Math.log10(R0) + 10 * Math.log10(r / R0);
  const absorb = (alphaDbPerKm * r) / 1000;
  const layer = crossesLayer(depthA, depthB, env) ? env.layerLoss : 0;
  return spread + absorb + layer;
}

export function ambientNoise(env: Environment): number {
  return 60 + 3 * env.seaState;
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
): number {
  return passiveExcessFrom(sourceLevel(target), target.depth, receiver, range, array, env, receiverDepth);
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
): number {
  const spec = CLASSES[receiver.cls];
  const di = array === 'hull' ? spec.hull.di : (spec.towed?.di ?? 0);
  const self = array === 'hull' ? hullSelfNoise(receiver) : towedSelfNoise(receiver);
  const nl = dbSum(ambientNoise(env), self);
  const tl = transmissionLoss(range, sourceDepth, receiverDepth, env);
  return sl - tl - (nl - di) - DT_PASSIVE;
}

/** Signal excess of an active sonar echo (monostatic). */
export function activeSignalExcess(target: Ship, pinger: Ship, range: number, env: Environment): number {
  const spec = CLASSES[pinger.cls];
  const sl = spec.hull.activeSl;
  if (sl === undefined) return -Infinity;
  const tl = transmissionLoss(range, pinger.depth, target.depth, env, ALPHA_ACTIVE);
  const nl = dbSum(ambientNoise(env), hullSelfNoise(pinger));
  const ts = CLASSES[target.cls].targetStrength;
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
