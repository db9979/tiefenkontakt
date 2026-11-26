import { CLASSES, KN, NM, bearing, distance, evaluateSolution, headingVec, ownPosAt, targetPosAt, wrap360, type Snapshot, type Vec2 } from '@tk/shared';
import { store } from '../store.js';
import { airIcon, airSymbol, drawAir } from './air-symbols.js';
import { drawMineSector } from './airdef-symbols.js';
import { drawMet } from './met-overlay.js';
import { COL, FONT, deg3, fitCanvas, km } from './format.js';
import { affiliationOf, isFriendlyContact } from './friendly.js';
import { lastFix } from './contact-pos.js';
import { BearingRangeFilter, ownNow, simNow } from './smooth.js';
import { onRelease, touchable } from './touch.js';
import { openMenu, type MenuItem } from './menu.js';
import { drawEllipse, drawSymbol } from './symbols.js';
import { drawOrderMarks } from './order-marks.js';
import { drawConvoyDangerRing } from './convoy-ring.js';
import { ChartMarks, drawHavens, drawLanes } from './chart-marks.js';
import { DepthChart } from './plot-depth.js';
import { chartToScreen, chartToWorld, northUpGrid, panDelta, screenDir } from './chart-frame.js';
import { trueDeg } from '../north.js';
import { esmPlotLabel, esmTone } from './esm-text.js';
import { RoutePlot } from './route-plot.js';
import { chartLabel } from './canvas-text.js';
import { LabelLayer, PRIO, symbolBox } from './plot-labels.js';
import { AFF_COL, drawFriendlies, drawNavError, selRing } from './plot-marks.js';
import { linesMode, plotTools } from './plot-tools.js';

export interface PlotOptions {
  bearingLines: boolean;
  showConvoy: boolean;
  esmLines: boolean;
  /** Extra right-click actions at a world position (course, weapons, ...). */
  actions?: (p: Vec2) => MenuItem[];
  /** Own-ship chart: plot a route and let the helmsman run it (route-plot.ts). */
  route?: boolean;
  /**
   * Weather overlay (fog, ice, showers) shown at first; a toolbar button switches it and the choice
   * is kept per kind of chart. Default: on for the navigation charts (route: OPZ, Zentrale), off for
   * the fire-control charts (Zielkarte, Feuerleitung).
   */
  weather?: boolean;
}

