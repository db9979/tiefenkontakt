import { CLASSES, SYSTEMS, type ShipSystem } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';

const LABEL: Record<ShipSystem, string> = { antrieb: 'ANTRIEB', sonar: 'SONAR', waffen: 'WAFFEN', leck: 'WASSEREINBRUCH' };
const EFFECT: Record<ShipSystem, string> = {
  antrieb: 'Höchstfahrt sinkt', sonar: 'Eigenlärm im Rumpfsonar steigt', waffen: 'Nachladen dauert länger, ab 90 % Ausfall',
  leck: 'Zustand sinkt laufend, U-Boot verliert Tauchtiefe',
};

/** Damage control: bars per system; clicking a row makes it the repair priority. */
export function renderDamage(el: HTMLElement): void {
  const s = store.snap;
  if (!s) return;
  const d = s.own.damage;
  const any = SYSTEMS.some((k) => d[k] > 0);
  el.innerHTML = `<div class="hd"><span>Schadensabwehr</span><span class="${s.own.hp < CLASSES[s.own.cls].hp / 2 ? 'red' : 'dim'}">ZUSTAND ${Math.max(0, (100 * s.own.hp) / CLASSES[s.own.cls].hp).toFixed(0)} %</span></div>` +
    (any
      ? SYSTEMS.map((k) => {
        const v = d[k];
        const prio = s.own.repair === k;
        return `<div class="row clickable ${prio ? 'selrow' : ''}" data-sys="${k}" title="${EFFECT[k]} · Klick: Reparatur-Priorität">
          <span>${prio ? '▸ ' : ''}${LABEL[k]}</span>
          <span style="flex:1;margin:0 8px;background:#132320;height:8px;align-self:center"><span style="display:block;height:8px;width:${Math.round(v * 100)}%;background:${v > 0.6 ? '#f09595' : v > 0.25 ? '#fac775' : '#5dcaa5'}"></span></span>
          <span>${Math.round(v * 100)} %</span></div>`;
      }).join('') + '<div class="dim">KLICK AUF EIN SYSTEM = ZUERST REPARIEREN</div>'
      : '<div class="dim">KEINE SCHÄDEN</div>');
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('mousedown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-sys]');
      if (row) net.send({ t: 'repair', system: row.dataset.sys as ShipSystem });
    });
  }
}
