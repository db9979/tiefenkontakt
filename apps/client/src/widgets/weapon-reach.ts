import { ROCKET_MAX_RANGE, ROCKET_MIN_RANGE, TORPEDO_SPECS } from '@tk/shared';
import type { GuardCheck } from './fire-guard.js';
import { km } from './format.js';

/**
 * Weapon envelopes the fire buttons check against (OPZ and Waffen use the same numbers as the
 * server): ASW rocket 1,8–18 km, the ship's lightweight torpedo about 8 km of run.
 */

/** A range fix older than this is no aim for a weapon (s); the TMA solution takes over. */
export const FIX_AGE_S = 60;

/** Run of the frigate's lightweight torpedo (m). */
export const LIGHT_TORP_RANGE = TORPEDO_SPECS.light.maxRun;

/** The ASW rocket's envelope: refuse with no range, inside 1,8 km or beyond 18 km. */
export function rocketCheck(range: number | undefined): GuardCheck {
  if (range === undefined) return { block: 'KEINE ENTFERNUNG' };
  if (range < ROCKET_MIN_RANGE) return { block: `ZU NAH · UNTER ${km(ROCKET_MIN_RANGE)}` };
  if (range > ROCKET_MAX_RANGE) return { block: `ZU WEIT · ÜBER ${Math.round(ROCKET_MAX_RANGE / 1000)} KM` };
  return {};
}

/** The lightweight torpedo: beyond its run it cannot reach; near the end a second press. */
export function torpedoCheck(range: number | undefined): GuardCheck {
  if (range === undefined) return {};
  if (range > LIGHT_TORP_RANGE) return { block: `ZU WEIT · ÜBER ${Math.round(LIGHT_TORP_RANGE / 1000)} KM` };
  if (range > LIGHT_TORP_RANGE * 0.85) return { warn: 'REICHWEITE KNAPP' };
  return {};
}

/** Card line: "8 KM · ZIEL 3,9 KM ✓" (amber beyond reach). */
export function reachText(max: number, range: number | undefined, min = 0): { text: string; ok: boolean } {
  const maxT = `${Math.round(max / 1000)} KM`;
  if (range === undefined) return { text: `${min ? `${km(min).replace(' KM', '')}–` : ''}${maxT} · ZIEL ?`, ok: true };
  const ok = range >= min && range <= max;
  return { text: `${min ? `${km(min).replace(' KM', '')}–` : ''}${maxT} · ZIEL ${km(range)} ${ok ? '✓' : range < min ? 'ZU NAH' : 'ZU WEIT'}`, ok };
}
