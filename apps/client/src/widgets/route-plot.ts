import { CLASSES, KN, PERISCOPE_DEPTH, bearing, distance, headingVec, type Snapshot, type Vec2, type Waypoint } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { btnState } from './btn-state.js';
import { COL, km, tdeg3 } from './format.js';
import type { MenuItem } from './menu.js';
import { ownNow } from './smooth.js';

/** Route colour on the chart: apart from contacts (green/red), solutions (amber) and friends (blue). */
const ROUTE = '#c3a6f0';
const LEADS = [0, 3, 6, 10, 15, 30];
const leadMin = (): number => {
  const v = Number(localStorage.getItem('tk_lead') ?? 6);
  return LEADS.includes(v) ? v : 6;
};

type P = (p: Vec2) => Vec2;

/**
 * Plotted route on the own chart (Koppeltisch, OPZ): waypoints placed with the ⚑ tool or the
 * right-click menu, dragged with the mouse, each with an optional leg speed and depth. The
 * server holds the route and steers it ("Route fahren"); the chart shows legs with true course
 * and distance, and a lead vector where the ship will be in N minutes.
 */
export class RoutePlot {
  tool = false;
  private drag?: { i: number; wps: Waypoint[] };
  /** Sent but not yet back in a snapshot: shown meanwhile so the chart does not flicker. */
  private pending?: { wps: Waypoint[]; at: number };
  private runBtn: HTMLButtonElement;

  constructor(host: HTMLElement, private canvas: HTMLCanvasElement, private P: P) {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;top:6px;left:6px;display:flex;gap:3px;flex-wrap:wrap;max-width:70%';
    bar.innerHTML = '<button data-r="tool" title="Wegpunkte setzen: Klick auf die Karte hängt einen an, Ziehen verschiebt, Rechtsklick auf einen Punkt für Fahrt, Tiefe, Löschen">⚑ WEGPUNKTE</button>'
      + '<button data-r="run" title="Route fahren: der Rudergänger steuert Wegpunkt für Wegpunkt ab. Kurs von Hand schaltet ab">ROUTE FAHREN</button>'
      + '<button data-r="lead" title="Vorausvektor: wo das Schiff in N Minuten steht (Klick schaltet die Dauer um)"></button>';
    const [tool, run, lead] = [...bar.querySelectorAll<HTMLButtonElement>('button')];
    this.runBtn = run!;
    tool!.onclick = () => {
      this.tool = !this.tool;
      tool!.classList.toggle('on', this.tool);
      canvas.style.cursor = this.tool ? 'copy' : 'crosshair';
    };
    run!.onclick = () => net.send({ t: 'route', active: !store.snap?.own.route?.active });
    const showLead = () => (lead!.textContent = leadMin() ? `VORAUS ${leadMin()} MIN` : 'VORAUS AUS');
    lead!.onclick = () => {
      localStorage.setItem('tk_lead', String(LEADS[(LEADS.indexOf(leadMin()) + 1) % LEADS.length]));
      showLead();
    };
    showLead();
    host.appendChild(bar);
  }

  /** The waypoints as shown: while dragging, then what was just sent, else the server's. */
  private wps(): Waypoint[] {
    if (this.drag) return this.drag.wps;
    const s = store.snap;
    const own = s?.own.route?.wps ?? [];
    if (this.pending && s) {
      if (JSON.stringify(own) === JSON.stringify(this.pending.wps) || s.time > this.pending.at + 3) this.pending = undefined;
      else return this.pending.wps;
    }
    return own;
  }

  private send(wps: Waypoint[], idx?: number): void {
    this.pending = { wps, at: store.snap?.time ?? 0 };
    net.send({ t: 'route', wps, idx });
  }

  private hit(m: Vec2): number {
    const wps = this.wps();
    for (let i = wps.length - 1; i >= 0; i--) {
      const p = this.P(wps[i]!);
      if (Math.hypot(p.x - m.x, p.y - m.y) < 10) return i;
    }
    return -1;
  }

  /** Left button: grab a waypoint, or with the tool on add one. True when the route took the click. */
  down(m: Vec2, world: Vec2): boolean {
    const i = this.hit(m);
    if (i >= 0) {
      this.drag = { i, wps: this.wps().map((w) => ({ ...w })) };
      this.canvas.style.cursor = 'grabbing';
      return true;
    }
    if (!this.tool) return false;
    const wps = this.wps();
    if (wps.length >= 20) return true;
    this.send([...wps, { x: Math.round(world.x), y: Math.round(world.y) }]);
    return true;
  }

  move(world: Vec2): boolean {
    const d = this.drag;
    if (!d) return false;
    d.wps[d.i] = { ...d.wps[d.i]!, x: Math.round(world.x), y: Math.round(world.y) };
    return true;
  }

  up(): boolean {
    const d = this.drag;
    if (!d) return false;
    this.drag = undefined;
    this.canvas.style.cursor = this.tool ? 'copy' : 'crosshair';
    this.send(d.wps);
    return true;
  }

