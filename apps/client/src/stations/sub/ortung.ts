import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { activeScope } from '../../widgets/active-scope.js';
import { periscopeEsmRows } from '../../widgets/esm-text.js';
import { h, mastState, setHtml } from '../../widgets/format.js';
import { rangePanel } from '../../widgets/range-panel.js';
import { threatPanel } from '../../widgets/threat-panel.js';

/**
 * Ortung (submarines): the picture beyond passive listening — who is hunting us (threat panel
 * with the evasion proposal), radar intercepts on the mast, the active sonar console for when a
 * range is worth giving ourselves away, the echo sounder, and the listening-range prediction.
 */
export function subOrtungStation(): Station {
  const el = h(`<div class="cols">
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div id="threat-slot"></div>
      <div id="as-slot"></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel"><div class="hd"><span>ESM · Radarwarnung</span><span id="esm-st" class="dim"></span></div><div id="esm"></div></div>
      <div class="panel"><div class="hd"><span>Echolot</span><span id="snd-st" class="dim"></span></div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <button id="sound" title="Ein Lotimpuls nach unten, mit der Seekarte verglichen: gibt einen Standort, wo der Grund geneigt ist. Ein Geleitschiff in wenigen Kilometern kann ihn hören">Echolot</button>
          <span id="snd-rows" class="dim"></span>
        </div>
      </div>
      <div id="range-slot"></div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const threat = threatPanel();
  q('#threat-slot').replaceWith(threat.el);
  const scope = activeScope({ height: 340 });
  q('#as-slot').replaceWith(scope.el);
  const range = rangePanel();
  q('#range-slot').replaceWith(range.el);
  q<HTMLButtonElement>('#sound').onclick = () => net.send({ t: 'toggle', what: 'sounding', on: true });

  return {
    title: 'Ortung',
    el,
    snap() {
      const s = store.snap!;
      threat.update(s);
      scope.snap();
      range.update(s);
      const raised = mastState(s.own).raised;
      q('#esm-st').textContent = raised ? 'MAST OBEN · HÖRT RADARE' : 'NUR MIT MAST OBEN';
      const rows = raised ? periscopeEsmRows(s) : '';
      setHtml(q('#esm'), rows || `<div class="dim">${raised ? 'KEIN RADAR ZU HÖREN' : 'MAST UNTEN – AUF SEHROHRTIEFE GEHEN UND MAST AUSFAHREN'}</div>`);
      q('#snd-st').textContent = s.env.bottom !== undefined ? `GRUND ${s.env.bottom} M · UNTER KIEL ${Math.round(s.env.bottom - s.own.depth)} M` : '';
      q('#snd-rows').textContent = s.own.nav?.lastFix === 'sounding' ? 'LETZTER FIX: ECHOLOT' : 'VERRÄT DAS BOOT KAUM, ABER HÖRBAR IN DER NÄHE';
    },
    frame() {
      scope.frame();
    },
  };
}
