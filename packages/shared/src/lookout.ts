import { lineOfSight } from './terrain.js';
import type { Environment } from './acoustics.js';
import { CLASSES } from './classes.js';
import { isAtPeriscopeDepth, mastExposed, type Ship } from './entities.js';
import { isBroaching, isSnorkeling } from './kinematics.js';
import { KN, NM, bearing, distance, wrap360 } from './math.js';
import type { Rng } from './rng.js';
import { FOG_SIGHT_K, fogAt, sightPenalty } from './met.js';
import { seeingLight } from './moon.js';

/**
 * Bridge lookouts on surface escorts: binoculars from about 20 m eye height.
 * What gives a submarine away to the eye is rarely the boat itself but the white
 * "feather" a raised periscope cuts at speed, the snorkel's exhaust haze, or a
 * surfaced conning tower. Night, rain and whitecaps cut these ranges hard; a bright moon gives
 * some of it back, a moonless night takes a little more.
 */

export type Sighting = 'mast' | 'snorkel' | 'surfaced' | 'glow';

/** Eye height of the bridge lookouts (m). */
export const LOOKOUT_EYE_M = 20;
/** Binocular limit for a surfaced conning tower (m). */
const SURFACED_MAX = 12_000;
/** Torpedo tracks (bubbles, turbulence) are only seen close by and in daylight (m). */
const WAKE_RANGE = 2_000;
/** In thick fog a torpedo track is seen at a tenth of the range. */
const FOG_WAKE = 9;

/** Daylight (and at night the moon) and rain factor for visual search (1 = clear day). */
export function visibility(env: Environment): number {
  return (0.2 + 0.8 * seeingLight(env)) * (env.rain ? 0.5 : 1);
}

/** Small objects vanish among whitecaps as the sea builds. */
function clutter(env: Environment): number {
  return Math.max(0.15, 1 - env.seaState * 0.14);
}

const horizon = (eye: number, target: number) => 2.08 * (Math.sqrt(eye) + Math.sqrt(target)) * NM;

/**
 * Bioluminescence (0..1): how strongly the sea lights up where it is disturbed (dinoflagellate
 * blooms). Strong in warm and temperate waters from late spring to autumn (Mediterranean,
 * Biscay, the North Sea and the Norwegian coast in late summer), weak in Arctic water and in
 * winter. A bloom differs from match to match (seed). WWII and Cold War reports: wakes, a
 * periscope's feather and torpedo tracks seen glowing at 1–2 km on moonless nights.
 */
export function bioluminescence(env: Pick<Environment, 'lat' | 'month' | 'seed'>): number {
  if (env.lat === undefined || !env.month) return 0;
  const m = env.month, lat = Math.abs(env.lat);
  const summer = m >= 6 && m <= 10, spring = m === 4 || m === 5 || m === 11;
  const base = lat < 45 ? (m >= 5 && m <= 11 ? 0.85 : 0.4)
    : lat < 62 ? (summer ? 0.7 : spring ? 0.35 : 0.1)
    : lat < 72 ? (m >= 8 && m <= 10 ? 0.5 : summer ? 0.25 : 0.1)
    : m >= 8 && m <= 10 ? 0.3 : 0.08;
  // The bloom of this match: 0,6–1,4 of the season's mean (no match seed: the mean, for forecasts)
  const h = env.seed === undefined ? 0.5 : ((env.seed * 2654435761) >>> 0) / 4294967296;
  return Math.min(1, base * (0.6 + 0.8 * h));
}

/**
 * How much glowing water stands out to the eye (0..1): bioluminescence, only in the dark (a
 * bright moon drowns it), and washed out by the sea's own glowing whitecaps as it builds.
 */
export function glowStrength(env: Environment): number {
  const bio = bioluminescence(env);
  if (bio <= 0) return 0;
  const dark = Math.max(0, Math.min(1, (0.25 - seeingLight(env)) / 0.14));
  const caps = Math.max(0.2, 1 - 0.2 * Math.max(0, env.seaState - 2));
  return bio * dark * caps;
}
/** Range (m) at full glow at which a periscope feather at 6 kn, a moving boat's glow at 6 kn and a torpedo track are seen. */
export const GLOW_FEATHER_M = 1500;
export const GLOW_HULL_M = 900;
export const GLOW_TORPEDO_M = 1800;

