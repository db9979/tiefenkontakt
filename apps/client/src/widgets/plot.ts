import { CLASSES, KN, NM, bearing, distance, evaluateSolution, headingVec, ownPosAt, targetPosAt, wrap360, type Snapshot, type Vec2 } from '@tk/shared';
import { store } from '../store.js';
import { drawAir } from './air-symbols.js';
import { drawMineSector } from './airdef-symbols.js';
import { drawMet } from './met-overlay.js';
import { COL, deg3, fitCanvas, km } from './format.js';
import { isFriendlyContact } from './friendly.js';
import { lastFix } from './contact-pos.js';
import { BearingRangeFilter, moverNow, ownNow, simNow } from './smooth.js';
import { touchable } from './touch.js';
import { openMenu, type MenuItem } from './menu.js';
import { drawEllipse, drawNavUncertainty, drawSymbol, drawWake, type Affiliation } from './symbols.js';
import { drawOrderMarks } from './order-marks.js';
import { ChartMarks, drawHavens, drawLanes } from './chart-marks.js';
import { DepthChart } from './plot-depth.js';
import { chartToScreen, chartToWorld, northUpGrid, panDelta, screenDir } from './chart-frame.js';
import { trueDeg } from '../north.js';
import { esmPlotLabel } from './esm-text.js';
import { RoutePlot } from './route-plot.js';

export interface PlotOptions {
  bearingLines: boolean;
  showConvoy: boolean;
  esmLines: boolean;
  /** Extra right-click actions at a world position (course, weapons, ...). */
  actions?: (p: Vec2) => MenuItem[];
  /** Own-ship chart: plot a route and let the helmsman run it (route-plot.ts). */
  route?: boolean;
}

type Drag =
  | { kind: 'pan'; x: number; y: number; px: number; py: number; moved: boolean }
  | { kind: 'sol'; label: string }
  | { kind: 'vec'; label: string };

type LinesMode = 'alle' | 'auswahl' | 'aus';
/** Bearing lines on the plot: all contacts, only the selected one (default), or none. */
const linesMode = (): LinesMode => {
  const v = localStorage.getItem('tk_lines');
  return v === 'alle' || v === 'aus' ? v : 'auswahl';
};
/** Bearing fan of the selected contact: the last 10 minutes, at most this many lines. */
const FAN_WINDOW_S = 600;
const FAN_MAX = 10;

/** Widest zoom (m per pixel): the real charts reach about 260 km around the route. */
const MAX_SCALE = 260;

/**
 * North-up tactical plot centered on own ship (world in the game frame, turned so true north is up). Mouse: wheel/buttons zoom, drag pans,
 * click selects, right-click opens actions, the amber TMA marker and its vector tip drag.
 */
export class Plot {
  scale = 40; // m per px
  pan: Vec2 = { x: 0, y: 0 };
  private drag?: Drag;
  private mouse?: { x: number; y: number };
  private height = 400;
  readonly el: HTMLElement;

