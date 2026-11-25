import { FONT, LW } from './format.js';

/**
 * Binocular reticle: a mil scale across (10 mil steps, 1 mil = 1 m at 1 km) and a vertical one
 * below the centre, for estimating range from a known mast height or ship length.
 */
export function reticle(ctx: CanvasRenderingContext2D, w: number, hgt: number, fovDeg: number, r: number): void {
  const pxPerMil = (w / fovDeg) * (180 / Math.PI / 1000);
  const cx = w / 2, cy = hgt / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(20,24,22,0.85)';
  ctx.fillStyle = 'rgba(20,24,22,0.85)';
  ctx.lineWidth = LW.bearing;
  ctx.font = FONT.tick;
  ctx.textAlign = 'center';
  const span = Math.min(50, Math.floor((r * 0.85) / pxPerMil / 10) * 10);
  ctx.beginPath();
  ctx.moveTo(cx - span * pxPerMil, cy);
  ctx.lineTo(cx + span * pxPerMil, cy);
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx, cy + span * 0.6 * pxPerMil);
  for (let m = -span; m <= span; m += 5) {
    const x = cx + m * pxPerMil;
    const big = m % 10 === 0;
    ctx.moveTo(x, cy - (big ? 6 : 3));
    ctx.lineTo(x, cy);
  }
  for (let m = 5; m <= span * 0.6; m += 5) {
    const y = cy + m * pxPerMil;
    ctx.moveTo(cx - (m % 10 === 0 ? 5 : 3), y);
    ctx.lineTo(cx + (m % 10 === 0 ? 5 : 3), y);
  }
  ctx.stroke();
  for (let m = 10; m <= span; m += 10) for (const sx of [-1, 1]) ctx.fillText(String(m), cx + sx * m * pxPerMil, cy - 9);
  ctx.restore();
}
