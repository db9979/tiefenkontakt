import { bearing, type PlaneView, type Snapshot } from '@tk/shared';
import { drawMines, drawMissiles, drawSsm } from './airdef-symbols.js';
import { northOff, trueDeg } from '../north.js';
import { FONT, LW } from './format.js';
import { chartLabel } from './canvas-text.js';

/**
 * Air contacts on canvases (radar scope, plot): NATO-style air symbols – the upper half of
 * the frame (friend: arc, hostile: chevron, neutral: open box, unknown: arc of lobes) – with
 * a speed leader and the height. Aircraft heard only by ESM get a bearing strobe.
 */

const COLORS = { friend: '#85b7eb', hostile: '#f09595', neutral: '#9fe1cb', unknown: '#fac775' } as const;
const NAME: Record<PlaneView['kind'], string> = { airliner: 'VERKEHR', light: 'KLEINFLZ', recon: 'AUFKL', mpa: 'SEEAUFKL', helo: 'HUBSCHR.' };

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

/** APP-6 icon inside the air frame: a bow tie for rotary wing, a small wing for fixed wing. */
export function airIcon(ctx: CanvasRenderingContext2D, x: number, y: number, rotary: boolean, r = 7): void {
  const cy = y - r * 0.15;
  ctx.beginPath();
  if (rotary) {
    const w = r * 0.55, h = r * 0.32;
    ctx.moveTo(x - w, cy - h); ctx.lineTo(x + w, cy + h); ctx.lineTo(x + w, cy - h); ctx.lineTo(x - w, cy + h); ctx.closePath();
    ctx.fill();
  } else {
    ctx.moveTo(x - r * 0.6, cy); ctx.lineTo(x + r * 0.6, cy);
    ctx.moveTo(x, cy - r * 0.35); ctx.lineTo(x, cy + r * 0.3);
    ctx.stroke();
  }
}

/**
 * Draw the aircraft of a snapshot. toScreen maps world metres to canvas pixels (undefined =
 * off screen) on a north-up canvas (headings and bearings are turned by northOff()); origin is the own position on the canvas for ESM strobes of length len.
 */
export function drawAir(
  ctx: CanvasRenderingContext2D, s: Snapshot, toScreen: (x: number, y: number) => { x: number; y: number } | undefined,
  origin: { x: number; y: number }, len: number, only?: (p: PlaneView) => boolean,
  unit: 'km' | 'sm' = 'sm',
): void {
  ctx.save();
  ctx.lineWidth = LW.bearing;
  ctx.font = FONT.label;
  ctx.textAlign = 'left';
  for (const p of s.planes ?? []) {
    if (only && !only(p)) continue;
    const col = COLORS[p.side];
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    if (p.x === undefined || p.y === undefined) {
      // ESM only: a dashed strobe on the bearing with a plane marker at the end
      const a = ((p.bearing + northOff() - 90) * Math.PI) / 180;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(origin.x + Math.cos(a) * len, origin.y + Math.sin(a) * len);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`✈ ${p.emitter ?? 'RADAR'} ${brg(p.bearing)}`, origin.x + Math.cos(a) * len * 0.82 + 4, origin.y + Math.sin(a) * len * 0.82);
      continue;
    }
    if (p.rough) {
      // By eye only: the bearing is good, the range a guess (±25 %), the height only low or high
      const err = 1 + 0.5 * (hash(p.id) - 0.5);
      const ex = s.own.x + (p.x - s.own.x) * err, ey = s.own.y + (p.y - s.own.y) * err;
      const q = toScreen(ex, ey);
      if (!q) continue;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.setLineDash([]);
      airSymbol(ctx, q.x, q.y, p.side);
      airIcon(ctx, q.x, q.y, p.kind === 'helo');
      // In the display's own unit (radar scope: SM, chart: KM), with the bearing; height only low or high
      const d = Math.hypot(ex - s.own.x, ey - s.own.y) / (unit === 'sm' ? 1852 : 1000);
      const br = brg(bearing(s.own, { x: p.x, y: p.y }));
      airLabel(ctx, `${NAME[p.kind]} ${br} ~${d < 10 ? d.toFixed(1).replace('.', ',') : Math.round(d)} ${unit === 'sm' ? 'SM' : 'KM'} · ${(p.alt ?? 0) > 1500 ? 'HOCH' : 'NIEDRIG'}`, q.x + 9, q.y - 6);
      continue;
    }
    const q = toScreen(p.x, p.y);
    if (!q) continue;
    airSymbol(ctx, q.x, q.y, p.side);
    airIcon(ctx, q.x, q.y, p.kind === 'helo');
    if (p.heading !== undefined && (p.speedKn ?? 0) > 5) {
      const a = ((p.heading + northOff() - 90) * Math.PI) / 180;
      const l = Math.min(26, 6 + (p.speedKn ?? 0) / 25);
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x + Math.cos(a) * l, q.y + Math.sin(a) * l);
      ctx.stroke();
    }
    // Height in metres with its word (F19/F34: "10,3 KM" read as a range on the radar scope)
    airLabel(ctx, p.alt !== undefined ? `${NAME[p.kind]} ${altText(p.alt)} HÖHE` : NAME[p.kind], q.x + 9, q.y - 6);
  }
  ctx.restore();
  // Missiles in flight everywhere; mines only on the plot (not the radar scope)
  drawMissiles(ctx, s, toScreen);
  drawSsm(ctx, s, toScreen);
  if (!only) drawMines(ctx, s, toScreen);
}

/**
 * An aircraft's label: on a semi-opaque plate (it crosses depth labels and contours on the chart)
 * and kept inside the canvas (it flips to the left of the symbol at the right edge).
 */
function airLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  chartLabel(ctx, text, x, y, 18);
}

/** True bearing of a game-frame direction: three digits and the degree sign. */
const brg = (game: number): string => `${String(Math.round(((trueDeg(game) % 360) + 360) % 360) % 360).padStart(3, '0')}°`;

/** Aircraft height: metres, to 10 m low down, to 100 m higher, thousands with a point ("10.300 M"). */
export function altText(m: number): string {
  const r = m < 1000 ? Math.round(m / 10) * 10 : Math.round(m / 100) * 100;
  return `${String(r).replace(/\B(?=(\d{3})+$)/g, '.')} M`;
}

/** A steady number in [0, 1) per aircraft, so the guessed range does not jump every second. */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
