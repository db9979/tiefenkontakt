/**
 * ESM intercepts arrive every sensor cycle for every radar on the air. The message log and
 * the crew's voice report an emitter only when it is new on a bearing, after a quiet spell,
 * when it gets stronger or turns to closing, or (danger emitters) again after a short while.
 * The sensor displays (periscope list, plot lines) still use every intercept.
 */

/** Sim seconds before the same emitter on the same bearing is reported again. */
export const ESM_REPEAT_S = 120;
/** Aircraft and fire-control radars are repeated sooner. */
export const ESM_DANGER_REPEAT_S = 30;
/** Bearing sector (degrees) that counts as "the same" intercept. */
const SECTOR = 15;

export interface EsmSeen { time: number; lvl: number; trend: number }

export interface EsmIntercept { time: number; bearing?: number; emitter?: string; esmLvl?: number; esmTrend?: number }

export class EsmThrottle {
  private seen = new Map<string, EsmSeen>();

  /** True when this intercept should go into the log (and the record is updated). */
  report(a: EsmIntercept, danger: boolean): boolean {
    const key = `${a.emitter ?? 'FUNK'}|${Math.round((a.bearing ?? 0) / SECTOR) % (360 / SECTOR)}`;
    const prev = this.seen.get(key);
    const lvl = a.esmLvl ?? 0;
    const trend = a.esmTrend ?? 0;
    const due = !prev || a.time - prev.time >= (danger ? ESM_DANGER_REPEAT_S : ESM_REPEAT_S) || a.time < prev.time
      || lvl > prev.lvl || (trend > 0 && prev.trend <= 0);
    if (!due) return false;
    this.seen.set(key, { time: a.time, lvl, trend });
    if (this.seen.size > 200) this.seen.clear();
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}
