import { onTap } from './touch.js';
import { fitCanvas, setHtml } from './format.js';
import { CLASSES, SYSTEMS, compartmentLayout, type CompartmentView, type ShipSystem, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { cellAt, drawCutaway, type CutawayGeom } from './cutaway.js';

const LABEL: Record<ShipSystem, string> = { antrieb: 'ANTRIEB', sonar: 'SONAR', waffen: 'WAFFEN', leck: 'WASSER IM SCHIFF' };
const EFFECT: Record<ShipSystem, string> = {
  antrieb: 'Höchstfahrt sinkt', sonar: 'Eigenlärm im Rumpfsonar steigt', waffen: 'Nachladen dauert länger, ab 90 % Ausfall',
  leck: 'Anteil der Reserveverdrängung, der vollgelaufen ist: bei 100 % sinkt das Schiff',
};
const CUT_H = 120;

let selected: number | undefined;
let geom: CutawayGeom | undefined;
let raf = 0;

function compsOf(s: Snapshot): CompartmentView[] {
  return s.own.comps ?? compartmentLayout(s.own.cls).map(() => ({ flood: 0, leak: 0, fire: 0, dmg: 0 }));
}

/** The cutaway animates (water, flames) while the panel is on screen. */
function animate(canvas: HTMLCanvasElement): void {
  cancelAnimationFrame(raf);
  const t0 = performance.now();
  const tick = () => {
    const s = store.snap;
    if (!canvas.isConnected) return;
    raf = requestAnimationFrame(tick);
    if (!s || !canvas.offsetParent) return;
    const ctx = fitCanvas(canvas, CUT_H);
    geom = drawCutaway(ctx, canvas.clientWidth || 300, CUT_H, {
      cls: s.own.cls, comps: compsOf(s), wreck: s.own.wreck, dcAt: s.own.dcAt, selected, t: (performance.now() - t0) / 1000,
    });
  };
  raf = requestAnimationFrame(tick);
}

function build(el: HTMLElement): void {
  el.innerHTML = `<div class="hd"><span>Schadensabwehr</span><span id="dp-hp"></span></div>
    <canvas id="dp-cut" style="width:100%;height:${CUT_H}px;cursor:pointer;display:block" title="Klick: Abteilung wählen, Schadenstrupp dorthin"></canvas>
    <div id="dp-sel" class="row" style="min-height:18px"></div>
    <div class="steps" style="margin:2px 0 6px">
      <button id="dp-prio" title="Den Schadenstrupp in diese Abteilung schicken: Lecks dichten, lenzen, Brand löschen, reparieren">Trupp hierhin</button>
      <button id="dp-seal" class="warn" title="Schotten der Abteilung schließen: kein Wasser und kein Feuer gehen weiter, aber ihre Stationen und Systeme fallen aus">Schott schließen</button>
    </div>
    <div id="dp-sys"></div>`;
  const cut = el.querySelector<HTMLCanvasElement>('#dp-cut')!;
  cut.addEventListener('click', (e) => {
    const s = store.snap;
    if (!s || !geom) return;
    const i = cellAt(geom, e.clientX - cut.getBoundingClientRect().left);
    if (i === undefined) return;
    selected = i;
    if (!compsOf(s)[i]?.sealed) net.send({ t: 'compartment', index: i, action: 'priority' });
    renderDamage(el);
  });
  el.querySelector<HTMLButtonElement>('#dp-prio')!.onclick = () => {
    if (selected !== undefined) net.send({ t: 'compartment', index: selected, action: 'priority' });
  };
  el.querySelector<HTMLButtonElement>('#dp-seal')!.onclick = () => {
    const s = store.snap;
    if (!s || selected === undefined) return;
    net.send({ t: 'compartment', index: selected, action: compsOf(s)[selected]?.sealed ? 'open' : 'seal' });
  };
  onTap(el, '[data-sys]', (row) => {
    net.send({ t: 'repair', system: row.dataset.sys as ShipSystem });
  });
  animate(cut);
}

/** Damage control: cutaway of the compartments, bulkhead buttons, system bars (click = repair priority). */
export function renderDamage(el: HTMLElement): void {
  const s = store.snap;
  if (!s) return;
  if (!el.dataset.built) {
    el.dataset.built = '1';
    build(el);
  }
  const o = s.own;
  const comps = compsOf(s);
  const layout = compartmentLayout(o.cls);
  if (selected !== undefined && selected >= comps.length) selected = undefined;
  const hp = Math.max(0, (100 * o.hp) / CLASSES[o.cls].hp);
  const list = o.wreck && Math.abs(o.wreck.list) >= 1 ? ` · SCHLAGSEITE ${Math.abs(o.wreck.list).toFixed(0)}°` : '';
  setHtml(el.querySelector('#dp-hp')!, `<span class="${hp < 50 ? 'red' : 'dim'}">ZUSTAND ${hp.toFixed(0)} %${list}</span>`);
  const at = o.dcAt;
  const sel = selected ?? at;
  const c = sel !== undefined ? comps[sel] : undefined;
  setHtml(el.querySelector('#dp-sel')!, c && sel !== undefined
    ? `<span>${layout[sel]!.name.toUpperCase()}${sel === at ? ' · <span class="green">TRUPP</span>' : ''}</span><span class="${c.fire > 0 || c.flood > 0.3 ? 'red' : 'dim'}">${[
      c.sealed ? 'ABGESCHOTTET' : '', c.flood > 0.01 ? `WASSER ${Math.round(c.flood * 100)} %` : '', c.leak > 0.01 ? 'LECK' : '', c.fire > 0.01 ? 'FEUER' : '',
      c.dmg > 0.05 ? `SCHADEN ${Math.round(c.dmg * 100)} %` : '',
    ].filter(Boolean).join(' · ') || 'KLAR'}</span>`
    : '<span class="dim">ABTEILUNG ANKLICKEN = TRUPP DORTHIN</span>');
  const seal = el.querySelector<HTMLButtonElement>('#dp-seal')!;
  const sealText = c?.sealed ? 'Schott öffnen' : 'Schott schließen';
  if (seal.textContent !== sealText) seal.textContent = sealText;
  seal.disabled = selected === undefined;
  el.querySelector<HTMLButtonElement>('#dp-prio')!.disabled = selected === undefined || !!c?.sealed;
  const d = o.damage;
  setHtml(el.querySelector('#dp-sys')!, SYSTEMS.map((k) => {
    const v = d[k];
    const prio = o.repair === k;
    return `<div class="row clickable ${prio ? 'selrow' : ''}" data-sys="${k}" title="${EFFECT[k]} · Klick: Reparatur-Priorität">
      <span>${prio ? '▸ ' : ''}${LABEL[k]}</span>
      <span style="flex:1;margin:0 8px;background:#132320;height:8px;align-self:center"><span style="display:block;height:8px;width:${Math.round(v * 100)}%;background:${v > 0.6 ? '#f09595' : v > 0.25 ? '#fac775' : '#5dcaa5'}"></span></span>
      <span>${Math.round(v * 100)} %</span></div>`;
  }).join(''));
}
