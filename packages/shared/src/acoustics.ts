import { CLASSES } from './classes.js';
import { sonarPenaltyDb } from './damage.js';
import type { Ship } from './entities.js';
import { isSnorkeling } from './kinematics.js';
import { crewNoiseDb } from './crew.js';
import type { IncidentState } from './incidents.js';
import { KN, angleDiff, bearing, dbSum, distance, headingVec, type Vec2 } from './math.js';
import { DEEP_M, SHALLOW_M, type SeabedSpec } from './seabed.js';
import { RAIN_NOISE_DB, type WeatherState } from './weather.js';
import { localNoiseDb } from './met.js';
import { areaAcoustics, areaKind, type AreaAcoustics } from './sea-acoustics.js';

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
  /** Longitude of the area (degrees east) and the day of the month (the moon's age, moon.ts); the day rolls on past midnight. */
  lon?: number;
  day?: number;
  /** Moonlight at the sea now (0..1: phase, height, clouds; moon.ts). Unset = no moon data (the plain night). */
  moon?: number;
  /** Incidents at sea (driftnets, whales, fronts); present only in full matches. */
  incidents?: IncidentState;
  /** Aircraft: civil traffic and the Ostpakt's long-range reconnaissance. */
  airspace?: import('./airspace.js').AirspaceState;
  /** Escort air defence (missiles in flight, fighters) and naval mines. */
  airdef?: import('./airdef.js').AirDefState;
  mines?: import('./mines.js').MineState;
  /** Anti-ship missiles in flight (antiship.ts). */
  ssm?: import('./antiship.js').SsmState;
  /** Match seed (AI commanders' traits are drawn from it). */
  seed?: number;
  /** Mission id and its running state (shadowing time, exit line, weapons tight). */
  mission?: string;
  shadowS?: number;
  /** Sim time the mission goals were last evaluated (shadowing time accrues from there). */
  evalAt?: number;
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

/** The propeller's upper blade tip rides this far above the boat's depth (keel) reading (m). */
export const PROP_TIP_ABOVE_KEEL_M = 7;

/**
 * Cavitation inception speed at a depth. The blade tip cavitates when the local pressure drop
 * (∝ v²) reaches the static head there, so the inception speed grows with √(pressure):
 * v(d) = cavKn · √((10 m + tip depth) / 10 m), with the tip PROP_TIP_ABOVE_KEEL_M above the keel
 * (Ross, Mechanics of Underwater Noise, ch. 8; Urick ch. 10). Example SSK (cavKn 4,5): 6,5 kn at
 * periscope depth, 13,8 kn at 100 m, 17,6 kn at 150 m. Going deep is how a boat sprints quietly.
 */
export function cavitationSpeedAt(cls: Ship['cls'], depth: number): number {
  const cav = CLASSES[cls].cavKn;
  if (cav === undefined) return Infinity;
  const tip = Math.max(0, depth - PROP_TIP_ABOVE_KEEL_M);
  return cav * Math.sqrt((10 + tip) / 10);
}

export function cavitationSpeedKn(s: Ship): number {
  return cavitationSpeedAt(s.cls, s.depth);
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
  const near = spread + absorb + layer + bottomLoss - duct;
  // Shelf seas, fjords, harbours and narrows: shallow-water multipath as it was, never a CZ
  if (shallow || areaKind(env.seabed) !== 'open') return near;
  // Open sea over deep water: the direct path ends, then shadow (filled by bottom bounce), then the CZ rings
  // (hot path: no allocation, the same figures as deepPaths)
  const ac = areaAcoustics(env.seabed);
  const direct = near + shadowExcess(r, depthA, depthB, env, bottom, ac);
  if (ac.czKm === undefined || ac.halfChannel || bottom < ac.czDepthM) return direct;
  // CZ paths run deep under the layer and turn up again: no layer term, refocusing gain in the annulus
  const at = ac.czKm * 1000;
  const gain = Math.max(czGain(r, at, at * CZ1_HALF, CZ1_DB), czGain(r, 2 * at, 2 * at * CZ2_HALF, CZ2_DB));
  return gain > 0 ? Math.min(direct, spread + absorb - gain) : direct;
}

