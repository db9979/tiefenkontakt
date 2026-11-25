import { SIGNATURES, bearing, distance, iceCover, inSquall, shaftHz, type Evidence } from '@tk/shared';
import { audio, type ListenMode } from '../audio.js';
import { store } from '../store.js';
import { COL, fitCanvas, FONT, h } from './format.js';
import { renderVerdict } from './verdict.js';
import { Fader, dbToAmp, showChance } from './signal-display.js';
import { boxesHit, clampTextX, plateText, textBox, type Box } from './canvas-text.js';

/** Hz with one decimal and a decimal comma. */
const hz1 = (v: number) => v.toFixed(1).replace('.', ',');

type Page = 'lofar' | 'demon';
const BINS = 1000;
const ROWS = 140;
const INTEG = [2, 8, 16, 64] as const;
const LOFAR_BANDS = { voll: [0, 300], tief: [4, 80], welle: [8, 55], mittel: [20, 120], hoch: [200, 500] } as const;
const DEMON_BANDS = { '0-15': [0, 15], '0-30': [0, 30], '0-60': [0, 60] } as const;
const PALETTES = [
  [[8, 12, 11], [93, 202, 165], [216, 255, 240]],
  [[12, 9, 4], [250, 199, 117], [255, 240, 210]],
  [[5, 10, 14], [110, 205, 235], [225, 248, 255]],
];

const maxHz = (p: Page) => (p === 'lofar' ? 500 : 60);

/**
 * LOFAR/DEMON analysis for the selected contact. Everything shown is built from
 * the contact's measured evidence plus noise; marks and the class choice are the player's.
 */
export class AcousticAnalysis {
  readonly el: HTMLElement;
  page: Page = 'lofar';
  private band: string = 'voll';
  private demonBand: string = '0-30';
  private notch = true;
  private integ = 0;
  private peak = false;
  private gain = 1;
  private contrast = 1;
  private black = 0.1;
  private palette = 0;
  private cursor: Record<Page, number> = { lofar: 50, demon: 5 };
  private raw: Record<Page, Float32Array[]> = { lofar: [], demon: [] };
  private label?: string;
  private lastT = -1;
  private fader = new Fader();
  private listen = false;
  private listenMode: ListenMode = 'breitband';
  private canvas: HTMLCanvasElement;
  /** Controls moved out of the panel (footControls): still looked up by renderControls. */
  private moved?: HTMLElement;
  private img = document.createElement('canvas');

