import { headingVec, type Vec2 } from './math.js';

/**
 * Sonobuoy patterns for the helicopter (F15):
 * - line: `count` buoys `spacing` apart along `axis`, centred on the point (a search line);
 * - barrier: a staggered double line across `axis` (two rows 0.6 × spacing apart, the second
 *   offset by half a spacing), the classic barrier ahead of a transiting boat: the gaps of one
 *   row are covered by the other;
 * - circle: buoys evenly on a circle of radius `spacing` round a datum (a flaming-datum
 *   pattern, 6–8 buoys at 1–2 nm);
 * - chevron: a V whose apex lies on the point and points along `axis` (the boat's course):
 *   two arms trailing back at 40° either side, laid ahead of a fast boat so it runs into the V.
 */

export type BuoyPattern = 'line' | 'barrier' | 'circle' | 'chevron';

export interface PatternSpec {
  x: number;
  y: number;
  /** line, barrier: direction the line runs; chevron: direction the V points (the boat's course). */
  axis?: number;
  count?: number;
  /** Spacing between buoys (m); circle: the radius. */
  spacing?: number;
  pattern?: BuoyPattern;
}

/** Buoys per pattern: most and default. */
export const PATTERN_COUNT: Record<BuoyPattern, { max: number; def: number }> = {
  line: { max: 6, def: 4 }, barrier: { max: 8, def: 6 }, circle: { max: 8, def: 6 }, chevron: { max: 7, def: 5 },
};
/** Circle radius limits (m): 1–2 nm. */
export const CIRCLE_R: [number, number] = [1800, 3700];
/** Chevron arms: this far either side of the reverse axis (deg). */
const CHEVRON_DEG = 40;

/** The points of a pattern, in the order the helicopter lays them. */
export function buoyPoints(t: PatternSpec): Vec2[] {
  const n = Math.max(1, t.count ?? 1);
  const sp = t.spacing ?? 2500;
  const axis = t.axis ?? 0;
  const p = t.pattern ?? 'line';
  if (p === 'circle') {
    const r = Math.max(CIRCLE_R[0], Math.min(CIRCLE_R[1], sp));
    return Array.from({ length: n }, (_, i) => {
      const v = headingVec(axis + (360 * i) / n);
      return { x: t.x + v.x * r, y: t.y + v.y * r };
    });
  }
  if (p === 'chevron') {
    // Apex first, then alternately the port and starboard arm, outward
    const out: Vec2[] = [{ x: t.x, y: t.y }];
    for (let i = 1; out.length < n; i++) {
      for (const side of [-1, 1]) {
        if (out.length >= n) break;
        const v = headingVec(axis + 180 + side * CHEVRON_DEG);
        out.push({ x: t.x + v.x * sp * i, y: t.y + v.y * sp * i });
      }
    }
    return out;
  }
  const v = headingVec(axis);
  if (p === 'barrier') {
    // Two rows across the axis of approach: front row ceil(n/2), back row offset by half a spacing
    const across = headingVec(axis + 90);
    const front = Math.ceil(n / 2);
    const back = n - front;
    const row = (k: number, shift: number, depth: number) => Array.from({ length: k }, (_, i) => {
      const off = (i - (k - 1) / 2) * sp + shift;
      return { x: t.x + v.x * off + across.x * depth, y: t.y + v.y * off + across.y * depth };
    });
    // Back row laid in reverse, so the helicopter flies a zigzag instead of crossing back
    return [...row(front, 0, sp * 0.3), ...row(back, back === front ? sp / 2 : 0, -sp * 0.3).reverse()];
  }
  return Array.from({ length: n }, (_, i) => {
    const off = (i - (n - 1) / 2) * sp;
    return { x: t.x + v.x * off, y: t.y + v.y * off };
  });
}

/** A line or barrier may be laid from either end; circle and chevron have a fixed order. */
export function reversible(p: BuoyPattern | undefined): boolean {
  return p === undefined || p === 'line' || p === 'barrier';
}