/**
 * Deep-water propagation beyond the direct path (open sea, bottom deeper than SHALLOW_M).
 * Sources: Urick ch. 6 (limiting ray of the direct path ≈ √(2R·z) per end in a downward-refracting
 * profile, R ≈ 80 km: 400 m per √m), shadow zone 10–25 dB below the CZ, bottom bounce at about
 * 10–15 dB per bounce (here the cap of the shadow), CZ width 5–10 % of its range, the second
 * zone at twice the range and weaker. The surface duct leaks out the more, the thinner it is
 * (cutoff ≈ 1500/(0.008·D^1.5) Hz: a 30 m duct holds nothing of the low band, 100 m holds it).
 */
/** Direct-path end: 4 km plus 400 m per √m of source and receiver depth, clamped 6–20 km. */
export const DP_BASE_M = 4000;
export const DP_PER_SQRT_M = 400;
export const DP_MIN_M = 6000;
export const DP_MAX_M = 20_000;
/** Shadow zone: dB per km past the direct path, and its floor (bottom bounce fills it) over CZ-deep water. */
export const SHADOW_DB_PER_KM = 3;
export const SHADOW_MAX_DB = 18;
/** Over water too shallow for a CZ (300 m up to the CZ depth) bottom bounce comes back strongly: this cap at 300 m. */
export const SHADOW_MID_MIN_DB = 6;
/** First and second CZ: peak gain (dB, against the near-field curve without the layer) and half width (fraction of the zone's range). */
export const CZ1_DB = 12;
export const CZ2_DB = 7;
export const CZ1_HALF = 0.05;
export const CZ2_HALF = 0.07;
/** Arctic half-channel: surface-reflected paths lose about this much per km (ice and surface scatter) instead of a shadow. */
const HALF_CHANNEL_DB_PER_KM = 0.6;

export interface DeepPaths {
  /** Range where the direct path ends (m). */
  rdp: number;
  /** Extra loss beyond the direct path (shadow, duct leakage or half-channel scatter) at a range. */
  excessAt(r: number): number;
  /** Convergence zones: centre (m), half width (m), peak gain (dB). */
  cz: { at: number; half: number; db: number }[];
  /** The source/receiver pair is ducted (both above a layer): leakage instead of a shadow. */
  ducted: boolean;
}

/** Duct leakage (dB/km) by layer depth: thin ducts lose the low band, deep ones hold it. */
export function ductLeakDbPerKm(layerDepth: number): number {
  return Math.max(0.15, Math.min(1.2, 1.6 - 0.012 * layerDepth));
}

const directPathEnd = (depthA: number, depthB: number) =>
  Math.max(DP_MIN_M, Math.min(DP_MAX_M, DP_BASE_M + DP_PER_SQRT_M * (Math.sqrt(Math.max(0, depthA)) + Math.sqrt(Math.max(0, depthB)))));
const isDucted = (depthA: number, depthB: number, env: Environment) => env.layerDepth > 30 && depthA < env.layerDepth && depthB < env.layerDepth;

/** Extra loss past the direct path: shadow (or duct leakage, or half-channel scatter), capped where bottom bounce fills in. */
function shadowExcess(r: number, depthA: number, depthB: number, env: Environment, bottom: number, ac: AreaAcoustics): number {
  const rdp = directPathEnd(depthA, depthB);
  if (r <= rdp) return 0;
  // Bottom bounce fills the shadow: fully deep water down to the CZ floor, shallower water much less
  const czDepth = Math.min(ac.czDepthM, DEEP_M + 1000);
  const f = Math.max(0, Math.min(1, (bottom - SHALLOW_M) / Math.max(1, czDepth - SHALLOW_M)));
  const cap = SHADOW_MID_MIN_DB + (SHADOW_MAX_DB - SHADOW_MID_MIN_DB) * f;
  const slope = ac.halfChannel && env.layerDepth <= 30 ? HALF_CHANNEL_DB_PER_KM : isDucted(depthA, depthB, env) ? ductLeakDbPerKm(env.layerDepth) : SHADOW_DB_PER_KM;
  return Math.min(cap, ((r - rdp) / 1000) * slope);
}

