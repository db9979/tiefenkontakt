import { towedGeometryDepth } from './towed-geometry.js';
import {
  activeSignalExcess,
  bearingSigma,
  isCavitating,
  passiveExcessFrom,
  passiveSignalExcess,
  pointEchoExcess,
  pingInterceptExcess,
  type Environment,
  beamNoise,
  sourceLevelToward,
  transmissionLoss,
  closingSpeedMps,
  sonarDepth,
} from './acoustics.js';
import { isBroaching, isSnorkeling } from './kinematics.js';
import { lookoutSweep, type Sighting } from './lookout.js';
import { seeingLight } from './moon.js';
import { crewNoiseDb, crewSonarDb } from './crew.js';
import { measureEvidence, sigKeyOf, type Evidence, type SigKey } from './signatures.js';
import { SHALLOW_M } from './seabed.js';
import { bottomFeatures } from './bottom-echo.js';
import { lineOfSight, soundPathDepth as pathDepth, terrainLossDb } from './terrain.js';
import { metVisibility } from './weather.js';
import { CLASSES, type ClassId } from './classes.js';
import { RECOG } from './recognition.js';
import type { Ship } from './entities.js';
import { isAtPeriscopeDepth, mastExposed, mastRaised } from './entities.js';
import { KN, NM, angleDiff, bearing, dbSum, distance, headingVec, wrap360, type Vec2 } from './math.js';
import type { Rng } from './rng.js';
import { emitterSpec, esmLevel, esmTrend, shipEmitter } from './emitters.js';
import { ICE_MASK_DB, iceCover, inSquall, sightPenalty } from './met.js';

export type SensorKind = 'hull' | 'towed' | 'active' | 'intercept' | 'periscope' | 'radar' | 'esm' | 'buoy' | 'visual' | 'mad';

/** A single sensor measurement. targetId never leaves the server. */
export interface Detection {
  observerId: string;
  targetId: string;
  sensor: SensorKind;
  time: number;
  bearing: number;
  /** Towed array left/right ambiguity: the mirrored bearing. */
  bearingAlt?: number;
  range?: number;
  se: number;
  /** Only set by visual identification (periscope). Sonar never names a contact. */
  classified?: ClassId;
  /** Bridge lookout: what was seen (periscope feather, snorkel haze, conning tower). */
  sighting?: Sighting;
  /** Intercepted ping: whose sonar it was (frequency tells hull sonar from a dipping sonar). */
  source?: 'hull' | 'dip' | 'buoy';
  /** Seen through the periscope with navigation lights burning. */
  lit?: boolean;
  /** Periscope: power of the optic at the time (1.5, 6, 12). */
  mag?: number;
  /** Periscope: angle from waterline to masthead as the stadimeter marks it (mrad, with the marking error). */
  subtense?: number;
  /** Narrowband/DEMON measurements for passive sonar looks. */
  evidence?: Evidence;
  /** CW active echo: target closing speed in kn (positive = approaching). */
  dopplerKn?: number;
  /** Where the measurement was taken if not at the observer (sonobuoy position). */
  originX?: number;
  originY?: number;
  /** ESM: intercepted emitter (emitters.ts), signal strength 0..2 and its trend. */
  emitter?: string;
  esmLvl?: 0 | 1 | 2;
  esmTrend?: -1 | 0 | 1;
}

/** A non-ship noise source (running torpedo) that passive sonar can hear. */
export interface Emitter {
  id: string;
  ownerId: string;
  pos: Vec2;
  depth: number;
  sl: number;
  sig: SigKey;
  speedKn: number;
}

/**
 * Active sonar range scales (m) and the ping interval each needs: the echo from the edge of
 * the scale has to come back (2·r / 1500 m/s) and the operator needs a moment on the picture.
 * Echoes from beyond the scale arrive after the receiver stopped listening: not shown.
 */
export const PING_RANGES = [4000, 8000, 16_000] as const;
export type PingRange = (typeof PING_RANGES)[number];
export const DEFAULT_PING_RANGE: PingRange = 8000;
const PING_EVERY_S: Record<PingRange, number> = { 4000: 6, 8000: 11, 16_000: 22 };

export function pingRangeOf(s: Pick<Ship, 'pingRange'>): PingRange {
  return (PING_RANGES as readonly number[]).includes(s.pingRange ?? 0) ? (s.pingRange as PingRange) : DEFAULT_PING_RANGE;
}

/** Seconds between pings on the ship's range scale (4 / 8 / 16 km → 6 / 11 / 22 s). */
export function pingInterval(s: Pick<Ship, 'pingRange'>): number {
  return PING_EVERY_S[pingRangeOf(s)];
}
const SE_FLUCTUATION = 1; // dB sd per sample (fast part)
const FADE_DB = 3; // slow fading amplitude

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Slow, per contact and array different signal fading (±3 dB over 40-70 s). */
export function fading(key: string, t: number): number {
  const period = 40 + 30 * hash01(key);
  return FADE_DB * Math.sin((2 * Math.PI * t) / period + 2 * Math.PI * hash01(key + '#'));
}
const RADAR_RANGE = 22 * NM;
const ESM_RANGE = 40 * NM;