  constructor(private canvas: HTMLCanvasElement, private opts: PlotOptions) {
    this.el = document.createElement('div');
    this.el.style.position = 'relative';
    canvas.replaceWith(this.el);
    this.el.appendChild(canvas);
    const tools = document.createElement('div');
    tools.style.cssText = 'position:absolute;top:6px;right:6px;display:flex;flex-direction:column;gap:3px';
    tools.innerHTML = `<button title="Hineinzoomen">+</button><button title="Herauszoomen">−</button><button title="Auf eigenes Schiff zentrieren">◎</button><button class="lines-btn" title="Peillinien: alle / nur Auswahl / aus"></button>`;
    const [zin, zout, ctr, lines] = [...tools.querySelectorAll('button')];
    const showLines = () => {
      const m = linesMode();
      lines!.textContent = { alle: '╱╱', auswahl: '╱', aus: '·' }[m];
      lines!.title = `Peillinien: ${{ alle: 'ALLE KONTAKTE', auswahl: 'NUR GEWÄHLTER KONTAKT', aus: 'AUS' }[m]} · Klick schaltet weiter`;
      lines!.classList.toggle('warn', m === 'aus');
    };
    lines!.onclick = () => {
      const order: LinesMode[] = ['auswahl', 'alle', 'aus'];
      localStorage.setItem('tk_lines', order[(order.indexOf(linesMode()) + 1) % order.length]!);
      showLines();
    };
    showLines();
    zin!.onclick = () => (this.scale = Math.max(5, this.scale / 1.4));
    zout!.onclick = () => (this.scale = Math.min(MAX_SCALE, this.scale * 1.4));
    ctr!.onclick = () => (this.pan = { x: 0, y: 0 });
    // Plotting tools: mark, line, circle, eraser (click again to put the pencil down)
    for (const [tool, icon, title] of [['mark', '✕', 'Markierung setzen'], ['line', '⟋', 'Linie ziehen (Peilung und Länge)'], ['circle', '◯', 'Kreis ziehen (Radius)'], ['erase', '⌫', 'Zeichnung wegklicken']] as const) {
      const b = document.createElement('button');
      b.textContent = icon;
      b.title = title;
      b.dataset.tool = tool;
      b.onclick = () => {
        this.marks.tool = this.marks.tool === tool ? undefined : tool;
        tools.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === this.marks.tool));
        canvas.style.cursor = this.marks.tool ? 'cell' : 'crosshair';
      };
      tools.appendChild(b);
    }
    this.el.appendChild(tools);
    if (opts.route) this.route = new RoutePlot(this.el, canvas, (p) => this.toScreen(p));

    canvas.style.cursor = 'crosshair';
    touchable(canvas, (f) => (this.scale = Math.min(MAX_SCALE, Math.max(5, this.scale * f))));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scale = Math.min(MAX_SCALE, Math.max(5, this.scale * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerleave', () => (this.mouse = undefined));
    canvas.addEventListener('contextmenu', (e) => this.context(e));
    canvas.addEventListener('dblclick', () => (this.pan = { x: 0, y: 0 }));
  }

  private local(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private center(): Vec2 {
    const o = store.snap ? ownNow() : { x: 0, y: 0 };
    return { x: o.x + this.pan.x, y: o.y + this.pan.y };
  }

  /** Screen → world (game frame); the chart is drawn north-up. */
  toWorld(p: { x: number; y: number }): Vec2 {
    return chartToWorld(p, this.center(), this.scale, this.canvas.clientWidth, this.height);
  }

  toScreen(p: Vec2): Vec2 {
    return chartToScreen(p, this.center(), this.scale, this.canvas.clientWidth, this.height);
  }

  /** Solution marker or its velocity tip under the mouse, for dragging. */
  private hitSolution(m: { x: number; y: number }): Drag | undefined {
    const s = store.snap;
    if (!s) return undefined;
    for (const [label, sol] of store.solutions) {
      const p = this.toScreen(targetPosAt(sol, simNow()));
      const v = screenDir(sol.course);
      const tip = { x: p.x + v.x * sol.speedKn * 4, y: p.y + v.y * sol.speedKn * 4 };
      if (Math.hypot(tip.x - m.x, tip.y - m.y) < 8) return { kind: 'vec', label };
      if (Math.hypot(p.x - m.x, p.y - m.y) < 9) return { kind: 'sol', label };
    }
    return undefined;
  }

  /** Nearest contact to a screen point: fixed positions, solutions, else bearing lines. */
  private pickContact(m: { x: number; y: number }): string | undefined {
    const s = store.snap;
    if (!s) return undefined;
    let best: string | undefined;
    let bd = 14;
    for (const c of s.contacts) {
      const pts: Vec2[] = [];
      const sol = store.solutions.get(c.label);
      if (sol) pts.push(this.toScreen(targetPosAt(sol, simNow())));
      const fix = lastFix(c, s);
      if (fix) pts.push(this.toScreen(fix.pos));
      for (const p of pts) {
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < bd) [best, bd] = [c.label, d];
      }
    }
    if (best) return best;
    const wp = this.toWorld(m);
    const b = bearing(s.own, wp);
    const r = distance(s.own, wp);
    let bestAng = Math.max(1.5, ((14 * this.scale) / Math.max(r, 1)) * (180 / Math.PI));
    for (const c of s.contacts) {
      for (const cb of c.bearingAlt !== undefined ? [c.bearing, c.bearingAlt] : [c.bearing]) {
        const d = Math.abs(((cb - b + 540) % 360) - 180);
        if (d < bestAng) [best, bestAng] = [c.label, d];
      }
    }
    return best;
  }

  private down(e: MouseEvent): void {
    if (e.button !== 0) return;
    const m = this.local(e);
    if (this.marks.down(this.toWorld(m), this.scale) || this.route?.down(m, this.toWorld(m))) return;
    this.drag = this.hitSolution(m) ?? { kind: 'pan', x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y, moved: false };
  }

  private up(e: MouseEvent): void {
    if (this.marks.up() || this.route?.up()) return;
    const d = this.drag;
    this.drag = undefined;
    if (d?.kind === 'pan' && !d.moved && e.target === this.canvas) {
      const hit = this.pickContact(this.local(e));
      store.selected = hit;
    }
  }

  private move(e: MouseEvent): void {
    const m = this.local(e);
    this.mouse = m;
    if (this.marks.move(this.toWorld(m)) || this.route?.move(this.toWorld(m))) return;
    const s = store.snap;
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.hitSolution(m) ? 'grab' : 'crosshair';
      return;
    }
    if (this.canvas.dataset.pinch) {
      // Two fingers zoom; the pan of the first finger must not jump about meanwhile
      if (d.kind === 'pan') { d.x = e.clientX; d.y = e.clientY; d.px = this.pan.x; d.py = this.pan.y; d.moved = true; }
      return;
    }
    if (d.kind === 'pan') {
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
      const dp = panDelta(e.clientX - d.x, e.clientY - d.y, this.scale);
      this.pan.x = d.px + dp.x;
      this.pan.y = d.py + dp.y;
      return;
    }
    const sol = store.solutions.get(d.label);
    if (!sol || !s) return;
    const wp = this.toWorld(m);
    if (d.kind === 'sol') {
      // Move the track so the target is at the mouse now, keeping course and speed
      const v = headingVec(sol.course);
      const back = sol.speedKn * KN * (s.time - sol.t0);
      store.solutions.set(d.label, { ...sol, x0: wp.x - v.x * back, y0: wp.y - v.y * back });
    } else {
      const now = targetPosAt(sol, simNow());
      const px = distance(this.toScreen(now), m);
      const course = bearing(now, wp);
      const speedKn = Math.min(35, px / 4);
      const v = headingVec(course);
      const back = speedKn * KN * (s.time - sol.t0);
      store.solutions.set(d.label, { ...sol, course, speedKn, x0: now.x - v.x * back, y0: now.y - v.y * back });
    }
  }

  private context(e: MouseEvent): void {
    e.preventDefault();
    const s = store.snap;
    if (!s) return;
    const m = this.local(e);
    const wp = this.toWorld(m);
    const hit = this.pickContact(m);
    const items: MenuItem[] = [];
    if (hit) items.push({ label: `Kontakt ${hit} wählen`, run: () => (store.selected = hit) });
    const sel = store.selected;
    if (sel) {
      items.push({
        label: `TMA-Lösung ${sel} hierher`,
        run: () => {
          const old = store.solutions.get(sel);
          store.solutions.set(sel, { t0: s.time, x0: wp.x, y0: wp.y, course: old?.course ?? 0, speedKn: old?.speedKn ?? 0 });
        },
      });
    }
    items.push(...(this.opts.actions?.(wp) ?? []), ...(this.route?.menu(m, wp) ?? []));
    items.push({ label: 'Alle Zeichnungen löschen', run: () => this.marks.clear() });
    items.push({ label: 'Karte hier zentrieren', run: () => (this.pan = { x: wp.x - s.own.x, y: wp.y - s.own.y }) });
    openMenu(e.clientX, e.clientY, items, `${deg3(trueDeg(bearing(s.own, wp)))}° · ${km(distance(s.own, wp))}`);
  }

  draw(height: number): void {
    this.height = height;
    const s = store.snap;
    const ctx = fitCanvas(this.canvas, height);
    const w = this.canvas.clientWidth;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, height);
    if (!s) return;
    const P = (p: Vec2) => this.toScreen(p);
    const c = this.center();

    this.depth.draw(ctx, s.env.seabed, this.center(), this.scale, w, height);
    drawMet(ctx, s.env.met, P, this.scale);
    const step = this.scale > 150 ? 10 * NM : this.scale > 60 ? 5 * NM : this.scale > 25 ? 2 * NM : NM;
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    // Grid along true north and east (the chart is north-up)
    northUpGrid(ctx, c, this.scale, w, height, step);
    ctx.font = '11px ui-monospace, monospace';

    ctx.strokeStyle = 'rgba(133,183,235,0.5)';
    ctx.beginPath();
    store.ownTrack.forEach((f, i) => {
      const p = P(f);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.stroke();

    for (const b of s.air?.buoys ?? []) {
      const p = P(b);
      ctx.strokeStyle = COL.blue;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4); ctx.stroke();
      ctx.fillStyle = COL.blue;
      if (b.active) { ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 7); ctx.stroke(); }
      ctx.fillText(`${b.id}${b.depth > 60 ? ' T' : ''}${b.active ? ' A' : ''}`, p.x + 6, p.y + 4);
    }
    for (const hp of s.air?.helos ?? []) {
      const p = P(hp);
      ctx.strokeStyle = COL.blue;
      ctx.beginPath(); ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); ctx.stroke();
      if (hp.hovering && hp.kind !== 'mad') {
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.arc(p.x, p.y, 12_000 / this.scale, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = COL.blue;
      ctx.fillText(hp.kind === 'mpa' ? 'SEEFERNAUFKL.' : hp.kind === 'mad' ? 'MAD-SUCHE' : hp.hovering ? 'TAUCHSONAR' : 'HUBSCHR.', p.x + 8, p.y - 4);
    }
    this.drawContacts(ctx, s, P, w, height);
    this.drawFriendlies(ctx, s, P);
    drawOrderMarks(ctx, s, P, this.scale);
    // Aircraft with a position (datalink, radar, eye) and ESM strobes on aircraft radars
    const meA = P(ownNow());
    drawAir(ctx, s, (x, y) => P({ x, y }), meA, 120);
    drawMineSector(ctx, s, meA, this.scale);

    for (const t of s.torpedoes) {
      const p = P(t);
      const v = screenDir(t.heading);
      ctx.fillStyle = COL.red;
      ctx.strokeStyle = COL.red;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + v.x * 14, p.y + v.y * 14); ctx.stroke();
      ctx.fillText(`${t.id}${t.homing ? ' ZIEL' : ''}`, p.x + 6, p.y - 6);
    }

    const me = ownNow();
    const o = P(me);
    const v = screenDir(me.heading);
    const ov = screenDir(s.own.order.heading);
    ctx.strokeStyle = 'rgba(250,199,117,0.6)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + ov.x * 40, o.y + ov.y * 40); ctx.stroke();
    ctx.setLineDash([]);
    // Own ship: APP-6 friendly frame (circle on the surface, lower half-circle submerged), filled, with a dot
    ctx.fillStyle = COL.blue;
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = 2;
    // Surface ships carry their draft in `depth`: only boats count as subsurface (and only when not surfaced)
    const ownSub = CLASSES[s.own.cls].submarine && s.own.depth > 1;
    drawSymbol(ctx, o.x, o.y, 'friend', ownSub ? 'subsurface' : 'surface', 8, true);
    ctx.beginPath(); ctx.arc(o.x, o.y, 1.8, 0, 7); ctx.fill();
    if (s.own.navUncertainty !== undefined) drawNavUncertainty(ctx, o, s.own.navUncertainty / this.scale, s.own.navUncertainty);
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + v.x * 26, o.y + v.y * 26); ctx.stroke();
    ctx.lineWidth = 1;

    drawLanes(ctx, P, s.env.seabed?.region); drawHavens(ctx, P, s);
    this.marks.draw(ctx, P, this.scale);
    this.route?.draw(ctx, s);
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'left';
    let foot = `RASTER ${(step / NM).toFixed(0)} SM · RECHTSKLICK: AKTIONEN`;
    if (linesMode() === 'aus' && store.selected) foot = `PEILLINIEN AUS (KNOPF · RECHTS OBEN) · ${foot}`;
    if (this.mouse) {
      const wp = this.toWorld(this.mouse);
      foot = `MAUS ${deg3(trueDeg(bearing(s.own, wp)))}° · ${km(distance(s.own, wp))} · ` + foot;
    }
    ctx.fillText(foot, 8, height - 8);
  }

  private depth = new DepthChart();
  private marks = new ChartMarks();
  private route?: RoutePlot;

  private lineFilters = new Map<string, { f: BearingRangeFilter; last: number }>();

  /** Display-only smoothing of the current bearing line (raw samples stay in the fan and the TMA). */
  private smoothedBearing(label: string, lastSeen: number, bearing: number): number | undefined {
    let e = this.lineFilters.get(label);
    if (!e) this.lineFilters.set(label, (e = { f: new BearingRangeFilter(0.25, 0.02), last: -1 }));
    if (e.last !== lastSeen) {
      e.f.update(lastSeen, bearing);
      e.last = lastSeen;
    }
    return e.f.at(simNow())?.bearing;
  }

  private drawContacts(ctx: CanvasRenderingContext2D, s: Snapshot, P: (p: Vec2) => Vec2, w: number, hgt: number): void {
    const far = Math.hypot(w, hgt) * this.scale;
    for (const c of s.contacts) {
      const sel = c.label === store.selected;
      const friendly = isFriendlyContact(c, s);
      if (friendly && !sel) continue;
      const stale = s.time - c.lastSeen > 30;
      const color = c.label.startsWith('E') || c.label.includes('-E') ? COL.red : sel ? COL.amber : COL.g;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      const isEsm = c.sensors.includes('esm') && c.sensors.length === 1;
      const mode = linesMode();
      const wantLines = mode === 'alle' || (mode === 'auswahl' && sel);
      if (wantLines && ((this.opts.bearingLines && c.via === 'own') || (isEsm && this.opts.esmLines))) {
        // Selected: a stable fan, one line per minute of sim time over the last 10 minutes (bucketed by time, so it doesn't reshuffle)
        let bucket = -1;
        const step = FAN_WINDOW_S / FAN_MAX;
        const recent = c.history.filter((h) => s.time - h.t <= FAN_WINDOW_S);
        const fan = sel ? recent.filter((h) => (Math.floor(h.t / step) !== bucket ? ((bucket = Math.floor(h.t / step)), true) : false)).slice(-FAN_MAX) : [];
        const latest = c.history[c.history.length - 1];
        const smoothable = latest && latest.alt === undefined && latest.ox === undefined;
        const cur = smoothable ? this.smoothedBearing(c.label, c.lastSeen, c.bearing) : undefined;
        if (cur !== undefined) {
          const me = ownNow();
          const v = headingVec(cur);
          const a = P(me);
          const end = P({ x: me.x + v.x * far, y: me.y + v.y * far });
          ctx.globalAlpha = stale ? 0.25 : 0.75;
          ctx.setLineDash(isEsm ? [6, 4] : [4, 3]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
        }
        const hist = sel ? fan : smoothable ? [] : c.history.slice(-1);
        for (const hs of hist) {
          const origin = ownPosAt(store.ownTrack, hs.t) ?? s.own;
          const side = store.tasSide.get(c.label);
          const origin2 = hs.ox !== undefined && hs.oy !== undefined ? { x: hs.ox, y: hs.oy } : origin;
          const bs = hs.alt === undefined ? [hs.b] : side === 'stb' ? [hs.b] : side === 'port' ? [hs.alt] : [hs.b, hs.alt];
          for (const b of bs) {
            const v = headingVec(b);
            const a = P(origin2);
            const end = P({ x: origin2.x + v.x * far, y: origin2.y + v.y * far });
            // Older fan lines fade out
            ctx.globalAlpha = stale ? 0.2 : sel ? 0.1 + 0.4 * Math.max(0, 1 - (s.time - hs.t) / FAN_WINDOW_S) : 0.7;
            ctx.setLineDash(isEsm ? [6, 4] : [4, 3]);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
          }
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        if (!hist.length && cur === undefined) continue;
        const lb = headingVec(cur ?? c.bearing);
        const me = ownNow();
        const lp = P({ x: me.x + lb.x * 60 * this.scale, y: me.y + lb.y * 60 * this.scale });
        ctx.fillText(c.sensors.includes('esm') ? esmPlotLabel(c.label, c.emitter) : c.label, lp.x + 4, lp.y - 4);
      }
      const fix = lastFix(c, s);
      if (fix) {
        const p = P(fix.pos);
        const aff: Affiliation = friendly ? 'friend' : c.assigned && c.assigned !== 'unknown' && c.assigned !== 'bio' ? 'hostile' : 'unknown';
        drawSymbol(ctx, p.x, p.y, aff, c.assigned === 'submarine' || c.assigned === 'torpedo' ? 'subsurface' : 'surface', 6, sel);
        ctx.fillText(c.label, p.x + 9, p.y - 6);
      }
      const sol = store.solutions.get(c.label);
      if (sol) {
        const p = P(targetPosAt(sol, simNow()));
        const v = screenDir(sol.course);
        const tip = { x: p.x + v.x * sol.speedKn * 4, y: p.y + v.y * sol.speedKn * 4 };
        ctx.strokeStyle = COL.amber;
        ctx.fillStyle = COL.amber;
        // Uncertainty: poor solutions are long along the line of sight (range unknown), narrow across it
        const q = this.solQuality(c.label, s.time);
        const solPos = targetPosAt(sol, simNow());
        const r = distance(ownNow(), solPos);
        drawEllipse(ctx, p.x, p.y, trueDeg(bearing(ownNow(), solPos)), (r * (0.05 + 0.45 * (1 - q / 100))) / this.scale, (r * 0.035) / this.scale);
        ctx.lineWidth = sel ? 2 : 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 3, 0, 7); ctx.fill();
        ctx.lineWidth = 1;
        ctx.fillText(`${c.label} ${deg3(trueDeg(sol.course))}° ${sol.speedKn.toFixed(0)} KN`, p.x + 10, p.y + 14);
      }
    }
  }

  private qCache = new Map<string, { t: number; q: number }>();
  /** TMA quality per contact, recomputed at most once per snapshot. */
  private solQuality(label: string, t: number): number {
    const hit = this.qCache.get(label);
    if (hit && hit.t === t) return hit.q;
    const c = store.snap?.contacts.find((x) => x.label === label);
    const sol = store.solutions.get(label);
    const q = c && sol ? evaluateSolution(sol, c.history, store.ownTrack).quality : 0;
    this.qCache.set(label, { t, q });
    return q;
  }

  private drawFriendlies(ctx: CanvasRenderingContext2D, s: Snapshot, P: (p: Vec2) => Vec2): void {
    for (const f of s.friendlies) {
      if (f.cls === 'merchant' && !this.opts.showConvoy) continue;
      // Live datalink positions glide between updates; old radio reports stay where reported
      const live = f.alive && s.time - f.reportedAt < 3;
      const p = P(live ? moverNow(f, f.reportedAt) : f);
      ctx.fillStyle = f.alive ? COL.blue : COL.dim;
      ctx.strokeStyle = ctx.fillStyle;
      if (live) drawWake(ctx, p.x, p.y, trueDeg(f.heading), f.speedKn);
      if (f.cls === 'merchant') {
        // APP-6 friendly surface frame (circle) with a short course leader; merchants smaller than warships
        drawSymbol(ctx, p.x, p.y, 'friend', 'surface', 4, true);
        const hv = screenDir(f.heading);
        ctx.beginPath(); ctx.moveTo(p.x + hv.x * 4, p.y + hv.y * 4); ctx.lineTo(p.x + hv.x * 10, p.y + hv.y * 10); ctx.stroke();
      } else {
        drawSymbol(ctx, p.x, p.y, 'friend', CLASSES[f.cls].submarine ? 'subsurface' : 'surface', 6);
        const hv = screenDir(f.heading);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + hv.x * 14, p.y + hv.y * 14); ctx.stroke();
        const age = s.time - f.reportedAt;
        ctx.fillText(age > 5 ? `${f.name} (−${Math.round(age / 60)} MIN)` : f.name, p.x + 8, p.y + 4);
      }
    }
  }
}