/** How far a submarine can currently be seen from the bridge, and by what; undefined if not at all. */
export function sightingRange(tgt: Ship, env: Environment, now?: number): { what: Sighting; range: number } | undefined {
  if (!tgt.alive || !CLASSES[tgt.cls].submarine) return undefined;
  const vis = visibility(env);
  if (tgt.depth < 2) return { what: 'surfaced', range: Math.min(horizon(LOOKOUT_EYE_M, 8), SURFACED_MAX) * vis };
  // Broaching in a heavy sea: the conning tower shows for seconds among the waves
  if (isBroaching(tgt, now)) return { what: 'surfaced', range: Math.min(horizon(LOOKOUT_EYE_M, 5), SURFACED_MAX) * vis * 0.5 };
  if (!isAtPeriscopeDepth(tgt)) return undefined;
  const kn = tgt.speed / KN;
  const glow = glowStrength(env);
  // Diesel exhaust haze and the snorkel head's spray: seen farther, less hidden by whitecaps
  if (isSnorkeling(tgt)) return { what: 'snorkel', range: Math.max((3_500 + 300 * kn) * vis * (0.5 + 0.5 * clutter(env)), (GLOW_FEATHER_M * glow * Math.max(kn, 3)) / 6) };
  // A periscope or mast at speed cuts a feather; almost invisible when the boat creeps.
  // On a dark night in a bloom the feather glows
  if (mastExposed(tgt) && (tgt.mastExt ?? 1) > 0.3) {
    return { what: 'mast', range: Math.max(Math.min(4_500, 900 + 380 * kn) * vis * clutter(env), Math.min(2_500, (GLOW_FEATHER_M * glow * kn) / 6)) };
  }
  // A boat moving at periscope depth stirs the glowing water above her: a pale smear moving on the sea
  const smear = kn >= 3 ? Math.min(1_500, (GLOW_HULL_M * glow * kn) / 6) : 0;
  if (smear > 150) return { what: 'glow', range: smear };
  return undefined;
}

export interface VisualDetection {
  targetId: string;
  bearing: number;
  range: number;
  sighting: Sighting;
}

/** One lookout sweep (1 s): a chance to spot each exposed submarine, better the closer it is. */
export function lookoutSweep(obs: Ship, ships: readonly Ship[], env: Environment, rng: Rng, now?: number): VisualDetection[] {
  const out: VisualDetection[] = [];
  if (!obs.alive || CLASSES[obs.cls].submarine || obs.cls === 'merchant') return out;
  for (const tgt of ships) {
    if (tgt === obs || tgt.team === obs.team) continue;
    const s = sightingRange(tgt, env, now);
    if (!s) continue;
    const r = distance(obs.pos, tgt.pos);
    if (r > s.range) continue;
    // Fog banks and rain curtains in the line of sight hide even close boats
    if (r + sightPenalty(env.met, obs.pos, tgt.pos) > s.range) continue;
    // Behind a headland or an island nothing is seen
    if (!lineOfSight(env.seabed, obs.pos, LOOKOUT_EYE_M, tgt.pos, s.what === 'surfaced' ? 8 : s.what === 'glow' ? 0.5 : 2)) continue;
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

/**
 * Whether the lookouts can see a torpedo's track coming in: by day close by in a moderate sea;
 * at night only where the sea glows (bioluminescence on a dark night). Never through fog.
 */
export function seesTorpedoTrack(obs: Ship, range: number, env: Environment): boolean {
  if (CLASSES[obs.cls].submarine) return false;
  const reach = (env.light ?? 1) < 0.4 ? GLOW_TORPEDO_M * glowStrength(env) : WAKE_RANGE * visibility(env) * clutter(env);
  return range * (1 + FOG_WAKE * fogAt(env.met, obs.pos)) < reach;
}

/** Current lookout ranges for the bridge display: periscope at 6 kn, snorkel, surfaced boat, glow of a boat at 6 kn (m). */
export function lookoutRanges(env: Environment, fog = 0): { mast: number; snorkel: number; surfaced: number; glow: number } {
  // Inside a fog bank (density 0..1 at the bridge) the eye reaches only a fraction as far
  const f = 1 + FOG_SIGHT_K * fog;
  const vis = visibility(env) / f;
  const glow = glowStrength(env);
  return {
    mast: Math.max(Math.min(4_500, 900 + 380 * 6) * vis * clutter(env), (GLOW_FEATHER_M * glow) / f),
    snorkel: Math.max((3_500 + 300 * 6) * vis * (0.5 + 0.5 * clutter(env)), (GLOW_FEATHER_M * glow) / f),
    surfaced: Math.min(horizon(LOOKOUT_EYE_M, 8), SURFACED_MAX) * vis,
    glow: (GLOW_HULL_M * glow) / f,
  };
}
