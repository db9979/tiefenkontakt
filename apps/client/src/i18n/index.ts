import { EN_HELP, EN_PHRASES } from './en-help.js';
import { EN_CANVAS, EN_MORE, EN_MORE_PHRASES } from './en-more.js';
import { EN_UI } from './en-ui.js';
import { EN_UX, EN_UX_PHRASES } from './en-ux.js';
import { EN_DAMAGE_PHRASES } from './en-damage.js';
import { EN_TUTORIAL } from './en-tutorial.js';
import { EN_RANKS, EN_RANKS_PHRASES } from './en-ranks.js';
import { EN_RANGE, EN_RANGE_PHRASES } from './en-range.js';
import { EN_RECOG, EN_RECOG_PHRASES } from './en-recog.js';
import { EN_WEAPONS, EN_WEAPONS_PHRASES } from './en-weapons.js';

/**
 * Language switch. The UI is written in German; for English, rendered text nodes and
 * title/placeholder attributes are translated as they appear (dictionary first, then
 * phrase rules for text with numbers). Canvas drawings, radio messages and text typed
 * by players stay as they are.
 */

export type Lang = 'de' | 'en';
export const lang: Lang = (localStorage.getItem('tk_lang') as Lang | null) ?? (navigator.language.startsWith('de') ? 'de' : 'en');

const dict = new Map<string, string>([...EN_RECOG, ...EN_UI, ...EN_HELP, ...EN_MORE, ...EN_UX, ...EN_TUTORIAL, ...EN_RANKS, ...EN_RANGE, ...EN_WEAPONS]);
const canvasDict = new Map<string, string>(EN_CANVAS);
const PHRASES = [...EN_WEAPONS_PHRASES, ...EN_RECOG_PHRASES, ...EN_RANGE_PHRASES, ...EN_RANKS_PHRASES, ...EN_DAMAGE_PHRASES, ...EN_UX_PHRASES, ...EN_PHRASES, ...EN_MORE_PHRASES];
const memo = new Map<string, string>();

/** Translate one string for the current language (German passes through). */
export function t(de: string): string {
  if (lang === 'de') return de;
  const m = memo.get(de);
  if (m !== undefined) return m;
  const out = translate(de);
  if (location.port === '5173') (window as unknown as { __tkT?: typeof t }).__tkT = t;
  // Dev aid: collect what still looks German (window.__tkUntranslated)
  if (location.port === '5173' && /[äöüÄÖÜß]|\b(und|der|die|das|nicht|mit|auf|kein|wird|ist|UND|DER|DIE|NICHT|MIT|AUF|KEIN|IST|BEI|ZUM)\b/.test(out)) {
    ((window as unknown as { __tkUntranslated?: Set<string> }).__tkUntranslated ??= new Set()).add(out);
  }
  if (memo.size > 5000) memo.clear();
  memo.set(de, out);
  return out;
}

function translate(de: string): string {
  const hit = dict.get(de);
  if (hit !== undefined) return hit;
  // Bullets and markers in front of a known sentence: "▸ Güte über 60 % bringen"
  const lead = /^([▸·✓•–\s]+)(.+)$/.exec(de);
  if (lead) return lead[1]! + translate(lead[2]!);
  // Sort arrows after a column name: "PEILUNG ▲"
  const tail = /^(.+?)( [▲▼])$/.exec(de);
  if (tail) return translate(tail[1]!) + tail[2]!;
  // Composite labels like "1 · OPZ" or "Westbund · Geleitschutz": translate each part
  const parts = de.includes(' · ') ? de.split(' · ') : undefined;
  // Every part known: done (the phrase rules below are for German text, not for our English)
  if (parts?.every((p) => dict.has(p))) return parts.map((p) => dict.get(p)!).join(' · ');
  let out = parts ? parts.map((p) => dict.get(p) ?? p).join(' · ') : de;
  for (const [re, rep] of PHRASES) out = out.replace(re, rep);
  out = out.replace(/^(\d+ · )(.+)$/, (_m, n: string, rest: string) => n + (dict.get(rest) ?? rest));
  return out;
}

function translateText(node: Text): void {
  const raw = node.data;
  const s = raw.trim();
  if (!s || !(/[A-Za-zÄÖÜäöü]{2}/.test(s) || /\d,\d/.test(s))) return;
  const norm = s.replace(/\s+/g, ' ');
  // Our own output comes back through the observer: translating it again would undo e.g.
  // "50,000" (English thousands) as if it were a German decimal comma
  if (produced.has(norm)) return;
  const en = t(norm);
  if (en !== norm) node.data = raw.replace(s, mark(en));
}

/** Texts this module wrote into the page. */
const produced = new Set<string>();
const mark = (en: string): string => {
  if (produced.size > 5000) produced.clear();
  produced.add(en);
  return en;
};

const ATTRS = ['title', 'placeholder'] as const;
const SKIP = '.radio, input, textarea, [data-noi18n]';

function translateTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!root.parentElement?.closest(SKIP)) translateText(root as Text);
    return;
  }
  if (!(root instanceof Element) || root.closest(SKIP)) return;
  for (const a of ATTRS) {
    const v = root.getAttribute(a);
    if (v && !produced.has(v)) {
      const en = t(v);
      if (en !== v) root.setAttribute(a, mark(en));
    }
  }
  for (const el of root.querySelectorAll(`[title],[placeholder]`)) {
    if (el.closest(SKIP) && el.tagName !== 'INPUT') continue;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && !produced.has(v)) {
        const en = t(v);
        if (en !== v) el.setAttribute(a, mark(en));
      }
    }
  }
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.parentElement?.closest(SKIP)) translateText(n as Text);
  }
}

export function setLang(l: Lang): void {
  localStorage.setItem('tk_lang', l);
  location.reload();
}

/** Start translating the page (no-op in German) and show the DE/EN switch. */
export function initI18n(): void {
  document.documentElement.lang = lang;
  const sw = document.createElement('button');
  sw.className = 'langbtn';
  sw.dataset.noi18n = '1';
  sw.textContent = lang === 'de' ? 'EN' : 'DE';
  sw.title = lang === 'de' ? 'Switch to English' : 'Auf Deutsch umschalten';
  sw.onclick = () => setLang(lang === 'de' ? 'en' : 'de');
  document.body.appendChild(sw);
  if (lang === 'de') return;
  patchCanvas();
  translateTree(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') translateTree(m.target);
      else if (m.type === 'attributes') translateTree(m.target);
      else m.addedNodes.forEach(translateTree);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
}

/** Canvas labels (plot, waterfall, scope, depth profile) go through the same dictionary. */
function patchCanvas(): void {
  const proto = CanvasRenderingContext2D.prototype;
  const fill = proto.fillText;
  const stroke = proto.strokeText;
  const measure = proto.measureText;
  const tr = (s: string) => (typeof s === 'string' && /[A-Za-zÄÖÜäöü]/.test(s) ? canvasDict.get(s) ?? t(s) : s);
  proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    return maxWidth === undefined ? fill.call(this, tr(text), x, y) : fill.call(this, tr(text), x, y, maxWidth);
  };
  proto.strokeText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    return maxWidth === undefined ? stroke.call(this, tr(text), x, y) : stroke.call(this, tr(text), x, y, maxWidth);
  };
  proto.measureText = function (this: CanvasRenderingContext2D, text: string) {
    return measure.call(this, tr(text));
  };
}
