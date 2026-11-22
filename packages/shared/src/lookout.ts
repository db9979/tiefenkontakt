import type { Environment } from './acoustics.js';
import { CLASSES } from './classes.js';
import { isAtPeriscopeDepth, mastExposed, type Ship } from './entities.js';
import { isSnorkeling } from './kinematics.js';
import { KN, NM, bearing, distance, wrap360 } from './math.js';
import type { Rng } from './rng.js';
import { fogAt, sightPenalty } from './met.js';

/**
 * Bridge lookouts on surface escorts: binoculars from about 20 m eye height.
 * What gives a submarine away to the eye is rarely the boat itself but the white
 * "feather" a raised periscope cuts at speed, the snorkel's exhaust haze, or a
 * surfaced conning tower. Night, rain and whitecaps cut these ranges hard.
 */

export type Sighting = 'mast' | 'snorkel' | 'surfaced';

/** Eye height of the bridge lookouts (m). */
export const LOOKOUT_EYE_M = 20;
/** Binocular limit for a surfaced conning tower (m). */
const SURFACED_MAX = 12_000;
/** Torpedo tracks (bubbles, turbulence) are only seen close by and in daylight (m). */
const WAKE_RANGE = 2_000;
/** In thick fog a torpedo track is seen at a tenth of the range. */
const FOG_WAKE = 9;

/** Daylight and rain factor for visual search (1 = clear day). */
export function visibility(env: Environment): number {
  return (0.2 + 0.8 * (env.light ?? 1)) * (env.rain ? 0.5 : 1);
}

/** Small objects vanish among whitecaps as the sea builds. */
function clutter(env: Environment): number {
  return Math.max(0.15, 1 - env.seaState * 0.14);
}

const horizon = (eye: number, target: number) => 2.08 * (Math.sqrt(eye) + Math.sqrt(target)) * NM;

/** How far a submarine can currently be seen from the bridge, and by what; undefined if not at all. */
export function sightingRange(tgt: Ship, env: Environment): { what: Sighting; range: number } | undefined {
  if (!tgt.alive || !CLASSES[tgt.cls].submarine) return undefined;
  const vis = visibility(env);
  if (tgt.depth < 2) return { what: 'surfaced', range: Math.min(horizon(LOOKOUT_EYE_M, 8), SURFACED_MAX) * vis };
  if (!isAtPeriscopeDepth(tgt)) return undefined;
  const kn = tgt.speed / KN;
  // Diesel exhaust haze and the snorkel head's spray: seen farther, less hidden by whitecaps
  if (isSnorkeling(tgt)) return { what: 'snorkel', range: (3_500 + 300 * kn) * vis * (0.5 + 0.5 * clutter(env)) };
  // A periscope or mast at speed cuts a feather; almost invisible when the boat creeps
  if (mastExposed(tgt) && (tgt.mastExt ?? 1) > 0.3) return { what: 'mast', range: Math.min(4_500, 900 + 380 * kn) * vis * clutter(env) };
  return undefined;
}

export interface VisualDetection {
  targetId: string;
  bearing: number;
  range: number;
  sighting: Sighting;
}

/** One lookout sweep (1 s): a chance to spot each exposed submarine, better the closer it is. */
export function lookoutSweep(obs: Ship, ships: readonly Ship[], env: Environment, rng: Rng): VisualDetection[] {
  const out: VisualDetection[] = [];
  if (!obs.alive || CLASSES[obs.cls].submarine || obs.cls === 'merchant') return out;
  for (const tgt of ships) {
    if (tgt === obs || tgt.team === obs.team) continue;
    const s = sightingRange(tgt, env);
    if (!s) continue;
    const r = distance(obs.pos, tgt.pos);
    if (r > s.range) continue;
    // Fog banks and rain curtains in the line of sight hide even close boats
    if (r + sightPenalty(env.met, obs.pos, tgt.pos) > s.range) continue;
    if (rng.next() > 0.15 + 0.5 * (1 - r / s.range)) continue;
    out.push({
      targetId: tgt.id, sighting: s.what,
      bearing: wrap360(bearing(obs.pos, tgt.pos) + rng.gauss(0, 1)),
      // Range by eye and binocular reticle: rough
      range: r * Math.max(0.5, 1 + rng.gauss(0, 0.15)),
    });
  }
  return out;
}

/** Whether the lookouts can see a torpedo's track coming in (daylight, close, moderate sea, no fog). */
export function seesTorpedoTrack(obs: Ship, range: number, env: Environment): boolean {
  if (CLASSES[obs.cls].submarine || (env.light ?? 1) < 0.4) return false;
  return range * (1 + FOG_WAKE * fogAt(env.met, obs.pos)) < WAKE_RANGE * visibility(env) * clutter(env);
}

/** Current lookout ranges for the bridge display: periscope at 6 kn, snorkel, surfaced boat (m). */
export function lookoutRanges(env: Environment): { mast: number; snorkel: number; surfaced: number } {
  const vis = visibility(env);
  return {
    mast: Math.min(4_500, 900 + 380 * 6) * vis * clutter(env),
    snorkel: (3_500 + 300 * 6) * vis * (0.5 + 0.5 * clutter(env)),
    surfaced: Math.min(horizon(LOOKOUT_EYE_M, 8), SURFACED_MAX) * vis,
  };
}
