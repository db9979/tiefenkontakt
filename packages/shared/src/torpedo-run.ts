/**
 * Heavyweight run and fuel (F17, realism round 5): one speed, or a slow quiet transit and a fast
 * attack once the seeker opens (Tigerfish, Mk 48, SET-65 practice). The reach follows from the
 * fuel burnt at each speed.
 */
import { clamp } from './math.js';
import type { SeekerMode, TorpedoKind } from './weapons.js';

/** Fastest and slowest heavyweight run (kn). */
export const HEAVY_MAX_KN = 40;
export const HEAVY_MIN_KN = 25;
/** Heavyweight fuel: metres of run at the reference speed. */
export const HEAVY_FUEL = 25_000;
const HEAVY_REF_KN = 30;
/**
 * Fuel burnt per metre ∝ v^1.78: between pure hull drag (v², power v³) and a fixed hotel load.
 * The exponent fits the class data: 25 km at 30 kn, 15 km at 40 kn (35 km at 25 kn).
 */
const BURN_EXP = Math.log(25 / 15) / Math.log(40 / 30);

/** Fuel per metre run at `kn` (heavyweights; a lightweight's fuel is counted in metres). */
export function burnPerM(kind: TorpedoKind, kn: number): number {
  return kind === 'heavy' ? (clamp(kn, HEAVY_MIN_KN, HEAVY_MAX_KN) / HEAVY_REF_KN) ** BURN_EXP : 1;
}

/** Heavyweight reach at one run speed (m): the fuel at that speed's burn. */
export function heavyRange(speedKn: number): number {
  return HEAVY_FUEL / burnPerM('heavy', speedKn);
}

/**
 * Reach of a two-speed run (m): transit until the seeker opens at `enableAfter`, then the
 * attack speed for the rest of the fuel. A slow transit buys reach and a quiet approach.
 */
export function twoSpeedRange(transitKn: number, attackKn: number, enableAfter: number): number {
  const full = heavyRange(transitKn);
  if (enableAfter >= full) return full;
  const left = HEAVY_FUEL - enableAfter * burnPerM('heavy', transitKn);
  return enableAfter + left / burnPerM('heavy', attackKn);
}

/** Mean speed (kn) of a two-speed run out to `rangeM` (for the intercept course). */
export function twoSpeedMeanKn(transitKn: number, attackKn: number, enableAfter: number, rangeM: number): number {
  const a = Math.min(enableAfter, rangeM);
  const time = a / transitKn + Math.max(0, rangeM - a) / attackKn;
  return time > 0 ? rangeM / time : attackKn;
}

/**
 * The AI's speed setting for a heavyweight shot. An active (anti-submarine) shot from beyond
 * 3 km transits at 30 kn, quieter and later heard by the target, and sprints at 40 kn once the
 * seeker opens (an active seeker loses little to flow noise). Passive shots keep one speed:
 * 30 kn beyond 4 km (a fast passive seeker goes deaf), else 40 kn.
 */
export function heavyPreset(rangeM: number, mode: SeekerMode): { transitKn: number; speedKn: number } {
  if (mode === 'active') return rangeM > 3000 ? { transitKn: 30, speedKn: 40 } : { transitKn: 40, speedKn: 40 };
  const kn = rangeM > 4000 ? 30 : 40;
  return { transitKn: kn, speedKn: kn };
}
