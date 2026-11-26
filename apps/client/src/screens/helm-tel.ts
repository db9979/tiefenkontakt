import { CLASSES, type ClassId } from '@tk/shared';

/** Engine telegraph steps and the helmsman's rudder for the helm (helm.ts); pure, for the tests. */

export type TelStep = { label: string; short: string; kn: number | 'astern' | 'halfAstern' | 'max' };
/** Astern steps of both telegraphs (left); "−" tells them from the ahead steps of the same name. */
const ASTERN: TelStep[] = [
  { label: 'AK zurück', short: '−AK', kn: 'astern' }, { label: 'Halbe zurück', short: '−HA', kn: 'halfAstern' },
  { label: 'Langsam zurück', short: '−LA', kn: -3 }, { label: 'Stopp', short: 'ST', kn: 0 },
];
/** Engine telegraph of a boat: creep for listening, then slow, half, full (kn; AK follows the class). */
const TEL_SUB: TelStep[] = [
  ...ASTERN,
  { label: 'Schleich', short: 'SL', kn: 3 }, { label: 'Langsam', short: 'LA', kn: 6 },
  { label: 'Halbe', short: 'HA', kn: 12 }, { label: 'AK', short: 'AK', kn: 'max' },
];
/** A surface ship's telegraph (F30): no creep step, and steps up to her top speed. */
const TEL_SURF: TelStep[] = [
  ...ASTERN,
  { label: 'Langsam', short: 'LA', kn: 6 }, { label: 'Halbe', short: 'HA', kn: 12 },
  { label: 'Zwei Drittel', short: '2/3', kn: 16 }, { label: 'Voll', short: 'VO', kn: 22 }, { label: 'AK', short: 'AK', kn: 'max' },
];
export const telegraphOf = (cls: ClassId): TelStep[] => (CLASSES[cls].submarine ? TEL_SUB : TEL_SURF);

/**
 * The rudder the helmsman lays (S8): toward the remaining turn, hard over (35°) until the turn
 * is nearly done, then eased so she meets the ordered course (as the ship model turns her).
 */
export function orderedRudder(togoDeg: number, maxRateDeg: number): number {
  if (Math.abs(togoDeg) < 0.5 || maxRateDeg <= 0) return 0;
  // The model eases the rate as sqrt(2·acc·togo) with acc = maxRate/6
  const share = Math.min(1, Math.sqrt((2 * (maxRateDeg / 6) * Math.abs(togoDeg))) / maxRateDeg);
  return Math.sign(togoDeg) * Math.round(35 * share);
}
