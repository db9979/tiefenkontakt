import { angleDiff, isDangerEmitter, type Snapshot } from '@tk/shared';
import { trueDeg } from '../north.js';
import { t } from '../i18n/index.js';
import { COL, fitCanvas, FONT } from './format.js';

/** One strobe: game-frame bearing, strength 0..2 (unknown: middle), red for aircraft and fire-control radars. */
interface Strobe {
  b: number;
  lvl: number;
  danger: boolean;
}

/**
 * The radar warner's strobe rose beside the periscope (U2): north up, the own heading as a
 * line, one strobe per fresh intercept (the same set as the text rows), longer when stronger;
 * amber, red for a radar that means an aircraft or a fire-control lock. With the mast down it
 * stays empty and says so.
 */
export function esmStrobes(s: Snapshot): Strobe[] {
  const fresh = s.alerts.filter((a) => a.kind === 'esm' && s.time - a.time < 10).sort((a, b) => b.time - a.time);
  const out: (Strobe & { id?: string })[] = [];
  for (const a of fresh) {
    const b = a.bearing ?? 0;
    if (out.some((k) => k.id === a.emitter && Math.abs(angleDiff(k.b, b)) < 10)) continue;
    out.push({ b, lvl: a.esmLvl ?? 1, danger: !!a.emitter && isDangerEmitter(a.emitter), id: a.emitter });
  }
  for (const p of s.planes ?? []) if (p.via.includes('esm')) out.push({ b: p.bearing, lvl: p.esmLvl ?? 1, danger: true });
  return out;
}

export function drawEsmRose(canvas: HTMLCanvasElement, H: number, s: Snapshot | undefined, listening: boolean): void {
  const ctx = fitCanvas(canvas, H);
  const w = canvas.clientWidth;
  ctx.clearRect(0, 0, w, H);
  const cx = w / 2;
  const cy = H / 2;
  // S30: the letters stand inside the dark disc (the rose stays dark in the light theme, so
  // letters outside it were dim grey on white)
  const R = Math.min(w, H) / 2 - 3;
  ctx.fillStyle = COL.bg;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 1;
  for (const f of [1, 0.66, 0.33]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Ticks every 30°, cardinal letters just inside the ring
  const at = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  };
  ctx.strokeStyle = COL.dim;
  for (let d = 0; d < 360; d += 30) {
    const [x0, y0] = at(d, R - 5);
    const [x1, y1] = at(d, R);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.font = FONT.tick;
  ctx.fillStyle = COL.g2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [d, l] of [[0, 'N'], [90, 'O'], [180, 'S'], [270, 'W']] as const) {
    const [x, y] = at(d, R - 13);
    ctx.fillText(t(l), x, y);
  }
  if (!s) return;
  // Own heading
  const [hx, hy] = at(trueDeg(s.own.heading), R * 0.9);
  ctx.strokeStyle = COL.g;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.setLineDash([]);
  if (!listening) {
    // On a plate of the scope's own background: the dashed heading line must not cross the text
    const label = t('MAST UNTEN');
    const tw = ctx.measureText(label).width;
    const ty = cy + R * 0.45;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(cx - tw / 2 - 4, ty - 8, tw + 8, 16);
    ctx.fillStyle = COL.dim;
    ctx.fillText(label, cx, ty);
    ctx.textBaseline = 'alphabetic';
    return;
  }
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const st of esmStrobes(s)) {
    const len = R * (0.45 + 0.25 * Math.max(0, Math.min(2, st.lvl)));
    const [x, y] = at(trueDeg(st.b), len);
    ctx.strokeStyle = st.danger ? COL.red : COL.amber;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.textBaseline = 'alphabetic';
}
