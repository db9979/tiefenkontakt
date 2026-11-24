import { CLASSES, RECOG, RECOG_ORDER, choiceOfClass, type ClassId } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { CLASS_LABEL, esc, h } from './format.js';
import type { RecogView } from './recog-render.js';
import { CONVOY_TYPES } from './sea3d/convoy-types.js';

/**
 * Erkennungsheft: a drawer beside the periscope or bridge view with every class one may meet,
 * each as side, bow and top silhouette rendered from its 3D model, with the data for
 * recognition and stadimeter ranging. "Klasse zuweisen" classifies the selected contact
 * exactly like the sonar class buttons do, and adds the precise class.
 */

const GROUP_TITLE = { warship: 'Kriegsschiffe', convoy: 'Geleitzug', submarine: 'U-Boote (aufgetaucht)', neutral: 'Neutrale Schifffahrt' } as const;
const VIEW_TITLE: Record<RecogView, string> = { side: 'SEITE', bow: 'BUG', top: 'DRAUFSICHT' };

let render: typeof import('./recog-render.js') | undefined;
let open: { el: HTMLElement; close(): void } | undefined;

let lastPage: ClassId = 'ffg';

/** Open (or close, when open) the book beside a station; it closes when the station leaves the screen. */
export function toggleRecogBook(title: string, anchor: HTMLElement): void {
  if (open) return open.close();
  let current: ClassId = store.selectedContact()?.assignedCls ?? lastPage;
  const el = h(`<div class="panel recog" style="position:fixed;top:54px;right:8px;bottom:8px;width:min(520px,94vw);z-index:55;display:flex;flex-direction:column;gap:6px;box-shadow:0 0 24px #000">
    <div class="hd"><span>Erkennungsheft · ${esc(title)}</span><button id="rb-close" style="padding:0 8px">✕</button></div>
    <div style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px;min-height:0;flex:1">
      <div id="rb-list" style="overflow:auto;min-height:0"></div>
      <div id="rb-page" style="overflow:auto;min-height:0"></div>
    </div>
    <div id="rb-assign" style="border-top:1px solid var(--line);padding-top:6px"></div>
  </div>`);
  document.body.appendChild(el);
  const q = (s: string) => el.querySelector<HTMLElement>(s)!;
  const close = () => {
    clearInterval(timer);
    el.remove();
    open = undefined;
  };
  open = { el, close };
  q('#rb-close').onclick = close;

  const img = (cls: ClassId, view: RecogView, height: number) => {
    const src = render?.recogImage(cls, view);
    return src ? `<img src="${src}" alt="" style="height:${height}px;max-width:100%;display:block">` : `<div class="dim" style="height:${height}px">…</div>`;
  };
  const list = () => {
    let html = '';
    for (const g of Object.keys(GROUP_TITLE) as (keyof typeof GROUP_TITLE)[]) {
      html += `<div class="dim" style="margin:6px 0 2px">${GROUP_TITLE[g]}</div>`;
      for (const c of RECOG_ORDER.filter((x) => RECOG[x].group === g)) {
        html += `<div class="clickable" data-cls="${c}" style="padding:3px;border:1px solid ${c === current ? 'var(--g)' : 'transparent'};border-radius:3px;cursor:pointer">
          ${img(c, 'side', 22)}<div style="font-size:0.9167rem">${CLASS_LABEL[c]}</div></div>`;
      }
    }
    q('#rb-list').innerHTML = html;
    for (const d of el.querySelectorAll<HTMLElement>('[data-cls]')) d.onclick = () => ((current = lastPage = d.dataset.cls as ClassId), list(), page(), assign());
  };
  /** The convoy is not one class of ship: every type it may contain, side on. */
  const convoyTypes = () => `<div class="dim" style="margin-top:6px">TYPEN IM GELEITZUG</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:2px">${CONVOY_TYPES.map(([t, name]) => {
      const src = render?.convoyImage(t);
      return `<div style="background:var(--well);border:1px solid var(--line);padding:3px">${src ? `<img src="${src}" alt="" style="height:34px;max-width:100%;display:block">` : '<div class="dim" style="height:34px">…</div>'}<div style="font-size:0.8333rem">${name}</div></div>`;
    }).join('')}</div>
    <div class="dim" style="margin-top:4px;line-height:1.45">Größe, Beladung und Farben wechseln von Schiff zu Schiff: in Ballast liegt ein Frachter hoch, das rote Unterwasserschiff zeigt sich.</div>`;
  const page = () => {
    const r = RECOG[current];
    const spec = CLASSES[current];
    const row = (k: string, v: string) => `<div class="row"><span class="dim">${k}</span><span>${v}</span></div>`;
    q('#rb-page').innerHTML = `
      <div class="hd"><span>${esc(spec.name)}</span><span class="dim">${CLASS_LABEL[current]}</span></div>
      <div style="background:var(--well);border:1px solid var(--line);padding:4px;margin:4px 0">
        <div class="dim" style="font-size:0.8333rem">${VIEW_TITLE.side}</div>${img(current, 'side', 96)}
        <div style="display:flex;gap:6px;align-items:flex-end">
          <div><div class="dim" style="font-size:0.8333rem">${VIEW_TITLE.bow}</div>${img(current, 'bow', 80)}</div>
          <div style="flex:1;min-width:0"><div class="dim" style="font-size:0.8333rem">${VIEW_TITLE.top}</div>${img(current, 'top', 58)}</div>
        </div>
      </div>
      ${row('LÄNGE', `${r.length} M`)}${row('BREITE', `${r.beam} M`)}
      ${row('MASTHÖHE (STADIMETER)', `${r.mast} M`)}${row('HÖCHSTFAHRT', `${spec.maxSpeedKn} KN`)}
      ${row('VERDRÄNGUNG', `${spec.tonnage.toLocaleString('de-DE')} T`)}
      <div class="dim" style="margin-top:6px">MERKMALE</div><div style="line-height:1.45">${esc(r.cues)}</div>
      ${current === 'merchant' ? convoyTypes() : ''}
      <div class="dim" style="margin-top:6px;line-height:1.45">Lage: Bug voraus wirkt der Rumpf kurz und hoch, querab zeigt er die volle Länge. Das Stadimeter rechnet mit der Masthöhe der zugewiesenen Klasse.</div>`;
  };
  /** The selected contact and its current assignment, with the assign button. */
  let lastKey = '';
  const assign = () => {
    if (!anchor.isConnected) return close();
    const c = store.selectedContact();
    const key = `${c?.label}|${c?.assignedCls}|${current}`;
    if (key === lastKey) return;
    lastKey = key;
    q('#rb-assign').innerHTML = c
      ? `<div class="row"><span class="dim">KONTAKT · ${esc(c.label)}</span><span>${c.assignedCls ? CLASS_LABEL[c.assignedCls] : 'NICHT ZUGEWIESEN'}</span></div>
         <div style="display:flex;gap:6px;margin-top:4px"><button id="rb-set" class="warn" style="flex:1">Klasse zuweisen · ${CLASS_LABEL[current]}</button>${c.assignedCls ? '<button id="rb-clear">Löschen</button>' : ''}</div>`
      : '<div class="dim">ERST EINEN SICHTKONTAKT WÄHLEN (IM BILD ANKLICKEN), DANN DIE KLASSE ZUWEISEN.</div>';
    const set = el.querySelector<HTMLButtonElement>('#rb-set');
    if (set && c) set.onclick = () => net.send({ t: 'classify', label: c.label, choice: choiceOfClass(current), cls: current });
    const clr = el.querySelector<HTMLButtonElement>('#rb-clear');
    if (clr && c) clr.onclick = () => net.send({ t: 'classify', label: c.label, choice: 'unknown' });
  };
  const timer = setInterval(assign, 400);
  list();
  page();
  assign();
  // Silhouettes: three.js is loaded with the book, then all classes are drawn once
  void import('./recog-render.js').then((m) => {
    render = m;
    m.renderRecog(RECOG_ORDER);
    if (open?.el === el) (list(), page());
  });
}

export function recogBookOpen(): boolean {
  return !!open;
}
