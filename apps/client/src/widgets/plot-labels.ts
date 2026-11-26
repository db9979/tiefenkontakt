import { CHART_PLATE, textBox, type Box } from './canvas-text.js';

/**
 * One label pass per chart frame (S19, F4). While the plot draws, every text that goes onto the
 * chart (own code and the helpers it calls: lanes, met, order marks, route, missiles, depth
 * numbers) is collected instead of drawn, with a priority. At the end of the frame the labels are
 * placed from the most to the least important: each tries its own spot, then a few nearby ones
 * (below, above, on the other side of its symbol), clamped inside the canvas and clear of the
 * tool buttons, the legend and the symbols; a label that finds no free spot is left out, the
 * most important ones are drawn anyway where they overlap least.
 *
 * Priorities: contacts and weapons > own lead (dead-reckoning, route, friendly names) > met >
 * lanes > depth numbers.
 */

export const PRIO = {
  contact: 100,
  order: 95,
  air: 92,
  own: 80,
  marks: 60,
  met: 50,
  lanes: 40,
  depth: 20,
} as const;
/** From this priority on a label is always drawn (where it overlaps least when crowded). */
export const MUST = 90;

export interface PlaceItem {
  /** Box the label covers where it was asked for (plate included). */
  box: Box;
  prio: number;
  /** Drawing order: ties keep it. */
  seq: number;
}

/** Overlap with a button or legend costs this much more than overlap with another label. */
const OBSTACLE_WEIGHT = 8;

/** Offsets tried for a label (dx, dy), its own spot first. */
function candidates(b: Box): [number, number][] {
  const lh = b.h + 1;
  const left = -(b.w + 14);
  return [[0, 0], [0, lh], [0, -lh], [left, 0], [left, lh], [left, -lh], [0, 2 * lh], [0, -2 * lh], [left, 2 * lh], [left, -2 * lh]];
}

