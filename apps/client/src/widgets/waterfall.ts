import { angleDiff, bearing, iceCover, type Snapshot } from '@tk/shared';
import { COL, deg3, fitCanvas } from './format.js';
import { gameDeg, trueDeg } from '../north.js';
import { Fader, beamWidth, dbToAmp, showChance } from './signal-display.js';
import { isInkLight } from './ink.js';
import { clampTextX, plateText } from './canvas-text.js';

const BINS = 360;
const ROWS = 240;
/** Left margin of the picture: room for the time axis ("−4 MIN") inside the canvas. */
const PL = 50;

interface Line {
  b: number;
  amp: number;
  width: number;
}

export interface WfOpts { norm: boolean; integ: number; gain: number; contrast: number }
const OPTS_KEY = 'tk_wf_opts';
const INTEG = [1, 3, 10];

function loadOpts(): WfOpts {
  try {
    const o = JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') as Partial<WfOpts>;
    return { norm: o.norm ?? true, integ: INTEG.includes(o.integ ?? 0) ? o.integ! : 1, gain: Math.min(2, Math.max(0.5, o.gain ?? 1)), contrast: Math.min(2, Math.max(0.6, o.contrast ?? 1)) };
  } catch {
    return { norm: true, integ: 1, gain: 1, contrast: 1 };
  }
}

/** Split-window normaliser: value over the mean of the neighbours 4°–20° away on both sides, back on a noise floor. */
export function normalise(raw: Float32Array): Float32Array {
  const n = raw.length;
  // Two passes: a first background, then the background again with the peaks clipped to it, so a
  // loud trace does not raise its neighbours' reference and dig a pale trench beside itself
  const window = (x: number, clip: number) => {
    let sum = 0;
    let k = 0;
    for (let d = 4; d <= 20; d++) {
      sum += Math.min(clip, raw[(x + d) % n]!) + Math.min(clip, raw[(x - d + n) % n]!);
      k += 2;
    }
    return sum / k;
  };
  const out = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const bg0 = window(x, Infinity);
    const bg = window(x, bg0 * 1.3);
    out[x] = 0.18 + Math.max(0, raw[x]! - bg) * 1.6 + (raw[x]! - bg < 0 ? (raw[x]! - bg) * 0.3 : 0);
  }
  return out;
}

/**
 * Broadband waterfall: true bearing (x) over time (y, newest on top). Columns are true degrees;
 * contact bearings arrive in the game frame and are turned on the way in.
 * Built purely from the player's own contacts plus cosmetic noise.
 */
export class Waterfall {
  /** Picture in the current ink (light mode inks every row as it is put). */
  private buf = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  /** The same history in dark-screen colours (.keep: never inked), to re-ink after a theme switch. */
  private raw = document.createElement('canvas');
  private rctx: CanvasRenderingContext2D;
  private inkedLight = isInkLight();
  private lastT = -1;
  private fader = new Fader();
  /** Display settings (shared by every waterfall, stored): normaliser, averaging, gain, contrast, baffle shading. */
  opts = loadOpts();
  private acc = new Float32Array(BINS);

  constructor(private sensors: readonly string[] = ['hull', 'towed', 'intercept', 'active']) {
    this.buf.width = BINS;
    this.buf.height = ROWS;
    this.bctx = this.buf.getContext('2d')!;
    this.raw.width = BINS;
    this.raw.height = ROWS;
    this.raw.classList.add('keep');
    this.rctx = this.raw.getContext('2d', { willReadFrequently: true })!;
    this.rctx.fillStyle = COL.bg;
    this.rctx.fillRect(0, 0, BINS, ROWS);
    this.reink();
  }

  /** Redraw the shown history from the raw one in the current ink (no near-black block on paper). */
  private reink(): void {
    this.inkedLight = isInkLight();
    this.bctx.putImageData(this.rctx.getImageData(0, 0, BINS, ROWS), 0, 0);
  }

