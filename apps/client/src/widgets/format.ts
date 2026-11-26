import { dpr2d } from './perf.js';
import { trueDeg } from '../north.js';
import type { ClassChoice, ClassId, NeutralClass } from '@tk/shared';

export const deg3 = (d: number) => Math.round(((d % 360) + 360) % 360).toString().padStart(3, '0');
export const deg1 = (d: number) => (((d % 360) + 360) % 360).toFixed(1).replace('.', ',');
/** Game-frame direction shown as true degrees, three digits (north-up display). */
export const tdeg3 = (game: number) => deg3(trueDeg(game));
/** Bearing as every list and report writes it (F20): true, three digits, with the degree sign: "087°". */
export const tbrg = (game: number) => `${tdeg3(game)}°`;
/** Game-frame direction shown as true degrees, one decimal (TMA solutions only). */
export const tdeg1 = (game: number) => deg1(trueDeg(game));
export const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',') + ' KM';
/** Kilometres without the unit (a column whose header says KM): "2,8". */
export const kmNum = (m: number) => (m / 1000).toFixed(1).replace('.', ',');
/** Sea miles, for the frigate's chart and radar (F19): "9,9 SM". */
export const sm = (m: number) => (m / 1852).toFixed(1).replace('.', ',') + ' SM';
/** A range on a chart: sea miles on a surface ship's chart (SM grid), kilometres on the boat's (F19). */
export const chartDist = (m: number, surface: boolean) => (surface ? sm(m) : km(m));
export const kn = (v: number) => v.toFixed(1).replace('.', ',') + ' KN';

export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Like clock(), without the leading "00:" in the first hour: "37:38", "1:02:05" → "01:02:05". */
export function shortClock(t: number): string {
  const c = clock(t);
  return c.startsWith('00:') ? c.slice(3) : c;
}

export const CLASS_LABEL: Record<ClassId, string> = {
  ssn: 'ATOM-U-BOOT', ssk: 'DIESEL-U-BOOT', ssc: 'KÜSTEN-U-BOOT', ffg: 'FREGATTE', kor: 'KORVETTE', merchant: 'HANDELSSCHIFF',
  ssa: 'AIP-U-BOOT', ffv: 'VDS-FREGATTE', ssw: 'JAGD-U-BOOT', ffk: 'WACHSCHIFF', fischer: 'FISCHTRAWLER',
  tanker: 'SUPERTANKER', container: 'CONTAINERSCHIFF', faehre: 'FÄHRE', schlepper: 'SCHLEPPER', yacht: 'SEGELYACHT',
};

export const CHOICE_LABEL: Record<ClassChoice, string> = {
  merchant: 'HANDELSSCHIFF', warship: 'KRIEGSSCHIFF', submarine: 'U-BOOT', torpedo: 'TORPEDO', bio: 'BIOLOGISCH', unknown: 'UNBEKANNT',
};

export const CLASS_NAME: Record<Exclude<ClassId, 'merchant' | NeutralClass>, { title: string; info: string }> = {
  ffg: { title: 'Fregatte F-12', info: 'Rumpf- und Schleppsonar, Radar, U-Jagd-Raketen' },
  ssn: { title: 'Atom-U-Boot Projekt 9', info: 'Schnell, unbegrenzte Ausdauer, laut bei hoher Fahrt' },
  ssk: { title: 'Diesel-U-Boot Projekt 4', info: 'Sehr leise, begrenzte Batterie, muss schnorcheln' },
  ssc: { title: 'Küsten-U-Boot Projekt 2', info: 'Extrem leise, klein und wendig; 8 Rohre ohne Nachladen, kleine Batterie, 200 m' },
  kor: { title: 'Korvette K-7', info: 'Leise, schnell, wendig; kurzes Schleppsonar, kein Hubschrauber' },
  ffv: { title: 'Fregatte F-30 (VDS)', info: 'Tiefensonar lässt sich unter die Sprungschicht absenken (bis 18 kn); kein Hubschrauber' },
  ssa: { title: 'U-Boot Projekt 6 (AIP)', info: 'Außenluftunabhängig: bis 5 kn ohne Batterieverbrauch, sehr leise; 250 m' },
  ssw: { title: 'Jagd-U-Boot S-14', info: 'Geleitschutz unter Wasser: jagt die Wölfe vor dem Konvoi; leise, schnell, 400 m. Nur ein Boot pro Team' },
  ffk: { title: 'Wachschiff Projekt 11', info: 'U-Jagd für das Rudel: Tiefensonar, Raketen, schnell; bindet die Eskorte, jagt deren U-Boot. Nur ein Schiff pro Team' },
};

/** Create an element from an HTML string. */
export function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Size a canvas backing store to its CSS box (crisp at any DPR). */
export function fitCanvas(c: HTMLCanvasElement, cssHeight: number): CanvasRenderingContext2D {
  const dpr = dpr2d();
  const w = c.clientWidth || 600;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(cssHeight * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(cssHeight * dpr);
    c.style.height = `${cssHeight}px`;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Canvas type scale: scale ticks 10 px, labels 11 px, values and big readouts semibold. Nothing smaller. */
export const FONT = {
  tick: '10px ui-monospace, monospace',
  label: '11px ui-monospace, monospace',
  value: '600 12px ui-monospace, monospace',
  big: '600 15px ui-monospace, monospace',
} as const;
/** Canvas line weights: grid, bearing lines, tracks, own ship, threats. */
export const LW = { grid: 1, bearing: 1.25, track: 1.5, own: 2.5, threat: 2 } as const;

export const COL = {
  bg: '#080c0b', grid: 'rgba(93,202,165,0.12)', g: '#5dcaa5', g2: '#9fe1cb', dim: '#5f7a72',
  amber: '#fac775', red: '#f09595', blue: '#85b7eb',
};

/** Mast hoist state from the own-ship view: extension 0..1, fully raised, and direction of travel. */
export function mastState(o: { mastUp: boolean; mastExt?: number }): { ext: number; raised: boolean; moving?: 'aus' | 'ein' } {
  const ext = o.mastExt ?? (o.mastUp ? 1 : 0);
  const moving = o.mastUp && ext < 1 ? 'aus' : !o.mastUp && ext > 0 ? 'ein' : undefined;
  return { ext, raised: ext >= 1, moving };
}

const written = new WeakMap<Element, string>();
/** Set innerHTML only when the markup changed: no DOM churn (and no re-translation) for identical updates. */
export function setHtml(el: Element, html: string): void {
  if (written.get(el) === html) return;
  written.set(el, html);
  el.innerHTML = html;
}

/** Set textContent only when it changed. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Geographic position as the navigator writes it: 69°20,1' N 033°33,5' E. */
export function latLon(lat: number, lon: number): string {
  const f = (v: number, w: number, pos: string, neg: string) => {
    const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    return `${String(d).padStart(w, '0')}°${m.toFixed(1).padStart(4, '0').replace('.', ',')}' ${v >= 0 ? pos : neg}`;
  };
  return `${f(lat, 2, 'N', 'S')} ${f(lon, 3, 'E', 'W')}`;
}
