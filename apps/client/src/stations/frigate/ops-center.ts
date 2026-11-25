import { CLASSES, hasHelicopter, type Snapshot } from '@tk/shared';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { mountEscortOrders } from '../../widgets/escort-orders.js';
import { fillBox } from '../../widgets/fill.js';
import { h, setHtml, setText } from '../../widgets/format.js';
import { mountHeloPanel } from '../../widgets/helo-panel.js';
import { panelTabs, tabRow } from '../../widgets/panel-tabs.js';
import { Plot } from '../../widgets/plot.js';
import { buoyAction, courseAction, escortOrderActions, mpaAction, rocketAction, ssmAction } from '../../widgets/actions.js';

/** The ASW strip above the chart: the state of every hunting tool at one glance. */
function aswStrip(s: Snapshot): string {
  const o = s.own;
  const spec = CLASSES[o.cls];
  const chip = (label: string, value: string, tone = '') => `<span class="aswchip ${tone}"><span class="dim">${label}</span> ${value}</span>`;
  const tgt = o.towedOrder ?? o.towedLength;
  const tow = !spec.towed ? '' : chip('SCHLEPP', tgt !== o.towedLength ? `${o.towedLength}/${tgt} M` : o.towedLength === 0 ? 'EINGEHOLT' : o.towedReady ? `${o.towedLength} M` : 'STAB…', tgt !== o.towedLength || (o.towedLength > 0 && !o.towedReady) ? 'amber' : '');
  const a = hasHelicopter(o.cls) ? s.air : undefined;
  const helo = a?.helos.find((x) => x.kind !== 'mpa');
  return [
    chip('SONAR', o.activeSonar ? 'AKTIV' : 'PASSIV', o.activeSonar ? 'amber' : ''),
    tow,
    chip('SCHICHT', s.env.layerDepth !== undefined ? `${s.env.layerDepth} M` : '?', s.env.layerDepth === undefined ? 'amber' : ''),
    a ? chip('HUBSCHR.', helo ? 'IN DER LUFT' : a.heloReadyInS > 0 ? `${Math.ceil(a.heloReadyInS / 60)} MIN` : 'BEREIT', a.heloReadyInS > 0 && !helo ? 'amber' : '') : '',
    a ? chip('BOJEN', `${a.stock} · ${a.buoys.length} IM WASSER`) : '',
    chip('RAKETEN', String(o.loadout.rockets), o.loadout.rockets ? '' : 'amber'),
    chip('WERFER', String(o.loadout.depthCharges)),
    chip('DATALINK', String(s.friendlies.filter((f) => f.cls !== 'merchant').length)),
  ].join('');
}

/**
 * OPZ: the shared picture. The chart takes two thirds of the width under the ASW strip; the
 * side panel holds the contact list, the group and convoy orders, and the helicopter, one at
 * a time behind tabs.
 */
export function opsCenterStation(): Station {
  const el = h(`<div class="st opz">
    <div class="st-col">
      <div class="aswstrip" id="asw"></div>
      <div class="panel grow"><div class="hd"><span>Operationszentrale · Lagebild</span><span id="opz-st" class="dim"></span></div>
        <div class="fill" id="plot-box"><canvas id="plot"></canvas></div>
        <div class="hint">KLICK WÄHLT · RECHTSKLICK = KURS / RAKETE / BOJE</div>
      </div>
    </div>
    <div class="st-col">
      <div class="panel grow tabbed" id="tabs">
        <div class="hd">${tabRow([['list', 'Kontakte', 'Kontakte (eigen + Datalink)'], ['group', 'Verband', 'Verband und Konvoi'], ['helo', 'Hubschrauber', 'Bordhubschrauber und Seefernaufklärer']])}<span id="tab-st" class="dim"></span></div>
        <div class="pane scroll" data-pane="list"><div id="list"></div></div>
        <div class="pane scroll" data-pane="group" id="group-slot"></div>
        <div class="pane scroll" data-pane="helo" id="helo-slot"></div>
      </div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const plot = new Plot(q<HTMLCanvasElement>('#plot'), {
    bearingLines: true, showConvoy: true, esmLines: true, route: true, actions: (p) => [...courseAction(p), ...ssmAction(p), ...rocketAction(p), ...(store.snap && hasHelicopter(store.snap.own.cls) ? buoyAction(p) : []), ...mpaAction(p), ...escortOrderActions(p)],
  });
  plot.scale = 80;
  const box = fillBox(q('#plot-box'), 300);
  const escort = mountEscortOrders(q('#group-slot'));
  const helo = mountHeloPanel(q('#helo-slot'));
  const tabs = panelTabs(q('#tabs'), 'opz');

  return {
    id: 'opz',
    title: 'OPZ',
    el,
    snap() {
      const s = store.snap!;
      setHtml(q('#asw'), aswStrip(s));
      // No helicopter aboard: no tab for it
      const hasHelo = hasHelicopter(s.own.cls);
      q('[data-ptab="helo"]').hidden = !hasHelo;
      if (!hasHelo && tabs.current === 'helo') tabs.show('list');
      if (tabs.current === 'list') renderContactList(q('#list'));
      else if (tabs.current === 'group') escort.update(s);
      else helo.update(s);
      const hostile = s.contacts.filter((c) => c.assigned === 'submarine' || c.assigned === 'torpedo').length;
      setText(q('#opz-st'), hostile ? `${hostile} FEINDKONTAKT${hostile > 1 ? 'E' : ''}` : '');
      q('#opz-st').className = hostile ? 'amber' : 'dim';
      setText(q('#tab-st'), tabs.current === 'list' ? `${s.contacts.length}` : '');
    },
    frame() {
      plot.draw(box.h);
    },
    dispose() {
      box.dispose();
      escort.dispose?.();
      helo.dispose?.();
    },
  };
}