  /** Append a row per new second of sim time. */
  push(s: Snapshot, baffleHalf = 30): void {
    if (Math.floor(s.time) === this.lastT) return;
    this.lastT = Math.floor(s.time);
    const lines: Line[] = [];
    for (const c of s.contacts) {
      if (c.via !== 'own' || s.time - c.lastSeen > 2) continue;
      // Only what this array hears now: a contact another sensor holds (radar, eye) leaves no trace here,
      // so nothing paints in the deaf sector astern
      const seen = c.seenBy as Record<string, number | undefined> | undefined;
      const heardNow = this.sensors.some((x) => (seen?.[x] ?? ((c.sensors as string[]).includes(x) ? c.lastSeen : -Infinity)) >= s.time - 2);
      if (!heardNow) continue;
      // dB brightness with slow multipath fading; weak contacts break up, loud ones spread
      const db = c.se + this.fader.at(c.label, s.time);
      if (Math.random() > showChance(db)) continue;
      const amp = dbToAmp(db);
      const width = beamWidth(db);
      lines.push({ b: trueDeg(c.bearing), amp, width });
      if (c.bearingAlt !== undefined) lines.push({ b: trueDeg(c.bearingAlt), amp, width });
    }
    // Own wire-guided torpedoes: loud and close, a bright narrow trace on their bearing
    for (const t of s.torpedoes) lines.push({ b: trueDeg(bearing(s.own, t)), amp: 0.95, width: beamWidth(26) });
    const row = this.bctx.createImageData(BINS, 1);
    const stern = trueDeg(s.own.heading + 180);
    const selfNoise = Math.min(0.35, Math.max(0, (s.own.noiseDb - 110) / 120));
    const ice = iceCover(s.env.met, s.own);
    const raw = new Float32Array(BINS);
    for (let x = 0; x < BINS; x++) {
      let v = 0.1 + Math.random() * 0.2 + selfNoise * Math.random() + (s.env.rain ? 0.08 * Math.random() : 0);
      // Ice: a raised floor and sharp crackling all round
      if (ice > 0) v += ice * 0.12 * Math.random() + (Math.random() < ice * 0.1 ? 0.3 + Math.random() * 0.5 : 0);
      for (const l of lines) {
        const d = Math.abs(angleDiff(l.b, x));
        if (d < 4 * l.width) v += l.amp * Math.exp((-d * d) / (2 * l.width * l.width)) * (0.6 + 0.4 * Math.random());
      }
      if (Math.abs(angleDiff(stern, x)) < baffleHalf) v *= 0.3;
      raw[x] = v;
    }
    // Background normaliser (split window): each bearing against the mean of its neighbours
    // 4°–20° either side, so a loud sector flattens and single ships stay apart as narrow peaks
    const out = this.opts.norm ? normalise(raw) : raw;
    // Averaging over seconds: steadier traces, less speckle (and slower to show a change)
    const a = 1 / this.opts.integ;
    for (let x = 0; x < BINS; x++) {
      this.acc[x] = this.acc[x]! * (1 - a) + out[x]! * a;
      const v = Math.min(1, Math.max(0, this.acc[x]!));
      const i = x * 4;
      row.data[i] = 8 + v * 85;
      row.data[i + 1] = 12 + v * 190;
      row.data[i + 2] = 11 + v * 150;
      row.data[i + 3] = 255;
    }
    this.rctx.drawImage(this.raw, 0, 1);
    this.rctx.putImageData(row, 0, 0);
    if (this.inkedLight !== isInkLight()) this.reink();
    else {
      this.bctx.drawImage(this.buf, 0, 1);
      this.bctx.putImageData(row, 0, 0);
    }
  }

