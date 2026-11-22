import { dpr2d } from './perf.js';
import type { ClassChoice, ClassId } from '@tk/shared';

export const deg3 = (d: number) => Math.round(((d % 360) + 360) % 360).toString().padStart(3, '0');
export const deg1 = (d: number) => (((d % 360) + 360) % 360).toFixed(1).replace('.', ',');
export const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',') + ' KM';
export const kn = (v: number) => v.toFixed(1).replace('.', ',') + ' KN';

export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const CLASS_LABEL: Record<ClassId, string> = {
  ssn: 'ATOM-U-BOOT', ssk: 'DIESEL-U-BOOT', ssc: 'KÜSTEN-U-BOOT', ffg: 'FREGATTE', kor: 'KORVETTE', merchant: 'HANDELSSCHIFF',
  ssa: 'AIP-U-BOOT', ffv: 'VDS-FREGATTE', fischer: 'FISCHTRAWLER',
};

export const CHOICE_LABEL: Record<ClassChoice, string> = {
  merchant: 'HANDELSSCHIFF', warship: 'KRIEGSSCHIFF', submarine: 'U-BOOT', torpedo: 'TORPEDO', bio: 'BIOLOGISCH', unknown: 'UNBEKANNT',
};

export const CLASS_NAME: Record<Exclude<ClassId, 'merchant' | 'fischer'>, { title: string; info: string }> = {
  ffg: { title: 'Fregatte F-12', info: 'Rumpf- und Schleppsonar, Radar, U-Jagd-Raketen' },
  ssn: { title: 'Atom-U-Boot Projekt 9', info: 'Schnell, unbegrenzte Ausdauer, laut bei hoher Fahrt' },
  ssk: { title: 'Diesel-U-Boot Projekt 4', info: 'Sehr leise, begrenzte Batterie, muss schnorcheln' },
  ssc: { title: 'Küsten-U-Boot Projekt 2', info: 'Extrem leise, klein und wendig; nur 4 Rohre, kleine Batterie, 200 m' },
  kor: { title: 'Korvette K-7', info: 'Leise, schnell, wendig; kurzes Schleppsonar, kein Hubschrauber' },
  ffv: { title: 'Fregatte F-30 (VDS)', info: 'Tiefensonar lässt sich unter die Sprungschicht absenken (bis 18 kn); kein Hubschrauber' },
  ssa: { title: 'U-Boot Projekt 6 (AIP)', info: 'Außenluftunabhängig: bis 5 kn ohne Batterieverbrauch, sehr leise; 250 m' },
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
