import { CLASSES } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { activeScope } from '../../widgets/active-scope.js';
import { btnState } from '../../widgets/btn-state.js';
import { h, setHtml } from '../../widgets/format.js';
import { rangePanel } from '../../widgets/range-panel.js';

/**
 * Ortung (surface ships): everything that transmits or measures the water — the active sonar
 * console (PPI, CW/LFM, returns), the bathythermograph for the layer, the variable-depth sonar
 * and the mine-avoidance sonar, and the listening-range prediction built from what was measured.
 */
export function frigateOrtungStation(): Station {
  const el = h(`<div class="cols">
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0" id="as-slot"></div>
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel"><div class="hd"><span>Sonaranlage</span><span id="o-st" class="dim"></span></div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button id="xbt" title="Bathythermograph werfen: misst die Sprungschicht">BT messen</button>
          <button id="vds" title="Tiefensonar unter die Sprungschicht absenken (nur bis 18 kn)">VDS absenken</button>
          <button id="mav" title="Hochfrequentes Minenmeidesonar: findet verankerte Minen voraus bis etwa 1,6 km (±70°), nur bis 15 kn, kaum weit zu hören">Minenmeiden</button>
        </div>
        <div id="o-rows" style="margin-top:6px"></div>
      </div>
      <div id="range-slot"></div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const scope = activeScope({ height: 420 });
  q('#as-slot').appendChild(scope.el);
  const range = rangePanel();
  q('#range-slot').replaceWith(range.el);
  q<HTMLButtonElement>('#xbt').onclick = () => net.send({ t: 'bt' });
  q<HTMLButtonElement>('#mav').onclick = () => net.send({ t: 'toggle', what: 'mineavoid', on: !store.snap?.own.mineAvoid });
  q<HTMLButtonElement>('#vds').onclick = () => net.send({ t: 'toggle', what: 'vds', on: !(store.snap?.own.vdsOrder ?? 0) });

  return {
    title: 'Ortung',
    el,
    snap() {
      const s = store.snap!;
      const o = s.own;
      scope.snap();
      range.update(s);
      btnState(q('#xbt'), o.loadout.xbt ? { label: String(o.loadout.xbt) } : { label: 'LEER', tone: 'empty' });
      btnState(q('#mav'), o.mineAvoid && !o.mineAvoidRange ? { on: true, label: 'ZU SCHNELL', tone: 'warn' } : { on: !!o.mineAvoid });
      const vb = q<HTMLButtonElement>('#vds');
      const hasVds = !!CLASSES[o.cls].vds;
      vb.style.display = hasVds ? '' : 'none';
      vb.textContent = (o.vdsOrder ?? 0) > 0 ? 'VDS einholen' : 'VDS absenken';
      const vd = o.vdsDepth ?? 0, vo = o.vdsOrder ?? 0;
      btnState(vb, Math.abs(vd - vo) > 2 ? { on: vo > 0, label: `${vd} M`, pct: (100 * vd) / Math.max(vd, vo, 1), tone: 'busy' } : { on: vo > 0, label: vo > 0 ? `${vd} M` : undefined });
      q('#o-st').textContent = o.activeSonar ? 'AKTIV' : 'PASSIV';
      setHtml(q('#o-rows'), `
        <div class="row"><span class="dim">SPRUNGSCHICHT</span><span class="${s.env.layerDepth === undefined ? 'amber' : ''}">${s.env.layerDepth !== undefined ? `${s.env.layerDepth} M (GEMESSEN)` : 'UNBEKANNT · BT WERFEN'}</span></div>
        <div class="row"><span class="dim">WASSERTIEFE</span><span>${s.env.bottom !== undefined ? `${s.env.bottom} M` : '—'}</span></div>
        ${hasVds ? `<div class="row"><span class="dim">TIEFENSONAR</span><span>${vo > 0 || vd > 5 ? `${vd} M${vo !== vd ? ` → ${vo} M` : ''}` : 'EINGEHOLT'}</span></div>` : ''}
        <div class="row"><span class="dim">MINENMEIDEN</span><span>${o.mineAvoid ? (o.mineAvoidRange ? `AN · ${o.mineAvoidRange} M VORAUS` : '<span class="amber">ZU SCHNELL (ÜBER 15 KN)</span>') : 'AUS'}</span></div>`);
    },
    frame() {
      scope.frame();
    },
  };
}
