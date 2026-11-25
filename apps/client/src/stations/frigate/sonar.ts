import { net } from '../../net.js';
import { btnState } from '../../widgets/btn-state.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { AcousticAnalysis } from '../../widgets/analysis.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { h, setHtml, setText } from '../../widgets/format.js';
import { CLASSES } from '@tk/shared';
import { Waterfall } from '../../widgets/waterfall.js';
import { pickByBearing } from '../sub/sonar.js';
import { rangePanel } from '../../widgets/range-panel.js';

export function frigateSonarStation(): Station {
  const el = h(`<div class="cols">
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel"><div class="hd"><span>Rumpfsonar</span><span id="hs" class="dim"></span></div><canvas id="hull"></canvas></div>
      <div class="panel"><div class="hd"><span>Schleppsonar · links/rechts mehrdeutig</span><span id="ts" class="dim"></span></div><canvas id="tow"></canvas>
        <div class="steps" style="margin-top:6px">
          <button id="ping" class="warn" title="Aktiv-Ping alle 30 s: Entfernung, verrät aber die Fregatte">Aktiv-Ping</button>
          <button data-pulse="cw" title="CW: grobe Entfernung, misst die Annäherung (Doppler)">CW</button>
          <button data-pulse="lfm" title="LFM: genaue Entfernung, findet auch langsame Ziele im Nachhall">LFM</button>
          <button id="xbt" title="Bathythermograph werfen: misst die Sprungschicht">BT messen</button>
          <button id="mav" title="Hochfrequentes Minenmeidesonar: findet verankerte Minen voraus bis etwa 1,6 km (±70°), nur bis 15 kn, kaum weit zu hören">Minenmeiden</button>
          <button id="vds" title="Tiefensonar unter die Sprungschicht absenken (nur bis 18 kn)" style="display:none">VDS absenken</button>
          ${[0, 300, 600, 900, 1200].map((l) => `<button data-len="${l}" title="${l ? 'Kabellänge ' + l + ' m (lang = unter der Sprungschicht)' : 'Schleppsonar einholen'}">${l ? l + ' m' : 'Einholen'}</button>`).join('')}
        </div>
      </div>
      <div class="panel"><div class="hd"><span>Schleppsonar-Seite</span><span id="tas-hint" class="dim"></span></div>
        <div class="steps"><button data-side="stb">Steuerbord</button><button data-side="port">Backbord</button><button data-side="both">Beide zeigen</button></div>
      </div>
      <div class="panel"><div class="hd"><span>Kontakte</span></div><div id="list"></div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel" style="min-width:0"><div class="hd"><span>Signalanalyse</span><span id="lab" class="amber"></span></div><div id="ana"></div></div>
      <div id="range-slot"></div>
    </div>
  </div>`);
  const range = rangePanel();
  el.querySelector('#range-slot')!.replaceWith(range.el);
  const hull = new Waterfall(['hull', 'active', 'intercept']);
  const tow = new Waterfall(['towed']);
  const hullCv = el.querySelector<HTMLCanvasElement>('#hull')!;
  const towCv = el.querySelector<HTMLCanvasElement>('#tow')!;
  const analysis = new AcousticAnalysis(250);
  el.querySelector('#ana')!.appendChild(analysis.el);
  for (const [wf, cv] of [[hull, hullCv], [tow, towCv]] as const) {
    cv.style.cursor = 'pointer';
    cv.onmousedown = (e) => {
      const hit = pickByBearing(wf.bearingAt(cv, e.clientX));
      if (hit) store.selected = hit;
    };
  }
  el.querySelector<HTMLButtonElement>('#ping')!.onclick = () => net.send({ t: 'toggle', what: 'active', on: !store.snap?.own.activeSonar });
  el.querySelectorAll<HTMLButtonElement>('[data-pulse]').forEach((b) => (b.onclick = () => net.send({ t: 'pulse', pulse: b.dataset.pulse as 'cw' | 'lfm' })));
  el.querySelector<HTMLButtonElement>('#xbt')!.onclick = () => net.send({ t: 'bt' });
  el.querySelector<HTMLButtonElement>('#mav')!.onclick = () => net.send({ t: 'toggle', what: 'mineavoid', on: !store.snap?.own.mineAvoid });
  el.querySelector<HTMLButtonElement>('#vds')!.onclick = () => net.send({ t: 'toggle', what: 'vds', on: !(store.snap?.own.vdsOrder ?? 0) });
  el.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) => {
    b.onclick = () => {
      const l = store.selected;
      if (!l) return;
      if (b.dataset.side === 'both') store.tasSide.delete(l);
      else store.tasSide.set(l, b.dataset.side as 'stb' | 'port');
    };
  });
  el.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => (b.onclick = () => net.send({ t: 'towed', length: Number(b.dataset.len) })));

  return {
    title: 'Sonar',
    el,
    snap() {
      const s = store.snap!;
      hull.push(s);
      tow.push(s, 15);
      range.update(s);
      const o = s.own;
      renderContactList(el.querySelector('#list')!, (via) => via === 'own');
      btnState(el.querySelector<HTMLElement>('#ping'), { on: o.activeSonar, tone: o.activeSonar ? 'warn' : undefined });
      const vdsTxt = (o.vdsDepth ?? 0) > 5 || (o.vdsOrder ?? 0) > 0 ? ` · VDS ${o.vdsDepth ?? 0}${o.vdsOrder !== o.vdsDepth ? ` / ${o.vdsOrder ?? 0}` : ''} M` : '';
      const mavTxt = o.mineAvoid ? (o.mineAvoidRange ? ` · MINENMEIDEN ${o.mineAvoidRange} M` : ' · MINENMEIDEN ZU SCHNELL') : '';
      setText(el.querySelector('#hs')!, (o.activeSonar ? 'AKTIV · VERRÄT EIGENE POSITION' : 'PASSIV') + vdsTxt + mavTxt);
      btnState(el.querySelector<HTMLElement>('#mav'), o.mineAvoid && !o.mineAvoidRange ? { on: true, label: 'ZU SCHNELL', tone: 'warn' } : { on: !!o.mineAvoid });
      const vb = el.querySelector<HTMLButtonElement>('#vds')!;
      vb.style.display = CLASSES[o.cls].vds ? '' : 'none';
      setText(vb, (o.vdsOrder ?? 0) > 0 ? 'VDS einholen' : 'VDS absenken');
      const vd = o.vdsDepth ?? 0, vo = o.vdsOrder ?? 0;
      btnState(vb, Math.abs(vd - vo) > 2 ? { on: vo > 0, label: `${vd} M`, pct: (100 * vd) / Math.max(vd, vo, 1), tone: 'busy' } : { on: vo > 0, label: vo > 0 ? `${vd} M` : undefined });
      const tgt = o.towedOrder ?? o.towedLength;
      const winch = tgt !== o.towedLength;
      el.querySelector('#ts')!.textContent = winch
        ? `${tgt > o.towedLength ? 'AUSBRINGEN' : 'EINHOLEN'} ${o.towedLength} / ${tgt} M`
        : o.towedLength === 0 ? 'EINGEHOLT' : o.towedReady ? `${o.towedLength} M · BEREIT` : `${o.towedLength} M · STABILISIERT…`;
      el.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => {
        const len = Number(b.dataset.len);
        if (len !== tgt) return btnState(b, { on: false, label: '' });
        btnState(b, winch ? { on: true, label: `${o.towedLength} M`, pct: (100 * o.towedLength) / Math.max(1, len, o.towedLength), tone: 'busy' }
          : { on: true, label: len && !o.towedReady ? 'STAB…' : '✓', tone: len && !o.towedReady ? 'busy' : undefined });
      });
      el.querySelector('#lab')!.textContent = store.selected ?? '';
      el.querySelectorAll<HTMLButtonElement>('[data-pulse]').forEach((b) => b.classList.toggle('on', b.dataset.pulse === o.pulse));
      el.querySelector('#xbt')!.textContent = 'BT messen';
      btnState(el.querySelector<HTMLElement>('#xbt'), o.loadout.xbt ? { label: String(o.loadout.xbt) } : { label: 'LEER', tone: 'empty' });
      const c = store.selectedContact();
      const side = c ? store.tasSide.get(c.label) : undefined;
      el.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) => b.classList.toggle('on', (b.dataset.side === 'both' && !side) || b.dataset.side === side));
      setHtml(el.querySelector('#tas-hint')!, !c ? 'KONTAKT WÄHLEN' : c.tas?.ghost ? '<span class="red">RUMPF UND SCHLEPP WEICHEN AB · MÖGLICHER GEIST</span>'
        : c.tas?.resolved ? 'DURCH RUMPFSONAR AUFGELÖST' : c.bearingAlt !== undefined ? '<span class="amber">MEHRDEUTIG · 20° WENDEN UND SPUREN VERGLEICHEN</span>' : 'EINDEUTIG');
      analysis.update();
    },
    frame() {
      const hgt = Math.max(150, (window.innerHeight - 330) / 2);
      hull.draw(hullCv, hgt, store.snap, store.selected);
      tow.draw(towCv, hgt, store.snap, store.selected);
      analysis.draw();
    },
  };
}
