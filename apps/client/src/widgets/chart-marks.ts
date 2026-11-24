import { CLASSES, HAVEN_M, bearing, distance, groundsOf, lanesOf, type RegionId, type Snapshot, type Vec2 } from '@tk/shared';
import { store } from '../store.js';
import { deg3, km } from './format.js';
import { trueDeg } from '../north.js';

/**
 * Plotting on the chart, like a navigator with pencil and dividers: marks (a cross with an
 * optional name), lines (with their bearing and length) and circles (with their radius), in
 * map coordinates, so they stay put while the own ship moves. Kept per match in the browser.
 */

export type Tool = 'mark' | 'line' | 'circle' | 'erase';
type Shape =
  | { k: 'mark'; p: Vec2; name: string }
  | { k: 'line'; a: Vec2; b: Vec2 }
  | { k: 'circle'; c: Vec2; r: number };

const INK = '#e8c86a';

export class ChartMarks {
  tool: Tool | undefined;
  private shapes: Shape[] = [];
  private draft?: Shape;
  private key = '';
  private count = 0;

  /** Shapes of the current match (loaded when the match changes). */
  private sync(): void {
    const k = `tk_marks_${store.matchId ?? 'x'}`;
    if (k === this.key) return;
    this.key = k;
    try {
      this.shapes = JSON.parse(localStorage.getItem(k) ?? '[]') as Shape[];
    } catch {
      this.shapes = [];
    }
    this.count = this.shapes.filter((s) => s.k === 'mark').length;
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.shapes));
    } catch { /* storage full: the marks still show this session */ }
  }

  clear(): void {
    this.sync();
    this.shapes = [];
    this.count = 0;
    this.save();
  }

  /** Pointer down at a map point with a tool active: true when the chart took it. */
  down(p: Vec2, scale: number): boolean {
    if (!this.tool) return false;
    this.sync();
    if (this.tool === 'mark') {
      const name = (prompt('Name der Markierung (leer: Nummer)', '') ?? '').trim().slice(0, 16);
      this.shapes.push({ k: 'mark', p, name: name || `M${++this.count}` });
      this.save();
    } else if (this.tool === 'line') this.draft = { k: 'line', a: p, b: p };
    else if (this.tool === 'circle') this.draft = { k: 'circle', c: p, r: 0 };
    else {
      // Erase the nearest shape within a few pixels
      const tol = 10 * scale;
      const d = (s: Shape) => s.k === 'mark' ? distance(s.p, p)
        : s.k === 'circle' ? Math.abs(distance(s.c, p) - s.r)
        : segDist(p, s.a, s.b);
      const best = this.shapes.map((s, i) => [d(s), i] as const).sort((x, y) => x[0] - y[0])[0];
      if (best && best[0] < tol) {
        this.shapes.splice(best[1], 1);
        this.save();
      }
    }
    return true;
  }

  move(p: Vec2): boolean {
    const d = this.draft;
    if (!d) return false;
    if (d.k === 'line') d.b = p;
    else if (d.k === 'circle') d.r = distance(d.c, p);
    return true;
  }

  up(): boolean {
    const d = this.draft;
    this.draft = undefined;
    if (!d) return false;
    if ((d.k === 'line' && distance(d.a, d.b) > 20) || (d.k === 'circle' && d.r > 20)) {
      this.shapes.push(d);
      this.save();
    }
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, P: (p: Vec2) => Vec2, scale: number): void {
    this.sync();
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 1.4;
    ctx.font = '11px ui-monospace, monospace';
    for (const s of [...this.shapes, ...(this.draft ? [this.draft] : [])]) {
      if (s.k === 'mark') {
        const q = P(s.p);
        ctx.beginPath();
        ctx.moveTo(q.x - 6, q.y - 6); ctx.lineTo(q.x + 6, q.y + 6);
        ctx.moveTo(q.x + 6, q.y - 6); ctx.lineTo(q.x - 6, q.y + 6);
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillText(s.name, q.x + 8, q.y - 6);
      } else if (s.k === 'line') {
        const a = P(s.a), b = P(s.b);
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        for (const q of [a, b]) { ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, 7); ctx.fill(); }
        ctx.textAlign = 'center';
        ctx.fillText(`${deg3(trueDeg(bearing(s.a, s.b)))}° · ${km(distance(s.a, s.b))}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 6);
      } else {
        const c = P(s.c);
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.arc(c.x, c.y, s.r / scale, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(c.x, c.y, 2.5, 0, 7); ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillText(`R ${km(s.r)}`, c.x, c.y - s.r / scale - 5);
      }
    }
    ctx.restore();
  }
}

/** Distance (m) from point p to the segment a–b. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shipping lanes, ferry routes and fishing banks as the printed chart shows them (faint magenta). */
export function drawLanes(ctx: CanvasRenderingContext2D, P: (p: Vec2) => Vec2, region: RegionId | undefined): void {
  const lanes = lanesOf(region);
  const grounds = groundsOf(region);
  if (!lanes.length && !grounds.length) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(214,120,200,0.45)';
  ctx.fillStyle = 'rgba(214,120,200,0.6)';
  ctx.lineWidth = 1;
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const l of lanes) {
    ctx.setLineDash(l.shuttle ? [2, 4] : [8, 5]);
    ctx.beginPath();
    l.xy.forEach((p, i) => { const q = P(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.stroke();
    const mid = P(l.xy[Math.floor(l.xy.length / 2)]!);
    ctx.fillText(l.name.toUpperCase(), mid.x, mid.y - 5);
  }
  ctx.setLineDash([3, 3]);
  for (const g of grounds) {
    const c = P(g.c), e = P({ x: g.c.x + g.r, y: g.c.y });
    ctx.beginPath(); ctx.arc(c.x, c.y, distance(e, c), 0, Math.PI * 2); ctx.stroke();
    ctx.fillText('FANGGRUND', c.x, c.y);
  }
  ctx.restore();
}

/** Moving havens round own submarines: no own ASW weapon may go into the water inside (blue, dashed). */
export function drawHavens(ctx: CanvasRenderingContext2D, P: (p: Vec2) => Vec2, s: Snapshot): void {
  const boats = s.friendlies.filter((f) => f.alive && CLASSES[f.cls].submarine && f.id !== s.own.id);
  if (CLASSES[s.own.cls].submarine && s.friendlies.some((f) => f.alive && !CLASSES[f.cls].submarine && f.cls !== 'merchant')) boats.push({ ...s.own, alive: true } as never);
  if (!boats.length) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(110,170,255,0.55)';
  ctx.fillStyle = 'rgba(110,170,255,0.06)';
  ctx.setLineDash([10, 6]);
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const b of boats) {
    const c = P(b), e = P({ x: b.x + HAVEN_M, y: b.y });
    const r = distance(e, c);
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(110,170,255,0.8)';
    ctx.fillText('SPERRGEBIET', c.x, c.y - r - 4);
    ctx.fillStyle = 'rgba(110,170,255,0.06)';
  }
  ctx.restore();
}
