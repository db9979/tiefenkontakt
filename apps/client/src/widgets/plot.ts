import { NM, headingVec, ownPosAt, targetPosAt, type Snapshot, type Vec2 } from '@tk/shared';
import { store } from '../store.js';
import { COL, fitCanvas } from './format.js';

export interface PlotOptions {
  bearingLines: boolean;
  showConvoy: boolean;
  esmLines: boolean;
}

/** North-up tactical plot centered on own ship. Wheel zooms, drag pans. */
export class Plot {
  scale = 40; // m per px
  pan: Vec2 = { x: 0, y: 0 };
  private drag?: { x: number; y: number; px: number; py: number };

  constructor(private canvas: HTMLCanvasElement, private opts: PlotOptions) {
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scale = Math.min(400, Math.max(5, this.scale * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
    }, { passive: false });
    canvas.addEventListener('mousedown', (e) => (this.drag = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y }));
    window.addEventListener('mouseup', () => (this.drag = undefined));
    canvas.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      this.pan.x = this.drag.px - (e.clientX - this.drag.x) * this.scale;
      this.pan.y = this.drag.py + (e.clientY - this.drag.y) * this.scale;
    });
    canvas.addEventListener('dblclick', () => (this.pan = { x: 0, y: 0 }));
  }

  draw(height: number): void {
    const s = store.snap;
    const ctx = fitCanvas(this.canvas, height);
    const w = this.canvas.clientWidth;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, height);
    if (!s) return;
    const cx = s.own.x + this.pan.x;
    const cy = s.own.y + this.pan.y;
    const P = (p: Vec2) => ({ x: w / 2 + (p.x - cx) / this.scale, y: height / 2 - (p.y - cy) / this.scale });

    // Grid in nautical miles
    const step = this.scale > 100 ? 5 * NM : this.scale > 30 ? NM * 2 : NM;
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    const x0 = Math.floor((cx - (w / 2) * this.scale) / step) * step;
    const y0 = Math.floor((cy - (height / 2) * this.scale) / step) * step;
    for (let gx = x0; gx < cx + (w / 2) * this.scale; gx += step) {
      const p = P({ x: gx, y: 0 });
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, height); ctx.stroke();
    }
    for (let gy = y0; gy < cy + (height / 2) * this.scale; gy += step) {
      const p = P({ x: 0, y: gy });
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(w, p.y); ctx.stroke();
    }
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'left';
    ctx.fillText(`RASTER ${(step / NM).toFixed(0)} SM`, 8, height - 8);

    // Own track
    ctx.strokeStyle = 'rgba(133,183,235,0.5)';
    ctx.beginPath();
    store.ownTrack.forEach((f, i) => {
      const p = P(f);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.stroke();

    this.drawContacts(ctx, s, P, w, height);
    this.drawFriendlies(ctx, s, P);

    for (const t of s.torpedoes) {
      const p = P(t);
      ctx.fillStyle = COL.red;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      const v = headingVec(t.heading);
      ctx.strokeStyle = COL.red;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + v.x * 14, p.y - v.y * 14); ctx.stroke();
      ctx.fillText(`${t.id}${t.homing ? ' ZIEL' : ''}`, p.x + 6, p.y - 6);
    }

    const o = P(s.own);
    const v = headingVec(s.own.heading);
    ctx.fillStyle = COL.blue;
    ctx.beginPath(); ctx.arc(o.x, o.y, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + v.x * 26, o.y - v.y * 26); ctx.stroke();
    ctx.lineWidth = 1;
  }

  private drawContacts(ctx: CanvasRenderingContext2D, s: Snapshot, P: (p: Vec2) => Vec2, w: number, hgt: number): void {
    const far = Math.hypot(w, hgt) * this.scale;
    for (const c of s.contacts) {
      const sel = c.label === store.selected;
      const stale = s.time - c.lastSeen > 10;
      const color = c.label.startsWith('E') ? COL.red : sel ? COL.amber : COL.g;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      const isEsm = c.sensors.includes('esm') && c.sensors.length === 1;
      if ((this.opts.bearingLines && c.via === 'own') || (isEsm && this.opts.esmLines)) {
        const hist = sel ? c.history.filter((_, i) => i % 6 === 0) : c.history.slice(-1);
        for (const hs of hist) {
          const origin = ownPosAt(store.ownTrack, hs.t) ?? s.own;
          for (const b of hs.alt !== undefined ? [hs.b, hs.alt] : [hs.b]) {
            const v = headingVec(b);
            const a = P(origin);
            const end = P({ x: origin.x + v.x * far, y: origin.y + v.y * far });
            ctx.globalAlpha = stale ? 0.25 : sel ? 0.5 : 0.7;
            ctx.setLineDash(isEsm ? [6, 4] : [4, 3]);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
          }
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (c.range !== undefined && c.rangeAt !== undefined && s.time - c.rangeAt < 60) {
        const origin = ownPosAt(store.ownTrack, c.rangeAt) ?? s.own;
        const v = headingVec(c.bearing);
        const p = P({ x: origin.x + v.x * c.range, y: origin.y + v.y * c.range });
        ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
        ctx.fillText(c.label, p.x + 7, p.y - 6);
      }
      const sol = store.solutions.get(c.label);
      if (sol) {
        const p = P(targetPosAt(sol, s.time));
        const v = headingVec(sol.course);
        ctx.strokeStyle = COL.amber;
        ctx.fillStyle = COL.amber;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + v.x * sol.speedKn * 2, p.y - v.y * sol.speedKn * 2); ctx.stroke();
        ctx.fillText(`${c.label} LSG`, p.x + 8, p.y + 12);
      }
    }
  }

  private drawFriendlies(ctx: CanvasRenderingContext2D, s: Snapshot, P: (p: Vec2) => Vec2): void {
    for (const f of s.friendlies) {
      if (f.cls === 'merchant' && !this.opts.showConvoy) continue;
      const p = P(f);
      ctx.fillStyle = f.alive ? COL.blue : COL.dim;
      ctx.strokeStyle = ctx.fillStyle;
      if (f.cls === 'merchant') ctx.fillRect(p.x - 4, p.y - 2, 8, 4);
      else {
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 5, p.y + 4); ctx.lineTo(p.x - 5, p.y + 4); ctx.closePath(); ctx.stroke();
        const age = s.time - f.reportedAt;
        ctx.fillText(age > 5 ? `${f.name} (−${Math.round(age / 60)} MIN)` : f.name, p.x + 8, p.y + 4);
      }
    }
  }
}
