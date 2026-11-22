import { CLASSES } from './classes.js';
import type { Ship } from './entities.js';

/**
 * The people aboard: watches wear them down, battle stations sharpen them for a while and
 * exhaust them, morale follows success and losses, hits wound people and empty posts slow
 * the boat. Silent running ("Ruhe im Boot") quiets the boat but slows repairs and reloads.
 * Bad air (CO2/O2) in a closed-up diesel boat drags everything down.
 */

export interface CrewState {
  /** 0 fresh … 1 exhausted. */
  fatigue: number;
  /** 0 broken … 1 elated. */
  morale: number;
  wounded: number;
  battle: boolean;
  silent: boolean;
}

/** Air in a non-nuclear boat (nuclear boats make their own oxygen and scrub CO2 indefinitely). */
export interface AtmoState {
  co2: number; // %
  o2: number; // %
  scrubbers: number; // CO2 absorbent sets left
  candles: number; // oxygen candles left
}

export function crewOf(s: Ship): CrewState {
  return (s.crew ??= { fatigue: 0.1, morale: 0.7, wounded: 0, battle: false, silent: false });
}

/** Diesel and coastal boats track their air; nuclear boats and surface ships don't need to. */
export function needsAir(s: Ship): boolean {
  return !!CLASSES[s.cls].battery;
}

export function airOf(s: Ship): AtmoState | undefined {
  if (!needsAir(s)) return undefined;
  return (s.air ??= { co2: 0.1, o2: 20.9, scrubbers: 8, candles: 8 });
}

export const BAD_CO2 = 3;
export const BAD_O2 = 18;

/**
 * Overall crew performance factor (≈0.55 … 1.1): applied to sonar detection, repairs
 * and reloading. Battle stations +10 %, fatigue up to −30 %, morale ±10 %, wounded −3 % each,
 * foul air −15 %.
 */
export function crewPerformance(s: Ship): number {
  const c = s.crew;
  if (!c) return 1;
  let p = (c.battle ? 1.1 : 1) * (1 - 0.3 * c.fatigue) * (0.9 + 0.2 * (c.morale - 0.5)) * (1 - Math.min(0.3, 0.03 * c.wounded));
  const a = s.air;
  if (a && (a.co2 > BAD_CO2 || a.o2 < BAD_O2)) p *= 0.85;
  return Math.max(0.5, Math.min(1.12, p));
}

/** Sonar operators' effectiveness in dB of signal excess. */
export function crewSonarDb(s: Ship): number {
  return 10 * Math.log10(crewPerformance(s));
}

/** Repairs and reloads: crew performance, halved under silent running (no hammering). */
export function crewWorkRate(s: Ship): number {
  return crewPerformance(s) * (s.crew?.silent ? 0.5 : 1);
}

/** Radiated noise change from the crew's conduct: silent running −3 dB, trim pumps +3 dB, blowing tanks +25 dB. */
export function crewNoiseDb(s: Ship): number {
  let db = s.crew?.silent ? -3 : 0;
  if (Math.abs(s.trim ?? 0) > 0.2) db += 3;
  if (s.blowing) db += 25;
  if (s.snagged) db += 15;
  return db;
}
