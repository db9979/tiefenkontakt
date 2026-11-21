import {
  activeSignalExcess,
  bearingSigma,
  passiveSignalExcess,
  pingInterceptExcess,
  type Environment,
} from './acoustics.js';
import { CLASSES, type ClassId } from './classes.js';
import type { Ship } from './entities.js';
import { isAtPeriscopeDepth } from './entities.js';
import { NM, angleDiff, bearing, distance, wrap360 } from './math.js';
import type { Rng } from './rng.js';

export type SensorKind = 'hull' | 'towed' | 'active' | 'intercept' | 'periscope' | 'radar' | 'esm';

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
  classified?: ClassId;
}

export const PING_INTERVAL = 30; // s
const SE_FLUCTUATION = 2; // dB sd per sample
const CLASSIFY_SE = 8;
const RADAR_RANGE = 22 * NM;
const RADAR_MAST_RANGE = 6 * NM;
const ESM_RANGE = 40 * NM;

export interface SensorContext {
  ships: readonly Ship[];
  env: Environment;
  time: number;
  rng: Rng;
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

function passive(obs: Ship, tgt: Ship, ctx: SensorContext, out: Detection[]): void {
  const spec = CLASSES[obs.cls];
  const range = distance(obs.pos, tgt.pos);
  const trueB = bearing(obs.pos, tgt.pos);
  const rel = angleDiff(obs.heading, trueB);

  if (spec.hull.di > 0 && Math.abs(rel) < 180 - spec.hull.baffleHalfAngle) {
    const se = passiveSignalExcess(tgt, obs, range, 'hull', ctx.env) + ctx.rng.gauss(0, SE_FLUCTUATION);
    if (se > 0) {
      out.push({
        observerId: obs.id, targetId: tgt.id, sensor: 'hull', time: ctx.time,
        bearing: noisyBearing(trueB, se, ctx.rng), se,
        classified: se > CLASSIFY_SE ? tgt.cls : undefined,
      });
    }
  }

  if (towedArrayReady(obs, ctx.time)) {
    const endfire = Math.abs(rel) < 20 || Math.abs(rel) > 160 ? 10 : 0;
    const se =
      passiveSignalExcess(tgt, obs, range, 'towed', ctx.env, towedArrayDepth(obs)) -
      endfire +
      ctx.rng.gauss(0, SE_FLUCTUATION);
    if (se > 0) {
      const measuredRel = rel + ctx.rng.gauss(0, bearingSigma(se));
      let b = wrap360(obs.heading + measuredRel);
      let alt = wrap360(obs.heading - measuredRel);
      if (ctx.rng.next() < 0.5) [b, alt] = [alt, b];
      out.push({
        observerId: obs.id, targetId: tgt.id, sensor: 'towed', time: ctx.time,
        bearing: b, bearingAlt: alt, se,
        classified: se > CLASSIFY_SE ? tgt.cls : undefined,
      });
    }
  }
}

function ping(pinger: Ship, ctx: SensorContext, out: Detection[]): void {
  for (const tgt of ctx.ships) {
    if (tgt === pinger || !tgt.alive) continue;
    const range = distance(pinger.pos, tgt.pos);
    const trueB = bearing(pinger.pos, tgt.pos);
    const se = activeSignalExcess(tgt, pinger, range, ctx.env) + ctx.rng.gauss(0, SE_FLUCTUATION);
    if (se > 0) {
      out.push({
        observerId: pinger.id, targetId: tgt.id, sensor: 'active', time: ctx.time,
        bearing: noisyBearing(trueB, se + 10, ctx.rng),
        range: range * (1 + ctx.rng.gauss(0, 0.01)), se,
      });
    }
    if (CLASSES[tgt.cls].hull.di > 0) {
      const ie = pingInterceptExcess(pinger, tgt, range, ctx.env);
      if (ie > 0) {
        out.push({
          observerId: tgt.id, targetId: pinger.id, sensor: 'intercept', time: ctx.time,
          bearing: noisyBearing(bearing(tgt.pos, pinger.pos), ie, ctx.rng), se: ie,
        });
      }
    }
  }
}

/** Geometric horizon range in meters between an eye height and a target height. */
export function horizonRange(eyeHeight: number, targetHeight: number): number {
  return 2.08 * (Math.sqrt(eyeHeight) + Math.sqrt(targetHeight)) * NM;
}

function periscope(obs: Ship, ctx: SensorContext, out: Detection[]): void {
  const vis = 1 - ctx.env.seaState * 0.08;
  for (const tgt of ctx.ships) {
    if (tgt === obs || !tgt.alive || CLASSES[tgt.cls].submarine) continue;
    const range = distance(obs.pos, tgt.pos);
    if (range > horizonRange(1.5, 30) * vis) continue;
    out.push({
      observerId: obs.id, targetId: tgt.id, sensor: 'periscope', time: ctx.time,
      bearing: wrap360(bearing(obs.pos, tgt.pos) + ctx.rng.gauss(0, 0.3)),
      range: range * (1 + ctx.rng.gauss(0, 0.05)), se: 20, classified: tgt.cls,
    });
  }
}

function radar(obs: Ship, ctx: SensorContext, out: Detection[]): void {
  for (const tgt of ctx.ships) {
    if (tgt === obs || !tgt.alive) continue;
    const range = distance(obs.pos, tgt.pos);
    const sub = CLASSES[tgt.cls].submarine;
    if (sub) {
      if (!(tgt.mastUp && isAtPeriscopeDepth(tgt)) || range > RADAR_MAST_RANGE) continue;
      const pDetect = 0.35 * (1 - ctx.env.seaState * 0.1);
      if (ctx.rng.next() > pDetect) continue;
    } else if (range > RADAR_RANGE) continue;
    out.push({
      observerId: obs.id, targetId: tgt.id, sensor: 'radar', time: ctx.time,
      bearing: wrap360(bearing(obs.pos, tgt.pos) + ctx.rng.gauss(0, 0.5)),
      range: range * (1 + ctx.rng.gauss(0, 0.01)), se: 15,
    });
  }
}

/** ESM: anyone with an antenna above water hears active radars (bearing only). */
function esm(obs: Ship, ctx: SensorContext, out: Detection[]): void {
  for (const emitter of ctx.ships) {
    if (emitter === obs || !emitter.alive || !emitter.radarOn) continue;
    if (distance(obs.pos, emitter.pos) > ESM_RANGE) continue;
    out.push({
      observerId: obs.id, targetId: emitter.id, sensor: 'esm', time: ctx.time,
      bearing: wrap360(bearing(obs.pos, emitter.pos) + ctx.rng.gauss(0, 2)), se: 10,
    });
  }
}

function hasAntennaUp(s: Ship): boolean {
  return CLASSES[s.cls].submarine ? s.mastUp && isAtPeriscopeDepth(s) : true;
}

/** Run one sensor cycle for all ships. Pings fire when their interval elapsed. */
export function runSensors(ctx: SensorContext): Detection[] {
  const out: Detection[] = [];
  for (const obs of ctx.ships) {
    if (!obs.alive || obs.cls === 'merchant') continue;
    for (const tgt of ctx.ships) {
      if (tgt !== obs && tgt.alive) passive(obs, tgt, ctx, out);
    }
    if (obs.activeSonar && ctx.time - obs.lastPingAt >= PING_INTERVAL) {
      obs.lastPingAt = ctx.time;
      ping(obs, ctx, out);
    }
    if (CLASSES[obs.cls].submarine && obs.mastUp && isAtPeriscopeDepth(obs)) periscope(obs, ctx, out);
    if (obs.radarOn && !CLASSES[obs.cls].submarine) radar(obs, ctx, out);
    if (hasAntennaUp(obs)) esm(obs, ctx, out);
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
