import { CLASSES } from './classes.js';
import { sonarPenaltyDb } from './damage.js';
import type { Ship } from './entities.js';
import { isSnorkeling } from './kinematics.js';
import { crewNoiseDb } from './crew.js';
import type { IncidentState } from './incidents.js';
import { KN, angleDiff, bearing, dbSum, distance, type Vec2 } from './math.js';
import { DEEP_M, SHALLOW_M, type SeabedSpec } from './seabed.js';
import { RAIN_NOISE_DB, type WeatherState } from './weather.js';
import { localNoiseDb } from './met.js';

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
  /** Local cells: fog banks, rain squalls, ice (see met.ts). */
  met?: import('./met.js').MetState;
  /** Set (current) in m/s; moves submerged boats' dead reckoning off. */
  current?: { x: number; y: number };
  /** Phase of the tide at match start (radians, drawn per match). */
  tidePhase?: number;
  /** Month (1–12) and latitude of the area: the sun follows them (climate.ts). */
  month?: number;
  lat?: number;
  /** Incidents at sea (driftnets, whales, fronts); present only in full matches. */
  incidents?: IncidentState;
  /** Aircraft: civil traffic and the Ostpakt's long-range reconnaissance. */
  airspace?: import('./airspace.js').AirspaceState;
  /** Escort air defence (missiles in flight, fighters) and naval mines. */
  airdef?: import('./airdef.js').AirDefState;
  mines?: import('./mines.js').MineState;
  /** Match seed (AI commanders' traits are drawn from it). */
  seed?: number;
  /** Mission id and its running state (shadowing time, exit line, weapons tight). */
  mission?: string;
  shadowS?: number;
  weaponsTight?: 'west' | 'east';
  exitY?: number;
  /** Reconnaissance: when and by whom the enemy report went out. */
  reportAt?: number;
  reportBy?: string;
  /** Last threat the convoy noticed (lights go out for 30 min). */
  threatAt?: number;
  /** What each side's AI learned about the other side's players' habits. */
  adapt?: { west?: { pd?: boolean; above?: boolean; fast?: boolean }; east?: { ping?: boolean; fast?: boolean } };
  /** FLASH orders from fleet command (orders.ts). */
  orders?: import('./orders.js').OrdersState;
  /** AI escorts' shared hunt: team datum and roles per side (shown on the plot). */
  hunt?: Partial<Record<'west' | 'east', import('./orders.js').HuntPlan>>;
}

export const DEFAULT_ENV: Environment = { layerDepth: 120, layerLoss: 12, seaState: 3 };

/** Detection threshold dB (broadband, operator + processing). */
export const DT_PASSIVE = 10;
export const DT_ACTIVE = 10;

/** Transition from spherical to cylindrical spreading: about the water depth (clamped). */
const R0_MIN = 150;
const R0_MAX = 1500;
const ALPHA_PASSIVE = 0.2; // dB/km broadband (dominated by low frequencies)
/** dB/km at hull-sonar frequencies (≈5–8 kHz) incl. scattering; reverberation is modelled separately. */
const ALPHA_ACTIVE = 1.8;
/** Steep paths get through the layer close in; its full shadow builds up by this range. */
const LAYER_FULL_M = 2000;
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
  // Spherical until the sound fills the water column, then cylindrical (shallow water: early)
  const r0 = Math.max(R0_MIN, Math.min(R0_MAX, bottom));
  const spread = r <= r0 ? 20 * Math.log10(r) : 20 * Math.log10(r0) + 10 * Math.log10(r / r0);
  const absorb = (alphaDbPerKm * r) / 1000;
  const shallow = bottom < SHALLOW_M;
  // Layer: close in, steep paths go straight through; the shadow is full from ~2 km.
  // Shallow water: bottom bounce fills the shadow (weaker layer)
  const layer = crossesLayer(depthA, depthB, env) ? env.layerLoss * (shallow ? 0.5 : 1) * Math.min(1, r / LAYER_FULL_M) : 0;
  // Surface duct: both above a layer in deep water, sound stays trapped and spreads less
  const duct = !shallow && env.layerDepth > 30 && depthA < env.layerDepth && depthB < env.layerDepth && r > 3000 ? 2 : 0;
  // Every bottom bounce costs energy: the loss grows with range, the shallower the more
  const bottomLoss = shallow && r > r0 ? Math.min(20, (r / 1000) * 0.3 * (SHALLOW_M / Math.max(bottom, 30))) : 0;
  // Deep water: the first convergence zone refocuses sound around 55 km
  const cz = bottom > DEEP_M && r > 50_000 && r < 62_000 ? 12 : 0;
  return spread + absorb + layer + bottomLoss - cz - duct;
}

/** Ambient noise; at a position it adds a rain squall overhead and ice (floes crackling). */
export function ambientNoise(env: Environment, at?: Vec2): number {
  return 60 + 3 * env.seaState + (env.rain ? RAIN_NOISE_DB : 0) + (at ? localNoiseDb(env.met, at, !!env.rain) : 0);
}

