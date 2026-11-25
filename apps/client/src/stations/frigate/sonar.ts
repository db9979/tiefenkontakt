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

export function frigateSonarStation(): Station {
  const el = h(`<div class="cols">
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel"><div class="hd"><span>Rumpfsonar</span><span id="hs" class="dim"></span></div><canvas id="hull"></canvas></div>
      <div class="panel"><div class="hd"><span>Schleppsonar · links/rechts mehrdeutig</span><span id="ts" class="dim"></span></div><canvas id="tow"></canvas>
        <div class="steps" style="margin-top:6px">
          ${[0, 300, 600, 900, 1200].map((l) => `<button data-len="${l}" title="${l ? 'Kabellänge ' + l + ' m (lang = unter der Sprungschicht)' : 'Schleppsonar einholen'}">${l ? l + ' m' : 'Einholen'}</button>`).join('')}
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel" style="min-width:0"><div class="hd"><span>Signalanalyse</span><span id="lab" class="amber"></span></div><div id="ana"></div></div>
      <div class="panel"><div class="hd"><span>Schleppsonar-Seite</span><span id="tas-hint" class="dim"></span></div>
        <div class="steps"><button data-side="stb">Steuerbord</button><button data-side="port">Backbord</button><button data-side="both">Beide zeigen</button></div>
      </div>
      <div class="panel"><div class="hd"><span>Kontakte</span></div><div id="list"></div></div>
    </div>
  </div>`);
  const hull = new Waterfall(['hull', 'active', 'intercept']);
  const tow = new Waterfall(['towed']);
  el.querySelector('#hs')!.before(hull.controls());
  el.querySelector('#ts')!.before(tow.controls());
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
      const o = s.own;
      renderContactList(el.querySelector('#list')!, (via) => via === 'own');
      const vdsTxt = (o.vdsDepth ?? 0) > 5 || (o.vdsOrder ?? 0) > 0 ? ` · VDS ${o.vdsDepth ?? 0}${o.vdsOrder !== o.vdsDepth ? ` / ${o.vdsOrder ?? 0}` : ''} M` : '';
      const mavTxt = o.mineAvoid ? (o.mineAvoidRange ? ` · MINENMEIDEN ${o.mineAvoidRange} M` : ' · MINENMEIDEN ZU SCHNELL') : '';
      setText(el.querySelector('#hs')!, (o.activeSonar ? 'AKTIV · VERRÄT EIGENE POSITION' : 'PASSIV') + vdsTxt + mavTxt);
      const tgt = o.towedOrder ?? o.towedLength;
      const winch = tgt !== o.towedLength;
      el.querySelector('#ts')!.textContent = winch
        ? `${tgt > o.towedLength ? 'AUSBRINGEN' : 'EINHOLEN'} ${o.towedLength} / ${tgt} M`
        : o.towedLength === 0 ? 'EINGEHOLT' : o.towedReady ? `${o.towedLength} M · BEREIT` : `${o.towedLength} M · STABILISIERT…`;
      const maxTow = CLASSES[o.cls].towed?.maxLength ?? 0;
      el.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => {
        const len = Number(b.dataset.len);
        // Only the lengths this ship's cable has
        b.style.display = len <= maxTow ? '' : 'none';
        if (len !== tgt) return btnState(b, { on: false, label: '' });
        btnState(b, winch ? { on: true, label: `${o.towedLength} M`, pct: (100 * o.towedLength) / Math.max(1, len, o.towedLength), tone: 'busy' }
          : { on: true, label: len && !o.towedReady ? 'STAB…' : '✓', tone: len && !o.towedReady ? 'busy' : undefined });
      });
      el.querySelector('#lab')!.textContent = store.selected ?? '';
      const c = store.selectedContact();
      const side = c ? store.tasSide.get(c.label) : undefined;
      el.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) => b.classList.toggle('on', (b.dataset.side === 'both' && !side) || b.dataset.side === side));
      setHtml(el.querySelector('#tas-hint')!, !c ? 'KONTAKT WÄHLEN' : c.tas?.ghost ? '<span class="red">RUMPF UND SCHLEPP WEICHEN AB · MÖGLICHER GEIST</span>'
        : c.tas?.resolved ? 'DURCH RUMPFSONAR AUFGELÖST' : c.bearingAlt !== undefined ? '<span class="amber">MEHRDEUTIG · 20° WENDEN UND SPUREN VERGLEICHEN</span>' : 'EINDEUTIG');
    },
    collect() {
      const s = store.snap;
      if (!s) return;
      hull.push(s);
      tow.push(s, 15);
      analysis.update();
    },
    frame() {
      const hgt = Math.max(170, (window.innerHeight - 290) / 2);
      hull.draw(hullCv, hgt, store.snap, store.selected);
      tow.draw(towCv, hgt, store.snap, store.selected);
      analysis.draw();
    },
  };
}
