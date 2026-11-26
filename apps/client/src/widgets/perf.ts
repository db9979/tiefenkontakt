/**
 * Graphics quality: how hard the client works. "Auto" picks a lower level on phones and
 * small machines to save battery and heat; players can override it in the gear menu.
 * Levels cap the frame rate, the canvas resolution and the 3D detail. "Niedrig" also draws the
 * 3D views a little under CSS resolution and without multisampling, with cheaper sea and sky
 * shaders, no faint stars, Milky Way or cirrus and half the rain (periscope3d.ts, sea3d/sky.ts):
 * on a weak GPU that doubles to triples the frame rate of the night views.
 */

export type Quality = 'niedrig' | 'mittel' | 'hoch';
export type QualitySetting = Quality | 'auto';

const LEVELS = {
  niedrig: { fps: 24, dpr2d: 1, dprGl: 0.8, ocean: 128 },
  mittel: { fps: 30, dpr2d: 1.5, dprGl: 1.25, ocean: 224 },
  hoch: { fps: 60, dpr2d: 2, dprGl: 1.5, ocean: 320 },
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
  const guess: Quality = touch || cores <= 4 ? 'mittel' : 'hoch';
  // Stepped down this session because the device could not keep up
  const steps = Number(sessionStorage.getItem('tk_quality_down') ?? 0);
  const order: Quality[] = ['niedrig', 'mittel', 'hoch'];
  return order[Math.max(0, order.indexOf(guess) - steps)]!;
}

/**
 * Watches the drawn frames: when the device reaches under 60 % of the frame cap for several
 * seconds, 'auto' steps one level down (for this session; the next 3D view builds the lighter
 * sea, frame cap and resolution follow at once). Gaps over half a second (tab hidden, a
 * screen change) do not count.
 */
export class FrameWatch {
  private sum = 0;
  private n = 0;
  private last = 0;
  constructor(private target: () => number, private window = 6000) {}

  /** A frame was drawn at `now` (ms); true when the device is too slow. */
  note(now: number): boolean {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    if (dt <= 0 || dt > 500) return false;
    this.sum += dt;
    this.n++;
    if (this.sum < this.window) return false;
    const slow = this.sum / this.n > this.target() / 0.6;
    this.sum = 0;
    this.n = 0;
    return slow;
  }
}

/** Step 'auto' down one level for this session (false when it is set by hand or already lowest). */
export function stepDown(): boolean {
  if (qualitySetting() !== 'auto' || quality() === 'niedrig') return false;
  sessionStorage.setItem('tk_quality_down', String(Number(sessionStorage.getItem('tk_quality_down') ?? 0) + 1));
  return true;
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
