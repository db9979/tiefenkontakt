import { TMA_RANGE_FRESH_S, type MeasuredRange } from '@tk/shared';
import { store, type RangeMark } from '../store.js';
import { stadimeterOf } from './scope-targets.js';

type Contact = NonNullable<typeof store.snap>['contacts'][number];

/** A periscope look this old (s) still counts as "in the optic now" for the stadimeter. */
export const STADI_LOOK_S = 6;

/** Time of the latest periscope bearing on this contact, when it is recent enough to range on. */
export function periscopeLookAt(c: Contact, now: number): number | undefined {
  for (let i = c.history.length - 1; i >= 0; i--) {
    const h = c.history[i]!;
    if (now - h.t > STADI_LOOK_S) return undefined;
    if (h.sensor === 'periscope') return h.t;
  }
  return undefined;
}

/**
 * The officer calls the stadimeter range to the plot: the reading as it stands (mast height of
 * the class he assigned, with its marking error), timed at the periscope look it comes from.
 * Undefined while the stadimeter shows no range (no class assigned in Profi, no angle marked)
 * or the target is not in the optic now (mast down: an old angle is no new range).
 */
export function takeStadimeter(c: Contact, now: number): RangeMark | undefined {
  const r = stadimeterOf(c, store.realism === 'einsteiger');
  const t = periscopeLookAt(c, now);
  if (r === undefined || !(r > 0) || t === undefined) return undefined;
  const mark: RangeMark = { t, r, source: 'stadimeter', cls: c.assignedCls ?? c.classified };
  store.rangeMarks.set(c.label, mark);
  return mark;
}

/** Age (s) of a range mark at `now`, and whether Auto-TMA still anchors on it. */
export function rangeMarkAge(mark: RangeMark, now: number): { age: number; fresh: boolean } {
  const age = Math.max(0, now - mark.t);
  return { age, fresh: age <= TMA_RANGE_FRESH_S };
}

/**
 * The player's range Auto-TMA gets for this contact: Profi only (Einsteiger already has the
 * server's periscope range in the plot, and stays as it was).
 */
export function measuredRangeFor(label: string): MeasuredRange | undefined {
  if (store.realism !== 'profi') return undefined;
  const m = store.rangeMarks.get(label);
  return m ? { t: m.t, r: m.r } : undefined;
}
