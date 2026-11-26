import { CLASSES } from './classes.js';
import type { Ship } from './entities.js';
import { KN } from './math.js';

/**
 * Towed-array geometry (F27). A surface ship's array hangs on a heavy cable whose depression angle
 * falls with the drag, roughly as 1/speed: an array on about 1,5 km of cable runs near 250 m deep
 * at 6 kn and near 100 m at 15 kn (SQR-19/2031-class figures). Fast, it rises into the surface duct;
 * slow, it sinks below the layer. A submarine's array trails nearly level behind the boat.
 */

/** Depth per metre of cable at the reference speed (surface ship), and that speed (kn). */
export const TOWED_DEPTH_FACTOR = 0.15;
export const TOWED_REF_KN = 10;
/** Bounds of the speed factor: a slow ship's cable hangs at most this steep, a fast one this flat. */
const SLOW_MAX = 1.6;
const FAST_MIN = 0.4;
/** Deepest the array goes (m). */
export const TOWED_MAX_DEPTH = 300;

/** Depth of the towed array for this speed (kn) and cable length (m). */
export function towedDepthFor(shipDepth: number, length: number, speedKn: number, submarine: boolean): number {
  if (submarine) return Math.min(shipDepth + length * 0.05, TOWED_MAX_DEPTH);
  const k = Math.max(FAST_MIN, Math.min(SLOW_MAX, TOWED_REF_KN / Math.max(0.1, speedKn)));
  return Math.min(shipDepth + length * TOWED_DEPTH_FACTOR * k, TOWED_MAX_DEPTH);
}

/** Depth of the ship's towed array now (speed through the water and the cable streamed). */
export function towedGeometryDepth(s: Ship): number {
  return towedDepthFor(s.depth, s.towedLength, s.speed / KN, !!CLASSES[s.cls].submarine);
}
