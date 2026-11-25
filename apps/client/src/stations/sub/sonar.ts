import { angleDiff, bearing, CLASSES } from '@tk/shared';
import { net } from '../../net.js';
import { btnState } from '../../widgets/btn-state.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { AcousticAnalysis } from '../../widgets/analysis.js';
import { activeScope } from '../../widgets/active-scope.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { fillBox } from '../../widgets/fill.js';
import { h, setText } from '../../widgets/format.js';
import { panelTabs, tabRow } from '../../widgets/panel-tabs.js';
import { rangePanel } from '../../widgets/range-panel.js';
import { threatPanel } from '../../widgets/threat-panel.js';
import { Waterfall } from '../../widgets/waterfall.js';

/** Pick the contact nearest to a clicked bearing on a waterfall. */
export function pickByBearing(b: number, maxDeg = 6): string | undefined {
  const s = store.snap;
  if (!s) return undefined;
  let best: string | undefined;
  let bd = maxDeg;
  for (const c of s.contacts) {
    if (c.via !== 'own') continue;
    for (const cb of c.bearingAlt !== undefined ? [c.bearing, c.bearingAlt] : [c.bearing]) {
      const d = Math.abs(angleDiff(cb, b));
      if (d < bd) [best, bd] = [c.label, d];
    }
  }
  // The own torpedoes on the wire can be picked too (fire control steers the selected one)
  for (const t of s.torpedoes) {
    const d = Math.abs(angleDiff(bearing(s.own, t), b));
    if (d < bd) [best, bd] = [t.id, d];
  }
  return best;
}

/**
 * Horchraum: the passive picture. The broadband waterfall takes the full height on the left,
 * with the listening modes and the analysis filters in its footer; on the right the signal
 * analysis (LOFAR/DEMON at a fixed height) and one tabbed panel that takes the rest: the
 * contact list, the threat picture (who is pinging us, the evasion proposal, the
 * listening-range prediction) and the active sonar for the single ping. Nothing in the right
 * column scrolls but the tab pane.
 */
export function subSonarStation(): Station {
  const el = h(`<div class="st two sub-horch stack">
    <div class="st-col">
      <div class="panel grow"><div class="hd"><span>Horchraum · Breitband</span><span id="own" class="dim"></span></div>
        <div class="fill" id="wf-box"><canvas id="wf"></canvas></div>
        <div class="foot"><span id="wf-ctl"></span><span id="lm-slot"></span><button id="tow" title="Schleppsonar aus- oder einholen">Schleppsonar</button><span class="hint">KLICK AUF EINE SPUR WÄHLT DEN KONTAKT</span></div>
      </div>
    </div>
    <div class="st-col">
      <div class="panel" style="min-width:0"><div class="hd"><span>Signalanalyse</span><span id="lab" class="amber"></span></div><div id="ana"></div></div>
      <div class="panel grow tabbed" id="st-tabs">
        <div class="hd">${tabRow([['list', 'Kontakte'], ['threat', 'Bedrohung', 'Wer pingt uns, Ausweichvorschlag, Hörreichweite'], ['active', 'Aktiv', 'Einzelping: Entfernung, verrät aber das Boot']])}<span id="tab-st" class="dim"></span></div>
        <div class="pane" data-pane="list"><div id="list"></div></div>
        <div class="pane" data-pane="threat"><div id="threat-slot"></div><div id="range-slot"></div></div>
        <div class="pane" data-pane="active"><div id="as-slot"></div></div>
      </div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const wf = new Waterfall();
  q('#wf-ctl').replaceWith(wf.controls());
  const wfCanvas = q<HTMLCanvasElement>('#wf');
  const box = fillBox(q('#wf-box'), 220);
  const analysis = new AcousticAnalysis(170);
  q('#ana').appendChild(analysis.el);
  q('#lm-slot').replaceWith(analysis.footControls());
  const threat = threatPanel();
  q('#threat-slot').replaceWith(threat.el);
  const range = rangePanel();
  q('#range-slot').replaceWith(range.el);
  const scope = activeScope({ height: 260, compact: true });
  q('#as-slot').replaceWith(scope.el);
  // A tab is drawn the moment it opens, not at the next snapshot (no empty pane, no buttons jumping under the pointer)
  let redraw = () => {};
  const tabs = panelTabs(q('#st-tabs'), 'horch', () => redraw());

  wfCanvas.style.cursor = 'pointer';
  wfCanvas.onmousedown = (e) => {
    const hit = pickByBearing(wf.bearingAt(wfCanvas, e.clientX));
    if (hit) store.selected = hit;
  };
  q<HTMLButtonElement>('#tow').onclick = () => {
    const o = store.snap?.own;
    if (o) net.send({ t: 'towed', length: (o.towedOrder ?? o.towedLength) > 0 ? 0 : (CLASSES[o.cls].towed?.maxLength ?? 0) });
  };

  const station: Station = {
    id: 'horch',
    title: 'Horchraum',
    el,
    snap() {
      const s = store.snap!;
      const o = s.own;
      if (tabs.current === 'list') renderContactList(q('#list'), (via) => via === 'own');
      threat.update(s);
      range.update(s);
      scope.snap();
      setText(q('#own'), `EIGENGERÄUSCH ${o.noiseDb.toFixed(0)} DB`);
      // The threat tab says when something is pinging us, even while another tab is open
      const pings = s.alerts.filter((a) => a.kind === 'ping' && s.time - a.time < 300).length;
      const torp = s.alerts.some((a) => a.kind === 'torpedo' && s.time - a.time < 90);
      const badge = q('[data-ptab="threat"] .cnt');
      setText(badge, torp ? '!' : pings ? String(pings) : '');
      badge.classList.toggle('alarm', torp);
      setText(q('#tab-st'), tabs.current === 'list' ? `${s.contacts.filter((c) => c.via === 'own').length} KONTAKTE` : '');
      const tow = q<HTMLButtonElement>('#tow');
      tow.style.display = CLASSES[o.cls].towed ? '' : 'none';
      const tgt = o.towedOrder ?? o.towedLength;
      const maxLen = CLASSES[o.cls].towed?.maxLength ?? 1;
      btnState(tow, tgt !== o.towedLength ? { on: tgt > 0, label: `${tgt > o.towedLength ? 'AUS' : 'EIN'} ${o.towedLength} M`, pct: (100 * o.towedLength) / maxLen, tone: 'busy' }
        : o.towedLength > 0 ? (o.towedReady ? { on: true, label: `${o.towedLength} M` } : { on: true, label: 'STABILISIERT…', tone: 'busy' }) : { on: false });
      setText(q('#lab'), store.selected ?? '');
    },
    collect() {
      const s = store.snap;
      if (!s) return;
      wf.push(s);
      analysis.update();
    },
    frame() {
      wf.draw(wfCanvas, box.h, store.snap, store.selected);
      analysis.draw();
      if (tabs.current === 'active') scope.frame();
    },
    dispose() {
      box.dispose();
    },
  };
  redraw = () => {
    if (store.snap) station.snap?.();
  };
  return station;
}
