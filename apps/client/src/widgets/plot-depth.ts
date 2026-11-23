import { isInkLight } from './ink.js';
import { depthAt, type Snapshot, type Vec2 } from '@tk/shared';

/**
 * The plot's chart background from the (public) seabed: a continuous depth tint, hill shading
 * so banks and slopes read as relief, smooth isobaths (marching squares) with depth labels, and
 * a small legend. The depth grid covers the view plus a margin and is sampled a few rows per
 * frame, so panning, zooming and the own ship's movement never stall the plot; until a new
 * render is complete the last one is drawn, mapped to the current view.
 */

type Seabed = NonNullable<Snapshot['env']['seabed']>;

/** Screen pixels per depth sample. */
const CELL = 4;
/** Margin around the view (fraction of its size) rendered in advance. */
const MARGIN = 0.35;
/** Time budget per frame for sampling (ms). */
const BUDGET_MS = 7;
/** Isobaths (m); the major ones are brighter and labelled. */
const LEVELS = [10, 25, 50, 100, 200, 300, 500, 1000, 2000, 3000];
const MAJOR = new Set([50, 100, 200, 500, 1000, 2000]);
/** Depth tint stops: depth (m) → colour. Land is olive, shoals light, the deep sea near black. */
const STOPS: [number, number, number, number][] = [
  [0, 66, 92, 76], [25, 54, 86, 76], [50, 42, 76, 70], [100, 30, 64, 62], [200, 20, 52, 54],
  [500, 13, 38, 44], [1000, 9, 29, 35], [2000, 6, 20, 26], [4000, 4, 12, 17],
];

interface Render {
  key: string;
  /** World coordinates of the render area's top-left corner and metres per sample. */
  x0: number;
  y0: number;
  step: number;
  cols: number;
  rows: number;
  img: HTMLCanvasElement;
}

interface Job extends Omit<Render, 'img'> {
  spec: Seabed;
  depths: Float32Array;
  row: number;
}

