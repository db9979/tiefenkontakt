import { CLASSES } from '@tk/shared';
import { net } from '../../net.js';
import { btnState } from '../../widgets/btn-state.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { AcousticAnalysis } from '../../widgets/analysis.js';
import { activeScope } from '../../widgets/active-scope.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { fillBox } from '../../widgets/fill.js';
import { h, setHtml, setText } from '../../widgets/format.js';
import { panelTabs, tabRow } from '../../widgets/panel-tabs.js';
import { rangePanel } from '../../widgets/range-panel.js';
import { Waterfall } from '../../widgets/waterfall.js';
import { pickByBearing } from '../sub/sonar.js';

/**
 * Sonar (surface ships): hull and towed-array waterfalls stacked on the left, sharing the
 * height; on the right one tabbed panel: signal analysis, the active sonar (PPI, CW/LFM,
 * returns), the variable-depth sonar with the bathythermograph and mine avoidance plus the
 * listening-range prediction, and the contact list. The array length sits in the towed panel's
 * header; one "Anzeige" popover sets both waterfalls (they share their display settings), next
 * to the towed array's side choice in its footer.
 */
export function frigateSonarStation(): Station {
  const el = h(`<div class="st two fsonar">
    <div class="st-col">
      <div class="panel grow"><div class="hd"><span>Rumpfsonar</span><span id="hs" class="dim"></span></div>
        <div class="fill" id="hull-box" title="Klick auf eine Spur wählt den Kontakt"><canvas id="hull"></canvas></div>
      </div>
      <div class="panel grow"><div class="hd"><span title="Schleppsonar: Peilung links/rechts mehrdeutig">Schleppsonar</span>
          <span class="hd-r"><span id="ts" class="dim"></span><span class="seg hdseg" title="Kabellänge (lang = unter der Sprungschicht)">${[0, 300, 600, 900, 1200].map((l) => `<button data-len="${l}" title="${l ? 'Kabellänge ' + l + ' m (lang = unter der Sprungschicht)' : 'Schleppsonar einholen'}">${l ? l : 'Einholen'}</button>`).join('')}</span><span class="dim">M</span></span></div>
        <div class="fill" id="tow-box"><canvas id="tow"></canvas></div>
        <div class="foot">
          <details class="wfpop"><summary title="Anzeige beider Wasserfälle: Normalisierer, Mittelung, Helligkeit, Kontrast">Anzeige ▾</summary><div id="wf-ctl"></div></details>
          <span class="seg" title="Welche Seite des Schleppsonars für den gewählten Kontakt gilt"><button data-side="stb">Stb</button><button data-side="port">Bb</button><button data-side="both">Beide</button></span>
          <span id="tas-hint" class="hint"></span>
        </div>
      </div>
    </div>
    <div class="st-col">
      <div class="panel grow tabbed" id="st-tabs">
        <div class="hd">${tabRow([['ana', 'Analyse', 'LOFAR / DEMON des gewählten Kontakts'], ['active', 'Aktiv', 'Aktivsonar: Einzelping, CW/LFM, Echos'], ['vds', 'VDS/BT', 'Tiefensonar, Bathythermograph, Minenmeiden, Hörreichweite'], ['list', 'Kontakte']])}<span id="lab" class="amber"></span></div>
        <div class="pane scroll" data-pane="ana"><div id="ana"></div></div>
        <div class="pane scroll" data-pane="active"><div id="as-slot"></div></div>
        <div class="pane scroll" data-pane="vds">
          <div class="btnrow">
            <button id="xbt" title="Bathythermograph werfen: misst die Sprungschicht">BT messen</button>
            <button id="vds" title="Tiefensonar unter die Sprungschicht absenken (nur bis 18 kn)">VDS absenken</button>
            <button id="mav" title="Hochfrequentes Minenmeidesonar: findet verankerte Minen voraus bis etwa 1,6 km (±70°), nur bis 15 kn, kaum weit zu hören">Minenmeiden</button>
          </div>
          <div id="o-rows"></div>
          <div id="range-slot"></div>
        </div>
        <div class="pane scroll" data-pane="list"><div id="list"></div></div>
      </div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const hull = new Waterfall(['hull', 'active', 'intercept']);
  const tow = new Waterfall(['towed']);
  // One set of display settings for both waterfalls, in one popover
  tow.opts = hull.opts;
  q('#wf-ctl').replaceWith(hull.controls());
  const pop = q<HTMLDetailsElement>('.wfpop');
  const closePop = (e: PointerEvent) => {
    if (pop.open && !pop.contains(e.target as Node)) pop.open = false;
  };
  document.addEventListener('pointerdown', closePop);
  const hullCv = q<HTMLCanvasElement>('#hull');
  const towCv = q<HTMLCanvasElement>('#tow');
  const hullBox = fillBox(q('#hull-box'), 150);
  const towBox = fillBox(q('#tow-box'), 150);
  const analysis = new AcousticAnalysis(170);
  q('#ana').appendChild(analysis.el);
  const scope = activeScope({ height: () => Math.max(240, Math.min(420, q('#st-tabs').clientHeight - 150)), pingKey: true });
  q('#as-slot').replaceWith(scope.el);
  const range = rangePanel();
  q('#range-slot').replaceWith(range.el);
  // A tab is drawn the moment it opens, not at the next snapshot (no empty pane, no buttons jumping under the pointer)
  let redraw = () => {};
  const tabs = panelTabs(q('#st-tabs'), 'fsonar', () => redraw());
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
  q<HTMLButtonElement>('#xbt').onclick = () => net.send({ t: 'bt' });
  q<HTMLButtonElement>('#mav').onclick = () => net.send({ t: 'toggle', what: 'mineavoid', on: !store.snap?.own.mineAvoid });
  q<HTMLButtonElement>('#vds').onclick = () => net.send({ t: 'toggle', what: 'vds', on: !(store.snap?.own.vdsOrder ?? 0) });

  const station: Station = {
    id: 'sonar',
    title: 'Sonar',
    el,
    snap() {
      const s = store.snap!;
      const o = s.own;
      if (tabs.current === 'list') renderContactList(q('#list'), (via) => via === 'own');
      scope.snap();
      range.update(s);
      const vdsTxt = (o.vdsDepth ?? 0) > 5 || (o.vdsOrder ?? 0) > 0 ? ` · VDS ${o.vdsDepth ?? 0}${o.vdsOrder !== o.vdsDepth ? ` / ${o.vdsOrder ?? 0}` : ''} M` : '';
      const mavTxt = o.mineAvoid ? (o.mineAvoidRange ? ` · MINENMEIDEN ${o.mineAvoidRange} M` : ' · MINENMEIDEN ZU SCHNELL') : '';
      setText(q('#hs'), (o.activeSonar ? 'AKTIV · VERRÄT EIGENE POSITION' : 'PASSIV') + vdsTxt + mavTxt);
      q('#hs').className = o.activeSonar ? 'amber' : 'dim';
      const tgt = o.towedOrder ?? o.towedLength;
      const winch = tgt !== o.towedLength;
      q('#ts').textContent = winch
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
      setText(q('#lab'), store.selected ?? '');
      const c = store.selectedContact();
      const side = c ? store.tasSide.get(c.label) : undefined;
      el.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) => b.classList.toggle('on', (b.dataset.side === 'both' && !side) || b.dataset.side === side));
      setHtml(q('#tas-hint'), !c ? 'KLICK AUF EINE SPUR WÄHLT' : c.tas?.ghost ? '<span class="red">RUMPF UND SCHLEPP WEICHEN AB · MÖGLICHER GEIST</span>'
        : c.tas?.resolved ? 'DURCH RUMPFSONAR AUFGELÖST' : c.bearingAlt !== undefined ? '<span class="amber">MEHRDEUTIG · 20° WENDEN</span>' : 'EINDEUTIG');
      // The active tab says when the sonar is sending, from any tab
      setText(q('[data-ptab="active"] .cnt'), o.activeSonar ? '●' : '');
      // VDS / BT / mine avoidance
      btnState(q('#xbt'), o.loadout.xbt ? { label: String(o.loadout.xbt) } : { label: 'LEER', tone: 'empty' });
      btnState(q('#mav'), o.mineAvoid && !o.mineAvoidRange ? { on: true, label: 'ZU SCHNELL', tone: 'warn' } : { on: !!o.mineAvoid });
      const vb = q<HTMLButtonElement>('#vds');
      const hasVds = !!CLASSES[o.cls].vds;
      vb.style.display = hasVds ? '' : 'none';
      vb.textContent = (o.vdsOrder ?? 0) > 0 ? 'VDS einholen' : 'VDS absenken';
      const vd = o.vdsDepth ?? 0, vo = o.vdsOrder ?? 0;
      btnState(vb, Math.abs(vd - vo) > 2 ? { on: vo > 0, label: `${vd} M`, pct: (100 * vd) / Math.max(vd, vo, 1), tone: 'busy' } : { on: vo > 0, label: vo > 0 ? `${vd} M` : undefined });
      setHtml(q('#o-rows'), `
        <div class="row"><span class="dim">SPRUNGSCHICHT</span><span class="${s.env.layerDepth === undefined ? 'amber' : ''}">${s.env.layerDepth !== undefined ? `${s.env.layerDepth} M (GEMESSEN)` : 'UNBEKANNT · BT WERFEN'}</span></div>
        <div class="row"><span class="dim">WASSERTIEFE</span><span>${s.env.bottom !== undefined ? `${s.env.bottom} M` : '—'}</span></div>
        ${hasVds ? `<div class="row"><span class="dim">TIEFENSONAR</span><span>${vo > 0 || vd > 5 ? `${vd} M${vo !== vd ? ` → ${vo} M` : ''}` : 'EINGEHOLT'}</span></div>` : ''}
        <div class="row"><span class="dim">MINENMEIDEN</span><span>${o.mineAvoid ? (o.mineAvoidRange ? `AN · ${o.mineAvoidRange} M VORAUS` : '<span class="amber">ZU SCHNELL (ÜBER 15 KN)</span>') : 'AUS'}</span></div>`);
    },
    collect() {
      const s = store.snap;
      if (!s) return;
      hull.push(s);
      tow.push(s, 15);
      analysis.update();
    },
    frame() {
      hull.draw(hullCv, hullBox.h, store.snap, store.selected);
      tow.draw(towCv, towBox.h, store.snap, store.selected);
      if (tabs.current === 'ana') analysis.draw();
      else if (tabs.current === 'active') scope.frame();
    },
    dispose() {
      hullBox.dispose();
      towBox.dispose();
      document.removeEventListener('pointerdown', closePop);
    },
  };
  redraw = () => {
    if (store.snap) station.snap?.();
  };
  return station;
}
