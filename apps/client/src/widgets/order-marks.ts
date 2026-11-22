import type { Snapshot, Vec2 } from '@tk/shared';
import { COL } from './format.js';

/**
 * Plot overlay: areas and sectors from fleet command's FLASH orders (dashed amber circle
 * with the order's short name) and the team datum of the escort hunt (diamond with age).
 */
const SHORT: Record<string, string> = { clear: 'RÄUMEN', search: 'ABSUCHEN' };

export function drawOrderMarks(ctx: CanvasRenderingContext2D, s: Snapshot, P: (p: Vec2) => Vec2, scale: number): void {
  ctx.save();
  for (const o of s.orders ?? []) {
    if (!o.area || o.status !== 'active') continue;
    const p = P(o.area);
    const r = o.area.r / scale;
    ctx.strokeStyle = COL.amber;
    ctx.fillStyle = 'rgba(250,199,117,0.06)';
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.amber;
    const left = Math.max(0, Math.round(o.deadline - s.time));
    ctx.fillText(`FLASH · ${SHORT[o.kind] ?? ''} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, p.x - 40, p.y - r - 6);
  }
  const d = s.hunt?.datum;
  if (d) {
    const p = P(d);
    const age = Math.round(s.time - d.t);
    ctx.strokeStyle = age < 120 ? COL.amber : COL.dim;
    ctx.beginPath(); ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x + 8, p.y); ctx.lineTo(p.x, p.y + 8); ctx.lineTo(p.x - 8, p.y); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText(`DATUM ${Math.floor(age / 60)}:${String(age % 60).padStart(2, '0')}`, p.x + 11, p.y + 4);
  }
  ctx.restore();
}
