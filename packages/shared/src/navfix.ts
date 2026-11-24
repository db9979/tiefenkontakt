import { CLASSES } from './classes.js';
import { mastRaised, type Ship } from './entities.js';
import { NM } from './math.js';
import { depthAt } from './seabed.js';
import { lineOfSight } from './terrain.js';
import { fogAt, inSquall } from './met.js';
import { metVisibility } from './weather.js';
import type { World } from './world.js';

/**
 * Fixing the boat's position without satellite navigation as we know it today. Between fixes
 * the boat only reckons (course and speed through the water; the current sets her off unseen).
 * A fix needs a method:
 *  - Landmarks: with the mast up and land in sight, cross bearings on peaks and headlands (±100 m).
 *  - Transit satellite: a pass about every 90 minutes; the antenna has to be up for two minutes (±200 m).
 *  - Stars: at night under a clear sky, three stars through the periscope, three minutes (±1.5 km).
 *  - Echo sounder: one sounding compared with the chart; helps where the bottom slopes (one
 *    ping straight down, short and quiet, but a listening escort close by may hear it).
 */

export type FixMethod = 'land' | 'sat' | 'stars' | 'sounding';
export const FIX_LABEL: Record<FixMethod, string> = { land: 'LANDPEILUNG', sat: 'SATELLIT', stars: 'STERNE', sounding: 'ECHOLOT' };
const FIX_SIGMA: Record<Exclude<FixMethod, 'sounding'>, number> = { land: 100, sat: 200, stars: 1500 };

export const SAT_EVERY_S = 5400;
export const SAT_PASS_S = 900;
const SAT_RX_S = 120;
const STAR_S = 180;
const LAND_SIGHT_M = 25_000;
const LAND_CHECK_S = 10;

/** Start of the satellite window that contains t (seconds), or undefined. */
function satOffset(w: World): number {
  return ((w.env.seed ?? 0) * 7919) % SAT_EVERY_S;
}
export function satPassNow(w: World, t = w.time): boolean {
  return ((t - satOffset(w)) % SAT_EVERY_S + SAT_EVERY_S) % SAT_EVERY_S < SAT_PASS_S;
}
export function nextSatPassIn(w: World, t = w.time): number {
  if (satPassNow(w, t)) return 0;
  const into = ((t - satOffset(w)) % SAT_EVERY_S + SAT_EVERY_S) % SAT_EVERY_S;
  return SAT_EVERY_S - into;
}

/** Land in sight from the mast: a peak or headland above the line of sight within reach. */
export function landInSight(w: World, s: Ship): boolean {
  const spec = w.env.seabed;
  if (!spec) return false;
  if ((w.env.light ?? 1) < 0.2) return false;
  const reach = Math.min(LAND_SIGHT_M, metVisibility(w.env.seaState, !!w.env.rain) * (1 - 0.9 * fogAt(w.env.met, s.pos)));
  for (let a = 0; a < 360; a += 22.5) {
    const v = { x: Math.sin((a * Math.PI) / 180), y: Math.cos((a * Math.PI) / 180) };
    for (let r = 1000; r <= reach; r += 1000) {
      const p = { x: s.pos.x + v.x * r, y: s.pos.y + v.y * r };
      const d = depthAt(spec, p.x, p.y);
      if (d < -5 && lineOfSight(spec, s.pos, 3, p, -d)) return true;
      if (d < 0) break;
    }
  }
  return false;
}

/** Clear night sky over the boat: dark enough, no rain, no fog. */
function starsVisible(w: World, s: Ship): boolean {
  return (w.env.light ?? 1) < 0.3 && !w.env.rain && !inSquall(w.env.met, s.pos) && fogAt(w.env.met, s.pos) < 0.2 && w.env.seaState <= 5;
}

