import { FOG_SPEED, SQUALL_SPEED, type MetCells, type Vec2 } from '@tk/shared';

/**
 * Met forecast on the plot: fog banks, rain squalls and ice fields as shaded areas, icebergs
 * as marks. Dashed outlines show where fog and showers will have drifted in 15 minutes.
 */

const AHEAD_S = 900;

function area(ctx: CanvasRenderingContext2D, c: Vec2, r: number, fill: string, stroke: string, dash: number[]): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.setLineDash(dash);
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function forecast(ctx: CanvasRenderingContext2D, now: Vec2, then: Vec2, r: number, stroke: string): void {
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.arc(then.x, then.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(now.x, now.y);
  ctx.lineTo(then.x, then.y);
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, p: Vec2, r: number, text: string, color: string): void {
  if (r < 14) return;
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, p.y - Math.min(r * 0.6, 40));
}

/** Draw the met cells; P maps world to screen, scale is meters per pixel. */
export function drawMet(ctx: CanvasRenderingContext2D, met: MetCells | undefined, P: (p: Vec2) => Vec2, scale: number): void {
  if (!met) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const f of met.floes) {
    const c = P(f);
    const r = f.r / scale;
    area(ctx, c, r, `rgba(215,232,240,${0.05 + 0.12 * f.cover})`, 'rgba(215,232,240,0.35)', [1, 3]);
    label(ctx, c, r, `EIS · ${Math.round(f.cover * 10)}/10`, 'rgba(215,232,240,0.7)');
  }
  for (const f of met.fog) {
    const c = P(f);
    const r = f.r / scale;
    area(ctx, c, r, 'rgba(190,200,205,0.16)', 'rgba(200,210,215,0.45)', [2, 2]);
    forecast(ctx, c, P({ x: f.x + met.wind.x * FOG_SPEED * AHEAD_S, y: f.y + met.wind.y * FOG_SPEED * AHEAD_S }), r, 'rgba(200,210,215,0.3)');
    label(ctx, c, r, 'NEBEL', 'rgba(215,222,226,0.8)');
  }
  for (const s of met.squalls) {
    const c = P(s);
    const r = s.r / scale;
    area(ctx, c, r, 'rgba(80,130,165,0.18)', 'rgba(110,165,200,0.5)', [6, 3]);
    forecast(ctx, c, P({ x: s.x + met.wind.x * SQUALL_SPEED * AHEAD_S, y: s.y + met.wind.y * SQUALL_SPEED * AHEAD_S }), r, 'rgba(110,165,200,0.3)');
    label(ctx, c, r, 'SCHAUER', 'rgba(140,190,220,0.85)');
  }
  ctx.setLineDash([]);
  for (const b of met.bergs) {
    const c = P(b);
    const k = Math.max(4, b.r / scale);
    ctx.fillStyle = 'rgba(230,242,248,0.9)';
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - k);
    ctx.lineTo(c.x + k, c.y + k * 0.7);
    ctx.lineTo(c.x - k, c.y + k * 0.7);
    ctx.closePath();
    ctx.fill();
    if (scale < 40) ctx.fillText('EISBERG', c.x, c.y + k + 11);
  }
  ctx.restore();
}
