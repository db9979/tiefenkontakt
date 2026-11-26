import { onTap } from './touch.js';
import { fitCanvas, setHtml } from './format.js';
import { CLASSES, SYSTEMS, compartmentLayout, type CompartmentView, type ShipSystem, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { trimDeg, trimText } from './depth-profile.js';
import { cellAt, compColour, cutawayBg, drawCutaway, sysTags, type CutawayGeom } from './cutaway.js';

const LABEL: Record<ShipSystem, string> = { antrieb: 'ANTRIEB', sonar: 'SONAR', waffen: 'WAFFEN', leck: 'WASSER' };
const EFFECT: Record<ShipSystem, string> = {
  antrieb: 'Höchstfahrt sinkt', sonar: 'Eigenlärm im Rumpfsonar steigt', waffen: 'Nachladen dauert länger, ab 90 % Ausfall',
  leck: 'Vollgelaufener Anteil der Reserveverdrängung: bei 100 % sinkt das Schiff',
};
const TAG_NAME: Record<string, string> = { A: 'Antrieb', S: 'Sonar', W: 'Waffen', B: 'Batterie', M: 'Magazin' };

/** Cutaway height follows the panel width (the ship is long and low). */
const cutH = (w: number) => Math.round(Math.max(96, Math.min(170, w * 0.36)));

const CSS = `<style>
.dp-strip{display:flex;flex-wrap:wrap;gap:3px 10px;margin:5px 0 4px;font-size:0.9167rem}
.dp-strip b{font-weight:normal;color:var(--dim);margin-right:3px}
.dp-tbl{display:grid;grid-template-columns:14px minmax(0,1fr) 52px 30px;align-items:center;column-gap:5px;font-size:0.9167rem}
.dp-tbl>div{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 0;border-top:1px solid var(--line)}
.dp-tbl .h{color:var(--dim);font-size:var(--fs-cap);border-top:none;padding:0 0 1px}
.dp-row{cursor:pointer}
.dp-sel{background:rgba(250,199,117,0.12)}
html[data-theme='light'] .dp-sel{background:#fbf0d6}
.dp-bar{position:relative;height:9px;background:var(--track);border-radius:1px}
.dp-bar>i{position:absolute;left:0;top:0;bottom:0;display:block}
.dp-bar>span{position:absolute;right:2px;top:-3px;font-size:var(--fs-cap);line-height:15px;color:var(--g2)}
.dp-fl{display:inline-block;width:14px;text-align:center;font-weight:bold}
.dp-act{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:4px 0 0;padding:4px;border:1px solid var(--line2);border-radius:3px;font-size:0.8333rem}
.dp-act>span{flex:1 1 100%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dp-act button{flex:1 1 0;padding:2px 4px;min-height:0;font-size:var(--fs-cap);white-space:nowrap}
.dp-sys{display:grid;grid-template-columns:62px minmax(0,1fr) 34px;align-items:center;column-gap:6px;font-size:0.9167rem}
.dp-sys>div{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 0}
</style>`;

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
    const w = canvas.clientWidth || 300;
    const H = cutH(w);
    const ctx = fitCanvas(canvas, H);
    const bg = cutawayBg();
    if (canvas.style.background !== bg) canvas.style.background = bg;
    geom = drawCutaway(ctx, w, H, {
      cls: s.own.cls, comps: compsOf(s), wreck: s.own.wreck, dcAt: s.own.dcAt, selected, t: (performance.now() - t0) / 1000,
    });
  };
  raf = requestAnimationFrame(tick);
}

