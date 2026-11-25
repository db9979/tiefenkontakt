import { chartLabel } from './canvas-text.js';
/**
 * Simplified NATO APP-6 frames for the tactical plot: friend = circle, hostile = diamond,
 * unknown = quatrefoil, neutral = square. Subsurface contacts show only the lower half.
 */
export type Affiliation = 'friend' | 'hostile' | 'unknown' | 'neutral';
export type Dimension = 'surface' | 'subsurface';

export function drawSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, aff: Affiliation, dim: Dimension, size = 7, fill = false): void {
  const r = size;
  ctx.beginPath();
  const sub = dim === 'subsurface';
  if (aff === 'friend') {
    if (sub) {
      ctx.moveTo(x - r, y - r * 0.2);
      ctx.arc(x, y - r * 0.2, r, Math.PI, 0, true);
    } else ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (aff === 'hostile') {
    const d = r * 1.25;
    if (sub) {
      ctx.moveTo(x - d, y - d * 0.3);
      ctx.lineTo(x, y + d * 0.7);
      ctx.lineTo(x + d, y - d * 0.3);
    } else {
      ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath();
    }
  } else if (aff === 'neutral') {
    if (sub) {
      ctx.moveTo(x - r, y - r * 0.6); ctx.lineTo(x - r, y + r * 0.6); ctx.lineTo(x + r, y + r * 0.6); ctx.lineTo(x + r, y - r * 0.6);
    } else ctx.rect(x - r, y - r, 2 * r, 2 * r);
  } else {
    // Quatrefoil: four lobes (lower two only when subsurface)
    const l = r * 0.55;
    const lobes = sub ? [[-l, l * 0.6], [l, l * 0.6]] : [[0, -l], [l, 0], [0, l], [-l, 0]];
    for (const [dx, dy] of lobes) {
      ctx.moveTo(x + dx! + l, y + dy!);
      ctx.arc(x + dx!, y + dy!, l, 0, Math.PI * 2);
    }
  }
  if (fill) {
    ctx.globalAlpha *= 0.25;
    ctx.fill();
    ctx.globalAlpha /= 0.25;
  }
  ctx.stroke();
}

/** Short V-shaped wake behind a moving ship (screen coords, heading in degrees, speed in kn). */
export function drawWake(ctx: CanvasRenderingContext2D, x: number, y: number, headingDeg: number, kn: number): void {
  if (kn < 1) return;
  const len = Math.min(26, 6 + kn * 1.2);
  const a = (headingDeg * Math.PI) / 180;
  const back = { x: -Math.sin(a), y: Math.cos(a) };
  const side = { x: Math.cos(a), y: Math.sin(a) };
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  for (const sgn of [-1, 1]) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + back.x * len + side.x * sgn * len * 0.35, y + back.y * len + side.y * sgn * len * 0.35);
  }
  ctx.stroke();
  ctx.restore();
}

/** Uncertainty ellipse of a TMA solution: long along the line of sight, narrow across it. */
export function drawEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, losDeg: number, along: number, across: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((losDeg * Math.PI) / 180);
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(3, across), Math.max(4, along), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Dead-reckoning uncertainty around the own boat since the last fix (radius in px and m). */
export function drawNavUncertainty(ctx: CanvasRenderingContext2D, o: { x: number; y: number }, rPx: number, rM: number): void {
  if (rPx < 6) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(250,199,117,0.55)';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(o.x, o.y, rPx, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(250,199,117,0.8)';
  chartLabel(ctx, `KOPPELORT ±${(rM / 1852).toFixed(1).replace('.', ',')} SM`, o.x + rPx * 0.72, o.y - rPx * 0.72, rPx * 1.44);
  ctx.restore();
}