function tint(d: number): [number, number, number] {
  if (d < 0) return [44, 42, 30];
  for (let i = 1; i < STOPS.length; i++) {
    const [z1, r1, g1, b1] = STOPS[i]!;
    if (d <= z1) {
      const [z0, r0, g0, b0] = STOPS[i - 1]!;
      // Interpolate on a log-like scale: the shallow end gets more of the colour range
      const f = (Math.sqrt(d) - Math.sqrt(z0)) / (Math.sqrt(z1) - Math.sqrt(z0));
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  const last = STOPS[STOPS.length - 1]!;
  return [last[1], last[2], last[3]];
}

export class DepthChart {
  private done?: Render;
  private job?: Job;

  draw(ctx: CanvasRenderingContext2D, spec: Snapshot['env']['seabed'], c: Vec2, scale: number, w: number, hgt: number): void {
    if (!spec) return;
    const step = scale * CELL;
    // The render area is anchored on a coarse world grid, so small moves of the view reuse it
    const ax = Math.round(c.x / (w * scale * MARGIN)) * (w * scale * MARGIN);
    const ay = Math.round(c.y / (hgt * scale * MARGIN)) * (hgt * scale * MARGIN);
    const key = `${spec.kind}|${spec.seed}|${spec.bankY ?? ''}|${scale.toFixed(3)}|${ax}|${ay}|${w}|${hgt}|${isInkLight()}`;
    if (this.done?.key !== key && this.job?.key !== key) {
      const spanX = w * scale * (1 + 2 * MARGIN);
      const spanY = hgt * scale * (1 + 2 * MARGIN);
      const cols = Math.ceil(spanX / step) + 1;
      const rows = Math.ceil(spanY / step) + 1;
      this.job = { key, spec, x0: ax - spanX / 2, y0: ay + spanY / 2, step, cols, rows, depths: new Float32Array(cols * rows), row: 0 };
    }
    if (this.job) this.work();
    const r = this.done;
    if (!r) return;
    // Map the render's world rectangle onto the current view (handles pan and zoom while a new one is computed)
    const sx = (r.x0 - c.x) / scale + w / 2;
    const sy = -(r.y0 - c.y) / scale + hgt / 2;
    const sw = (r.cols - 1) * (r.step / scale);
    const sh = (r.rows - 1) * (r.step / scale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(r.img, sx, sy, sw, sh);
    legend(ctx, w, hgt);
  }

  /** Sample rows of the pending render within the frame budget; finish it when complete. */
  private work(): void {
    const j = this.job!;
    const t0 = performance.now();
    while (j.row < j.rows && performance.now() - t0 < BUDGET_MS) {
      const y = j.y0 - j.row * j.step;
      const base = j.row * j.cols;
      for (let i = 0; i < j.cols; i++) j.depths[base + i] = depthAt(j.spec, j.x0 + i * j.step, y);
      j.row++;
    }
    if (j.row < j.rows) return;
    this.done = { key: j.key, x0: j.x0, y0: j.y0, step: j.step, cols: j.cols, rows: j.rows, img: paint(j, this.done?.img) };
    this.job = undefined;
  }
}

/** Tint plus hill shading into the pixel grid, then the isobaths drawn at full resolution on top. */
function paint(j: Job, reuse?: HTMLCanvasElement): HTMLCanvasElement {
  const { cols, rows, depths, step } = j;
  // Shading: slope of the seabed lit from the north-west. Gentle deep-sea slopes are exaggerated
  // more than steep coastal ones, so both show
  const tex = document.createElement('canvas');
  tex.width = cols;
  tex.height = rows;
  const tc = tex.getContext('2d')!;
  const data = tc.createImageData(cols, rows);
  const at = (i: number, k: number) => depths[Math.min(rows - 1, Math.max(0, k)) * cols + Math.min(cols - 1, Math.max(0, i))]!;
  for (let k = 0; k < rows; k++) {
    for (let i = 0; i < cols; i++) {
      const d = at(i, k);
      const gx = (at(i + 1, k) - at(i - 1, k)) / (2 * step);
      const gy = (at(i, k + 1) - at(i, k - 1)) / (2 * step);
      // Depth grows downwards: a slope deepening towards the south-east faces the light
      const light = (gx + gy) * 0.7071;
      const shade = 1 + Math.max(-0.35, Math.min(0.35, Math.sign(light) * Math.sqrt(Math.abs(light)) * 3.2));
      const [r, g, b] = tint(d);
      const p = (k * cols + i) * 4;
      data.data[p] = Math.min(255, r * shade);
      data.data[p + 1] = Math.min(255, g * shade);
      data.data[p + 2] = Math.min(255, b * shade);
      data.data[p + 3] = 255;
    }
  }
  tc.putImageData(data, 0, 0);
  // Output at screen resolution (one sample = CELL px) so the isobaths stay sharp
  const out = reuse ?? document.createElement('canvas');
  out.width = (cols - 1) * CELL;
  out.height = (rows - 1) * CELL;
  const oc = out.getContext('2d')!;
  oc.imageSmoothingEnabled = true;
  oc.drawImage(tex, 0.5, 0.5, cols - 1, rows - 1, 0, 0, out.width, out.height);
  isobaths(oc, depths, cols, rows);
  return out;
}

/** Marching squares with linear interpolation; coastline bright, major isobaths labelled. */
function isobaths(ctx: CanvasRenderingContext2D, depths: Float32Array, cols: number, rows: number): void {
  const levels = [0, ...LEVELS];
  const labels: { x: number; y: number }[] = [];
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const z of levels) {
    const segs: number[] = [];
    for (let k = 0; k < rows - 1; k++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = depths[k * cols + i]! - z;
        const b = depths[k * cols + i + 1]! - z;
        const c = depths[(k + 1) * cols + i + 1]! - z;
        const d = depths[(k + 1) * cols + i]! - z;
        const idx = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        // Edge crossings (in sample units): top, right, bottom, left
        const top = [i + a / (a - b), k];
        const right = [i + 1, k + b / (b - c)];
        const bottom = [i + d / (d - c), k + 1];
        const left = [i, k + a / (a - d)];
        const add = (p: number[], q: number[]) => segs.push(p[0]!, p[1]!, q[0]!, q[1]!);
        switch (idx) {
          case 1: case 14: add(left, bottom); break;
          case 2: case 13: add(bottom, right); break;
          case 3: case 12: add(left, right); break;
          case 4: case 11: add(top, right); break;
          case 5: add(left, top); add(bottom, right); break;
          case 6: case 9: add(top, bottom); break;
          case 7: case 8: add(left, top); break;
          case 10: add(top, right); add(left, bottom); break;
        }
      }
    }
    if (!segs.length) continue;
    const major = MAJOR.has(z);
    ctx.strokeStyle = z === 0 ? 'rgba(170,190,150,0.85)' : major ? 'rgba(130,200,180,0.42)' : 'rgba(110,170,155,0.2)';
    ctx.lineWidth = z === 0 ? 1.4 : major ? 1 : 0.7;
    ctx.beginPath();
    for (let s = 0; s < segs.length; s += 4) {
      ctx.moveTo(segs[s]! * CELL, segs[s + 1]! * CELL);
      ctx.lineTo(segs[s + 2]! * CELL, segs[s + 3]! * CELL);
    }
    ctx.stroke();
    if (!major) continue;
    // Labels only where the view will be (not in the margin rendered in advance), spaced along
    // the line and away from other labels
    const m = MARGIN / (1 + 2 * MARGIN) + 0.03;
    const [x0, x1, y0, y1] = [m * (cols - 1) * CELL, (1 - m) * (cols - 1) * CELL, m * (rows - 1) * CELL, (1 - m) * (rows - 1) * CELL];
    const mine: { x: number; y: number }[] = [];
    for (let s = 0; s < segs.length && mine.length < 5; s += 4) {
      const x = ((segs[s]! + segs[s + 2]!) / 2) * CELL;
      const y = ((segs[s + 1]! + segs[s + 3]!) / 2) * CELL;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (mine.some((l) => Math.hypot(l.x - x, l.y - y) < 220) || labels.some((l) => Math.hypot(l.x - x, l.y - y) < 70)) continue;
      mine.push({ x, y });
      labels.push({ x, y });
      const t = `${z}`;
      const tw = ctx.measureText(t).width + 4;
      ctx.fillStyle = 'rgba(6,14,16,0.75)';
      ctx.fillRect(x - tw / 2, y - 6, tw, 12);
      ctx.fillStyle = 'rgba(150,210,190,0.85)';
      ctx.fillText(t, x, y + 0.5);
    }
  }
}

/** Depth scale in the upper left corner (the lower edge of the plot can be cut off by its panel). */
function legend(ctx: CanvasRenderingContext2D, _w: number, _hgt: number): void {
  const marks = [0, 50, 200, 1000, 3000];
  const bw = 150;
  const x = 62;
  const y = 12;
  ctx.save();
  for (let i = 0; i < bw; i++) {
    // Same square-root scale as the tint, from 0 to 4000 m
    const d = ((i / bw) * Math.sqrt(4000)) ** 2;
    const [r, g, b] = tint(d);
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(x + i, y, 1, 7);
  }
  ctx.strokeStyle = 'rgba(130,200,180,0.5)';
  ctx.strokeRect(x - 0.5, y - 0.5, bw + 1, 8);
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(150,210,190,0.8)';
  ctx.textAlign = 'center';
  for (const m of marks) {
    const px = x + (Math.sqrt(m) / Math.sqrt(4000)) * bw;
    ctx.fillText(m >= 1000 ? `${m / 1000}k` : `${m}`, px, y + 18);
  }
  ctx.textAlign = 'right';
  ctx.fillText('TIEFE M', x - 6, y + 6);
  ctx.restore();
}