function applyFix(w: World, s: Ship, sigma: number, method: FixMethod): void {
  const e = (s.drErr ??= { x: 0, y: 0 });
  e.x = w.rng.gauss(0, sigma * 0.7);
  e.y = w.rng.gauss(0, sigma * 0.7);
  s.navSigma = sigma;
  s.lastFixAt = w.time;
  s.lastFix = method;
  w.events.push({ kind: 'boat', time: w.time, shipId: s.id, what: 'navfix', text: `STANDORT DURCH ${FIX_LABEL[method]} · ± ${sigma < 1000 ? `${Math.round(sigma)} M` : `${(sigma / NM).toFixed(1).replace('.', ',')} SM`}` });
}

/** Fixes with the mast up: landmarks, a satellite pass, the stars (one tick of a boat). */
export function stepFixes(w: World, s: Ship, dt: number): void {
  const up = mastRaised(s) || s.depth <= 0.5;
  const nav = (s.navFix ??= { sat: 0, stars: 0, landAt: -1e9 });
  if (!up) {
    nav.sat = 0;
    nav.stars = 0;
    return;
  }
  const sigma = s.navSigma ?? 0;
  if (w.time - nav.landAt >= LAND_CHECK_S) {
    nav.landAt = w.time;
    if (sigma > FIX_SIGMA.land * 1.5 && landInSight(w, s)) return applyFix(w, s, FIX_SIGMA.land, 'land');
  }
  nav.sat = satPassNow(w) ? nav.sat + dt : 0;
  if (nav.sat >= SAT_RX_S && sigma > FIX_SIGMA.sat * 1.5) {
    nav.sat = 0;
    return applyFix(w, s, FIX_SIGMA.sat, 'sat');
  }
  nav.stars = starsVisible(w, s) ? nav.stars + dt : 0;
  if (nav.stars >= STAR_S && sigma > FIX_SIGMA.stars * 1.5) {
    nav.stars = 0;
    applyFix(w, s, FIX_SIGMA.stars, 'stars');
  }
}

/**
 * One sounding: the depth under the keel against the chart. Where the bottom slopes steeply
 * the believed position can only be where the chart shows that depth: the error shrinks.
 * Over a flat bottom it tells nothing. Returns a message for the crew.
 */
export function sounding(w: World, s: Ship): string {
  if (!CLASSES[s.cls].submarine) return 'Nur für U-Boote';
  const spec = w.env.seabed;
  w.events.push({ kind: 'transient', time: w.time, sourceId: s.id, x: s.pos.x, y: s.pos.y, what: 'sounding' });
  const here = spec ? depthAt(spec, s.pos.x, s.pos.y) : 3000;
  if (!spec) return `ECHOLOT: ${Math.round(here - s.depth)} M UNTER KIEL · KEINE SEEKARTE ZUM VERGLEICH`;
  // Slope of the bottom (m per m) from four soundings of the chart round the boat
  const g = Math.hypot(depthAt(spec, s.pos.x + 400, s.pos.y) - depthAt(spec, s.pos.x - 400, s.pos.y),
    depthAt(spec, s.pos.x, s.pos.y + 400) - depthAt(spec, s.pos.x, s.pos.y - 400)) / 800;
  const sigma = s.navSigma ?? 0;
  const under = `${Math.round(here - s.depth)} M UNTER KIEL`;
  if (g < 0.01 || sigma < 300) return `ECHOLOT: ${under} · GRUND ZU FLACH GENEIGT, STANDORT UNVERÄNDERT`;
  // A steeper slope pins the position better (accuracy ~ 15 m depth error / slope)
  const acc = Math.max(300, Math.min(sigma, 15 / g));
  if (acc >= sigma * 0.9) return `ECHOLOT: ${under} · KAUM HILFE, STANDORT ± ${Math.round(sigma)} M`;
  const e = (s.drErr ??= { x: 0, y: 0 });
  const k = acc / sigma;
  e.x *= k;
  e.y *= k;
  s.navSigma = acc;
  s.lastFixAt = w.time;
  s.lastFix = 'sounding';
  return `ECHOLOT: ${under} · STANDORT NACH SEEKARTE ± ${Math.round(acc)} M`;
}
