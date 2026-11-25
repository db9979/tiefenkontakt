import { FOG_SPEED, SQUALL_SPEED, type MetCells, type Vec2 } from '@tk/shared';
import { FONT } from './format.js';

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
  const y = p.y - Math.min(r * 0.6, 40);
  // Not under the chart's tool buttons (top row, right column), where it would peek out half hidden
  const cv = ctx.canvas as HTMLCanvasElement;
  const w = cv.clientWidth || cv.width;
  const tw = ctx.measureText(text).width;
  if (y < 44 || p.x + tw / 2 > w - 46) return;
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, y);
}

/**
 * Overlapping cells of one kind form a cluster; it gets one label, at its largest cell
 * (indices into the list; the rest stay unlabelled).
 */
export function labelled(cells: readonly { x: number; y: number; r: number }[]): Set<number> {
  const parent = cells.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i]!, b = cells[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) parent[root(j)] = root(i);
    }
  }
  const best = new Map<number, number>();
  cells.forEach((c, i) => {
    const k = root(i);
    const cur = best.get(k);
    if (cur === undefined || c.r > cells[cur]!.r) best.set(k, i);
  });
  return new Set(best.values());
}

/** Area overlays at half strength: the picture underneath (contacts, tracks) stays in front. */
const AREA_ALPHA = 0.5;

/** Draw the met cells; P maps world to screen, scale is meters per pixel. */
export function drawMet(ctx: CanvasRenderingContext2D, met: MetCells | undefined, P: (p: Vec2) => Vec2, scale: number): void {
  if (!met) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = FONT.label;
  ctx.textAlign = 'center';
  const labels: (() => void)[] = [];
  ctx.globalAlpha = AREA_ALPHA;
  const iceL = labelled(met.floes);
  met.floes.forEach((f, i) => {
    const c = P(f);
    const r = f.r / scale;
    area(ctx, c, r, `rgba(215,232,240,${0.05 + 0.12 * f.cover})`, 'rgba(215,232,240,0.35)', [1, 3]);
    if (iceL.has(i)) labels.push(() => label(ctx, c, r, `EIS · ${Math.round(f.cover * 10)}/10`, 'rgba(215,232,240,0.7)'));
  });
  const fogL = labelled(met.fog);
  met.fog.forEach((f, i) => {
    const c = P(f);
    const r = f.r / scale;
    area(ctx, c, r, 'rgba(190,200,205,0.16)', 'rgba(200,210,215,0.45)', [2, 2]);
    forecast(ctx, c, P({ x: f.x + met.wind.x * FOG_SPEED * AHEAD_S, y: f.y + met.wind.y * FOG_SPEED * AHEAD_S }), r, 'rgba(200,210,215,0.3)');
    if (fogL.has(i)) labels.push(() => label(ctx, c, r, 'NEBEL', 'rgba(215,222,226,0.8)'));
  });
  const sqL = labelled(met.squalls);
  met.squalls.forEach((q, i) => {
    const c = P(q);
    const r = q.r / scale;
    area(ctx, c, r, 'rgba(80,130,165,0.18)', 'rgba(110,165,200,0.5)', [6, 3]);
    forecast(ctx, c, P({ x: q.x + met.wind.x * SQUALL_SPEED * AHEAD_S, y: q.y + met.wind.y * SQUALL_SPEED * AHEAD_S }), r, 'rgba(110,165,200,0.3)');
    if (sqL.has(i)) labels.push(() => label(ctx, c, r, 'SCHAUER', 'rgba(140,190,220,0.85)'));
  });
  // Labels a little stronger than the areas, so the name still reads
  ctx.globalAlpha = 0.75;
  for (const l of labels) l();
  ctx.globalAlpha = 1;
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