function build(el: HTMLElement): void {
  el.style.overflowX = 'hidden';
  el.innerHTML = `${CSS}<div class="hd dp-hd"><span>Schadensabwehr</span><span id="dp-hp"></span></div>
    <canvas id="dp-cut" class="keep" style="width:100%;cursor:pointer;display:block;border-radius:3px;border:1px solid var(--line)" title="Klick: Abteilung wählen, Schadenstrupp dorthin"></canvas>
    <div id="dp-state" class="dp-strip"></div>
    <div id="dp-comps" class="dp-tbl"></div>
    <div id="dp-act" class="dp-act"></div>
    <div class="dim" style="margin:8px 0 2px;font-size:var(--fs-cap)">SYSTEME · KLICK = REPARATUR ZUERST</div>
    <div id="dp-sys" class="dp-sys"></div>`;
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

const bar = (v: number, colour: string, text = `${Math.round(v * 100)}`) =>
  `<div class="dp-bar"><i style="width:${Math.round(Math.min(1, v) * 100)}%;background:${colour}"></i>${v > 0.005 ? `<span>${text}</span>` : ''}</div>`;

/** Damage control: cutaway of the compartments, one line per compartment, system bars (click = repair priority). */
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
  setHtml(el.querySelector('#dp-hp')!, `<span class="${hp < 50 ? 'red' : hp < 80 ? 'amber' : 'dim'}">${hp.toFixed(0)} %</span>`);
  const w = o.wreck;
  const list = w?.list ?? 0;
  // Trim angle as the Zentrale shows it (flooding plus the weight out of trim on a boat)
  const trim = trimDeg(o);
  const water = Math.round(o.damage.leck * 100);
  const burning = comps.filter((c) => c.fire > 0.02).length;
  const val = (label: string, v: string, cls = '') => `<span><b>${label}</b><span class="${cls}">${v}</span></span>`;
  setHtml(el.querySelector('#dp-state')!, [
    val('SCHLAGSEITE', `${Math.abs(list).toFixed(0)}°${list > 0.5 ? ' STB' : list < -0.5 ? ' BB' : ''}`, Math.abs(list) > 10 ? 'red' : Math.abs(list) > 3 ? 'amber' : ''),
    val('TRIMM', trimText(trim), Math.abs(trim) > 3 ? 'red' : Math.abs(trim) > 1 ? 'amber' : ''),
    val('WASSER', `${water} %${water > 70 ? ' SINKT' : ''}`, water > 50 ? 'red' : water > 15 ? 'amber' : ''),
    burning ? val('BRAND', `${burning} ABT.`, 'red') : '',
  ].join(''));
  const at = o.dcAt;
  const head = '<div class="h">#</div><div class="h">ABTEILUNG</div><div class="h">WASSER</div><div class="h">LAGE</div>';
  const pick = selected ?? at ?? 0;
  setHtml(el.querySelector('#dp-comps')!, head + comps.map((c, i) => {
    const spec = layout[i]!;
    const cls = `dp-row${i === pick ? ' dp-sel' : ''}`;
    const tags = sysTags(spec);
    const flags = [
      c.fire > 0.02 ? `<span class="dp-fl" style="color:${compColour({ flood: 0, leak: 0, dmg: 0, fire: 1 })}" title="Brand ${Math.round(c.fire * 100)} %">F</span>` : '',
      c.leak > 0.01 ? `<span class="dp-fl ${c.leak >= 0.5 ? 'red' : 'amber'}" title="Leck ${c.leak > 0.5 ? 'groß' : 'klein'}">L</span>` : '',
      c.dmg > 0.05 ? `<span class="dp-fl ${c.dmg >= 0.5 ? 'red' : 'amber'}" title="Schaden ${Math.round(c.dmg * 100)} %">S</span>` : '',
    ].join('') || '<span class="dim">–</span>';
    const name = `${i === at ? '<span style="color:var(--g)">◆</span>' : ''}${c.sealed ? '<span class="amber">▮</span>' : ''}${spec.name.toUpperCase()}${tags.length ? ` <span class="dim">${tags.join('')}</span>` : ''}`;
    const row = `data-crow="${i}" class="${cls}"`;
    return `<div ${row} style="color:${compColour(c)};font-weight:bold">${i + 1}</div><div ${row} title="${spec.name}${tags.length ? ` · ${tags.map((t) => TAG_NAME[t]).join(', ')}` : ''}">${name}</div><div ${row}>${bar(c.flood, c.flood >= 0.4 ? 'var(--red)' : 'var(--blue)')}</div><div ${row}>${flags}</div>`;
  }).join(''));
  // Orders for the picked compartment
  const pc = comps[pick];
  const ps = layout[pick];
  if (pc && ps) {
    const state = [
      pc.flood > 0.01 ? `WASSER ${Math.round(pc.flood * 100)} %` : '',
      pc.fire > 0.02 ? 'BRAND' : '',
      pc.leak > 0.01 ? `LECK ${pc.leak > 0.5 ? 'GROSS' : 'KLEIN'}` : '',
      pc.dmg > 0.05 ? `SCHADEN ${Math.round(pc.dmg * 100)} %` : '',
      pc.sealed ? 'ABGESCHOTTET' : '',
    ].filter(Boolean).join(' · ') || 'KLAR';
    setHtml(el.querySelector('#dp-act')!, `<span><b style="color:${compColour(pc)}">${pick + 1}</b> ${ps.name.toUpperCase()} <span class="dim">${state}</span></span>
      <button data-cact="party" data-ci="${pick}" class="${pick === at ? 'on' : ''}" ${pc.sealed || pick === at ? 'disabled' : ''} title="Schadenstrupp hierher: Lecks dichten, lenzen, Brand löschen, reparieren">${pick === at ? 'TRUPP IST HIER' : 'TRUPP HIERHER'}</button>
      <button data-cact="seal" data-ci="${pick}" class="warn" title="${pc.sealed ? 'Schott öffnen: der Trupp kann wieder hinein' : 'Schotten schließen: Wasser und Feuer gehen nicht weiter, aber Stationen und Systeme darin fallen aus'}">${pc.sealed ? 'SCHOTT ÖFFNEN' : 'ABSCHOTTEN'}</button>`);
  }
  const d = o.damage;
  setHtml(el.querySelector('#dp-sys')!, SYSTEMS.map((k) => {
    const v = d[k];
    const prio = o.repair === k;
    const col = v > 0.6 ? 'var(--red)' : v > 0.25 ? 'var(--amber)' : 'var(--g)';
    const attrs = `data-sys="${k}" class="clickable${prio ? ' selrow' : ''}" title="${EFFECT[k]} · Klick: Reparatur zuerst"`;
    return `<div ${attrs}>${prio ? '▸' : ''}${LABEL[k]}</div><div ${attrs}>${bar(v, col, '')}</div><div ${attrs} style="text-align:right">${Math.round(v * 100)} %</div>`;
  }).join(''));
}