  constructor(private height = 260) {
    this.img.width = BINS;
    this.img.height = ROWS;
    this.el = h(`<div class="analysis">
      <div class="steps" id="a-pages"><button data-p="lofar">LOFAR</button><button data-p="demon">DEMON</button>
        <span class="spacer"></span><span id="a-bands" class="steps" style="margin:0"></span></div>
      <canvas id="a-cv" style="cursor:crosshair" title="Klick setzt den Frequenz-Cursor"></canvas>
      <div class="row"><span id="a-cur"></span><span id="a-markinfo" class="amber"></span></div>
      <div class="steps" id="a-markbtns"></div>
      <div id="a-verdict"></div>
      <details class="filters" id="a-filters"><summary>FILTER UND ANZEIGE</summary>
        <div class="steps">
          <button id="a-notch" title="Eigene Blattlinie ausblenden">Notch</button>
          <button id="a-int" title="Integrationszeit: längeres Mitteln hebt schwache stehende Töne">Int 2 s</button>
          <button id="a-peak" title="Spitzenwerte halten">Spitze</button>
          <button id="a-pal" title="Phosphorfarbe">Farbe</button>
        </div>
        <div class="steps">
          <button data-adj="gain:-1" title="Verstärkung −">Verst −</button><button data-adj="gain:1" title="Verstärkung +">Verst +</button>
          <button data-adj="contrast:-1">Kontr −</button><button data-adj="contrast:1">Kontr +</button>
          <button data-adj="black:-1">Schwarz −</button><button data-adj="black:1">Schwarz +</button>
        </div>
      </details>
      <div class="steps" id="a-lm">
        <button id="a-listen" title="Gewählten Kontakt abhören">Mithören</button>
        <button data-lm="breitband">Breitband</button><button data-lm="gefiltert">Gefiltert</button><button data-lm="ueberlagerung" title="Tiefe Töne um 700 Hz hochgeschoben">Überlagerung</button>
      </div>
    </div>`);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
    this.canvas = q<HTMLCanvasElement>('#a-cv');
    this.el.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => (b.onclick = () => this.setPage(b.dataset.p as Page)));
    q<HTMLButtonElement>('#a-notch').onclick = () => (this.notch = !this.notch);
    q<HTMLButtonElement>('#a-int').onclick = () => (this.integ = (this.integ + 1) % INTEG.length);
    q<HTMLButtonElement>('#a-peak').onclick = () => (this.peak = !this.peak);
    q<HTMLButtonElement>('#a-pal').onclick = () => (this.palette = (this.palette + 1) % PALETTES.length);
    this.el.querySelectorAll<HTMLButtonElement>('[data-adj]').forEach((b) => {
      b.onclick = () => {
        const [k, d] = b.dataset.adj!.split(':') as ['gain' | 'contrast' | 'black', string];
        const step = Number(d);
        if (k === 'gain') this.gain = Math.min(4, Math.max(0.25, this.gain * (step > 0 ? 1.25 : 0.8)));
        else if (k === 'contrast') this.contrast = Math.min(4, Math.max(0.5, this.contrast * (step > 0 ? 1.2 : 0.83)));
        else this.black = Math.min(0.6, Math.max(0, this.black + step * 0.05));
      };
    });
    q<HTMLButtonElement>('#a-listen').onclick = () => {
      audio.unlock();
      this.listen = !this.listen;
      if (!this.listen) audio.hydrophone(undefined);
    };
    this.el.querySelectorAll<HTMLButtonElement>('[data-lm]').forEach((b) => (b.onclick = () => (this.listenMode = b.dataset.lm as ListenMode)));
    this.canvas.addEventListener('mousedown', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const [lo, hi] = this.range();
      const hz = lo + ((e.clientX - r.left - 4) / (r.width - 8)) * (hi - lo);
      const stepHz = this.page === 'lofar' ? 0.5 : 0.1;
      this.cursor[this.page] = Math.round(Math.min(hi, Math.max(lo, hz)) / stepHz) * stepHz;
      this.renderControls();
    });
    this.setPage('lofar');
  }

  /**
   * Takes the listening modes and the filter settings out of the panel, for a station that
   * puts them under its waterfall (Horchraum): the listening modes as one segmented control,
   * the filters as a small popover. The analysis keeps driving them.
   */
  footControls(): HTMLElement {
    if (this.moved) return this.moved;
    const wrap = h('<span class="ana-foot"></span>');
    const lm = this.el.querySelector<HTMLElement>('#a-lm')!;
    lm.className = 'seg lm-seg';
    const filters = this.el.querySelector<HTMLElement>('#a-filters')!;
    filters.querySelector('summary')!.textContent = 'LOFAR ▾';
    filters.title = 'LOFAR-Filter und Anzeige';
    filters.classList.add('pop');
    const body = h('<div class="pop-body"></div>');
    body.append(...filters.querySelectorAll('.steps'));
    filters.append(body);
    wrap.append(lm, filters);
    this.moved = wrap;
    this.renderControls();
    return wrap;
  }

  private range(): readonly [number, number] {
    return this.page === 'lofar'
      ? LOFAR_BANDS[this.band as keyof typeof LOFAR_BANDS]
      : DEMON_BANDS[this.demonBand as keyof typeof DEMON_BANDS];
  }

  private setPage(p: Page): void {
    this.page = p;
    const bands = p === 'lofar' ? Object.keys(LOFAR_BANDS) : Object.keys(DEMON_BANDS);
    const bandsEl = this.el.querySelector<HTMLElement>('#a-bands')!;
    bandsEl.innerHTML = bands.map((b) => `<button data-b="${b}">${b === 'voll' ? 'Voll' : b === 'tief' ? 'Tief' : b === 'welle' ? 'Welle' : b === 'mittel' ? 'Mittel' : b === 'hoch' ? 'Hoch' : b + ' Hz'}</button>`).join('');
    bandsEl.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((b) => {
      b.onclick = () => {
        if (this.page === 'lofar') this.band = b.dataset.b!;
        else this.demonBand = b.dataset.b!;
      };
    });
    this.el.querySelector<HTMLElement>('#a-markbtns')!.innerHTML = p === 'lofar'
      ? `<button data-m="tonal" title="Linie am Cursor als Grundton markieren (rastet auf die nächste Spitze)">Grundton markieren</button><button data-m="clear">Marken löschen</button><button data-m="auto" class="einsteiger">Auto-Marken</button>`
      : `<button data-m="shaft" title="Linie am Cursor als Wellenfrequenz">Welle markieren</button><button data-m="blade" title="Linie am Cursor als Blattfrequenz">Blatt markieren</button><button data-m="clear">Marken löschen</button><button data-m="auto" class="einsteiger">Auto-Marken</button>`;
    this.el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => (b.onclick = () => this.mark(b.dataset.m!)));
    this.renderControls();
  }

  /** Integrated spectrum of the newest rows. */
  private integrated(page: Page, offset = 0): Float32Array {
    const rows = this.raw[page];
    const n = Math.min(INTEG[this.integ]!, rows.length - offset);
    const out = new Float32Array(BINS);
    if (n <= 0) return out;
    for (let r = offset; r < offset + n; r++) {
      const row = rows[r]!;
      for (let i = 0; i < BINS; i++) out[i]! += row[i]! / n;
    }
    return out;
  }

  private binOf(page: Page, hz: number): number {
    return Math.round((hz / maxHz(page)) * (BINS - 1));
  }

  /** Mark at the cursor, snapped to the strongest bin nearby (the player still chooses the line). */
  private mark(kind: string): void {
    const label = store.selected;
    if (!label) return;
    const m = { ...(store.marks.get(label) ?? {}) };
    if (kind === 'clear') {
      if (this.page === 'lofar') delete m.tonalHz;
      else {
        delete m.shaftHz;
        delete m.bladeHz;
      }
    } else if (kind === 'auto') {
      const ev = store.selectedContact()?.evidence;
      if (!ev) return;
      const strongest = [...ev.tonals].sort((a, b) => b.snr - a.snr)[0];
      if (strongest) m.tonalHz = strongest.hz;
      if (ev.shaftHz) m.shaftHz = ev.shaftHz;
      if (ev.bladeHz) m.bladeHz = ev.bladeHz;
    } else {
      const page = this.page;
      const spec = this.integrated(page);
      const c = this.cursor[page];
      const span = page === 'lofar' ? 1 : 0.3;
      let best = c;
      let bv = -1;
      for (let hz = c - span; hz <= c + span; hz += page === 'lofar' ? 0.5 : 0.1) {
        const b = this.binOf(page, hz);
        if (b >= 0 && b < BINS && spec[b]! > bv) [best, bv] = [hz, spec[b]!];
      }
      const hz = Math.round(best * 10) / 10;
      if (kind === 'tonal') m.tonalHz = hz;
      else if (kind === 'shaft') m.shaftHz = hz;
      else m.bladeHz = hz;
    }
    store.marks.set(label, m);
    this.renderControls();
  }

  private ownBladeHz(): number {
    const o = store.snap?.own;
    if (!o) return 0;
    const sig = SIGNATURES[o.cls];
    return shaftHz(sig, o.speedKn) * sig.blades[0]!;
  }

  private makeRow(page: Page, ev: Evidence | undefined): Float32Array {
    const row = new Float32Array(BINS);
    const hzPerBin = maxHz(page) / BINS;
    const add = (hz: number, amp: number, width: number) => {
      const c = hz / hzPerBin;
      const w = width / hzPerBin;
      for (let i = Math.max(0, Math.floor(c - 3 * w)); i < Math.min(BINS, Math.ceil(c + 3 * w)); i++) {
        row[i]! += amp * Math.exp(-((i - c) ** 2) / (2 * w * w)) * (0.6 + 0.4 * Math.random());
      }
    };
    for (let i = 0; i < BINS; i++) row[i] = 0.12 + Math.random() * 0.2;
    if (page === 'lofar') {
      // Each line fades on its own (multipath); weak lines break up, strong ones stand out on a dB scale
      const now = store.snap?.time ?? 0;
      for (const t of ev?.tonals ?? []) {
        const db = t.snr + this.fader.at(`${this.label}|${t.hz}`, now);
        if (Math.random() <= showChance(db)) add(t.hz, dbToAmp(db, -4, 24), t.snr > 15 ? 0.5 : 0.7);
      }
      const own = this.ownBladeHz();
      if (own > 0.5 && !this.notch) {
        const sp = store.snap?.own.speedKn ?? 0;
        for (let k = 1; k <= 4; k++) add(own * k, Math.min(0.8, 0.15 + sp / 35) / k, 0.8);
      }
    } else if (ev?.shaftHz && ev.bladeHz) {
      const db = (ev.demonSnr ?? 0) + this.fader.at(`${this.label}|demon`, store.snap?.time ?? 0);
      const a = Math.random() <= showChance(db) ? dbToAmp(db, -4, 22) : 0;
      add(ev.shaftHz, a * 0.7, 0.15);
      add(ev.shaftHz * 2, a * 0.35, 0.15);
      add(ev.bladeHz, a, 0.2);
      add(ev.bladeHz * 2, a * 0.5, 0.2);
    }
    return row;
  }

  /** New measurement rows once per sim second. */
  update(): void {
    const s = store.snap;
    if (!s) return;
    if (store.selected !== this.label) {
      this.label = store.selected;
      this.raw = { lofar: [], demon: [] };
    }
    const c = store.selectedContact();
    const fresh = c && c.evidenceAt !== undefined && s.time - c.evidenceAt < 3 ? c.evidence : undefined;
    if (Math.floor(s.time) !== this.lastT) {
      this.lastT = Math.floor(s.time);
      for (const p of ['lofar', 'demon'] as const) {
        this.raw[p].unshift(this.makeRow(p, fresh));
        if (this.raw[p].length > ROWS + 64) this.raw[p].pop();
      }
    }
    if (this.listen) {
      // The sea is always in the phones; the contact rides on it with its own sound
      const own = s.own;
      const sol = c ? store.solutions.get(c.label) : undefined;
      let closingKn: number | undefined;
      if (c && sol) {
        // Closing speed along the line of sight from the TMA solution and the own motion
        const b = (c.bearing * Math.PI) / 180;
        const tv = (sol.course * Math.PI) / 180;
        const ov = (own.heading * Math.PI) / 180;
        closingKn = -(sol.speedKn * Math.cos(tv - b)) + own.speedKn * Math.cos(ov - b);
      }
      // An own torpedo picked on the waterfall: its high propulsor whine, opening (Doppler down)
      const torp = !c ? s.torpedoes.find((t) => t.id === store.selected) : undefined;
      if (torp) {
        const tb = bearing(own, torp);
        audio.hydrophone({
          mode: this.listenMode, band: LOFAR_BANDS[this.band as keyof typeof LOFAR_BANDS] as [number, number], se: 22, tonals: [], voice: 'torpedo',
          rel: ((tb - own.heading + 540) % 360) - 180, rangeM: distance(own, torp), closingKn: -35,
          sea: s.env.seaState, rain: !!s.env.rain || inSquall(s.env.met, own), ice: iceCover(s.env.met, own), ownKn: own.speedKn,
        });
        this.renderControls();
        return;
      }
      audio.hydrophone({
        mode: this.listenMode, band: LOFAR_BANDS[this.band as keyof typeof LOFAR_BANDS] as [number, number],
        se: fresh && c ? c.se : undefined, shaftHz: fresh?.shaftHz, bladeHz: fresh?.bladeHz, tonals: fresh?.tonals ?? [],
        cav: fresh?.cav, voice: fresh?.voice,
        rel: c ? ((c.bearing - own.heading + 540) % 360) - 180 : undefined, rangeM: c?.range, closingKn,
        sea: s.env.seaState, rain: !!s.env.rain || inSquall(s.env.met, own), ice: iceCover(s.env.met, own), ownKn: own.speedKn,
      });
    }
    this.renderControls();
  }

  private renderControls(): void {
    const q = <T extends HTMLElement>(s: string) => (this.el.querySelector<T>(s) ?? this.moved?.querySelector<T>(s))!;
    this.el.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === this.page));
    this.el.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((b) => b.classList.toggle('on', b.dataset.b === (this.page === 'lofar' ? this.band : this.demonBand)));
    (this.moved ?? this.el).querySelectorAll<HTMLButtonElement>('[data-lm]').forEach((b) => b.classList.toggle('on', b.dataset.lm === this.listenMode));
    q('#a-notch').classList.toggle('on', this.notch);
    q('#a-peak').classList.toggle('on', this.peak);
    q('#a-listen').classList.toggle('on', this.listen);
    q('#a-int').textContent = `Int ${INTEG[this.integ]} s`;
    this.el.querySelectorAll<HTMLElement>('.einsteiger').forEach((b) => (b.style.display = store.realism === 'einsteiger' ? '' : 'none'));
    const spec = this.integrated(this.page);
    const lvl = spec[this.binOf(this.page, this.cursor[this.page])] ?? 0;
    q('#a-cur').textContent = `CURSOR ${this.cursor[this.page].toFixed(1).replace('.', ',')} HZ · PEGEL ${lvl.toFixed(2).replace('.', ',')}`;
    const m = store.selected ? store.marks.get(store.selected) : undefined;
    q('#a-markinfo').textContent = [
      m?.tonalHz ? `GRUNDTON ${hz1(m.tonalHz)} HZ` : '', m?.shaftHz ? `WELLE ${hz1(m.shaftHz)} HZ` : '', m?.bladeHz ? `BLATT ${hz1(m.bladeHz)} HZ` : '',
    ].filter(Boolean).join(' · ');
    renderVerdict(q('#a-verdict'));
  }

  draw(): void {
    const page = this.page;
    const ctx = fitCanvas(this.canvas, this.height);
    const w = this.canvas.clientWidth;
    const H = this.height;
    const strip = 54;
    const [lo, hi] = this.range();
    const X = (hz: number) => 4 + ((hz - lo) / (hi - lo)) * (w - 8);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, H);
    if (!store.selected) {
      ctx.fillStyle = COL.dim;
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText('KONTAKT WÄHLEN, UM IHN ZU ANALYSIEREN', 12, H / 2);
      return;
    }
    // Waterfall image from integrated rows
    const pal = PALETTES[this.palette]!;
    const ictx = this.img.getContext('2d')!;
    const data = ictx.createImageData(BINS, ROWS);
    const b0 = this.binOf(page, lo);
    const b1 = this.binOf(page, hi);
    const rows = Math.min(ROWS, this.raw[page].length);
    for (let r = 0; r < rows; r++) {
      const row = this.integrated(page, r);
      for (let x = 0; x < BINS; x++) {
        const src = b0 + Math.floor((x / BINS) * (b1 - b0));
        let v = ((row[src] ?? 0) * this.gain - this.black) * this.contrast;
        v = Math.max(0, Math.min(1, v));
        const [c0, c1, c2] = pal as number[][];
        const t = v < 0.6 ? v / 0.6 : (v - 0.6) / 0.4;
        const a = v < 0.6 ? c0! : c1!;
        const b = v < 0.6 ? c1! : c2!;
        const i = (r * BINS + x) * 4;
        data.data[i] = a[0]! + (b[0]! - a[0]!) * t;
        data.data[i + 1] = a[1]! + (b[1]! - a[1]!) * t;
        data.data[i + 2] = a[2]! + (b[2]! - a[2]!) * t;
        data.data[i + 3] = 255;
      }
    }
    ictx.putImageData(data, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.img, 0, 0, BINS, Math.max(1, rows), 4, strip + 4, w - 8, ((H - strip - 22) * Math.max(1, rows)) / ROWS);
    // The history area framed: it fills downwards over two minutes after a contact is chosen,
    // so the part not yet filled reads as "still to come", not as a broken black strip
    ctx.strokeStyle = 'rgba(93,202,165,0.18)';
    ctx.strokeRect(3.5, strip + 3.5, w - 7, H - strip - 21);

    // Spectrum strip (current or peak-held)
    let spec = this.integrated(page);
    if (this.peak) {
      const held = new Float32Array(BINS);
      for (let r = 0; r < Math.min(30, this.raw[page].length); r++) {
        const row = this.raw[page][r]!;
        for (let i = 0; i < BINS; i++) held[i] = Math.max(held[i]!, row[i]!);
      }
      spec = held;
    }
    ctx.strokeStyle = COL.g;
    ctx.beginPath();
    for (let x = 0; x <= w - 8; x++) {
      const hz = lo + (x / (w - 8)) * (hi - lo);
      const v = Math.min(1, (spec[this.binOf(page, hz)] ?? 0) * this.gain);
      const y = strip - 2 - v * (strip - 10);
      if (x) ctx.lineTo(4 + x, y);
      else ctx.moveTo(4 + x, y);
    }
    ctx.stroke();
    ctx.font = FONT.tick;
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'center';
    // Frequency axis: labels kept inside the canvas, the unit on the last one, none on top of another
    const tick = hi - lo > 100 ? 50 : hi - lo > 40 ? 10 : 5;
    const ticks: number[] = [];
    for (let f = Math.ceil(lo / tick) * tick; f <= hi; f += tick) ticks.push(f);
    let lastRight = -Infinity;
    ticks.forEach((f, i) => {
      const text = i === ticks.length - 1 ? `${f} HZ` : String(f);
      const x = clampTextX(ctx, text, X(f), 2, w - 2);
      const half = ctx.measureText(text).width / 2;
      if (x - half < lastRight + 6) return;
      ctx.fillText(text, x, H - 6);
      lastRight = x + half;
    });

    const m = store.marks.get(store.selected) ?? {};
    const vline = (hz: number, color: string, text?: string, dash = false) => {
      if (hz < lo || hz > hi) return;
      ctx.strokeStyle = color;
      ctx.setLineDash(dash ? [3, 3] : []);
      ctx.beginPath(); ctx.moveTo(X(hz), 4); ctx.lineTo(X(hz), H - 18); ctx.stroke();
      ctx.setLineDash([]);
      if (text) {
        ctx.fillStyle = color;
        ctx.fillText(text, X(hz), 12);
      }
    };
    if (page === 'lofar' && m.tonalHz) for (let k = 2; k <= 10; k++) vline(m.tonalHz * k, 'rgba(250,199,117,0.45)', `${k}f`, true);
    if (page === 'lofar' && m.tonalHz) vline(m.tonalHz, COL.amber, 'GT');
    if (page === 'demon' && m.shaftHz) vline(m.shaftHz, COL.amber, 'W');
    if (page === 'demon' && m.bladeHz) vline(m.bladeHz, COL.blue, 'B');
    vline(this.cursor[page], '#ffffff');
    if (store.realism === 'einsteiger') {
      // Line values for beginners: on a plate (the cursor and the lines run through them), in two
      // staggered rows; a value that still has no room is left out (the line itself stays)
      const ev = store.selectedContact()?.evidence;
      const peaks = page === 'lofar'
        ? (ev?.tonals ?? []).map((t) => t.hz)
        : ev?.shaftHz ? [ev.shaftHz, ...(ev.bladeHz ? [ev.bladeHz] : [])] : [];
      ctx.fillStyle = COL.g2;
      ctx.textAlign = 'center';
      const taken: Box[] = [];
      for (const hz of peaks.filter((f) => f >= lo && f <= hi).sort((a, b) => a - b)) {
        const text = hz1(hz);
        const x = clampTextX(ctx, text, X(hz), 6, w - 6);
        for (const y of [strip + 16, strip + 31]) {
          const box = textBox(ctx, text, x, y);
          if (taken.some((b) => boxesHit(b, box, 2))) continue;
          taken.push(plateText(ctx, text, x, y));
          break;
        }
      }
    }
  }
}