/** A box shifted so it lies inside the bounds (as far as it fits). */
export function clampBox(b: Box, bounds: Box): Box {
  const x = Math.max(bounds.x, Math.min(b.x, bounds.x + bounds.w - b.w));
  const y = Math.max(bounds.y, Math.min(b.y, bounds.y + bounds.h - b.h));
  return { x, y, w: b.w, h: b.h };
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Place labels: per item the shift (dx, dy) from where it was asked for, or undefined when it is
 * left out. Pure, for the tests.
 */
export function placeLabels(items: readonly PlaceItem[], bounds: Box, obstacles: readonly Box[]): ({ dx: number; dy: number } | undefined)[] {
  const out: ({ dx: number; dy: number } | undefined)[] = items.map(() => undefined);
  const taken: Box[] = [];
  const order = items.map((_, i) => i).sort((a, b) => items[b]!.prio - items[a]!.prio || items[a]!.seq - items[b]!.seq);
  for (const i of order) {
    const it = items[i]!;
    // The thing it names is off the chart: no label pinned to the edge
    const b = it.box;
    if (b.x + b.w <= bounds.x || b.x >= bounds.x + bounds.w || b.y + b.h <= bounds.y || b.y >= bounds.y + bounds.h) continue;
    let best: { box: Box; cost: number } | undefined;
    const spots = candidates(it.box);
    // A label that must be drawn may also step out from under a button or legend in its way
    // (beside or below it): under the route bar it was hidden (audit 4, phone OPZ)
    if (it.prio >= MUST) {
      for (const o of obstacles) {
        if (!overlap(b, o)) continue;
        spots.push([0, o.y + o.h + 1 - b.y], [o.x + o.w + 1 - b.x, 0], [o.x - b.w - 1 - b.x, 0], [0, o.y - b.h - 1 - b.y]);
      }
    }
    for (const [dx, dy] of spots) {
      const box = clampBox({ x: it.box.x + dx, y: it.box.y + dy, w: it.box.w, h: it.box.h }, bounds);
      let cost = 0;
      // Under a button the text is gone; over another label it is only crowded
      for (const o of obstacles) cost += OBSTACLE_WEIGHT * overlap(box, o);
      for (const t of taken) cost += overlap(box, t);
      if (cost === 0) {
        best = { box, cost };
        break;
      }
      if (!best || cost < best.cost) best = { box, cost };
    }
    if (!best || (best.cost > 0 && it.prio < MUST)) continue;
    taken.push(best.box);
    out[i] = { dx: best.box.x - it.box.x, dy: best.box.y - it.box.y };
  }
  return out;
}

interface Queued extends PlaceItem {
  text: string;
  x: number;
  y: number;
  font: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  alpha: number;
  fill: string | CanvasGradient | CanvasPattern;
  /** Plate behind the text, relative to (x, y). */
  plate?: { x: number; y: number; w: number; h: number; fill: string };
}

type Ctx = CanvasRenderingContext2D;
const P = typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : undefined;

/** The label pass of one canvas (the plot's). */
export class LabelLayer {
  /** Priority given to text drawn from now on (set around each part of the chart). */
  prio: number = PRIO.own;
  private active = false;
  private items: Queued[] = [];
  private obstacles: Box[] = [];
  private raw: string | CanvasGradient | CanvasPattern = '#000';
  private stack: (string | CanvasGradient | CanvasPattern)[] = [];
  private pending?: { x: number; y: number; w: number; h: number; fill: string };
  private seq = 0;

  constructor(private ctx: Ctx) {
    layers.set(ctx, this);
    if (!P) return;
    const fs = Object.getOwnPropertyDescriptor(P, 'fillStyle');
    // Keep the colour as it was given (in light mode the setter inks it: reading it back and
    // setting it again would ink it twice); save/restore keep it in step
    if (fs?.get && fs.set) {
      Object.defineProperty(ctx, 'fillStyle', {
        configurable: true,
        get: () => fs.get!.call(ctx),
        set: (v: string | CanvasGradient | CanvasPattern) => {
          this.raw = v;
          fs.set!.call(ctx, v);
        },
      });
    }
    ctx.save = () => {
      this.stack.push(this.raw);
      P.save.call(ctx);
    };
    ctx.restore = () => {
      if (this.stack.length) this.raw = this.stack.pop()!;
      P.restore.call(ctx);
    };
    ctx.fillRect = (x: number, y: number, w: number, h: number) => {
      this.dropPlate();
      // A label plate (canvas-text's chartLabel): goes with the text that follows
      if (this.active && this.raw === CHART_PLATE && this.plain()) this.pending = { x, y, w, h, fill: CHART_PLATE };
      else P.fillRect.call(ctx, x, y, w, h);
    };
    ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
      if (!this.active || maxWidth !== undefined || !this.plain()) {
        this.dropPlate();
        return maxWidth === undefined ? P.fillText.call(ctx, text, x, y) : P.fillText.call(ctx, text, x, y, maxWidth);
      }
      this.queue(text, x, y);
    };
  }

  /** The transform is the plain pixel-ratio scale (labels in a turned or moved frame are drawn as they are). */
  private plain(): boolean {
    const m = this.ctx.getTransform();
    return m.b === 0 && m.c === 0 && m.e === 0 && m.f === 0 && m.a === m.d;
  }

  private dropPlate(): void {
    const p = this.pending;
    if (!p || !P) return;
    this.pending = undefined;
    const keep = this.raw;
    this.ctx.fillStyle = p.fill;
    P.fillRect.call(this.ctx, p.x, p.y, p.w, p.h);
    this.ctx.fillStyle = keep;
  }

  private queue(text: string, x: number, y: number): void {
    const c = this.ctx;
    const p = this.pending;
    this.pending = undefined;
    const tb = textBox(c, text, x, y, 2);
    const box = p ? { x: Math.min(p.x, tb.x), y: Math.min(p.y, tb.y), w: Math.max(p.x + p.w, tb.x + tb.w) - Math.min(p.x, tb.x), h: Math.max(p.y + p.h, tb.y + tb.h) - Math.min(p.y, tb.y) } : tb;
    this.items.push({
      text, x, y, box, prio: this.prio, seq: this.seq++, font: c.font, align: c.textAlign, baseline: c.textBaseline, alpha: c.globalAlpha, fill: this.raw,
      plate: p ? { x: p.x - x, y: p.y - y, w: p.w, h: p.h, fill: p.fill } : undefined,
    });
  }

  /** Start a frame: text is collected from now on. */
  begin(): void {
    this.items = [];
    this.obstacles = [];
    this.pending = undefined;
    this.seq = 0;
    this.active = true;
  }

  /** Something labels must keep clear of (tool buttons, legend, symbols). */
  avoid(b: Box): void {
    this.obstacles.push(b);
  }

  /** Draw without collecting (legend, footer: they stay where they are). */
  direct(fn: () => void): void {
    const was = this.active;
    this.dropPlate();
    this.active = false;
    try {
      fn();
    } finally {
      this.active = was;
    }
  }

  /** Place and draw the collected labels. */
  flush(w: number, h: number): void {
    this.dropPlate();
    this.active = false;
    if (!P) return;
    const c = this.ctx;
    const items = this.items;
    this.items = [];
    const at = placeLabels(items, { x: 2, y: 2, w: w - 4, h: h - 4 }, this.obstacles);
    c.save();
    items.forEach((it, i) => {
      const d = at[i];
      if (!d) return;
      c.globalAlpha = it.alpha;
      if (it.plate) {
        c.fillStyle = it.plate.fill;
        P.fillRect.call(c, it.x + d.dx + it.plate.x, it.y + d.dy + it.plate.y, it.plate.w, it.plate.h);
      }
      c.font = it.font;
      c.textAlign = it.align;
      c.textBaseline = it.baseline;
      c.fillStyle = it.fill;
      P.fillText.call(c, it.text, it.x + d.dx, it.y + d.dy);
    });
    c.restore();
  }
}

const layers = new WeakMap<Ctx, LabelLayer>();

/** The label layer of a canvas, if its chart has one (helpers set their priority through it). */
export function labelLayer(ctx: Ctx): LabelLayer | undefined {
  return layers.get(ctx);
}

/** A symbol's box (centre and half size) as something labels keep clear of. */
export function symbolBox(x: number, y: number, r: number): Box {
  return { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
}