/**
 * Radar against a submarine: one chance per antenna turn, p = base · (1 − r/Rmax) · clutter.
 * A periscope or mast head is a tiny, intermittent return; the snorkel head with its spray and
 * exhaust is a far better one. A surfaced boat's conning tower and casing (some 10–100 m² of
 * radar cross-section) is a solid paint: a frigate's surface-search radar holds it at 8–12 nm
 * in a moderate sea; that is why diesel boats charged on the snorkel, not on the surface.
 */
export const MAST_RADAR = { mast: { base: 0.08, rmax: 5 * NM }, snorkel: { base: 0.4, rmax: 8 * NM }, hull: { base: 0.9, rmax: 12 * NM } } as const;
export type MastKind = keyof typeof MAST_RADAR;
const RADAR_MAST_RANGE = MAST_RADAR.mast.rmax;
const RADAR_SNORKEL_RANGE = MAST_RADAR.snorkel.rmax;
export { RADAR_RANGE, RADAR_MAST_RANGE, RADAR_SNORKEL_RANGE };
/** Height of a surfaced boat's conning tower above the sea (m): for line of sight and the horizon. */
export const SURFACED_TOP_M = 6;
/** A boat shallower than this has her conning tower and casing out of the water. */
export const SURFACED_DEPTH_M = 2;

/** Is this submarine on the surface (conning tower and casing out of the water)? */
export function isSurfacedBoat(s: Ship): boolean {
  return CLASSES[s.cls].submarine && s.alive && s.depth < SURFACED_DEPTH_M;
}

/**
 * What of a submarine sticks out of the water for a radar: the whole boat (surfaced, or broaching
 * in a heavy sea at `now`), the snorkel head, a mast, or nothing.
 */
export function exposedMast(s: Ship, now?: number): MastKind | undefined {
  if (isSurfacedBoat(s) || (CLASSES[s.cls].submarine && isBroaching(s, now))) return 'hull';
  if (!mastExposed(s)) return undefined;
  return (s.snorkelExt ?? 0) > 0.3 ? 'snorkel' : 'mast';
}

/**
 * Sea clutter factor of a radar against a small target. Up to sea state 3 the old 12 % per
 * step; above it the non-coherent search radars of the period lose a periscope in the
 * whitecaps almost completely (SS5 0,30, SS6 0,13). A snorkel head with its spray and
 * exhaust is lost more slowly (floor 0,2); a surfaced hull stands well above the clutter.
 */
export function radarClutter(seaState: number, kind: MastKind = 'mast'): number {
  if (kind === 'hull') return Math.max(0.5, 1 - 0.06 * seaState);
  const calm = 1 - 0.12 * Math.min(seaState, 3);
  const rough = Math.max(0, seaState - 3);
  return kind === 'snorkel' ? Math.max(0.2, calm - 0.12 * rough) : Math.max(0.05, calm - 0.17 * rough);
}

/** Chance per antenna turn that a radar paints this mast at this range (rmax: the radar's own limit for it). */
export function mastDetectP(kind: MastKind, range: number, seaState: number, rmax: number = MAST_RADAR[kind].rmax, base: number = MAST_RADAR[kind].base): number {
  if (range >= rmax) return 0;
  return base * (1 - range / rmax) * radarClutter(seaState, kind);
}

/**
 * Did this antenna complete a turn during the last sensor second? Each radar has its own phase
 * (from its id), so the sweeps of two ships don't fall on the same second.
 */
export function antennaTurned(id: string, rotationS: number, t: number, dt = 1): boolean {
  const off = hash01(`${id}|ant`) * rotationS;
  return Math.floor((t + off) / rotationS) !== Math.floor((t - dt + off) / rotationS);
}

/** Radio horizon (m) between two antenna heights (m), 4/3 earth radius. */
export function radioHorizon(hA: number, hB: number): number {
  return 4120 * (Math.sqrt(hA) + Math.sqrt(hB));
}

/**
 * How far an ESM receiver / radar warner at height hObs hears a radar at height hEmit: a little
 * past the radio horizon (strong main beam, the odd duct), never beyond 40 nm.
 */
export const ESM_HORIZON_FACTOR = 1.1;
export function esmReach(hObs: number, hEmit: number): number {
  return Math.min(ESM_RANGE, ESM_HORIZON_FACTOR * radioHorizon(hObs, hEmit));
}

export interface SensorContext {
  ships: readonly Ship[];
  emitters?: readonly Emitter[];
  env: Environment;
  time: number;
  rng: Rng;
  /** Bubble fields from hard turns: they block sound passing through and return false echoes. */
  knuckles?: readonly { id: string; pos: Vec2; depth: number }[];
}

const KNUCKLE_R = 70;
const KNUCKLE_TS = 12;
const KNUCKLE_LOSS_DB = 7;

/** Extra loss where the sound path a→b runs through knuckles (at most two count). */
export function knuckleLoss(a: Vec2, b: Vec2, knuckles: SensorContext['knuckles']): number {
  if (!knuckles?.length) return 0;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let n = 0;
  for (const k of knuckles) {
    const t = Math.max(0, Math.min(1, ((k.pos.x - a.x) * dx + (k.pos.y - a.y) * dy) / len2));
    if (Math.hypot(a.x + dx * t - k.pos.x, a.y + dy * t - k.pos.y) < KNUCKLE_R && ++n >= 2) break;
  }
  return n * KNUCKLE_LOSS_DB;
}