  draw(canvas: HTMLCanvasElement, height: number, s: Snapshot | undefined, selected?: string): void {
    const ctx = fitCanvas(canvas, height);
    const w = canvas.clientWidth;
    const pl = PL;
    const pt = 18;
    const pw = w - pl - 8;
    const ph = height - pt - 54;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, height);
    ctx.imageSmoothingEnabled = false;
    // Gain and contrast act on the whole history, like the knobs on a display
    ctx.filter = `brightness(${this.opts.gain}) contrast(${this.opts.contrast})`;
    if (this.inkedLight !== isInkLight()) this.reink();
    ctx.drawImage(this.buf, pl, pt, pw, ph);
    ctx.filter = 'none';
    ctx.strokeStyle = '#2c3a36';
    ctx.strokeRect(pl + 0.5, pt + 0.5, pw, ph);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = COL.g;
    ctx.textAlign = 'center';
    // Bearing scale every 30°, every 60° when the picture is too narrow for the labels to stand apart
    const step = pw / 12 < ctx.measureText('000').width + 8 ? 60 : 30;
    for (let a = 0; a <= 360; a += step) {
      const x = pl + (a / 360) * pw;
      ctx.fillText(deg3(a), clampTextX(ctx, deg3(a), x, 1, w - 1), 12);
      ctx.fillRect(x, pt - 3, 1, 3);
    }
    // Time axis: newest on top, the picture holds four minutes
    ctx.textAlign = 'right';
    ctx.fillText('0', pl - 4, pt + 10);
    ctx.fillText('−2 MIN', pl - 4, pt + ph / 2 + 4);
    ctx.fillText('−4 MIN', pl - 4, pt + ph);
    if (!s) return;
    const stern = trueDeg(s.own.heading + 180);
    // The deaf sector's name inside the picture at its foot, kept clear of the edges and of the contact labels below
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'center';
    ctx.fillText('TOTER WINKEL', Math.min(pl + pw - 44, Math.max(pl + 44, pl + (stern / 360) * pw)), pt + ph - 5);
    const hx = pl + (trueDeg(s.own.heading) / 360) * pw;
    ctx.fillStyle = COL.blue;
    ctx.fillText('▼', hx, pt + 9);
    // Own torpedoes: a red marker over their trace
    ctx.fillStyle = COL.red;
    for (const t of s.torpedoes) ctx.fillText(`▼${t.id}`, pl + (trueDeg(bearing(s.own, t)) / 360) * pw, pt + 9);
    // Contacts and the own torpedoes (on the wire) share the label rows; torpedoes in red
    const shown = [
      ...s.contacts
        .filter((c) => c.via === 'own' && s.time - c.lastSeen <= 5 && c.sensors.some((x) => this.sensors.includes(x)))
        .map((c) => ({ label: c.label, bearing: c.bearing, torp: false })),
      ...s.torpedoes.map((t) => ({ label: t.id, bearing: bearing(s.own, t), torp: true })),
    ].sort((a, b) => trueDeg(a.bearing) - trueDeg(b.bearing));
    // A towed-array waterfall while the array is in: say so (nothing can show up until it is out)
    const towedOnly = this.sensors.length === 1 && this.sensors[0] === 'towed';
    const towedIn = towedOnly && (s.own.towedLength ?? 0) <= 0;
    const towedSettling = towedOnly && !towedIn && !s.own.towedReady;
    if (!shown.length || towedIn) {
      // Empty state: say what to do instead of a black screen
      const [l1, l2] = towedIn
        ? ((s.own.towedOrder ?? 0) > 0 ? ['SCHLEPPSONAR WIRD AUSGEBRACHT', 'ES HÖRT ERST, WENN ES DRAUSSEN UND STABIL IST'] : ['SCHLEPPSONAR EINGEHOLT', 'LÄNGE WÄHLEN ZUM AUSBRINGEN'])
        : towedSettling ? ['SCHLEPPSONAR STABILISIERT SICH', 'GERADEAUS FAHREN, DANN HÖRT ES']
          : ['NOCH KEIN KONTAKT – LANGSAM FAHREN UND HORCHEN', 'SCHIFFE ERSCHEINEN ALS HELLE SENKRECHTE SPUREN'];
      ctx.fillStyle = towedIn ? COL.amber : COL.dim;
      ctx.textAlign = 'center';
      // Long lines on a narrow picture: the font shrinks to fit (never below 9 px)
      const fit = (t: string) => Math.min(1, (pw - 12) / Math.max(1, ctx.measureText(t).width));
      const k = Math.min(fit(l1), fit(l2));
      if (k < 1) ctx.font = `${Math.max(9, Math.floor(11 * k))}px ui-monospace, monospace`;
      plateText(ctx, l1, pl + pw / 2, pt + ph / 2 - 8);
      ctx.fillStyle = COL.dim;
      plateText(ctx, l2, pl + pw / 2, pt + ph / 2 + 8);
      ctx.font = '11px ui-monospace, monospace';
    }
    // Labels in up to three rows; a label goes into the first row where it touches no other
    // (by its real width); what does not fit is summed up as "+N" in a fourth row
    const rows: [number, number][][] = [[], [], []];
    const overflow: { x: number; n: number }[] = [];
    // The selected contact is placed first so it always gets a label
    const ordered = [...shown].sort((a, b) => (b.label === selected ? 1 : 0) - (a.label === selected ? 1 : 0));
    const placed: { c: typeof shown[number]; x: number; row: number }[] = [];
    for (const c of ordered) {
      const x0 = pl + (trueDeg(c.bearing) / 360) * pw;
      const x = clampTextX(ctx, c.label, x0, 1, w - 1);
      const half = ctx.measureText(c.label).width / 2 + 3;
      const row = rows.findIndex((r) => r.every(([a, b]) => x + half < a || x - half > b));
      if (row < 0) {
        const near = overflow.find((o) => Math.abs(o.x - x) < 30);
        if (near) near.n++;
        else overflow.push({ x, n: 1 });
      } else {
        rows[row]!.push([x - half, x + half]);
        placed.push({ c, x, row });
      }
    }
    ctx.fillStyle = COL.dim;
    for (const o of overflow) ctx.fillText(`+${o.n}`, clampTextX(ctx, `+${o.n}`, o.x, 1, w - 1), pt + ph + 13 + 3 * 12);
    for (const { c, x, row } of placed) {
      const sel = c.label === selected;
      ctx.fillStyle = sel ? COL.amber : c.torp ? COL.red : COL.g2;
      ctx.fillText(c.label, x, pt + ph + 13 + row * 12);
      if (sel) {
        ctx.strokeStyle = COL.amber;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        const bx = pl + (trueDeg(c.bearing) / 360) * pw;
        ctx.moveTo(bx, pt);
        ctx.lineTo(bx, pt + ph);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /** A small control strip (normaliser, averaging, gain, contrast) for the panel header. */
  controls(): HTMLElement {
    // Same height as the other footer controls (widgets.css); brightness − / + as one pair
    const el = document.createElement('span');
    el.className = 'wf-ctl';
    const btn = (label: string, title: string, run: () => void, parent: HTMLElement = el) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onclick = () => {
        run();
        localStorage.setItem(OPTS_KEY, JSON.stringify(this.opts));
        paint();
      };
      parent.appendChild(b);
      return b;
    };
    const norm = btn('NORM', 'Normalisierer: hebt einzelne Spuren aus lautem Hintergrund (Nachbarpeilungen als Bezug)', () => (this.opts.norm = !this.opts.norm));
    // "Int" like the LOFAR integration in the analysis filters
    const integ = btn('', 'Integration: Mittelung über mehrere Sekunden, ruhigere Spuren, aber träger', () => (this.opts.integ = INTEG[(INTEG.indexOf(this.opts.integ) + 1) % INTEG.length]!));
    const gain = document.createElement('span');
    gain.className = 'seg';
    el.appendChild(gain);
    btn('−', 'Helligkeit verringern', () => (this.opts.gain = Math.max(0.5, +(this.opts.gain - 0.15).toFixed(2))), gain);
    btn('+', 'Helligkeit erhöhen', () => (this.opts.gain = Math.min(2, +(this.opts.gain + 0.15).toFixed(2))), gain);
    const con = btn('', 'Kontrast: niedrig / normal / hoch', () => (this.opts.contrast = this.opts.contrast < 0.9 ? 1 : this.opts.contrast < 1.2 ? 1.4 : 0.7));
    const paint = () => {
      norm.classList.toggle('on', this.opts.norm);
      integ.textContent = `INT ${this.opts.integ} S`;
      con.textContent = this.opts.contrast < 0.9 ? 'KONTR −' : this.opts.contrast > 1.2 ? 'KONTR +' : 'KONTR';
    };
    paint();
    return el;
  }

  /** Bearing under a canvas x coordinate (for click-to-select), in the game frame like contact bearings. */
  bearingAt(canvas: HTMLCanvasElement, clientX: number): number {
    const r = canvas.getBoundingClientRect();
    const pw = r.width - PL - 8;
    return gameDeg((((clientX - r.left - PL) / pw) * 360 + 360) % 360);
  }
}
