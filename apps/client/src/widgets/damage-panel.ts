import { onTap } from './touch.js';
import { fitCanvas, setHtml } from './format.js';
import { CLASSES, SYSTEMS, compartmentLayout, type CompartmentView, type ShipSystem, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { cellAt, drawCutaway, sysTags, type CutawayGeom } from './cutaway.js';

const LABEL: Record<ShipSystem, string> = { antrieb: 'ANTRIEB', sonar: 'SONAR', waffen: 'WAFFEN', leck: 'WASSER IM SCHIFF' };
const EFFECT: Record<ShipSystem, string> = {
  antrieb: 'Höchstfahrt sinkt', sonar: 'Eigenlärm im Rumpfsonar steigt', waffen: 'Nachladen dauert länger, ab 90 % Ausfall',
  leck: 'Anteil der Reserveverdrängung, der vollgelaufen ist: bei 100 % sinkt das Schiff',
};
/** Cutaway height follows the panel width (the ship is long and low). */
const cutH = (w: number) => Math.round(Math.max(110, Math.min(200, w * 0.5)));

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
    const H = cutH(canvas.clientWidth || 300);
    const ctx = fitCanvas(canvas, H);
    geom = drawCutaway(ctx, canvas.clientWidth || 300, H, {
      cls: s.own.cls, comps: compsOf(s), wreck: s.own.wreck, dcAt: s.own.dcAt, selected, t: (performance.now() - t0) / 1000,
    });
  };
  raf = requestAnimationFrame(tick);
}

