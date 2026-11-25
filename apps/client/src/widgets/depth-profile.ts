import { CLASSES, PERISCOPE_DEPTH, batteryChargePctH, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { COL, clock, fitCanvas } from './format.js';

/**
 * Battery figures for a submarine: charge in %, and either the charging rate on the snorkel,
 * the AIP plant at a creep, or "Reichweite bei dieser Fahrt" (time and distance until the
 * battery is flat at the present speed). Undefined for a nuclear boat.
 */
export function batteryInfo(o: Snapshot['own']): { pct: number; charging: boolean; range: string; short: boolean } | undefined {
  const spec = CLASSES[o.cls];
  if (!spec.battery || o.battery === undefined) return undefined;
  const pct = (100 * o.battery) / spec.battery.capacityKnH;
  const charging = o.depth <= 0.5 || (o.snorkel && o.depth <= PERISCOPE_DEPTH + 0.5 && (o.snorkelExt ?? 1) >= 1);
  const range = charging
    ? `LÄDT ${Math.round(batteryChargePctH(o.speedKn))} %/H`
    : o.batteryEnduranceS === undefined ? 'AIP · UNBEGRENZT'
    : `${clock(o.batteryEnduranceS)} · ${((o.batteryEnduranceS / 3600) * o.speedKn).toFixed(0)} SM`;
  return { pct, charging, range, short: !charging && (o.batteryEnduranceS ?? Infinity) < 3600 };
}

/** Depth of a depth button ('layer-'/'layer+' need the measured layer). */
export function depthOf(v: string, layer: number | undefined, maxDepth: number): number | undefined {
  if (v === 'layer-') return layer === undefined ? undefined : Math.max(30, layer - 40);
  if (v === 'layer+') return layer === undefined ? undefined : layer + 30;
  return v === 'max' ? maxDepth * 0.9 : Number(v);
}

/**
 * Depth profile (the old diving station's display): the last 10 minutes of depth against
 * the layer, the bottom and periscope depth; a click sets the ordered depth.
 */
export class DepthProfile {
  private hist: { t: number; d: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    canvas.style.cursor = 'ns-resize';
    canvas.title = 'Klicken setzt die befohlene Tiefe';
    canvas.onmousedown = (e) => {
      const s = store.snap;
      if (!s) return;
      const r = canvas.getBoundingClientRect();
      const maxD = CLASSES[s.own.cls].maxDepth;
      const d = ((e.clientY - r.top - 14) / (r.height - 28)) * maxD;
      net.send({ t: 'order', depth: Math.round(Math.min(maxD, Math.max(0, d)) / 5) * 5 });
    };
  }

  /** Every snapshot, shown or not: a sample every 2 s, 10 minutes kept. */
  collect(s: Snapshot): void {
    const last = this.hist[this.hist.length - 1];
    if (!last || s.time - last.t >= 2) this.hist.push({ t: s.time, d: s.own.depth });
    if (this.hist.length > 300) this.hist.shift();
  }

  draw(H: number): void {
    const s = store.snap;
    const c = this.canvas;
    const ctx = fitCanvas(c, H);
    const w = c.clientWidth;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, H);
    if (!s) return;
    const maxD = CLASSES[s.own.cls].maxDepth;
    const Y = (d: number) => 14 + (d / maxD) * (H - 28);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = COL.dim;
    ctx.strokeStyle = COL.grid;
    const step = H < 220 ? 100 : 50;
    for (let d = 0; d <= maxD; d += step) {
      ctx.beginPath(); ctx.moveTo(40, Y(d)); ctx.lineTo(w, Y(d)); ctx.stroke();
      ctx.fillText(`${d}`, 4, Y(d) + 4);
    }
    const layer = s.env.layerDepth;
    if (layer !== undefined) {
      ctx.fillStyle = 'rgba(250,199,117,0.18)';
      ctx.fillRect(40, Y(layer) - 4, w - 40, 8);
      ctx.fillStyle = COL.amber;
      ctx.fillText(`SPRUNGSCHICHT ${layer} M`, w - 170, Y(layer) - 8);
    } else {
      ctx.fillStyle = COL.dim;
      ctx.fillText('SPRUNGSCHICHT UNBEKANNT', 46, H - 6);
    }
    const bottom = s.env.bottom;
    if (bottom !== undefined && bottom < maxD) {
      ctx.fillStyle = 'rgba(120, 96, 60, 0.35)';
      ctx.fillRect(40, Y(bottom), w - 40, H - Y(bottom));
      ctx.fillStyle = COL.amber;
      ctx.fillText(`MEERESGRUND ${bottom} M`, w - 170, Y(bottom) + 14);
    }
    ctx.strokeStyle = COL.blue;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(40, Y(PERISCOPE_DEPTH)); ctx.lineTo(w, Y(PERISCOPE_DEPTH)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.blue;
    ctx.fillText('SEHROHRTIEFE', w - 170, Y(PERISCOPE_DEPTH) - 4);
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const span = 600;
    this.hist.forEach((p, i) => {
      const x = 40 + ((p.t - (s.time - span)) / span) * (w - 60);
      if (i) ctx.lineTo(x, Y(p.d));
      else ctx.moveTo(x, Y(p.d));
    });
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(w - 20, Y(s.own.depth), 5, 0, 7); ctx.fill();
    ctx.strokeStyle = COL.amber;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(w - 60, Y(s.own.order.depth)); ctx.lineTo(w, Y(s.own.order.depth)); ctx.stroke();
    ctx.setLineDash([]);
  }
}
