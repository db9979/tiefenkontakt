import { CLASSES, RECOG, RECOG_ORDER, choiceOfClass, type ClassId } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { CLASS_LABEL, esc, h } from './format.js';
import type { Pics } from './recog-draw.js';
import { TAB_TITLE, akustikTab, bedrohungTab, defaultGhost, sichtTab, type RecogTab } from './recog-pages.js';
import { CONVOY_TYPES } from './sea3d/convoy-types.js';

/**
 * Erkennungsheft: a drawer beside the periscope or bridge view with every class one may meet.
 * Each class page has three tabs: SICHT (side, top and bow silhouette rendered from the 3D
 * model, all classes of a category at one common scale, with lookalikes), AKUSTIK (screw and
 * narrowband lines from the signature tables) and BEDROHUNG (weapons, sensors and their
 * ranges). "Klasse zuweisen" classifies the selected contact exactly like the sonar class
 * buttons do, and adds the precise class. On a phone the class list becomes a strip on top.
 */

const GROUP_TITLE = { warship: 'Kriegsschiffe', convoy: 'Geleitzug', submarine: 'U-Boote (aufgetaucht)', neutral: 'Neutrale Schifffahrt' } as const;

const CSS = `
.recog .rb-body { display:grid; grid-template-columns:150px minmax(0,1fr); gap:8px; min-height:0; flex:1; }
.recog .rb-list { overflow:auto; min-height:0; }
.recog .rb-main { display:flex; flex-direction:column; min-height:0; }
.recog .rb-tabs { display:flex; gap:4px; }
.recog .rb-tabs button { flex:1; padding:4px 2px; }
.recog #rb-page { overflow:auto; min-height:0; flex:1; padding-right:2px; }
.recog .rb-svg text { font-family:inherit; }
@media (max-width: 600px) {
  .recog { left:4px !important; right:4px !important; width:auto !important; top:46px !important; bottom:4px !important; }
  .recog .rb-body { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); gap:4px; }
  .recog .rb-list { display:flex; gap:4px; overflow-x:auto; overflow-y:hidden; padding-bottom:2px; }
  .recog .rb-list .rb-grp { display:none; }
  .recog .rb-list [data-cls] { flex:none; width:86px; }
}`;

let render: typeof import('./recog-render.js') | undefined;
let open: { el: HTMLElement; close(): void } | undefined;

let lastPage: ClassId = 'ffg';
let lastTab: RecogTab = 'sicht';

const pics: Pics = {
  image: (c, p) => render?.recogImage(c, p),
  meta: (c) => render?.recogMeta(c),
};

function addStyle(): void {
  if (document.getElementById('rb-style')) return;
  const s = document.createElement('style');
  s.id = 'rb-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Open (or close, when open) the book beside a station; it closes when the station leaves the screen. */
export function toggleRecogBook(title: string, anchor: HTMLElement): void {
  if (open) return open.close();
  addStyle();
  let current: ClassId = store.selectedContact()?.assignedCls ?? lastPage;
  let ghost = defaultGhost(current);
  const el = h(`<div class="panel recog" style="position:fixed;top:54px;right:8px;bottom:8px;width:min(620px,94vw);z-index:55;display:flex;flex-direction:column;gap:6px;box-shadow:0 0 24px #000">
    <div class="hd"><span>Erkennungsheft · ${esc(title)}</span><button id="rb-close" style="padding:0 8px">✕</button></div>
    <div class="rb-body">
      <div id="rb-list" class="rb-list"></div>
      <div class="rb-main">
        <div class="rb-tabs">${(Object.keys(TAB_TITLE) as RecogTab[]).map((t) => `<button data-tab="${t}">${TAB_TITLE[t]}</button>`).join('')}</div>
        <div id="rb-page"></div>
      </div>
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

  const go = (cls: ClassId) => {
    current = lastPage = cls;
    ghost = defaultGhost(cls);
    list();
    page();
    assign();
  };
  const img = (cls: ClassId, height: number) => {
    const src = pics.image(cls, 'side');
    return src ? `<img src="${src}" alt="" style="height:${height}px;max-width:100%;display:block;object-fit:contain;object-position:left">` : `<div class="dim" style="height:${height}px">…</div>`;
  };
  const list = () => {
    let html = '';
    for (const g of Object.keys(GROUP_TITLE) as (keyof typeof GROUP_TITLE)[]) {
      html += `<div class="dim rb-grp" style="margin:6px 0 2px">${GROUP_TITLE[g]}</div>`;
      for (const c of RECOG_ORDER.filter((x) => RECOG[x].group === g)) {
        html += `<div class="clickable" data-cls="${c}" style="padding:3px;border:1px solid ${c === current ? 'var(--g)' : 'transparent'};border-radius:3px;cursor:pointer">
          ${img(c, 22)}<div style="font-size:0.9167rem">${CLASS_LABEL[c]}</div></div>`;
      }
    }
    const box = q('#rb-list');
    box.innerHTML = html;
    for (const d of el.querySelectorAll<HTMLElement>('[data-cls]')) d.onclick = () => go(d.dataset.cls as ClassId);
    box.querySelector<HTMLElement>(`[data-cls="${current}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  /** The convoy is not one class of ship: every type it may contain, side on. */
  const convoyTypes = () => `<div class="dim" style="margin-top:8px">TYPEN IM GELEITZUG</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:2px">${CONVOY_TYPES.map(([t, name]) => {
      const src = render?.convoyImage(t);
      return `<div style="background:var(--well);border:1px solid var(--line);padding:3px">${src ? `<img src="${src}" alt="" style="height:34px;max-width:100%;display:block;object-fit:contain;object-position:left">` : '<div class="dim" style="height:34px">…</div>'}<div style="font-size:0.8333rem">${name}</div></div>`;
    }).join('')}</div>
    <div class="dim" style="margin-top:4px;line-height:1.45">Größe, Beladung und Farben wechseln von Schiff zu Schiff: in Ballast liegt ein Frachter hoch, das rote Unterwasserschiff zeigt sich.</div>`;
  const page = () => {
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.classList.toggle('on', b.dataset.tab === lastTab);
    const body = lastTab === 'akustik' ? akustikTab(current)
      : lastTab === 'bedrohung' ? bedrohungTab(current)
      : sichtTab(pics, current, ghost, RECOG_ORDER, current === 'merchant' ? convoyTypes() : '');
    const pg = q('#rb-page');
    const keep = pg.dataset.cls === current ? pg.scrollTop : 0;
    pg.dataset.cls = current;
    pg.innerHTML = `<div class="hd"><span>${esc(CLASSES[current].name)}</span><span class="dim">${CLASS_LABEL[current]}</span></div>${body}`;
    pg.scrollTop = keep;
    const sel = pg.querySelector<HTMLSelectElement>('#rb-ghost');
    if (sel) sel.onchange = () => ((ghost = (sel.value || undefined) as ClassId | undefined), page());
    for (const d of pg.querySelectorAll<HTMLElement>('[data-go]')) d.onclick = () => go(d.dataset.go as ClassId);
  };
  for (const b of el.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.onclick = () => ((lastTab = b.dataset.tab as RecogTab), page());
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
