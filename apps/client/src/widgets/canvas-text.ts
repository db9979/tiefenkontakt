import { COL } from './format.js';

/**
 * Canvas text that stays readable: a label that crosses lines gets a filled plate in the
 * display's background behind it, and labels are kept inside the canvas. Works with the
 * current font, textAlign and fillStyle (the plate is drawn in `plate`, the text in the
 * fillStyle that was set). Font size is read from the font string (px).
 */

export interface Box { x: number; y: number; w: number; h: number }

/** Pixel size of the current font (defaults to 11). */
function fontPx(ctx: CanvasRenderingContext2D): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
  return m ? Number(m[1]) : 11;
}

/** The box a text drawn at (x, y) covers with the current font, alignment and baseline. */
export function textBox(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, pad = 3): Box {
  const w = ctx.measureText(text).width;
  const px = fontPx(ctx);
  const a = ctx.textAlign;
  const left = a === 'center' ? x - w / 2 : a === 'right' || a === 'end' ? x - w : x;
  const b = ctx.textBaseline;
  const top = b === 'middle' ? y - px / 2 : b === 'top' || b === 'hanging' ? y : b === 'bottom' ? y - px : y - px * 0.8;
  return { x: left - pad, y: top - pad + 1, w: w + 2 * pad, h: px + 2 * pad - 1 };
}

/** x for a text so that it stays inside [min, max] with its alignment (min/max are the canvas edges). */
export function clampTextX(ctx: CanvasRenderingContext2D, text: string, x: number, min: number, max: number): number {
  const w = ctx.measureText(text).width;
  const a = ctx.textAlign;
  const left = a === 'center' ? x - w / 2 : a === 'right' || a === 'end' ? x - w : x;
  const shift = left < min ? min - left : left + w > max ? max - (left + w) : 0;
  return x + shift;
}

/** Fill a text on a plate of the background colour (padding 3 px); returns the plate. */
export function plateText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, plate: string = COL.bg, pad = 3): Box {
  const box = textBox(ctx, text, x, y, pad);
  // save/restore, not reading fillStyle back: in light mode the setter inks every colour it is given
  ctx.save();
  ctx.fillStyle = plate;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
  ctx.fillText(text, x, y);
  return box;
}

/** Plate of the chart labels: the dark sea, three quarters opaque (the chart still shows through). */
export const CHART_PLATE = 'rgba(6,14,16,0.72)';

/**
 * A chart overlay label (aircraft, own ship, contacts): on a semi-opaque plate, so depth labels,
 * contours and lanes under it do not run through the words; left-aligned text that would run
 * off the right edge flips to the left of x (by `flip` px).
 */
export function chartLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, flip = 0): void {
  const cv = ctx.canvas as HTMLCanvasElement;
  const w = cv.clientWidth || cv.width;
  ctx.save();
  ctx.textAlign = 'left';
  const tw = ctx.measureText(text).width;
  const lx = x + tw > w - 3 ? Math.max(3, x - flip - tw) : Math.max(3, x);
  plateText(ctx, text, lx, y, CHART_PLATE, 2);
  ctx.restore();
}

/** True when two boxes overlap (with an extra gap). */
export function boxesHit(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}
