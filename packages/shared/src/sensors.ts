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
  sonarDepth,
} from './acoustics.js';
import { isSnorkeling } from './kinematics.js';
import { lookoutSweep, type Sighting } from './lookout.js';
import { crewSonarDb } from './crew.js';
import { measureEvidence, sigKeyOf, type Evidence, type SigKey } from './signatures.js';
import { SHALLOW_M } from './seabed.js';
import { bottomFeatures } from './bottom-echo.js';
import { lineOfSight, soundPathDepth as pathDepth, terrainLossDb } from './terrain.js';
import { metVisibility } from './weather.js';
import { CLASSES, type ClassId } from './classes.js';
import type { Ship } from './entities.js';
import { isAtPeriscopeDepth, mastExposed, mastRaised } from './entities.js';
import { KN, NM, angleDiff, bearing, dbSum, distance, headingVec, wrap360, type Vec2 } from './math.js';
import type { Rng } from './rng.js';
import { esmLevel, esmTrend, shipEmitter } from './emitters.js';
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

export const PING_INTERVAL = 30; // s
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
const RADAR_MAST_RANGE = 6 * NM;
const ESM_RANGE = 40 * NM;
export { RADAR_RANGE, RADAR_MAST_RANGE };

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

function noisyBearing(trueB: number, se: number, rng: Rng): number {
  return wrap360(trueB + rng.gauss(0, bearingSigma(se)));
}

/** Depth of the towed array: it streams below and behind the towing ship. */
export function towedArrayDepth(s: Ship): number {
  const factor = CLASSES[s.cls].submarine ? 0.05 : 0.15;
  return Math.min(s.depth + s.towedLength * factor, 300);
}

export function towedArrayReady(s: Ship, now: number): boolean {
  const spec = CLASSES[s.cls].towed;
  return !!spec && s.towedLength > 0 && now - s.lastTurnAt >= spec.settleTime;
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
      ctx.rng.gauss(0, SE_FLUCTUATION) + adj - maskingLoss(obs, tgt.id, trueB, heard, 'hull', ctx.env);
    if (se > 0) {
      out.push({
        observerId: obs.id, targetId: tgt.id, sensor: 'hull', time: ctx.time,
        bearing: noisyBearing(trueB, se, ctx.rng), se, evidence: shipEvidence(tgt, se, ctx),
      });
    }
  }

  if (towedArrayReady(obs, ctx.time)) {
    const endfire = Math.abs(rel) < 20 || Math.abs(rel) > 160 ? 10 : 0;
    const se =
      passiveSignalExcess(tgt, obs, range, 'towed', ctx.env, Math.min(towedArrayDepth(obs), bottom - 10), bottom) -
      endfire +
      fading(`${obs.id}|${tgt.id}|t`, ctx.time) +
      ctx.rng.gauss(0, SE_FLUCTUATION) + adj - maskingLoss(obs, tgt.id, trueB, heard, 'towed', ctx.env);
    if (se > 0) {
      // A line array measures only the angle to its axis: report starboard side first, port as mirror
      const measuredRel = Math.abs(rel + ctx.rng.gauss(0, bearingSigma(se)));
      const b = wrap360(obs.heading + measuredRel);
      const alt = wrap360(obs.heading - measuredRel);
      out.push({
        observerId: obs.id, targetId: tgt.id, sensor: 'towed', time: ctx.time,
        bearing: b, bearingAlt: alt, se, evidence: shipEvidence(tgt, se, ctx),
      });
    }
  }
}

function shipEvidence(tgt: Ship, se: number, ctx: SensorContext): Evidence {
  return measureEvidence(sigKeyOf(tgt.cls), tgt.speed / KN, se, { cavitating: isCavitating(tgt), snorkel: isSnorkeling(tgt) }, ctx.rng);
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
      terrainLossDb(ctx.env.seabed, e.pos, e.depth, obs.pos, sonarDepth(obs));
    if (se <= 0) continue;
    out.push({
      observerId: obs.id, targetId: e.id, sensor: 'hull', time: ctx.time,
      bearing: noisyBearing(trueB, se, ctx.rng), se,
      evidence: measureEvidence(e.sig, e.speedKn, se, { cavitating: true }, ctx.rng),
    });
  }
}