function build(el: HTMLElement): void {
  el.innerHTML = `<div class="hd"><span>Schadensabwehr</span><span id="dp-hp"></span></div>
    <canvas id="dp-cut" class="keep" style="width:100%;cursor:pointer;display:block;background:#06100e;border-radius:3px" title="Klick: Abteilung wählen, Schadenstrupp dorthin"></canvas>
    <div id="dp-state" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:4px;margin:6px 0"></div>
    <div class="dim" style="margin-top:4px;font-size:0.8333rem">ABTEILUNGEN · A ANTRIEB · S SONAR · W WAFFEN · B BATTERIE · M MAGAZIN</div>
    <div id="dp-comps"></div>
    <div class="dim" style="margin-top:8px">SYSTEME · KLICK = REPARATUR ZUERST</div>
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
  onTap(el, '[data-cact]', (b) => {
    const s = store.snap;
    const i = Number(b.dataset.ci);
    if (!s || !Number.isFinite(i)) return;
    selected = i;
    const sealed = compsOf(s)[i]?.sealed;
    if (b.dataset.cact === 'party' && !sealed) net.send({ t: 'compartment', index: i, action: 'priority' });
    if (b.dataset.cact === 'seal') net.send({ t: 'compartment', index: i, action: sealed ? 'open' : 'seal' });
    renderDamage(el);
  });
  onTap(el, '[data-crow]', (r) => {
    selected = Number(r.dataset.crow);
    renderDamage(el);
  });
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
  const w = o.wreck;
  const gauge = (label: string, value: string, bad: boolean) => `<div style="border:1px solid var(--line);padding:3px 5px"><div class="dim" style="font-size:0.75rem">${label}</div><div class="${bad ? 'red' : ''}">${value}</div></div>`;
  const water = Math.round(o.damage.leck * 100);
  setHtml(el.querySelector('#dp-state')!, [
    gauge('ZUSTAND', `${hp.toFixed(0)} %`, hp < 50),
    gauge('SCHLAGSEITE', `${Math.abs(w?.list ?? 0).toFixed(0)}° ${(w?.list ?? 0) > 0.5 ? 'STB' : (w?.list ?? 0) < -0.5 ? 'BB' : ''}`, Math.abs(w?.list ?? 0) > 10),
    gauge('TRIMM', `${Math.abs(w?.trim ?? 0).toFixed(1)}° ${(w?.trim ?? 0) > 0.2 ? 'BUGLASTIG' : (w?.trim ?? 0) < -0.2 ? 'HECKLASTIG' : ''}`, Math.abs(w?.trim ?? 0) > 3),
    gauge('WASSER IM SCHIFF', `${water} %${water > 70 ? ' · SINKT BALD' : ''}`, water > 50),
  ].join(''));
  const cell = (v: number, warnAt: number, txt: string) => (v > 0.01 ? `<span class="${v >= warnAt ? 'red' : 'amber'}">${txt}</span>` : '<span class="dim">–</span>');
  setHtml(el.querySelector('#dp-comps')!, comps.map((c, i) => {
    const spec = layout[i]!;
    const sel = i === selected;
    const tags = sysTags(spec).join(' ');
    const chips = [
      c.flood > 0.01 ? `<span class="${c.flood >= 0.4 ? 'red' : 'amber'}">WASSER ${Math.round(c.flood * 100)} %</span>` : '',
      c.fire > 0.01 ? `<span class="red">${c.fire > 0.5 ? 'BRAND' : 'FEUER'}</span>` : '',
      c.leak > 0.01 ? `<span class="${c.leak >= 0.5 ? 'red' : 'amber'}">LECK ${c.leak > 0.5 ? 'GROSS' : 'KLEIN'}</span>` : '',
      c.dmg > 0.05 ? `<span class="${c.dmg >= 0.5 ? 'red' : 'amber'}">SCHADEN ${Math.round(c.dmg * 100)} %</span>` : '',
    ].filter(Boolean).join(' · ') || '<span class="dim">KLAR</span>';
    return `<div class="clickable ${sel ? 'selrow' : ''}" data-crow="${i}" style="border-top:1px solid var(--line);padding:3px 0">
      <div class="row" style="align-items:center"><span><b>${i + 1}</b> ${spec.name.toUpperCase()} <span class="dim">${tags}</span>${i === at ? ' <span class="green">◆ TRUPP</span>' : ''}${c.sealed ? ' <span class="amber">ABGESCHOTTET</span>' : ''}</span>
        <span style="white-space:nowrap"><button data-cact="party" data-ci="${i}" ${c.sealed || i === at ? 'disabled' : ''} title="Den Schadenstrupp hierher: Lecks dichten, lenzen, Brand löschen, reparieren" style="padding:0 5px;min-height:0">Trupp</button><button data-cact="seal" data-ci="${i}" class="warn" title="${c.sealed ? 'Schott öffnen: der Trupp kann wieder hinein' : 'Schotten schließen: kein Wasser und kein Feuer gehen weiter, aber ihre Stationen und Systeme fallen aus'}" style="padding:0 5px;min-height:0">${c.sealed ? 'Öffnen' : 'Schott'}</button></span></div>
      <div style="font-size:0.8333rem">${chips}</div>
    </div>`;
  }).join(''));
  const d = o.damage;
  setHtml(el.querySelector('#dp-sys')!, SYSTEMS.map((k) => {
    const v = d[k];
    const prio = o.repair === k;
    return `<div class="row clickable ${prio ? 'selrow' : ''}" data-sys="${k}" title="${EFFECT[k]} · Klick: Reparatur-Priorität">
      <span>${prio ? '▸ ' : ''}${LABEL[k]}</span>
      <span style="flex:1;margin:0 8px;background:var(--track);height:8px;align-self:center"><span style="display:block;height:8px;width:${Math.round(v * 100)}%;background:${v > 0.6 ? 'var(--red)' : v > 0.25 ? 'var(--amber)' : 'var(--g)'}"></span></span>
      <span>${Math.round(v * 100)} %</span></div>
      ${v > 0.05 ? `<div class="dim" style="font-size:0.75rem;margin:-2px 0 4px">${EFFECT[k]}</div>` : ''}`;
  }).join(''));
}
