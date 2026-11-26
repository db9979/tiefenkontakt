import type { ContactTrack } from '@tk/shared';
import type { BotSkill } from './common.js';

/**
 * Attack pacing: an AI captain goes through the same steps as a crew before a weapon goes.
 * A boat listens long enough to classify (or takes a periscope look), runs at least two legs for
 * its TMA with time on each, waits until the solution has held above its threshold for a while,
 * closes at a quiet speed and fires only inside the weapon's reach. An escort localizes first:
 * it holds the submarine for a while and wants repeated active fixes (or a long-held cross-fix)
 * before rockets or the helicopter's torpedo go. No clock: every gate is a condition of the
 * contact, and the minimum times per step vary by skill and from captain to captain.
 */

export interface Pace {
  /** Listening on a contact before the captain trusts its classification (s); a periscope look replaces it. */
  classifyS: number;
  /** Own-ship legs the TMA needs, and the least time on each (s). */
  legs: number;
  legS: number;
  /** The solution must have stayed above the firing threshold this long (s). */
  settleS: number;
  /** Escorts: least time holding a submarine contact (or hunting a datum) before a weapon goes (s). */
  prosecuteS: number;
  /** Escorts: active fixes (echo, dipping sonar) within FIX_WINDOW_S before a rocket or torpedo goes. */
  fixes: number;
}

export const PACE: Record<BotSkill, Pace> = {
  leicht: { classifyS: 180, legs: 2, legS: 140, settleS: 75, prosecuteS: 300, fixes: 3 },
  normal: { classifyS: 90, legs: 2, legS: 90, settleS: 30, prosecuteS: 120, fixes: 2 },
  schwer: { classifyS: 60, legs: 2, legS: 70, settleS: 15, prosecuteS: 60, fixes: 1 },
};

/** A boat's least time between salvos (s). */
export const SHOT_COOLDOWN = 150;

/** Active fixes count inside this window (s). */
export const FIX_WINDOW_S = 180;

/**
 * The captain's own tempo: 0.85–1.5 × the skill's times, drawn per ship and match (some crews
 * work faster than others), and a reckless commander hurries, a cautious one takes longer.
 */
export function captainPace(shipId: string, seed: number, trait?: string): number {
  let h = (seed ^ 0x9e3779b9) | 0;
  for (let i = 0; i < shipId.length; i++) h = Math.imul(h ^ shipId.charCodeAt(i), 0x85ebca6b);
  h ^= h >>> 13;
  const u = ((Math.imul(h, 0xc2b2ae35) >>> 0) % 1000) / 1000;
  const mood = trait === 'draufgaenger' ? 0.85 : trait === 'vorsichtig' ? 1.2 : trait === 'fuchs' ? 1.1 : 1;
  // Even the quickest crew needs most of the drill's time
  return Math.max(0.85, (0.85 + 0.45 * u) * mood);
}

/**
 * TMA legs between `from` and `now`, from the times the captain put the boat on a new leg (the
 * course change across the line of sight): a leg counts when the boat spent at least `minLegS`
 * of it inside the window; the leg it is on counts once it has.
 */
export function legsRun(starts: readonly number[], from: number, now: number, minLegS: number): number {
  let n = 0;
  for (let i = 0; i < starts.length; i++) {
    const a = Math.max(starts[i]!, from);
    const b = Math.min(starts[i + 1] ?? now, now);
    if (b - a >= minLegS) n++;
  }
  return n;
}

/** Has the captain seen the contact (periscope, radar, by eye) rather than only heard it? */
export function looked(t: ContactTrack): boolean {
  return t.sighting !== undefined || t.sensors.some((k) => k === 'periscope' || k === 'visual' || k === 'radar');
}

export type SubWait = 'classify' | 'tma' | 'legs' | 'settle' | 'range';

export interface SubShot {
  /** How long the contact has been held (s). */
  held: number;
  /** Seen through the periscope (or radar): classified, and the range measured. */
  seen: boolean;
  /** Own legs on the bearing plot. */
  legs: number;
  /** TMA quality and the quality the captain wants. */
  q?: number;
  qMin: number;
  /** How long the solution has stayed above qMin (s). */
  settled: number;
  /** Best range estimate (m) and the reach the captain shoots from. */
  range?: number;
  maxRange: number;
  /** The range was measured (periscope, radar): the legs still give course and speed, but no TMA quality is needed. */
  measured: boolean;
  /** A loud, close boat (duel): one leg is enough. */
  close?: boolean;
}

/**
 * The boat's firing gate. Returns undefined when the shot may go, else the step it is still in
 * (classify, legs, tma, settle: keep working the plot; range: close in).
 */
export function subWaits(p: Pace, f: number, x: SubShot): SubWait | undefined {
  if (x.held < p.classifyS * f && !x.seen) return 'classify';
  if (x.legs < (x.close ? 1 : p.legs)) return 'legs';
  if (!x.measured && !x.close) {
    if (x.q === undefined || x.q < x.qMin) return 'tma';
    if (x.settled < p.settleS * f) return 'settle';
  }
  if (x.range === undefined || x.range > x.maxRange) return 'range';
  return undefined;
}

/**
 * When the TMA legs start to count: after the classification time. Legs run before the captain
 * knew what he was plotting are search legs, not an attack plot (a periscope look lets him fire
 * before the classification time is up only when the legs are already in hand, see subWaits).
 */
export function plotFrom(p: Pace, f: number, firstSeen: number, now: number): number {
  return Math.max(firstSeen + p.classifyS * f, now - 900);
}

/** Active fixes (echo, dipping sonar, MAD) on a contact within the window, at least 8 s apart. */
export function activeFixes(t: ContactTrack, now: number): number {
  let n = 0;
  let last = -1e9;
  for (const h of t.history) {
    if (now - h.t > FIX_WINDOW_S || h.r === undefined || (h.sensor !== 'active' && h.sensor !== 'mad')) continue;
    if (h.t - last < 8) continue;
    n++;
    last = h.t;
  }
  return n;
}

export type EscortBasis = 'echo' | 'buoy' | 'datum' | 'dip';

/**
 * The escort's firing gate: held (or hunted) long enough, and localized. An echo or dip shot
 * wants repeated active fixes; a bearing-only cross-fix (buoy and own sonar) wants the contact
 * held half as long again; a team datum the attacker fires on is already an echo fix.
 */
export function escortMayFire(p: Pace, f: number, basis: EscortBasis, held: number, fixes: number): boolean {
  const need = p.prosecuteS * f * (basis === 'buoy' ? 1.5 : basis === 'dip' ? 0.6 : 1);
  if (held < need) return false;
  if ((basis === 'echo' || basis === 'dip') && fixes < p.fixes) return false;
  return true;
}