  /** Right-click entries: on a waypoint its speed, depth and delete; elsewhere add, run, clear. */
  menu(m: Vec2, world: Vec2): MenuItem[] {
    const s = store.snap;
    if (!s) return [];
    const wps = this.wps();
    const route = s.own.route;
    const i = this.hit(m);
    const spec = CLASSES[s.own.cls];
    if (i >= 0) {
      const n = i + 1;
      const set = (patch: Partial<Waypoint>) => this.send(wps.map((w, k) => (k === i ? { ...w, ...patch } : w)));
      const speeds = [5, 10, 15, 20].filter((v) => v <= spec.maxSpeedKn);
      const items: MenuItem[] = [
        { label: `Route ab Wegpunkt ${n} fahren`, run: () => net.send({ t: 'route', idx: i, active: true }) },
        ...speeds.map((v) => ({ label: `WP ${n}: Fahrt ${v} kn`, run: () => set({ speedKn: v }) })),
        { label: `WP ${n}: Fahrt beibehalten`, run: () => set({ speedKn: undefined }) },
      ];
      if (spec.submarine) {
        const depths = [PERISCOPE_DEPTH, 60, 150, 250].filter((v) => v <= spec.maxDepth);
        items.push(...depths.map((v) => ({ label: `WP ${n}: Tiefe ${v} m`, run: () => set({ depth: v }) })));
        items.push({ label: `WP ${n}: Tiefe beibehalten`, run: () => set({ depth: undefined }) });
      }
      const idx = route?.idx ?? 0;
      items.push({ label: `Wegpunkt ${n} löschen`, danger: true, run: () => this.send(wps.filter((_, k) => k !== i), i < idx ? idx - 1 : idx) });
      return items;
    }
    const items: MenuItem[] = [];
    if (wps.length < 20) items.push({ label: 'Wegpunkt hier anhängen', run: () => this.send([...wps, { x: Math.round(world.x), y: Math.round(world.y) }]) });
    if (wps.length) {
      items.push(route?.active ? { label: 'Route anhalten', run: () => net.send({ t: 'route', active: false }) } : { label: 'Route fahren', run: () => net.send({ t: 'route', active: true }) });
      items.push({ label: 'Route löschen', danger: true, run: () => this.send([], 0) });
    }
    return items;
  }

  draw(ctx: CanvasRenderingContext2D, s: Snapshot): void {
    const wps = this.wps();
    const route = s.own.route;
    const active = !!route?.active && !this.drag;
    const idx = route?.idx ?? 0;
    btnState(this.runBtn, wps.length ? { on: active, label: active ? `WP ${idx + 1}/${wps.length}` : 'AUS' } : { label: 'KEINE', tone: 'empty' });
    const me = ownNow();
    this.drawLead(ctx, s, me, active ? wps.slice(idx) : []);
    if (!wps.length) return;
    const P = this.P;
    ctx.save();
    ctx.font = '11px ui-monospace, monospace';
    ctx.strokeStyle = ROUTE;
    ctx.fillStyle = ROUTE;
    // Running: the leg from the ship to the next waypoint, dashed
    if (active && wps[idx]) {
      const a = P(me), b = P(wps[idx]!);
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    for (let i = 0; i < wps.length; i++) {
      const w = wps[i]!;
      const p = P(w);
      const done = !!route && i < idx;
      ctx.globalAlpha = done ? 0.4 : 1;
      if (i > 0) {
        const prev = wps[i - 1]!;
        const q = P(prev);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.lineWidth = 1;
        // Leg: true course and distance at the middle
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        if (Math.hypot(p.x - q.x, p.y - q.y) > 60) ctx.fillText(`${tdeg3(bearing(prev, w))}° · ${km(distance(prev, w))}`, mx + 6, my - 4);
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), p.x, p.y + 4);
      ctx.textAlign = 'left';
      const tags = [w.speedKn !== undefined ? `${w.speedKn} KN` : '', w.depth !== undefined ? `${w.depth} M` : ''].filter(Boolean).join(' · ');
      if (tags) ctx.fillText(tags, p.x + 10, p.y + 14);
      if (active && i === idx) { ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.stroke(); }
    }
    ctx.restore();
  }

  /** Where the ship is in N minutes: along the heading, or along the route while it runs it. */
  private drawLead(ctx: CanvasRenderingContext2D, s: Snapshot, me: { x: number; y: number; heading: number }, ahead: Waypoint[]): void {
    const min = leadMin();
    const v = s.own.speedKn * KN;
    if (!min || v < 0.3) return;
    let left = v * min * 60;
    let at: Vec2 = { x: me.x, y: me.y };
    const pts: Vec2[] = [at];
    for (const w of ahead) {
      const d = distance(at, w);
      if (d >= left) break;
      left -= d;
      at = w;
      pts.push(at);
    }
    // The rest of the time on the leg under way; past the last waypoint the ship holds its last course
    const next = ahead[pts.length - 1];
    const dir = headingVec(next ? bearing(at, next) : pts.length > 1 ? bearing(pts[pts.length - 2]!, at) : me.heading);
    pts.push({ x: at.x + dir.x * left, y: at.y + dir.y * left });
    const sp = pts.map(this.P);
    ctx.save();
    ctx.strokeStyle = COL.g2;
    ctx.fillStyle = COL.g2;
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([1, 3]);
    ctx.beginPath();
    sp.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    const end = sp[sp.length - 1]!;
    ctx.beginPath(); ctx.moveTo(end.x - 5, end.y - 5); ctx.lineTo(end.x + 5, end.y + 5); ctx.moveTo(end.x + 5, end.y - 5); ctx.lineTo(end.x - 5, end.y + 5); ctx.stroke();
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`+${min} MIN`, end.x + 8, end.y - 6);
    ctx.restore();
  }
}
