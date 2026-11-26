import {
  distance, fireSalvo, headingVec, heavyPreset, interceptHeading, targetPosAt, twoSpeedMeanKn, wrap360,
  type ContactTrack, type Ship, type TmaSolution, type World,
} from '@tk/shared';
import { solveFor, traceShot, type BotMemory } from './common.js';
import { legsRun, plotFrom, subWaits, type Pace } from './pacing.js';

/**
 * The east SSN's wake homers against the escorts (sub.ts): which hunter she turns on, how fast she
 * reckons it runs, and where the shot goes (across the escort's track astern of her).
 */

/** A wake homer goes only at an escort running faster than this (kn, turn count or TMA): slower, the trail is too faint to follow. */
export const WAKE_SHOT_KN = 15;

/**
 * TMA quality points a wake shot at a hunting escort may lack on top (the plot of a zigzagging
 * escort seldom settles; the homer only has to cross her track somewhere astern, not meet her).
 * Held time, legs and a settled solution are still required.
 */
export const WAKE_TMA_RELIEF = 22;
/** The wake sensor arms this far out from the boat (m): it must be awake before it crosses the trail. */
export const WAKE_ARM_M = 400;
/** Inside this a wake homer has no room to find the trail and run up it (m). */
export const WAKE_MIN_RANGE = 1500;
/** Shaft turns per knot the sonarman assumes for a warship's turn count (signatures: 7–9). */
const WARSHIP_RPM_PER_KN = 8;

/**
 * An escort's speed as the boat knows it: the sonarman's turn count off the DEMON shaft line when
 * it is fresh (the TMA's speed of a zigzagging hunter is poor), else the solution's.
 */
export function escortKn(t: ContactTrack, sol: TmaSolution | undefined, now: number): number | undefined {
  const shaft = t.evidence?.shaftHz;
  if (shaft !== undefined && t.evidenceAt !== undefined && now - t.evidenceAt < 60) return (shaft * 60) / WARSHIP_RPM_PER_KN;
  return sol?.speedKn;
}

/** The solution moved back along her course by `m` metres: aim there and the torpedo crosses her track astern. */
export function astern(sol: TmaSolution, m: number): TmaSolution {
  const v = headingVec(sol.course);
  return { ...sol, x0: sol.x0 - v.x * m, y0: sol.y0 - v.y * m };
}

/** The escort an SSN with wake homers turns on: the loudest hunter (at most two looked at) running faster than WAKE_SHOT_KN. */
export function fastEscort(m: BotMemory, warships: ContactTrack[], now: number): ContactTrack | undefined {
  // Stay on the escort already under attack while it is still heard
  const order = [...warships].sort((a, b) => (b.label === m.attackLabel ? 1 : 0) - (a.label === m.attackLabel ? 1 : 0) || b.se - a.se);
  for (const t of order.slice(0, 2)) {
    const sol = solveFor(m, t, now, 'warship');
    if ((escortKn(t, sol?.sol, now) ?? 0) > WAKE_SHOT_KN) return t;
  }
  return undefined;
}

/** A wake shot reaches out this far (m). */
const WAKE_MAX_RANGE = 8000;
/** After the shot: turn away deep for this long (s), as after any salvo. */
const WAKE_SCOOT_S = 120;

/**
 * One wake homer at a fast escort that pins the boat down, as a side shot: the escort's own plot,
 * held time and legs, a (relaxed) solution that has settled, room to find the trail. The convoy
 * attack keeps its target and plot. True when the homer went.
 */
export function wakeAtHunter(w: World, m: BotMemory, s: Ship, t: ContactTrack, o: { pace: Pace; pf: number; qMin: number; now: number }): boolean {
  const { pace, pf, now } = o;
  const solved = solveFor(m, t, now, 'warship');
  const qMin = Math.max(10, o.qMin - WAKE_TMA_RELIEF);
  const qs = (m.qualSince ??= {});
  const key = `wake:${t.label}`;
  if (solved && solved.q >= qMin) qs[key] ??= now;
  else delete qs[key];
  const range = solved ? distance(s.pos, targetPosAt(solved.sol, now)) : undefined;
  const legs = legsRun(m.legStarts ?? [], plotFrom(pace, pf, t.firstSeen, now), now, pace.legS * pf);
  const settled = qs[key] !== undefined ? now - qs[key]! : 0;
  const wait = subWaits(pace, pf, { held: now - t.firstSeen, seen: false, legs, q: solved?.q, qMin, settled, range, maxRange: WAKE_MAX_RANGE, measured: false, close: false });
  if (wait !== undefined || !solved || range === undefined || range < WAKE_MIN_RANGE || (escortKn(t, solved.sol, now) ?? 0) <= WAKE_SHOT_KN) return false;
  const plan = heavyPreset(range, 'wake');
  const runKn = twoSpeedMeanKn(plan.transitKn, plan.speedKn, WAKE_ARM_M, range);
  // Aimed to cross her track some way astern; the homer turns up the trail from there
  const aim = interceptHeading(s.pos, runKn, astern(solved.sol, Math.min(1000, Math.max(300, range * 0.25))), now) ?? t.bearing;
  const shot = fireSalvo(w, s, { heading: wrap360(aim), enableAfter: WAKE_ARM_M, mode: 'wake', searchDepth: 15, ...plan }, 1, 0);
  if (typeof shot === 'string' || !shot.length) return false;
  traceShot({ t: now, shooter: s.id, team: s.team, weapon: 'torpedo', basis: 'tma', q: solved.q, settled, range, held: now - t.firstSeen, legs, mode: 'wake', target: 'warship' });
  m.lastShot = now;
  m.evadeUntil = now + WAKE_SCOOT_S;
  s.order = { heading: wrap360(t.bearing + 150 * m.legSign), speedKn: 8, depth: Math.max(s.depth, s.order.depth) };
  return true;
}

