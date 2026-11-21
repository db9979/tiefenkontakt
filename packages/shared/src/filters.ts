import { angleDiff, wrap360 } from './math.js';

/** Display filters (pure): smooth noisy measurements for rendering only. */

/**
 * Alpha-beta tracker for a bearing (deg) and a range (m): smooths measurement
 * noise and carries the drift between updates.
 */
export class BearingRangeFilter {
  private b?: number;
  private bRate = 0;
  private r?: number;
  private rRate = 0;
  private t = 0;

  constructor(private alpha = 0.25, private beta = 0.03) {}

  update(t: number, bearing: number, range?: number): void {
    if (this.b === undefined) {
      this.b = bearing;
      this.r = range;
      this.t = t;
      return;
    }
    const dt = t - this.t;
    if (dt <= 0) return;
    const predB = this.b + this.bRate * dt;
    const resB = angleDiff(predB, bearing);
    this.b = wrap360(predB + this.alpha * resB);
    this.bRate += (this.beta * resB) / dt;
    if (range !== undefined) {
      if (this.r === undefined) this.r = range;
      else {
        const predR = this.r + this.rRate * dt;
        const resR = range - predR;
        this.r = predR + this.alpha * resR;
        this.rRate += (this.beta * resR) / dt;
      }
    }
    this.t = t;
  }

  /** Estimate at time t (extrapolated from the last update). */
  at(t: number): { bearing: number; range?: number } | undefined {
    if (this.b === undefined) return undefined;
    const dt = Math.max(0, Math.min(10, t - this.t));
    return { bearing: wrap360(this.b + this.bRate * dt), range: this.r !== undefined ? this.r + this.rRate * dt : undefined };
  }
}

/** Exponential approach of a displayed angle toward a target (for dials). */
export function easeAngle(current: number, target: number, dtS: number, tau = 0.25): number {
  const k = 1 - Math.exp(-dtS / tau);
  return wrap360(current + angleDiff(current, target) * k);
}