function ping(pinger: Ship, ctx: SensorContext, out: Detection[]): void {
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
      2 * knuckleLoss(pinger.pos, tgt.pos, ctx.knuckles) + crewSonarDb(pinger) - 2 * terrainLossDb(ctx.env.seabed, pinger.pos, sonarDepth(pinger), tgt.pos, tgt.depth);
    if (se > 0 && !inBaffles && !belowHull(pinger, tgt, range)) {
      out.push({
        observerId: pinger.id, targetId: tgt.id, sensor: 'active', time: ctx.time,
        bearing: noisyBearing(trueB, se + 10, ctx.rng),
        range: Math.max(10, range + ctx.rng.gauss(0, lfm ? 5 : 250)), se,
        dopplerKn: lfm ? undefined : Math.round((closing + ctx.rng.gauss(0, 0.5)) * 10) / 10,
      });
    }
    if (CLASSES[tgt.cls].hull.di > 0) {
      const ie = pingInterceptExcess(pinger, tgt, range, ctx.env) - terrainLossDb(ctx.env.seabed, pinger.pos, sonarDepth(pinger), tgt.pos, tgt.depth);
      if (ie > 0) {
        out.push({
          observerId: tgt.id, targetId: pinger.id, sensor: 'intercept', time: ctx.time,
          bearing: noisyBearing(bearing(tgt.pos, pinger.pos), ie, ctx.rng), se: ie, source: 'hull',
        });
      }
    }
  }
  bottomEchoes(pinger, ctx, out);
  // Knuckles answer like a stopped target: an echo with no Doppler that fades within minutes
  for (const k of ctx.knuckles ?? []) {
    const range = distance(pinger.pos, k.pos);
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
function bottomEchoes(pinger: Ship, ctx: SensorContext, out: Detection[]): void {
  const half = CLASSES[pinger.cls].hull.baffleHalfAngle;
  const lfm = pinger.pulse === 'lfm';
  const found: Detection[] = [];
  for (const f of bottomFeatures(ctx.env.seabed)) {
    const range = Math.hypot(f.x - pinger.pos.x, f.y - pinger.pos.y);
    if (range > BOTTOM_ECHO_RANGE || range < 200) continue;
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

/** Is this ship's radar on the air? A submarine's only with the mast fully up. */
function radiating(s: Ship): boolean {
  return s.radarOn && (!CLASSES[s.cls].submarine || mastRaised(s));
}

/** Geometric horizon range in meters between an eye height and a target height. */
export function horizonRange(eyeHeight: number, targetHeight: number): number {
  return 2.08 * (Math.sqrt(eyeHeight) + Math.sqrt(targetHeight)) * NM;
}

/** How far a submarine's mast radar finds ships: its horizon. */
export const SUB_RADAR_RANGE = Math.min(RADAR_RANGE, horizonRange(SUB_RADAR_ANTENNA_M, SHIP_TOP_M));

function periscope(obs: Ship, ctx: SensorContext, out: Detection[]): void {
  // Night cuts visual range sharply (darkened ships, no moon assumed)
  const light = ctx.env.light ?? 1;
  // As far as the horizon allows and the air carries (spray haze, rain); night cuts it to a third
  const air = Math.min(horizonRange(1.5, 30), metVisibility(ctx.env.seaState, !!ctx.env.rain)) * (1 - ctx.env.seaState * 0.03);
  const vis = 0.3 + 0.7 * light;
  for (const tgt of ctx.ships) {
    if (tgt === obs || !tgt.alive || CLASSES[tgt.cls].submarine) continue;
    const range = distance(obs.pos, tgt.pos);
    // Navigation lights carry far at night: a lit ship is seen almost as well as by day
    const seen = tgt.lights ? Math.max(vis, 0.85) : vis;
    if (range + sightPenalty(ctx.env.met, obs.pos, tgt.pos) > air * seen) continue;
    // Behind a headland or island the masts are out of sight
    if (!lineOfSight(ctx.env.seabed, obs.pos, 1.5, tgt.pos, SHIP_TOP_M)) continue;
    out.push({
      observerId: obs.id, targetId: tgt.id, sensor: 'periscope', time: ctx.time,
      bearing: wrap360(bearing(obs.pos, tgt.pos) + ctx.rng.gauss(0, 0.3)),
      range: range * (1 + ctx.rng.gauss(0, 0.05)), se: 20, classified: tgt.cls, lit: tgt.lights,
    });
  }
}

function radar(obs: Ship, ctx: SensorContext, out: Detection[]): void {
  const low = CLASSES[obs.cls].submarine;
  const antenna = low ? SUB_RADAR_ANTENNA_M : RADAR_ANTENNA_M;
  // From a submarine's mast the horizon limits the range to ships, and masts are lost in the waves sooner
  const shipRange = low ? SUB_RADAR_RANGE : RADAR_RANGE;
  const mastRange = low ? RADAR_MAST_RANGE * 0.6 : RADAR_MAST_RANGE;
  for (const tgt of ctx.ships) {
    if (tgt === obs || !tgt.alive) continue;
    const range = distance(obs.pos, tgt.pos);
    const sub = CLASSES[tgt.cls].submarine;
    if (sub) {
      if (!mastExposed(tgt) || range > mastRange) continue;
      // Rain clutter swallows a small mast return inside a shower
      const pDetect = 0.35 * (1 - ctx.env.seaState * 0.1) * (inSquall(ctx.env.met, tgt.pos) ? 0.25 : 1);
      if (ctx.rng.next() > pDetect) continue;
    } else if (range > shipRange) continue;
    // Land in between hides the target in its radar shadow
    if (!lineOfSight(ctx.env.seabed, obs.pos, antenna, tgt.pos, sub ? 3 : SHIP_TOP_M)) continue;
    out.push({
      observerId: obs.id, targetId: tgt.id, sensor: 'radar', time: ctx.time,
      bearing: wrap360(bearing(obs.pos, tgt.pos) + ctx.rng.gauss(0, 0.5)),
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
function esm(obs: Ship, ctx: SensorContext, out: Detection[], fc: Set<string>): void {
  for (const emitter of ctx.ships) {
    if (emitter === obs || !emitter.alive || !radiating(emitter)) continue;
    const range = distance(obs.pos, emitter.pos);
    if (range > ESM_RANGE) continue;
    // Radar waves travel in straight lines: no intercept from behind a mountain
    if (!lineOfSight(ctx.env.seabed, obs.pos, CLASSES[obs.cls].submarine ? 3 : RADAR_ANTENNA_M, emitter.pos, CLASSES[emitter.cls].submarine ? SUB_RADAR_ANTENNA_M : RADAR_ANTENNA_M)) continue;
    out.push({
      observerId: obs.id, targetId: emitter.id, sensor: 'esm', time: ctx.time,
      bearing: wrap360(bearing(obs.pos, emitter.pos) + ctx.rng.gauss(0, 2)), se: 10,
      emitter: shipEmitter(emitter.cls, fc.has(emitter.id)), esmLvl: esmLevel(range, ESM_RANGE),
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
    if (obs.activeSonar && ctx.time - obs.lastPingAt >= PING_INTERVAL) {
      obs.lastPingAt = ctx.time;
      ping(obs, ctx, out);
    }
    if (CLASSES[obs.cls].submarine && mastRaised(obs)) periscope(obs, ctx, out);
    if (radiating(obs)) radar(obs, ctx, out);
    if (!CLASSES[obs.cls].submarine) {
      for (const v of lookoutSweep(obs, ctx.ships, ctx.env, ctx.rng)) {
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