/**
 * Slow, correlated bearing bias (degrees, unit standard deviation) per contact and sensor:
 * multipath, refraction, array shape and the operator's own habit keep a bearing off by the
 * same amount for minutes. Smooth value noise over two scales (knots every 4 and 12 minutes,
 * the slow one carrying three quarters of the variance), seeded by the key: no state to carry, the same for everyone who
 * asks at the same time. This is why a real TMA needs a second leg and a cross-bearing.
 */
const BIAS_KNOTS = [[240, 0.5], [720, Math.sqrt(0.75)]] as const;
/** FNV-1a with a murmur3 finaliser: keys that differ only in the last digit land far apart. */
function mix01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function gaussOf(key: string): number {
  // Box–Muller from two hashes: a normal deviate fixed by the key
  const u = Math.max(1e-9, mix01(key)), v = mix01(key + '~');
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function bearingBias(key: string, t: number): number {
  let sum = 0;
  for (const [T, amp] of BIAS_KNOTS) {
    const x = t / T + mix01(`${key}|o${T}`);
    const k = Math.floor(x), f = x - k;
    const w = (1 - Math.cos(Math.PI * f)) / 2;
    sum += amp * (gaussOf(`${key}|${T}|${k}`) * (1 - w) + gaussOf(`${key}|${T}|${k + 1}`) * w);
  }
  // Cosine interpolation between two unit normals has a variance between 0,5 and 1 (mean 0,75)
  return sum / Math.sqrt(0.75);
}

/**
 * Size (1 σ, degrees) of that slow bias per sensor: a hull array 1–2° (here 1°, the lower end,
 * so the AI TMA settle gate still passes), a towed
 * array about 1° at broadside (growing toward endfire), the periscope 0,2°, the radar 0,3°,
 * ESM direction finding 3–5° (4°). Active sonar shares the hull array's error.
 */
export const BEARING_BIAS_DEG = { hull: 1, towed: 1, active: 1, intercept: 1, periscope: 0.2, radar: 0.3, esm: 4 } as const;

/** The slow bias of this observer's sensor on this target now (degrees); different in every match (seed). */
function biasOf(ctx: Pick<SensorContext, 'env' | 'time'>, obsId: string, tgtId: string, sensor: keyof typeof BEARING_BIAS_DEG): number {
  return BEARING_BIAS_DEG[sensor] * bearingBias(`${ctx.env.seed ?? 0}|${obsId}|${tgtId}|${sensor}`, ctx.time);
}

function noisyBearing(trueB: number, se: number, rng: Rng, bias = 0): number {
  return wrap360(trueB + bias + rng.gauss(0, bearingSigma(se)));
}

/**
 * A line array measures the cosine of the cone angle: its bearing error grows as 1 / sin θ
 * toward the axis (1° at the beam is about 3° at 20° off endfire). Capped at four times the
 * broadside value: inside some 15° of endfire the array is no use for TMA anyway.
 */
export const TOWED_ENDFIRE_CAP = 4;
export function towedErrorFactor(rel: number): number {
  return 1 / Math.max(1 / TOWED_ENDFIRE_CAP, Math.abs(Math.sin((rel * Math.PI) / 180)));
}

/** Depth of the towed array: it streams below and behind the towing ship, shallower the faster she goes (towed-geometry.ts). */
export function towedArrayDepth(s: Ship): number {
  return towedGeometryDepth(s);
}

/** Settling time after the last disturbance: set by the size of the alteration (kinematics), else the class value. */
export function towedArrayReady(s: Ship, now: number): boolean {
  const spec = CLASSES[s.cls].towed;
  return !!spec && s.towedLength > 0 && now - s.lastTurnAt >= (s.towedSettle ?? spec.settleTime);
}

/** Narrowband processing gain of a towed array on a target with strong tonals (dB). */
export const TOWED_NB_GAIN_DB = 8;

/**
 * Does the target give the towed array's narrowband processing tonals to lock on? Surface ships
 * (diesels, turbines, generators) always; a submarine only while it snorkels, runs its diesels
 * surfaced, pumps or works noisily (crewNoiseDb > 0), cavitates or blows tanks. A battery boat
 * creeping quietly offers none.
 */
export function tonalTarget(t: Ship): boolean {
  const spec = CLASSES[t.cls];
  if (!spec.submarine) return true;
  const dieselSurfaced = !!spec.battery && t.depth <= 0.5;
  return isSnorkeling(t) || dieselSurfaced || crewNoiseDb(t) > 0 || isCavitating(t) || !!t.blowing;
}

/** Received broadband level of every other loud source at an observer (computed once per sweep). */
interface Heard { id: string; b: number; rl: number }
const BEAM_HALF = { hull: 8, towed: 5 } as const;
const MASK_FLOOR_DB = 25;

function heardSources(obs: Ship, ctx: SensorContext): Heard[] {
  const out: Heard[] = [];
  for (const s of ctx.ships) {
    if (s === obs || !s.alive) continue;
    const r = distance(obs.pos, s.pos);
    const rl = sourceLevelToward(s, obs.pos) - transmissionLoss(r, s.depth, obs.depth, ctx.env, undefined, pathDepth(ctx.env.seabed, obs.pos, s.pos)) -
      terrainLossDb(ctx.env.seabed, s.pos, s.depth, obs.pos, obs.depth);
    out.push({ id: s.id, b: bearing(obs.pos, s.pos), rl });
  }
  return out;
}

/**
 * Masking: loud ships in or near the same beam drown a quiet target (a convoy hides a boat
 * running in its noise). Returns the dB the target's signal excess loses on this array.
 */
function maskingLoss(obs: Ship, tgtId: string, tgtB: number, heard: Heard[], array: 'hull' | 'towed', env: Environment): number {
  const half = BEAM_HALF[array];
  // Only sources clearly louder than the target in its beam drown it; equal ones are told apart
  const own = heard.find((h) => h.id === tgtId)?.rl ?? -Infinity;
  let sum = 0;
  for (const h of heard) {
    if (h.id === tgtId) continue;
    // A line array can't tell port from starboard: sources at the mirrored cone angle mask too
    const off = array === 'towed'
      ? Math.abs(Math.abs(angleDiff(obs.heading, h.b)) - Math.abs(angleDiff(obs.heading, tgtB)))
      : Math.abs(angleDiff(h.b, tgtB));
    const rejection = off <= half ? 0 : Math.min(MASK_FLOOR_DB, (off - half) * 1.5);
    const level = h.rl - rejection;
    if (level > own + 3) sum += 10 ** (level / 10);
  }
  if (sum <= 0) return 0;
  const n = beamNoise(obs, array, env);
  return dbSum(n, 10 * Math.log10(sum)) - n;
}

const heardCache = new WeakMap<Ship, { t: number; heard: Heard[] }>();

/** Hull arrays look out and down only to about 30°: a target steeper below the hull is in the blind cone. */
const BLIND_TAN = Math.tan((30 * Math.PI) / 180);
export function belowHull(obs: Ship, tgt: Ship, range: number): boolean {
  return tgt.depth - sonarDepth(obs) > Math.max(range, 1) * BLIND_TAN;
}

/**
 * Heavy weather and a surface ship's bow dome: from sea state 5 the dome pitches, slams and
 * draws air under the keel. The hull sonar loses 3 dB at SS5 and 8 dB at SS6 and drops out
 * now and then (7 % / 14 % of looks and pings). A lowered VDS body and the towed array ride
 * deep and steady: they are untouched, which is why navies bought them. Submarines don't care.
 */
export function domeQuenchDb(obs: Ship, seaState: number): number {
  if (CLASSES[obs.cls].submarine || (obs.vdsDepth ?? 0) > 5) return 0;
  return seaState < 5 ? 0 : 3 + 5 * (seaState - 5);
}
export function domeDropoutP(obs: Ship, seaState: number): number {
  if (CLASSES[obs.cls].submarine || (obs.vdsDepth ?? 0) > 5) return 0;
  return 0.07 * Math.max(0, seaState - 4);
}

function passive(obs: Ship, tgt: Ship, ctx: SensorContext, out: Detection[]): void {
  const spec = CLASSES[obs.cls];
  const range = distance(obs.pos, tgt.pos);
  const bottom = pathDepth(ctx.env.seabed, obs.pos, tgt.pos);
  const trueB = bearing(obs.pos, tgt.pos);
  const rel = angleDiff(obs.heading, trueB);
  // Operators: fresh, alert crews hear more; knuckles in the path swallow sound
  // A boat under or among floes hides in the crackling of the ice
  // Land and sills in between: an island is a wall, a sill lets only the sound near its crest over
  const adj = crewSonarDb(obs) - knuckleLoss(obs.pos, tgt.pos, ctx.knuckles) - ICE_MASK_DB * iceCover(ctx.env.met, tgt.pos) -
    terrainLossDb(ctx.env.seabed, tgt.pos, tgt.depth, obs.pos, sonarDepth(obs));
  let cache = heardCache.get(obs);
  if (!cache || cache.t !== ctx.time) heardCache.set(obs, (cache = { t: ctx.time, heard: heardSources(obs, ctx) }));
  const heard = cache.heard;

  if (spec.hull.di > 0 && Math.abs(rel) < 180 - spec.hull.baffleHalfAngle && !belowHull(obs, tgt, range)) {
    const se = passiveSignalExcess(tgt, obs, range, 'hull', ctx.env, sonarDepth(obs), bottom) + fading(`${obs.id}|${tgt.id}|h`, ctx.time) +
      ctx.rng.gauss(0, SE_FLUCTUATION) + adj - maskingLoss(obs, tgt.id, trueB, heard, 'hull', ctx.env) - domeQuenchDb(obs, ctx.env.seaState);
    if (se > 0 && !(domeDropoutP(obs, ctx.env.seaState) > 0 && ctx.rng.next() < domeDropoutP(obs, ctx.env.seaState))) {
      out.push({
        observerId: obs.id, targetId: tgt.id, sensor: 'hull', time: ctx.time,
        bearing: noisyBearing(trueB, se, ctx.rng, biasOf(ctx, obs.id, tgt.id, 'hull')), se, evidence: shipEvidence(tgt, se, ctx, obs),
      });
    }
  }

  if (towedArrayReady(obs, ctx.time)) {
    const endfire = Math.abs(rel) < 20 || Math.abs(rel) > 160 ? 10 : 0;
    const se =
      passiveSignalExcess(tgt, obs, range, 'towed', ctx.env, Math.min(towedArrayDepth(obs), bottom - 10), bottom) -
      endfire + (tonalTarget(tgt) ? TOWED_NB_GAIN_DB : 0) +
      fading(`${obs.id}|${tgt.id}|t`, ctx.time) +
      ctx.rng.gauss(0, SE_FLUCTUATION) + adj - maskingLoss(obs, tgt.id, trueB, heard, 'towed', ctx.env);
    if (se > 0) {
      // A line array measures only the angle to its axis: report starboard side first, port as mirror.
      // Its error (fast and slow) grows toward endfire as 1 / sin θ
      const k = towedErrorFactor(rel);
      const measuredRel = Math.abs(rel + k * (ctx.rng.gauss(0, bearingSigma(se)) + biasOf(ctx, obs.id, tgt.id, 'towed')));
      const b = wrap360(obs.heading + measuredRel);
      const alt = wrap360(obs.heading - measuredRel);
      out.push({
        observerId: obs.id, targetId: tgt.id, sensor: 'towed', time: ctx.time,
        bearing: b, bearingAlt: alt, se, evidence: shipEvidence(tgt, se, ctx, obs),
      });
    }
  }
}

function shipEvidence(tgt: Ship, se: number, ctx: SensorContext, obs?: Ship): Evidence {
  // Radial motion Doppler-shifts the tonals (acoustics.ts closingSpeedMps)
  const closingMps = obs ? closingSpeedMps(tgt, obs) : undefined;
  return measureEvidence(sigKeyOf(tgt.cls), tgt.speed / KN, se, { cavitating: isCavitating(tgt), snorkel: isSnorkeling(tgt), closingMps }, ctx.rng);
}

/** Passive looks at torpedoes and other emitters (hull array only, no towed self-noise model needed). */
function passiveEmitters(obs: Ship, ctx: SensorContext, out: Detection[]): void {
  const spec = CLASSES[obs.cls];
  if (spec.hull.di <= 0) return;
  for (const e of ctx.emitters ?? []) {
    if (e.ownerId === obs.id) continue;
    const range = distance(obs.pos, e.pos);
    const trueB = bearing(obs.pos, e.pos);
    if (Math.abs(angleDiff(obs.heading, trueB)) >= 180 - spec.hull.baffleHalfAngle) continue;
    const se = passiveExcessFrom(e.sl, e.depth, obs, range, 'hull', ctx.env) + ctx.rng.gauss(0, SE_FLUCTUATION) -
      terrainLossDb(ctx.env.seabed, e.pos, e.depth, obs.pos, sonarDepth(obs)) - domeQuenchDb(obs, ctx.env.seaState);
    if (se <= 0) continue;
    out.push({
      observerId: obs.id, targetId: e.id, sensor: 'hull', time: ctx.time,
      bearing: noisyBearing(trueB, se, ctx.rng, biasOf(ctx, obs.id, e.id, 'hull')), se,
      evidence: measureEvidence(e.sig, e.speedKn, se, { cavitating: true }, ctx.rng),
    });
  }
}

function ping(pinger: Ship, ctx: SensorContext, out: Detection[]): void {
  // Echoes from beyond the range scale come back after the receiver stopped listening
  const scale = pingRangeOf(pinger);
  // A slamming dome loses the odd ping altogether (heavy weather, surface ships' hull sonar)
  const pLost = domeDropoutP(pinger, ctx.env.seaState);
  const lost = pLost > 0 && ctx.rng.next() < pLost;
  const quench = domeQuenchDb(pinger, ctx.env.seaState);
  for (const tgt of ctx.ships) {
    if (tgt === pinger || !tgt.alive) continue;
    const range = distance(pinger.pos, tgt.pos);
    const trueB = bearing(pinger.pos, tgt.pos);
    const inBaffles = Math.abs(angleDiff(pinger.heading, trueB)) >= 180 - CLASSES[pinger.cls].hull.baffleHalfAngle;
    const lfm = pinger.pulse === 'lfm';
    const bottom = pathDepth(ctx.env.seabed, pinger.pos, tgt.pos);
    // Radial speed of the target toward the pinger (positive = closing): a CW echo with Doppler escapes reverberation
    const los = { x: (pinger.pos.x - tgt.pos.x) / Math.max(range, 1), y: (pinger.pos.y - tgt.pos.y) / Math.max(range, 1) };
    const tv = headingVec(tgt.heading);
    const closing = ((tv.x * los.x + tv.y * los.y) * tgt.speed) / KN;
    const se = activeSignalExcess(tgt, pinger, range, ctx.env, bottom, { lfm, closingKn: closing }) + ctx.rng.gauss(0, 2) -
      2 * knuckleLoss(pinger.pos, tgt.pos, ctx.knuckles) + crewSonarDb(pinger) - 2 * terrainLossDb(ctx.env.seabed, pinger.pos, sonarDepth(pinger), tgt.pos, tgt.depth) - quench;
    if (se > 0 && !lost && range <= scale && !inBaffles && !belowHull(pinger, tgt, range)) {
      out.push({
        observerId: pinger.id, targetId: tgt.id, sensor: 'active', time: ctx.time,
        bearing: noisyBearing(trueB, se + 10, ctx.rng, biasOf(ctx, pinger.id, tgt.id, 'active')),
        range: Math.max(10, range + ctx.rng.gauss(0, lfm ? 5 : 250)), se,
        dopplerKn: lfm ? undefined : Math.round((closing + ctx.rng.gauss(0, 0.5)) * 10) / 10,
      });
    }
    if (CLASSES[tgt.cls].hull.di > 0) {
      const ie = pingInterceptExcess(pinger, tgt, range, ctx.env) - terrainLossDb(ctx.env.seabed, pinger.pos, sonarDepth(pinger), tgt.pos, tgt.depth);
      if (ie > 0) {
        out.push({
          observerId: tgt.id, targetId: pinger.id, sensor: 'intercept', time: ctx.time,
          bearing: noisyBearing(bearing(tgt.pos, pinger.pos), ie, ctx.rng, biasOf(ctx, tgt.id, pinger.id, 'intercept')), se: ie, source: 'hull',
        });
      }
    }
  }
  if (lost) return;
  bottomEchoes(pinger, ctx, out, scale);
  // Knuckles answer like a stopped target: an echo with no Doppler that fades within minutes
  for (const k of ctx.knuckles ?? []) {
    const range = distance(pinger.pos, k.pos);
    if (range > scale) continue;
    const trueB = bearing(pinger.pos, k.pos);
    if (Math.abs(angleDiff(pinger.heading, trueB)) >= 180 - CLASSES[pinger.cls].hull.baffleHalfAngle) continue;
    const se = pointEchoExcess(pinger, range, k.depth, KNUCKLE_TS, ctx.env, pathDepth(ctx.env.seabed, pinger.pos, k.pos)) + ctx.rng.gauss(0, 2) -
      2 * terrainLossDb(ctx.env.seabed, pinger.pos, sonarDepth(pinger), k.pos, k.depth);
    if (se <= 0) continue;
    out.push({
      observerId: pinger.id, targetId: k.id, sensor: 'active', time: ctx.time, bearing: noisyBearing(trueB, se + 10, ctx.rng),
      range: Math.max(10, range + ctx.rng.gauss(0, pinger.pulse === 'lfm' ? 5 : 250)), se, dopplerKn: pinger.pulse === 'lfm' ? undefined : 0,
    });
  }
}

const BOTTOM_ECHO_RANGE = 16_000;
const BOTTOM_ECHO_MAX = 10;

/** Rocks, seamount tops and steep walls of the real seabed answer a ping like a stopped boat. */
function bottomEchoes(pinger: Ship, ctx: SensorContext, out: Detection[], scale: number): void {
  const half = CLASSES[pinger.cls].hull.baffleHalfAngle;
  const lfm = pinger.pulse === 'lfm';
  const found: Detection[] = [];
  for (const f of bottomFeatures(ctx.env.seabed)) {
    const range = Math.hypot(f.x - pinger.pos.x, f.y - pinger.pos.y);
    if (range > Math.min(BOTTOM_ECHO_RANGE, scale) || range < 200) continue;
    const trueB = bearing(pinger.pos, f);
    if (Math.abs(angleDiff(pinger.heading, trueB)) >= 180 - half) continue;
    const se = pointEchoExcess(pinger, range, f.depth, f.ts, ctx.env, pathDepth(ctx.env.seabed, pinger.pos, f)) + ctx.rng.gauss(0, 3) -
      2 * terrainLossDb(ctx.env.seabed, pinger.pos, sonarDepth(pinger), f, f.depth - 5);
    if (se <= 0) continue;
    found.push({
      observerId: pinger.id, targetId: f.id, sensor: 'active', time: ctx.time, bearing: noisyBearing(trueB, se + 10, ctx.rng),
      range: Math.max(10, range + ctx.rng.gauss(0, lfm ? 5 : 250)), se, dopplerKn: lfm ? undefined : 0,
    });
  }
  out.push(...found.sort((a, b) => b.se - a.se).slice(0, BOTTOM_ECHO_MAX));
}

/** Height of a ship's masts and of a radar antenna above the sea (m). */
const SHIP_TOP_M = 25;
const RADAR_ANTENNA_M = 20;
/** A submarine's radar sits on a mast a few metres above the waves: short horizon. */
const SUB_RADAR_ANTENNA_M = 4;
/** A boat's ESM / radar-warner head on the mast. */
const SUB_ESM_ANTENNA_M = 3;

/** Is this ship's radar on the air? A submarine's only with the mast fully up. */
function radiating(s: Ship): boolean {
  return s.radarOn && (!CLASSES[s.cls].submarine || mastRaised(s));
}

/** Geometric horizon range in meters between an eye height and a target height. */
export function horizonRange(eyeHeight: number, targetHeight: number): number {
  return 2.08 * (Math.sqrt(eyeHeight) + Math.sqrt(targetHeight)) * NM;
}

/** How far a submarine's mast radar finds ships: its horizon. */
export const SUB_RADAR_RANGE = Math.min(RADAR_RANGE, radioHorizon(SUB_RADAR_ANTENNA_M, 0.6 * SHIP_TOP_M));

/** Field of view of the attack periscope (degrees) at a power: 32° at 1.5×, 8° at 6×, 4° at 12×. */
export function scopeFov(mag: number): number {
  return 48 / mag;
}
/** Ships just outside the circle still catch the eye at its rim (degrees beyond the half field). */
export const SCOPE_MARGIN_DEG = 1;
/** Stadimeter marking error (1 σ, fraction of the angle): the mast top is set on the waterline by eye. */
export const STADIMETER_ERR = 0.06;

/** Is this true bearing inside the periscope's field of view (with its small margin)? */
export function inScopeView(scope: Ship['scope'], trueBearing: number): boolean {
  return !!scope && Math.abs(angleDiff(scope.bearing, trueBearing)) <= scopeFov(scope.mag) / 2 + SCOPE_MARGIN_DEG;
}

/**
 * Share of looks the periscope gets clear of the sea: every second from sea state 4 a wave may
 * wash over the head glass (SS4 85 %, SS5 70 %, SS6 55 %).
 */
export function periscopeClearP(seaState: number): number {
  return 1 - 0.15 * Math.max(0, seaState - 3);
}

/**
 * How far a radar at this antenna height paints a ship: the radio horizon to the bulk of her
 * superstructure (about 0,6 of the masthead height: a masthead alone is a weak return), never
 * beyond the radar's own 22 nm. A frigate's radar holds a merchant at about 19 nm, a fishing
 * boat at about 17 nm; a boat's mast radar sees them at 12–13 nm.
 */
export function shipRadarRange(antennaM: number, tgt: Ship): number {
  return Math.min(RADAR_RANGE, radioHorizon(antennaM, 0.6 * RECOG[tgt.cls].mast));
}

function periscope(obs: Ship, ctx: SensorContext, out: Detection[]): void {
  // Only what is inside the optic's field of view. Until the player trains it, the watch keeps
  // the periscope on the bow at low power (a raised scope is always manned)
  const scope = obs.scope ?? { bearing: obs.heading, mag: 1.5 as const };
  // Night cuts visual range sharply (darkened ships); a bright moon gives some of it back
  const light = seeingLight(ctx.env);
  // As far as the horizon allows and the air carries (spray haze, rain); night cuts it to a third
  const air = Math.min(horizonRange(1.5, 30), metVisibility(ctx.env.seaState, !!ctx.env.rain)) * (1 - ctx.env.seaState * 0.03);
  const vis = 0.3 + 0.7 * light;
  // Heavy sea washes over the head glass: the look is lost for that second
  const clear = periscopeClearP(ctx.env.seaState);
  if (clear < 1 && ctx.rng.next() > clear) return;
  for (const tgt of ctx.ships) {
    if (tgt === obs || !tgt.alive) continue;
    // Submerged boats are not seen; a surfaced one is, by her conning tower (smaller, nearer horizon)
    const boat = CLASSES[tgt.cls].submarine;
    if (boat && !isSurfacedBoat(tgt) && !isBroaching(tgt, ctx.time)) continue;
    const trueB = bearing(obs.pos, tgt.pos);
    if (!inScopeView(scope, trueB)) continue;
    const range = distance(obs.pos, tgt.pos);
    // Navigation lights carry far at night: a lit ship is seen almost as well as by day
    const seen = tgt.lights ? Math.max(vis, 0.85) : vis;
    const reach = boat ? Math.min(air, horizonRange(1.5, SURFACED_TOP_M)) : air;
    if (range + sightPenalty(ctx.env.met, obs.pos, tgt.pos) > reach * seen) continue;
    // Behind a headland or island the masts are out of sight
    if (!lineOfSight(ctx.env.seabed, obs.pos, 1.5, tgt.pos, boat ? SURFACED_TOP_M : SHIP_TOP_M)) continue;
    // Class and range stay on the server's books: a player gets them only by the rules of his
    // realism mode (snapshot.ts); the stadimeter angle is what the eye really measures
    out.push({
      observerId: obs.id, targetId: tgt.id, sensor: 'periscope', time: ctx.time,
      bearing: wrap360(trueB + biasOf(ctx, obs.id, tgt.id, 'periscope') + ctx.rng.gauss(0, 0.3)),
      range: range * (1 + ctx.rng.gauss(0, 0.05)), se: 20, classified: tgt.cls, lit: tgt.lights, mag: scope.mag,
      subtense: (RECOG[tgt.cls].mast / Math.max(50, range)) * 1000 * (1 + ctx.rng.gauss(0, STADIMETER_ERR)),
    });
  }
}

function radar(obs: Ship, ctx: SensorContext, out: Detection[]): void {
  const low = CLASSES[obs.cls].submarine;
  const antenna = low ? SUB_RADAR_ANTENNA_M : RADAR_ANTENNA_M;
  // Masts are rolled for once per antenna turn (not every second); a mast radar's short horizon cuts their range
  const rot = emitterSpec(shipEmitter(obs.cls))?.rotationS ?? 2.5;
  const turned = antennaTurned(obs.id, rot, ctx.time);
  for (const tgt of ctx.ships) {
    if (tgt === obs || !tgt.alive) continue;
    const range = distance(obs.pos, tgt.pos);
    const sub = CLASSES[tgt.cls].submarine;
    if (sub) {
      const kind = exposedMast(tgt, ctx.time);
      if (!kind || !turned) continue;
      // A surfaced boat is limited by the horizon to her conning tower, masts by their tiny return;
      // from a submarine's low mast both are lost in the waves sooner
      const rmax = Math.min(MAST_RADAR[kind].rmax * (low ? 0.6 : 1), kind === 'hull' ? radioHorizon(antenna, SURFACED_TOP_M) : Infinity);
      // Rain clutter swallows a small mast return inside a shower (a hull a little less)
      const p = mastDetectP(kind, range, ctx.env.seaState, rmax) * (inSquall(ctx.env.met, tgt.pos) ? (kind === 'hull' ? 0.6 : 0.25) : 1);
      if (p <= 0 || ctx.rng.next() > p) continue;
    } else if (range > shipRadarRange(antenna, tgt)) continue;
    // Land in between hides the target in its radar shadow
    if (!lineOfSight(ctx.env.seabed, obs.pos, antenna, tgt.pos, sub ? (exposedMast(tgt, ctx.time) === 'hull' ? SURFACED_TOP_M : 3) : SHIP_TOP_M)) continue;
    out.push({
      observerId: obs.id, targetId: tgt.id, sensor: 'radar', time: ctx.time,
      bearing: wrap360(bearing(obs.pos, tgt.pos) + biasOf(ctx, obs.id, tgt.id, 'radar') + ctx.rng.gauss(0, 0.5)),
      range: range * (1 + ctx.rng.gauss(0, 0.01)), se: 15,
    });
  }
}

/** Ships guiding a missile right now: their fire-control radar is on the air. */
function guiding(ctx: SensorContext): Set<string> {
  const ids = new Set<string>();
  for (const m of ctx.env.airdef?.sams ?? []) if (!m.done) ids.add(m.ownerId);
  for (const m of ctx.env.ssm?.missiles ?? []) if (!m.done) ids.add(m.ownerId);
  return ids;
}

/** ESM: anyone with an antenna above water hears active radars (bearing, emitter, strength). */
/** Height of an ESM antenna: a boat's mast head, a ship's mast. */
export function esmAntennaM(s: Ship): number {
  return CLASSES[s.cls].submarine ? SUB_ESM_ANTENNA_M : RADAR_ANTENNA_M;
}

/** Height of a ship's radar antenna (a boat's sits on its mast). */
export function radarAntennaM(s: Ship): number {
  return CLASSES[s.cls].submarine ? SUB_RADAR_ANTENNA_M : RADAR_ANTENNA_M;
}

function esm(obs: Ship, ctx: SensorContext, out: Detection[], fc: Set<string>): void {
  const hObs = esmAntennaM(obs);
  for (const emitter of ctx.ships) {
    if (emitter === obs || !emitter.alive || !radiating(emitter)) continue;
    const range = distance(obs.pos, emitter.pos);
    // Beyond the radio horizon (with some margin) the radar is not heard: a boat's low mast hears less far
    const reach = esmReach(hObs, radarAntennaM(emitter));
    if (range > reach) continue;
    // Radar waves travel in straight lines: no intercept from behind a mountain
    if (!lineOfSight(ctx.env.seabed, obs.pos, hObs, emitter.pos, radarAntennaM(emitter))) continue;
    out.push({
      observerId: obs.id, targetId: emitter.id, sensor: 'esm', time: ctx.time,
      bearing: wrap360(bearing(obs.pos, emitter.pos) + biasOf(ctx, obs.id, emitter.id, 'esm') + ctx.rng.gauss(0, 2)), se: 10,
      emitter: shipEmitter(emitter.cls, fc.has(emitter.id)), esmLvl: esmLevel(range, reach),
      esmTrend: esmTrend(obs.pos, obs.heading, obs.speed, emitter.pos, emitter.heading, emitter.speed),
    });
  }
}

function hasAntennaUp(s: Ship): boolean {
  return CLASSES[s.cls].submarine ? mastRaised(s) : true;
}

/** Run one sensor cycle for all ships. Pings fire when their interval elapsed. */
export function runSensors(ctx: SensorContext): Detection[] {
  const out: Detection[] = [];
  const fc = guiding(ctx);
  for (const obs of ctx.ships) {
    if (!obs.alive || obs.cls === 'merchant') continue;
    for (const tgt of ctx.ships) {
      if (tgt !== obs && tgt.alive) passive(obs, tgt, ctx, out);
    }
    passiveEmitters(obs, ctx, out);
    // Continuous pinging on the range scale's interval, or one single ping on request (as soon as the last one is back)
    if ((obs.activeSonar || obs.pingOnce) && ctx.time - obs.lastPingAt >= pingInterval(obs)) {
      obs.lastPingAt = ctx.time;
      obs.pingOnce = undefined;
      ping(obs, ctx, out);
    }
    if (CLASSES[obs.cls].submarine && mastRaised(obs)) periscope(obs, ctx, out);
    if (radiating(obs)) radar(obs, ctx, out);
    if (!CLASSES[obs.cls].submarine) {
      for (const v of lookoutSweep(obs, ctx.ships, ctx.env, ctx.rng, ctx.time)) {
        out.push({ observerId: obs.id, targetId: v.targetId, sensor: 'visual', time: ctx.time, bearing: v.bearing, range: v.range, se: 20, sighting: v.sighting });
      }
    }
    if (hasAntennaUp(obs)) esm(obs, ctx, out, fc);
  }
  return out;
}

/** Radio transmission by a ship: all enemy ships with antennas up get an ESM bearing. */
export function interceptTransmission(sender: Ship, ctx: SensorContext): Detection[] {
  const out: Detection[] = [];
  for (const obs of ctx.ships) {
    if (obs === sender || !obs.alive || obs.team === sender.team || obs.cls === 'merchant') continue;
    if (!hasAntennaUp(obs)) continue;
    if (distance(obs.pos, sender.pos) > ESM_RANGE * 2) continue;
    out.push({
      observerId: obs.id, targetId: sender.id, sensor: 'esm', time: ctx.time,
      bearing: wrap360(bearing(obs.pos, sender.pos) + ctx.rng.gauss(0, 1.5)), se: 10,
    });
  }
  return out;
}