/** Self noise of the hull array of a receiver at its current speed. */
/** Depth of the hull sonar: the variable-depth body when lowered, else the ship's own depth. */
export function sonarDepth(s: Ship): number {
  return (s.vdsDepth ?? 0) > 5 ? s.vdsDepth! : s.depth;
}

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

/** Noise in one beam of an array (ambient + self noise, reduced by the array gain). */
export function beamNoise(receiver: Ship, array: 'hull' | 'towed', env: Environment): number {
  const spec = CLASSES[receiver.cls];
  const di = array === 'hull' ? spec.hull.di : (spec.towed?.di ?? 0);
  const self = array === 'hull' ? hullSelfNoise(receiver) : towedSelfNoise(receiver);
  return dbSum(ambientNoise(env, receiver.pos), self) - di;
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
  const nl = dbSum(ambientNoise(env, receiver.pos), self);
  const tl = transmissionLoss(range, sourceDepth, receiverDepth, env, undefined, bottom);
  return sl - tl - (nl - di) - DT_PASSIVE;
}

/** Pulse options: LFM compresses the pulse (less reverberation); a CW echo with Doppler stands clear of it. */
export interface PulseOpts {
  lfm?: boolean;
  /** Radial speed of the target in kn (CW only); ≥ 3 kn moves the echo out of the reverberation band. */
  closingKn?: number;
}

/**
 * Reverberation level at a range: the pulse lights up the sea surface (and the bottom in
 * shallow water) and that backscatter competes with the echo. Grows weaker with range
 * (30·log r for a surface-limited cell), stronger with sea state and over a shallow bottom.
 */
export function reverbLevel(sl: number, range: number, env: Environment, bottom: number, o: PulseOpts = {}): number {
  const r = Math.max(range, 50);
  // Shallow water: strong bottom backscatter (grazing paths); deep water: surface only, rising with sea state
  const scatter = bottom < SHALLOW_M ? -22 + (SHALLOW_M - bottom) / 40 : -45 + 2 * env.seaState;
  // Scattering cell ≈ r · (c·τ/2) · beam width; LFM compresses τ, a Doppler-shifted CW echo avoids the band
  const rl = sl - 30 * Math.log10(r) + scatter + 11.8 - (2 * ALPHA_ACTIVE * r) / 1000;
  // LFM: pulse compression wins about 14 dB against reverberation; CW only when Doppler lifts the echo out of it
  return rl - (o.lfm ? 14 : Math.abs(o.closingKn ?? 0) >= 3 ? 10 : 0);
}

/** Signal excess of an active sonar echo (monostatic): echo against noise and reverberation. */
export function activeSignalExcess(target: Ship, pinger: Ship, range: number, env: Environment, bottom = 3000, o: PulseOpts = {}): number {
  const spec = CLASSES[pinger.cls];
  const sl = spec.hull.activeSl;
  if (sl === undefined) return -Infinity;
  const tl = transmissionLoss(range, sonarDepth(pinger), target.depth, env, ALPHA_ACTIVE, Math.min(bottom, 2000));
  const nl = dbSum(ambientNoise(env, pinger.pos), hullSelfNoise(pinger));
  const ts = targetStrengthToward(target, pinger.pos);
  return sl - 2 * tl + ts - dbSum(nl - spec.hull.di, reverbLevel(sl, range, env, bottom, o)) - DT_ACTIVE;
}

/** Echo excess from a point reflector (knuckle, wreck) with a fixed target strength. */
export function pointEchoExcess(pinger: Ship, range: number, depth: number, ts: number, env: Environment, bottom = 3000): number {
  const spec = CLASSES[pinger.cls];
  const sl = spec.hull.activeSl;
  if (sl === undefined) return -Infinity;
  const tl = transmissionLoss(range, pinger.depth, depth, env, ALPHA_ACTIVE, Math.min(bottom, 2000));
  const nl = dbSum(ambientNoise(env, pinger.pos), hullSelfNoise(pinger));
  return sl - 2 * tl + ts - dbSum(nl - spec.hull.di, reverbLevel(sl, range, env, bottom, { lfm: pinger.pulse === 'lfm' })) - DT_ACTIVE;
}

/** Signal excess for a target hearing someone else's ping (counter-detection, one-way). */
export function pingInterceptExcess(pinger: Ship, listener: Ship, range: number, env: Environment): number {
  const sl = CLASSES[pinger.cls].hull.activeSl;
  if (sl === undefined) return -Infinity;
  const tl = transmissionLoss(range, sonarDepth(pinger), listener.depth, env, ALPHA_ACTIVE);
  const nl = dbSum(ambientNoise(env, listener.pos), hullSelfNoise(listener));
  return sl - tl - nl - DT_PASSIVE;
}

/** Bearing measurement standard deviation in degrees for a given signal excess. */
export function bearingSigma(se: number): number {
  return 0.4 + 4 * Math.exp(-Math.max(se, 0) / 6);
}
