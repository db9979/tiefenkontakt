import { headingVec, type Vec2 } from '@tk/shared';
import { fromNorthUp, northOff, toNorthUp } from '../north.js';

/**
 * North-up chart geometry shared by the plot and the debrief: world positions stay in the game
 * frame, the screen shows true north up. `c` is the world point at the screen centre, `scale`
 * metres per pixel, `w`×`h` the canvas size in CSS pixels.
 */

export function chartToScreen(p: Vec2, c: Vec2, scale: number, w: number, h: number): Vec2 {
  const d = toNorthUp(p.x - c.x, p.y - c.y);
  return { x: w / 2 + d.x / scale, y: h / 2 - d.y / scale };
}

export function chartToWorld(m: { x: number; y: number }, c: Vec2, scale: number, w: number, h: number): Vec2 {
  const g = fromNorthUp((m.x - w / 2) * scale, -(m.y - h / 2) * scale);
  return { x: c.x + g.x, y: c.y + g.y };
}

/** World (game-frame) shift of the view centre for a screen drag of (dx, dy) pixels. */
export function panDelta(dx: number, dy: number, scale: number): Vec2 {
  return fromNorthUp(-dx * scale, dy * scale);
}

/** Unit vector on screen (y down) for a game-frame direction in degrees. */
export function screenDir(gameDeg: number): Vec2 {
  const v = headingVec(gameDeg + northOff());
  return { x: v.x, y: -v.y };
}

/** Grid lines along true north and east every `step` metres, aligned to the (rotated) world origin. */
export function northUpGrid(ctx: CanvasRenderingContext2D, c: Vec2, scale: number, w: number, h: number, step: number): void {
  const n = toNorthUp(c.x, c.y);
  ctx.beginPath();
  for (let e = Math.floor((n.x - (w / 2) * scale) / step) * step; e < n.x + (w / 2) * scale; e += step) {
    const x = w / 2 + (e - n.x) / scale;
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
  }
  for (let y = Math.floor((n.y - (h / 2) * scale) / step) * step; y < n.y + (h / 2) * scale; y += step) {
    const sy = h / 2 - (y - n.y) / scale;
    ctx.moveTo(0, sy); ctx.lineTo(w, sy);
  }
  ctx.stroke();
}
