import { KN, NM, bearing, depthAt, distance, headingVec, ownPosAt, targetPosAt, wrap360, type Snapshot, type Vec2 } from '@tk/shared';
import { store } from '../store.js';
import { COL, deg3, fitCanvas, km } from './format.js';
import { isFriendlyContact } from './friendly.js';
import { BearingRangeFilter, moverNow, ownNow, simNow } from './smooth.js';
import { openMenu, type MenuItem } from './menu.js';

export interface PlotOptions {
  bearingLines: boolean;
  showConvoy: boolean;
  esmLines: boolean;
  /** Extra right-click actions at a world position (course, weapons, ...). */
  actions?: (p: Vec2) => MenuItem[];
}

type Drag =
  | { kind: 'pan'; x: number; y: number; px: number; py: number; moved: boolean }
  | { kind: 'sol'; label: string }
  | { kind: 'vec'; label: string };

/**
 * North-up tactical plot centered on own ship. Mouse: wheel/buttons zoom, drag pans,
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
    tools.innerHTML = `<button title="Hineinzoomen">+</button><button title="Herauszoomen">−</button><button title="Auf eigenes Schiff zentrieren">◎</button>`;
    const [zin, zout, ctr] = [...tools.querySelectorAll('button')];
    zin!.onclick = () => (this.scale = Math.max(5, this.scale / 1.4));
    zout!.onclick = () => (this.scale = Math.min(600, this.scale * 1.4));
    ctr!.onclick = () => (this.pan = { x: 0, y: 0 });
    this.el.appendChild(tools);

    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scale = Math.min(600, Math.max(5, this.scale * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
    }, { passive: false });
    canvas.addEventListener('mousedown', (e) => this.down(e));
    window.addEventListener('mouseup', (e) => this.up(e));
    canvas.addEventListener('mousemove', (e) => this.move(e));
    canvas.addEventListener('mouseleave', () => (this.mouse = undefined));
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

  toWorld(p: { x: number; y: number }): Vec2 {
    const c = this.center();
    const w = this.canvas.clientWidth;
    return { x: c.x + (p.x - w / 2) * this.scale, y: c.y - (p.y - this.height / 2) * this.scale };
  }

  toScreen(p: Vec2): Vec2 {
    const c = this.center();
    const w = this.canvas.clientWidth;
    return { x: w / 2 + (p.x - c.x) / this.scale, y: this.height / 2 - (p.y - c.y) / this.scale };
  }

  /** Solution marker or its velocity tip under the mouse, for dragging. */
  private hitSolution(m: { x: number; y: number }): Drag | undefined {
    const s = store.snap;
    if (!s) return undefined;
    for (const [label, sol] of store.solutions) {
      const p = this.toScreen(targetPosAt(sol, simNow()));
      const v = headingVec(sol.course);
      const tip = { x: p.x + v.x * sol.speedKn * 4, y: p.y - v.y * sol.speedKn * 4 };
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
      if (c.range !== undefined && c.rangeAt !== undefined) {
        const o = ownPosAt(store.ownTrack, c.rangeAt) ?? s.own;
        const v = headingVec(c.bearing);
        pts.push(this.toScreen({ x: o.x + v.x * c.range, y: o.y + v.y * c.range }));
      }
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
    this.drag = this.hitSolution(m) ?? { kind: 'pan', x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y, moved: false };
  }

  private up(e: MouseEvent): void {
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
    const s = store.snap;
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.hitSolution(m) ? 'grab' : 'crosshair';
      return;
    }
    if (d.kind === 'pan') {
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
      this.pan.x = d.px - (e.clientX - d.x) * this.scale;
      this.pan.y = d.py + (e.clientY - d.y) * this.scale;
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
    items.push(...(this.opts.actions?.(wp) ?? []));
    items.push({ label: 'Karte hier zentrieren', run: () => (this.pan = { x: wp.x - s.own.x, y: wp.y - s.own.y }) });
    openMenu(e.clientX, e.clientY, items, `${deg3(bearing(s.own, wp))}° · ${km(distance(s.own, wp))}`);
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

    this.drawDepth(ctx, s, w, height);

    const step = this.scale > 150 ? 10 * NM : this.scale > 60 ? 5 * NM : this.scale > 25 ? 2 * NM : NM;
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    for (let gx = Math.floor((c.x - (w / 2) * this.scale) / step) * step; gx < c.x + (w / 2) * this.scale; gx += step) {
      const p = P({ x: gx, y: 0 });
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, height); ctx.stroke();
    }
    for (let gy = Math.floor((c.y - (height / 2) * this.scale) / step) * step; gy < c.y + (height / 2) * this.scale; gy += step) {
      const p = P({ x: 0, y: gy });
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(w, p.y); ctx.stroke();
    }
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
      ctx.fillText(`${b.id}${b.depth > 60 ? ' T' : ''}`, p.x + 6, p.y + 4);
    }
    for (const hp of s.air?.helos ?? []) {
      const p = P(hp);
      ctx.strokeStyle = COL.blue;
      ctx.beginPath(); ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); ctx.stroke();
      ctx.fillStyle = COL.blue;
      ctx.fillText('HUBSCHR.', p.x + 8, p.y - 4);
    }
    this.drawContacts(ctx, s, P, w, height);
    this.drawFriendlies(ctx, s, P);

    for (const t of s.torpedoes) {
      const p = P(t);
      const v = headingVec(t.heading);
      ctx.fillStyle = COL.red;
      ctx.strokeStyle = COL.red;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + v.x * 14, p.y - v.y * 14); ctx.stroke();
      ctx.fillText(`${t.id}${t.homing ? ' ZIEL' : ''}`, p.x + 6, p.y - 6);
    }

    const me = ownNow();
    const o = P(me);
    const v = headingVec(me.heading);
    const ov = headingVec(s.own.order.heading);
    ctx.strokeStyle = 'rgba(250,199,117,0.6)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + ov.x * 40, o.y - ov.y * 40); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.blue;
    ctx.beginPath(); ctx.arc(o.x, o.y, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + v.x * 26, o.y - v.y * 26); ctx.stroke();
    ctx.lineWidth = 1;

    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'left';
    let foot = `RASTER ${(step / NM).toFixed(0)} SM · RECHTSKLICK: AKTIONEN`;
    if (this.mouse) {
      const wp = this.toWorld(this.mouse);
      foot = `MAUS ${deg3(bearing(s.own, wp))}° · ${km(distance(s.own, wp))} · ` + foot;
    }
    ctx.fillText(foot, 8, height - 8);
  }

  private depthCache?: { key: string; img: HTMLCanvasElement; at: number };

  /** Chart shading from the (public) seabed: land, shoals, shelf and deep water. */
  private drawDepth(ctx: CanvasRenderingContext2D, s: Snapshot, w: number, hgt: number): void {
    const spec = s.env.seabed;
    if (!spec) return;
    const c = this.center();
    const cell = 6;
    const cols = Math.ceil(w / cell);
    const rows = Math.ceil(hgt / cell);
    const key = `${Math.round(c.x / (this.scale * 4))}|${Math.round(c.y / (this.scale * 4))}|${this.scale.toFixed(2)}|${cols}|${rows}`;
    const now = performance.now();
    if (!this.depthCache || (this.depthCache.key !== key && now - this.depthCache.at > 120)) {
      const img = this.depthCache?.img ?? document.createElement('canvas');
      img.width = cols;
      img.height = rows;
      const ic = img.getContext('2d')!;
      const data = ic.createImageData(cols, rows);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const d = depthAt(spec, c.x + (i * cell - w / 2) * this.scale, c.y - (j * cell - hgt / 2) * this.scale);
          const [r, g, b] = d < 0 ? [38, 36, 26] : d < 60 ? [52, 64, 50] : d < 300 ? [14, 34, 34] : d < 2000 ? [9, 22, 24] : [6, 14, 16];
          const k = (j * cols + i) * 4;
          data.data[k] = r;
          data.data[k + 1] = g;
          data.data[k + 2] = b;
          data.data[k + 3] = 255;
        }
      }
      ic.putImageData(data, 0, 0);
      this.depthCache = { key, img, at: now };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.depthCache.img, 0, 0, cols * cell, rows * cell);
  }

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
      if ((this.opts.bearingLines && c.via === 'own') || (isEsm && this.opts.esmLines)) {
        // Selected: a stable fan, one line per 20 s of sim time (not by index, which reshuffles on every update)
        let bucket = -1;
        const fan = sel ? c.history.filter((h) => (Math.floor(h.t / 20) !== bucket ? ((bucket = Math.floor(h.t / 20)), true) : false)) : [];
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
            ctx.globalAlpha = stale ? 0.2 : sel ? 0.35 : 0.7;
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
        ctx.fillText(c.label, lp.x + 4, lp.y - 4);
      }
      if (c.range !== undefined && c.rangeAt !== undefined && s.time - c.rangeAt < 90) {
        const origin = ownPosAt(store.ownTrack, c.rangeAt) ?? s.own;
        const v = headingVec(c.bearing);
        const p = P({ x: origin.x + v.x * c.range, y: origin.y + v.y * c.range });
        ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
        ctx.fillText(c.label, p.x + 7, p.y - 6);
      }
      const sol = store.solutions.get(c.label);
      if (sol) {
        const p = P(targetPosAt(sol, simNow()));
        const v = headingVec(sol.course);
        const tip = { x: p.x + v.x * sol.speedKn * 4, y: p.y - v.y * sol.speedKn * 4 };
        ctx.strokeStyle = COL.amber;
        ctx.fillStyle = COL.amber;
        ctx.lineWidth = sel ? 2 : 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 3, 0, 7); ctx.fill();
        ctx.lineWidth = 1;
        ctx.fillText(`${c.label} ${deg3(sol.course)}° ${sol.speedKn.toFixed(0)} KN`, p.x + 10, p.y + 14);
      }
    }
  }

  private drawFriendlies(ctx: CanvasRenderingContext2D, s: Snapshot, P: (p: Vec2) => Vec2): void {
    for (const f of s.friendlies) {
      if (f.cls === 'merchant' && !this.opts.showConvoy) continue;
      // Live datalink positions glide between updates; old radio reports stay where reported
      const live = f.alive && s.time - f.reportedAt < 3;
      const p = P(live ? moverNow(f, f.reportedAt) : f);
      ctx.fillStyle = f.alive ? COL.blue : COL.dim;
      ctx.strokeStyle = ctx.fillStyle;
      if (f.cls === 'merchant') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(wrap360(f.heading) * (Math.PI / 180));
        ctx.fillRect(-2, -5, 4, 10);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 5, p.y + 4); ctx.lineTo(p.x - 5, p.y + 4); ctx.closePath(); ctx.stroke();
        const age = s.time - f.reportedAt;
        ctx.fillText(age > 5 ? `${f.name} (−${Math.round(age / 60)} MIN)` : f.name, p.x + 8, p.y + 4);
      }
    }
  }
}
