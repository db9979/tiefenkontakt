import { CLASSES, distance, type Snapshot, type Vec2 } from '@tk/shared';
import { COL } from './format.js';

/** A heavyweight fired from inside this range of a merchant is a real threat to the convoy (m). */
export const TORPEDO_DANGER_M = 8000;

/**
 * Escort's plot: the torpedo danger ring, 8 km around the convoy's merchants (around their
 * centre, widened by the convoy's own spread), thin amber dashed. A boat inside it can shoot.
 */
export function drawConvoyDangerRing(ctx: CanvasRenderingContext2D, s: Snapshot, P: (p: Vec2) => Vec2, scale: number): void {
  if (CLASSES[s.own.cls].submarine) return;
  const ms = s.friendlies.filter((f) => f.cls === 'merchant' && f.alive);
  if (!ms.length) return;
  const c = { x: ms.reduce((a, f) => a + f.x, 0) / ms.length, y: ms.reduce((a, f) => a + f.y, 0) / ms.length };
  const r = TORPEDO_DANGER_M + Math.max(...ms.map((f) => distance(c, f)));
  const p = P(c);
  ctx.save();
  ctx.strokeStyle = COL.amber;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r / scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
