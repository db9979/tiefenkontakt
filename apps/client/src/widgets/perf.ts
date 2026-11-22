/**
 * Graphics quality: how hard the client works. "Auto" picks a lower level on phones and
 * small machines to save battery and heat; players can override it in the gear menu.
 * Levels cap the frame rate, the canvas resolution and the 3D detail.
 */

export type Quality = 'niedrig' | 'mittel' | 'hoch';
export type QualitySetting = Quality | 'auto';

const LEVELS = {
  niedrig: { fps: 24, dpr2d: 1, dprGl: 1, ocean: 128 },
  mittel: { fps: 30, dpr2d: 1.5, dprGl: 1.25, ocean: 192 },
  hoch: { fps: 60, dpr2d: 2, dprGl: 1.5, ocean: 256 },
} as const;

export function qualitySetting(): QualitySetting {
  const v = localStorage.getItem('tk_quality');
  return v === 'niedrig' || v === 'mittel' || v === 'hoch' ? v : 'auto';
}

export function setQuality(q: QualitySetting): void {
  if (q === 'auto') localStorage.removeItem('tk_quality');
  else localStorage.setItem('tk_quality', q);
}

/** The level in effect: the player's choice, or a guess from the device. */
export function quality(): Quality {
  const q = qualitySetting();
  if (q !== 'auto') return q;
  const touch = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  return touch || cores <= 4 ? 'mittel' : 'hoch';
}

const level = () => LEVELS[quality()];

/** Minimum time between drawn frames (ms). */
export const frameIntervalMs = () => 1000 / level().fps;
/** Device pixel ratio for 2D canvases and for WebGL. */
export const dpr2d = () => Math.min(window.devicePixelRatio || 1, level().dpr2d);
export const dprGl = () => Math.min(window.devicePixelRatio || 1, level().dprGl);
/** Ocean mesh resolution of the 3D scenes. */
export const oceanSegments = () => level().ocean;

export const QUALITY_LABEL: Record<QualitySetting, string> = { auto: 'Auto', niedrig: 'Niedrig', mittel: 'Mittel', hoch: 'Hoch' };