/** Deep-water path structure for a source/receiver depth pair over a given bottom (open sea): for the range panel and tests. */
export function deepPaths(depthA: number, depthB: number, env: Environment, bottom: number): DeepPaths {
  const ac = areaAcoustics(env.seabed);
  const cz = ac.czKm !== undefined && !ac.halfChannel && bottom >= ac.czDepthM
    ? [{ at: ac.czKm * 1000, half: ac.czKm * 1000 * CZ1_HALF, db: CZ1_DB }, { at: 2 * ac.czKm * 1000, half: 2 * ac.czKm * 1000 * CZ2_HALF, db: CZ2_DB }]
    : [];
  return {
    rdp: directPathEnd(depthA, depthB), ducted: isDucted(depthA, depthB, env), cz,
    excessAt: (r) => shadowExcess(r, depthA, depthB, env, bottom, ac),
  };
}

/** Gain of one CZ annulus at a range: flat top over the inner 60 %, cosine edges. */
function czGain(r: number, at: number, half: number, db: number): number {
  const x = Math.abs(r - at) / half;
  if (x >= 1) return 0;
  if (x <= 0.6) return db;
  return db * Math.cos(((x - 0.6) / 0.4) * (Math.PI / 2)) ** 2;
}

/** Distant shipping noise of the sea area (dB added to the ambient). */
export function shippingNoiseDb(env: Environment): number {
  return areaAcoustics(env.seabed).shippingDb;
}

/** Ambient noise: wind (sea state), distant shipping of the area, rain; at a position also a rain squall overhead and ice (floes crackling). */
export function ambientNoise(env: Environment, at?: Vec2): number {
  return 60 + 3 * env.seaState + shippingNoiseDb(env) + (env.rain ? RAIN_NOISE_DB : 0) + (at ? localNoiseDb(env.met, at, !!env.rain) : 0);
}

/** Self noise of the hull array of a receiver at its current speed. */
/** Depth of the hull sonar: the variable-depth body when lowered, else the ship's own depth. */
export function sonarDepth(s: Ship): number {
  return (s.vdsDepth ?? 0) > 5 ? s.vdsDepth! : s.depth;
}

/** A streamed Nixie decoy is loud on purpose: it rides close behind the towed array and reaches the hull sonar too. */
export const NIXIE_TOWED_DB = 12;
export const NIXIE_HULL_DB = 5;

export function hullSelfNoise(s: Ship): number {
  const h = CLASSES[s.cls].hull;
  const kn = Math.max(s.speed / KN, 1);
  let n = h.selfNoiseBase + 40 * Math.log10(kn / h.selfNoiseRefKn) + sonarPenaltyDb(s);
  if (isSnorkeling(s)) n += 15;
  if (s.nixie) n += NIXIE_HULL_DB;
  return n;
}

export function towedSelfNoise(s: Ship): number {
  const t = CLASSES[s.cls].towed;
  if (!t) return Infinity;
  const kn = s.speed / KN;
  const overspeed = Math.max(0, kn - t.maxSpeedKn);
  return t.selfNoise + overspeed * 6 + (s.nixie ? NIXIE_TOWED_DB : 0);
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

/** Velocity of a ship over the water (m/s; going astern points backwards). */
function velocity(s: Pick<Ship, 'heading' | 'speed' | 'sternway'>): Vec2 {
  const v = headingVec(s.heading);
  const way = s.sternway ? -s.speed : s.speed;
  return { x: v.x * way, y: v.y * way };
}

/** Radial closing speed between a source and a receiver (m/s, + = the range shrinks): it Doppler-shifts the source's lines. */
export function closingSpeedMps(src: Pick<Ship, 'pos' | 'heading' | 'speed' | 'sternway'>, rcv: Pick<Ship, 'pos' | 'heading' | 'speed' | 'sternway'>): number {
  const d = distance(src.pos, rcv.pos);
  if (d < 1) return 0;
  const ux = (rcv.pos.x - src.pos.x) / d, uy = (rcv.pos.y - src.pos.y) / d;
  const vs = velocity(src), vr = velocity(rcv);
  return (vs.x - vr.x) * ux + (vs.y - vr.y) * uy;
}

/** Bearing measurement standard deviation in degrees for a given signal excess. */
export function bearingSigma(se: number): number {
  return 0.4 + 4 * Math.exp(-Math.max(se, 0) / 6);
}
