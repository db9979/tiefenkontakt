import { angleDiff, type Snapshot } from '@tk/shared';
import { COL, deg3, fitCanvas } from './format.js';

const BINS = 360;
const ROWS = 240;

interface Line {
  b: number;
  amp: number;
  width: number;
}

/**
 * Broadband waterfall: bearing (x) over time (y, newest on top).
 * Built purely from the player's own contacts plus cosmetic noise.
 */
export class Waterfall {
  private buf = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  private lastT = -1;

  constructor(private sensors: readonly string[] = ['hull', 'towed', 'intercept', 'active']) {
    this.buf.width = BINS;
    this.buf.height = ROWS;
    this.bctx = this.buf.getContext('2d')!;
    this.bctx.fillStyle = COL.bg;
    this.bctx.fillRect(0, 0, BINS, ROWS);
  }

  /** Append a row per new second of sim time. */
  push(s: Snapshot, baffleHalf = 30): void {
    if (Math.floor(s.time) === this.lastT) return;
    this.lastT = Math.floor(s.time);
    const lines: Line[] = [];
    for (const c of s.contacts) {
      if (c.via !== 'own' || s.time - c.lastSeen > 2) continue;
      if (!c.sensors.some((x) => this.sensors.includes(x))) continue;
      const amp = Math.min(1, 0.25 + c.se / 18);
      lines.push({ b: c.bearing, amp, width: 1 + 4 * Math.exp(-c.se / 6) });
      if (c.bearingAlt !== undefined) lines.push({ b: c.bearingAlt, amp, width: 1 + 4 * Math.exp(-c.se / 6) });
    }
    const row = this.bctx.createImageData(BINS, 1);
    const stern = s.own.heading + 180;
    const selfNoise = Math.min(0.35, Math.max(0, (s.own.noiseDb - 110) / 120));
    for (let x = 0; x < BINS; x++) {
      let v = 0.1 + Math.random() * 0.2 + selfNoise * Math.random();
      for (const l of lines) {
        const d = Math.abs(angleDiff(l.b, x));
        v += l.amp * Math.exp((-d * d) / (2 * l.width * l.width)) * (0.6 + 0.4 * Math.random());
      }
      if (Math.abs(angleDiff(stern, x)) < baffleHalf) v *= 0.3;
      v = Math.min(1, v);
      const i = x * 4;
      row.data[i] = 8 + v * 85;
      row.data[i + 1] = 12 + v * 190;
      row.data[i + 2] = 11 + v * 150;
      row.data[i + 3] = 255;
    }
    this.bctx.drawImage(this.buf, 0, 1);
    this.bctx.putImageData(row, 0, 0);
  }

  draw(canvas: HTMLCanvasElement, height: number, s: Snapshot | undefined, selected?: string): void {
    const ctx = fitCanvas(canvas, height);
    const w = canvas.clientWidth;
    const pl = 36;
    const pt = 18;
    const pw = w - pl - 8;
    const ph = height - pt - 18;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buf, pl, pt, pw, ph);
    ctx.strokeStyle = '#2c3a36';
    ctx.strokeRect(pl + 0.5, pt + 0.5, pw, ph);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = COL.g;
    ctx.textAlign = 'center';
    for (let a = 0; a <= 360; a += 30) {
      const x = pl + (a / 360) * pw;
      ctx.fillText(deg3(a), x, 12);
      ctx.fillRect(x, pt - 3, 1, 3);
    }
    ctx.textAlign = 'right';
    ctx.fillText('0', pl - 4, pt + 10);
    ctx.fillText('−2 MIN', pl - 4, pt + ph / 2);
    ctx.fillText('−4', pl - 4, pt + ph);
    if (!s) return;
    const stern = (s.own.heading + 180) % 360;
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'center';
    ctx.fillText('TOTER WINKEL', pl + (stern / 360) * pw, pt + ph + 13);
    const hx = pl + (s.own.heading / 360) * pw;
    ctx.fillStyle = COL.blue;
    ctx.fillText('▼', hx, pt + 9);
    for (const c of s.contacts) {
      if (c.via !== 'own' || s.time - c.lastSeen > 5) continue;
      const x = pl + (c.bearing / 360) * pw;
      const sel = c.label === selected;
      ctx.fillStyle = sel ? COL.amber : COL.g2;
      ctx.fillText(c.label, x, pt + ph + 13);
      if (sel) {
        ctx.strokeStyle = COL.amber;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, pt);
        ctx.lineTo(x, pt + ph);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /** Bearing under a canvas x coordinate (for click-to-select). */
  bearingAt(canvas: HTMLCanvasElement, clientX: number): number {
    const r = canvas.getBoundingClientRect();
    const pw = r.width - 36 - 8;
    return (((clientX - r.left - 36) / pw) * 360 + 360) % 360;
  }
}
