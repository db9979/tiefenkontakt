import { CLASSES, RECOG, RECOG_ORDER, recogDraught, type ClassId } from '@tk/shared';

/**
 * Common scale for the recognition book's silhouettes: every class of a category (surface ships,
 * submarines) is drawn into the same frame in metres, so one metre is the same width on every
 * page and sizes can be compared directly. Pure layout numbers; recog-draw.ts turns them into SVG.
 */

export type ScaleCat = 'ship' | 'sub';
export const scaleCat = (cls: ClassId): ScaleCat => (CLASSES[cls].submarine ? 'sub' : 'ship');

export interface ScaleFrame {
  cat: ScaleCat;
  /** Height grid spacing (m). */
  grid: number;
  /** Label size (m in the drawing). */
  font: number;
  /** Side view: x from stern (0) towards the bow, y up from the waterline (m). */
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
  /** Bow view: half width (m) of its frame; drawn at BOW_ZOOM times the side scale. */
  bowHalf: number;
  /** Top view: half height (m) of its frame (beam). */
  topHalf: number;
}

/** The bow view is small at true scale: it is drawn twice as large (still the same for every class). */
export const BOW_ZOOM = 2;

const memo = new Map<string, ScaleFrame>();

/** The frame of a category: big enough for its longest, tallest, deepest and widest class. */
export function scaleFrame(cat: ScaleCat, classes: readonly ClassId[] = RECOG_ORDER): ScaleFrame {
  const key = `${cat}|${classes.join(',')}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const cs = classes.filter((c) => scaleCat(c) === cat);
  const max = (f: (c: ClassId) => number) => Math.max(1, ...cs.map(f));
  const len = max((c) => RECOG[c].length);
  const mast = max((c) => RECOG[c].mast);
  const draught = max((c) => recogDraught(c));
  const beam = max((c) => RECOG[c].beam);
  const grid = cat === 'sub' ? 5 : 10;
  const font = Math.round((len / 28) * 10) / 10;
  const f: ScaleFrame = {
    cat, grid, font,
    x0: -font * 3.6,
    x1: len + font * 6.5,
    yTop: Math.ceil(mast / grid) * grid + font * 0.8,
    yBot: -draught - font * 2,
    bowHalf: beam * 0.5 + font * 0.6,
    topHalf: beam * 0.5 + font * 0.5,
  };
  memo.set(key, f);
  return f;
}

/** Heights (m) of the grid lines inside the frame, the waterline (0) included. */
export function gridLines(f: ScaleFrame): number[] {
  const out: number[] = [];
  for (let y = Math.ceil((f.yBot + f.font * 0.5) / f.grid) * f.grid; y <= f.yTop + 1e-6; y += f.grid) out.push(y);
  return out;
}

/** Width of the side view of this frame relative to another (1 for the same category). */
export function metresPerPx(f: ScaleFrame, widthPx: number): number {
  return (f.x1 - f.x0) / Math.max(1, widthPx);
}

/** Bow view's share of the side view's width, so both stay to the same (zoomed) scale. */
export function bowWidthShare(f: ScaleFrame): number {
  return (2 * f.bowHalf * BOW_ZOOM) / (f.x1 - f.x0);
}
