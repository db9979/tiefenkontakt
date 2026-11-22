import type { PlaneView, Snapshot } from '@tk/shared';

/**
 * Air contacts on canvases (radar scope, plot): NATO-style air symbols – the upper half of
 * the frame (friend: arc, hostile: chevron, neutral: open box, unknown: arc of lobes) – with
 * a speed leader and the height. Aircraft heard only by ESM get a bearing strobe.
 */

const COLORS = { friend: '#85b7eb', hostile: '#f09595', neutral: '#9fe1cb', unknown: '#fac775' } as const;
const NAME: Record<PlaneView['kind'], string> = { airliner: 'VERKEHR', light: 'KLEINFLZ', recon: 'AUFKL', mpa: 'SEEAUFKL', helo: 'HUBSCHR' };

export function airSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, side: PlaneView['side'], r = 7): void {
  ctx.beginPath();
  if (side === 'friend') ctx.arc(x, y + r * 0.3, r, Math.PI, 0);
  else if (side === 'hostile') {
    ctx.moveTo(x - r, y + r * 0.4);
    ctx.lineTo(x, y - r * 0.8);
    ctx.lineTo(x + r, y + r * 0.4);
  } else if (side === 'neutral') {
    ctx.moveTo(x - r, y + r * 0.4);
    ctx.lineTo(x - r, y - r * 0.6);
    ctx.lineTo(x + r, y - r * 0.6);
    ctx.lineTo(x + r, y + r * 0.4);
  } else {
    for (const dx of [-r * 0.55, 0, r * 0.55]) {
      ctx.moveTo(x + dx + r * 0.45, y);
      ctx.arc(x + dx, y, r * 0.45, 0, Math.PI, true);
    }
  }
  ctx.stroke();
}

/**
 * Draw the aircraft of a snapshot. toScreen maps world metres to canvas pixels (undefined =
 * off screen); origin is the own position on the canvas for ESM strobes of length len.
 */
export function drawAir(
  ctx: CanvasRenderingContext2D, s: Snapshot, toScreen: (x: number, y: number) => { x: number; y: number } | undefined,
  origin: { x: number; y: number }, len: number, only?: (p: PlaneView) => boolean,
): void {
  ctx.save();
  ctx.lineWidth = 1.3;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  for (const p of s.planes ?? []) {
    if (only && !only(p)) continue;
    const col = COLORS[p.side];
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    if (p.x === undefined || p.y === undefined) {
      // ESM only: a dashed strobe on the bearing with a plane marker at the end
      const a = ((p.bearing - 90) * Math.PI) / 180;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(origin.x + Math.cos(a) * len, origin.y + Math.sin(a) * len);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`✈ RADAR ${String(Math.round(p.bearing)).padStart(3, '0')}`, origin.x + Math.cos(a) * len * 0.82 + 4, origin.y + Math.sin(a) * len * 0.82);
      continue;
    }
    const q = toScreen(p.x, p.y);
    if (!q) continue;
    airSymbol(ctx, q.x, q.y, p.side);
    if (p.heading !== undefined && (p.speedKn ?? 0) > 5) {
      const a = ((p.heading - 90) * Math.PI) / 180;
      const l = Math.min(26, 6 + (p.speedKn ?? 0) / 25);
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x + Math.cos(a) * l, q.y + Math.sin(a) * l);
      ctx.stroke();
    }
    const alt = p.alt !== undefined ? (p.alt >= 1000 ? `${(p.alt / 1000).toFixed(1).replace('.', ',')} KM` : `${Math.round(p.alt / 10) * 10} M`) : '';
    ctx.fillText(`${NAME[p.kind]} ${alt}`, q.x + 9, q.y - 6);
  }
  ctx.restore();
}
