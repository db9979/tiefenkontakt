import { CLASSES, type Snapshot, type Vec2 } from '@tk/shared';
import { chartLabel } from './canvas-text.js';
import { COL } from './format.js';
import { moverNow } from './smooth.js';
import { screenDir } from './chart-frame.js';
import { drawSymbol, drawWake, type Affiliation } from './symbols.js';
import { trueDeg } from '../north.js';

/** APP-6 colours by affiliation (F5): friend blue, hostile red, unknown amber, neutral green (as the air symbols). */
export const AFF_COL: Record<Affiliation, string> = { friend: COL.blue, hostile: COL.red, unknown: COL.amber, neutral: COL.g2 };

/**
 * Position error in one unit everywhere (S20): metres below a kilometre (to 10 m), else
 * kilometres with one decimal, as the navigation panel writes it.
 */
export function navErrorText(m: number): string {
  return m < 1000 ? `±${Math.round(m / 10) * 10} M` : `±${(m / 1000).toFixed(1).replace('.', ',')} KM`;
}

/** Dead-reckoning uncertainty round the own boat since the last fix (radius in px and m). */
export function drawNavError(ctx: CanvasRenderingContext2D, o: Vec2, rPx: number, rM: number): void {
  if (rPx < 6) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(250,199,117,0.55)';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(o.x, o.y, rPx, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(250,199,117,0.8)';
  // On the circle up and right; the label pass moves it off the ship symbol and other labels
  chartLabel(ctx, `KOPPELORT ${navErrorText(rM)}`, o.x + rPx * 0.72, o.y - rPx * 0.72, rPx * 1.44);
  ctx.restore();
}

/** Selection mark round a symbol: a light dashed ring (amber is taken by the unknown affiliation). */
export function selRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.strokeStyle = '#e8f4ef';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 2]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** Own and allied ships from the datalink and radio reports (merchants only on the convoy charts). */
export function drawFriendlies(ctx: CanvasRenderingContext2D, s: Snapshot, P: (p: Vec2) => Vec2, showConvoy: boolean): void {
  for (const f of s.friendlies) {
    if (f.cls === 'merchant' && !showConvoy) continue;
    // Live datalink positions glide between updates; old radio reports stay where reported
    const live = f.alive && s.time - f.reportedAt < 3;
    const p = P(live ? moverNow(f, f.reportedAt) : f);
    ctx.fillStyle = f.alive ? COL.blue : COL.dim;
    ctx.strokeStyle = ctx.fillStyle;
    if (live) drawWake(ctx, p.x, p.y, trueDeg(f.heading), f.speedKn);
    if (f.cls === 'merchant') {
      // APP-6 friendly surface frame (circle) with a short course leader; merchants smaller than warships
      drawSymbol(ctx, p.x, p.y, 'friend', 'surface', 4, true);
      const hv = screenDir(f.heading);
      ctx.beginPath(); ctx.moveTo(p.x + hv.x * 4, p.y + hv.y * 4); ctx.lineTo(p.x + hv.x * 10, p.y + hv.y * 10); ctx.stroke();
    } else {
      drawSymbol(ctx, p.x, p.y, 'friend', CLASSES[f.cls].submarine ? 'subsurface' : 'surface', 6);
      const hv = screenDir(f.heading);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + hv.x * 14, p.y + hv.y * 14); ctx.stroke();
      const age = s.time - f.reportedAt;
      // Datalink reports are 3–15 s old: an age only once it says something ("−0 MIN" read as a fault)
      ctx.fillText(age >= 30 ? `${f.name} (−${Math.max(1, Math.round(age / 60))} MIN)` : f.name, p.x + 8, p.y + 4);
    }
  }
}