type Drag =
  | { kind: 'pan'; x: number; y: number; px: number; py: number; moved: boolean }
  | { kind: 'sol'; label: string }
  | { kind: 'vec'; label: string };

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
  private tools!: HTMLElement;
  private labels: LabelLayer;
  /** Weather overlay shown (toolbar ☁). */
  weather = true;
  readonly el: HTMLElement;

  constructor(private canvas: HTMLCanvasElement, private opts: PlotOptions) {
    this.el = document.createElement('div');
    this.el.style.position = 'relative';
    canvas.replaceWith(this.el);
    this.el.appendChild(canvas);
    // Weather overlay on/off (stored per chart kind: navigation or fire control)
    const wxKey = `tk_wx_${opts.route ? 'nav' : 'fc'}`;
    const wxStored = localStorage.getItem(wxKey);
    this.weather = wxStored === null ? (opts.weather ?? !!opts.route) : wxStored === '1';
    const plot = this;
    const tools = plotTools(canvas, {
      zoom: (f) => (this.scale = Math.min(MAX_SCALE, Math.max(5, this.scale * f))),
      centre: () => (this.pan = { x: 0, y: 0 }),
      toggleTool: (t) => (this.marks.tool = this.marks.tool === t ? undefined : t),
      get weather() { return plot.weather; },
      setWeather: (on) => {
        this.weather = on;
        localStorage.setItem(wxKey, on ? '1' : '0');
      },
    });
    this.tools = tools;
    this.el.appendChild(tools);
    if (opts.route) this.route = new RoutePlot(this.el, canvas, (p) => this.toScreen(p));
    this.labels = new LabelLayer(canvas.getContext('2d')!);

    canvas.style.cursor = 'crosshair';
    touchable(canvas, (f) => (this.scale = Math.min(MAX_SCALE, Math.max(5, this.scale * f))));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scale = Math.min(MAX_SCALE, Math.max(5, this.scale * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      this.down(e);
      // The release may happen outside the chart; listening only for this gesture leaves nothing on the window
      onRelease(e, (u) => (u.type === 'pointerup' ? this.up(u) : (this.drag = undefined)));
    });
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
    // Narrow chart (phone): the tool column folds to zoom and ⋯
    this.tools.classList.toggle('compact', w < 420);
    if (!s) return;
    const P = (p: Vec2) => this.toScreen(p);
    const c = this.center();
    const L = this.labels;
    L.begin();
    // Labels keep clear of the buttons over the chart (tools, route bar)
    for (const el of this.el.children) {
      const b = el as HTMLElement;
      if (b === this.canvas || !b.offsetWidth || !b.offsetHeight) continue;
      L.avoid({ x: b.offsetLeft - 2, y: b.offsetTop - 2, w: b.offsetWidth + 4, h: b.offsetHeight + 4 });
    }

    L.prio = PRIO.depth;
    this.depth.draw(ctx, s.env.seabed, this.center(), this.scale, w, height);
    L.prio = PRIO.met;
    if (this.weather && !(CLASSES[s.own.cls].submarine && s.own.depth > 20)) drawMet(ctx, s.env.met, P, this.scale);
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

    L.prio = PRIO.own;
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
      // APP-6 friendly air frame with the rotary-wing (helicopter) or fixed-wing (patrol aircraft) icon
      ctx.strokeStyle = COL.blue;
      ctx.fillStyle = COL.blue;
      airSymbol(ctx, p.x, p.y, 'friend', 8);
      airIcon(ctx, p.x, p.y, hp.kind !== 'mpa', 8);
      L.avoid(symbolBox(p.x, p.y, 8));
      if (hp.hovering && hp.kind !== 'mad') {
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.arc(p.x, p.y, 12_000 / this.scale, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = COL.blue;
      ctx.fillText(hp.kind === 'mpa' ? 'SEEFERNAUFKL.' : hp.kind === 'mad' ? 'MAD-SUCHE' : hp.hovering ? 'TAUCHSONAR' : 'HUBSCHR.', p.x + 8, p.y + 14); // below: the contact it works carries its label above
    }
    L.prio = PRIO.contact;
    this.drawContacts(ctx, s, P, w, height);
    L.prio = PRIO.own;
    if (this.opts.showConvoy) drawConvoyDangerRing(ctx, s, P, this.scale);
    drawFriendlies(ctx, s, P, this.opts.showConvoy);
    L.prio = PRIO.order;
    drawOrderMarks(ctx, s, P, this.scale);
    // Aircraft with a position (datalink, radar, eye) and ESM strobes on aircraft radars
    const meA = P(ownNow());
    // The own side's helicopter and patrol aircraft are drawn above with their task: not a second time as air contacts
    const ownAir = s.air?.helos ?? [];
    L.prio = PRIO.air;
    drawAir(ctx, s, (x, y) => P({ x, y }), meA, 120, (pl) => !(pl.side === 'friend' && (pl.kind === 'helo' || pl.kind === 'mpa') && pl.x !== undefined
      && ownAir.some((hp) => Math.hypot(hp.x - pl.x!, hp.y - pl.y!) < 600)), 'km');
    drawMineSector(ctx, s, meA, this.scale);

    L.prio = PRIO.contact;
    for (const t of s.torpedoes) {
      const p = P(t);
      const v = screenDir(t.heading);
      // Own torpedo: APP-6 friendly subsurface frame with a T, blue (red is for threats), light ring when selected
      ctx.fillStyle = ctx.strokeStyle = COL.blue;
      drawSymbol(ctx, p.x, p.y, 'friend', 'subsurface', 5, t.id === store.selected);
      L.avoid(symbolBox(p.x, p.y, 6));
      ctx.save();
      ctx.font = FONT.tick;
      ctx.textAlign = 'center';
      L.direct(() => ctx.fillText('T', p.x, p.y + 2));
      ctx.restore();
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + v.x * 14, p.y + v.y * 14); ctx.stroke();
      if (t.id === store.selected) selRing(ctx, p.x, p.y, 9);
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
    L.avoid(symbolBox(o.x, o.y, 11));
    L.prio = PRIO.own;
    if (s.own.navUncertainty !== undefined) drawNavError(ctx, o, s.own.navUncertainty / this.scale, s.own.navUncertainty);
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + v.x * 26, o.y + v.y * 26); ctx.stroke();
    ctx.lineWidth = 1;

    L.prio = PRIO.lanes;
    drawLanes(ctx, P, s.env.seabed?.region, [o]); drawHavens(ctx, P, s);
    L.prio = PRIO.marks;
    this.marks.draw(ctx, P, this.scale);
    L.prio = PRIO.own;
    this.route?.draw(ctx, s);
    // Only the scale (and the mouse readout) in the chart: how-to lives in the footer hint below it
    ctx.font = '11px ui-monospace, monospace';
    let foot = `RASTER ${(step / NM).toFixed(0)} SM`;
    if (this.mouse) {
      const wp = this.toWorld(this.mouse);
      foot = `MAUS ${deg3(trueDeg(bearing(s.own, wp)))}° · ${km(distance(s.own, wp))} · ` + foot;
    }
    const fw = ctx.measureText(foot).width;
    L.avoid({ x: 2, y: height - 22, w: fw + 12, h: 20 });
    L.flush(w, height);
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'left';
    // On a plate (the legend's plate reaches down here, a longer mouse readout gets its own)
    ctx.save();
    ctx.fillStyle = 'rgba(6,14,16,0.72)';
    ctx.fillRect(4, height - 20, fw + 8, 16);
    ctx.restore();
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
    const L = this.labels;
    for (const c of s.contacts) {
      const sel = c.label === store.selected;
      const friendly = isFriendlyContact(c, s);
      if (friendly && !sel) continue;
      const stale = s.time - c.lastSeen > 30;
      // APP-6 (F5): the colour says friend, hostile, neutral or unknown from the assigned class;
      // the ESM tone goes on the strobe only
      const aff = affiliationOf(c, friendly);
      const color = AFF_COL[aff];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      const isEsm = c.sensors.includes('esm') && c.sensors.length === 1;
      const strobe = isEsm ? ({ red: COL.red, amber: COL.amber, dim: COL.dim } as const)[esmTone(c.emitter)] : color;
      const fix = lastFix(c, s);
      const mode = linesMode();
      const wantLines = mode === 'alle' || (mode === 'auswahl' && sel);
      if (wantLines && ((this.opts.bearingLines && c.via === 'own') || (isEsm && this.opts.esmLines))) {
        ctx.strokeStyle = strobe;
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
          ctx.globalAlpha = stale ? 0.25 : sel ? 0.9 : 0.75;
          ctx.lineWidth = sel ? 1.6 : 1;
          ctx.setLineDash(isEsm ? [6, 4] : [4, 3]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
          ctx.lineWidth = 1;
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
        ctx.strokeStyle = color;
        // The label at the line's end only when there is no fix to carry it (F29: it was drawn twice)
        if ((hist.length || cur !== undefined) && !fix) {
          const lb = headingVec(cur ?? c.bearing);
          const me = ownNow();
          const lp = P({ x: me.x + lb.x * 60 * this.scale, y: me.y + lb.y * 60 * this.scale });
          chartLabel(ctx, c.sensors.includes('esm') ? esmPlotLabel(c.label, c.emitter) : c.label, lp.x + 4, lp.y - 4, 8);
        }
      }
      if (fix) {
        const p = P(fix.pos);
        drawSymbol(ctx, p.x, p.y, aff, c.assigned === 'submarine' || c.assigned === 'torpedo' ? 'subsurface' : 'surface', 6, sel);
        if (sel) selRing(ctx, p.x, p.y, 11);
        L.avoid(symbolBox(p.x, p.y, 7));
        chartLabel(ctx, c.label, p.x + 9, p.y - 6, 18);
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
        L.avoid(symbolBox(p.x, p.y, 8));
        L.prio = PRIO.order;
        ctx.fillText(`${c.label} ${deg3(trueDeg(sol.course))}° ${sol.speedKn.toFixed(0)} KN`, p.x + 10, p.y + 14);
        L.prio = PRIO.contact;
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
}
