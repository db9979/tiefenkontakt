import { CLASSES, ROCKET_MIN_RANGE, bearing, distance, hasHelicopter, targetPosAt, type Snapshot, type Vec2 } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { mountEscortOrders } from '../../widgets/escort-orders.js';
import { fillBox } from '../../widgets/fill.js';
import { CHOICE_LABEL, CLASS_LABEL, h, km, setHtml, setText, tdeg1 } from '../../widgets/format.js';
import { heloMode, mountHeloPanel } from '../../widgets/helo-panel.js';
import { lastFix } from '../../widgets/contact-pos.js';
import { guardFire, targetCheck } from '../../widgets/fire-guard.js';
import { btnState } from '../../widgets/btn-state.js';
import { isFriendlyContact } from '../../widgets/friendly.js';
import { panelTabs, tabRow } from '../../widgets/panel-tabs.js';
import { Plot } from '../../widgets/plot.js';
import { buoyAction, courseAction, escortOrderActions, mpaAction, rocketAction, ssmAction } from '../../widgets/actions.js';

/**
 * The ASW strip above the chart: one line of small chips, only what is doing something or needs
 * attention (passive sonar, a recovered array, an empty datalink are not shown).
 */
function aswStrip(s: Snapshot): string {
  const o = s.own;
  const spec = CLASSES[o.cls];
  const chip = (label: string, value: string, tone = '') => `<span class="aswchip ${tone}"><span class="dim">${label}</span> ${value}</span>`;
  const tgt = o.towedOrder ?? o.towedLength;
  const winch = tgt !== o.towedLength;
  const tow = !spec.towed || (o.towedLength === 0 && !winch) ? '' : chip('SCHLEPP', winch ? `${o.towedLength}/${tgt} M` : o.towedReady ? `${o.towedLength} M` : 'STAB…', winch || !o.towedReady ? 'amber' : '');
  const a = hasHelicopter(o.cls) ? s.air : undefined;
  const helo = a?.helos.find((x) => x.kind !== 'mpa');
  const links = s.friendlies.filter((f) => f.cls !== 'merchant').length;
  const buoys = a ? a.buoys.length : 0;
  return [
    o.activeSonar ? chip('SONAR', 'AKTIV', 'amber') : '',
    tow,
    s.env.layerDepth !== undefined ? chip('SCHICHT', `${s.env.layerDepth} M`) : s.env.noLayer ? chip('SCHICHT', 'KEINE') : chip('SCHICHT', '?', 'amber'),
    a ? chip('HUBSCHR.', helo ? 'IN DER LUFT' : a.heloReadyInS > 0 ? `${Math.ceil(a.heloReadyInS / 60)} MIN` : 'BEREIT', a.heloReadyInS > 0 && !helo ? 'amber' : '') : '',
    a ? chip('BOJEN', buoys ? `${a.stock} · ${buoys} IM WASSER` : String(a.stock), a.stock ? '' : 'amber') : '',
    chip('RAKETEN', String(o.loadout.rockets), o.loadout.rockets ? '' : 'amber'),
    o.loadout.depthCharges ? chip('WERFER', String(o.loadout.depthCharges)) : '',
    links ? chip('DATALINK', String(links)) : '',
  ].join('');
}

/** Where the selected contact probably is: a fresh fix, else the TMA solution. */
function contactPoint(s: Snapshot): Vec2 | undefined {
  const c = store.selectedContact();
  if (!c) return undefined;
  const fix = lastFix(c, s, 120);
  if (fix) return fix.pos;
  const sol = store.solutions.get(c.label);
  return sol ? targetPosAt(sol, s.time + 40) : undefined;
}

/**
 * OPZ: the shared picture. The chart takes two thirds of the width, the ASW strip one line
 * over it inside its panel; the side column holds the contact list, the group and convoy
 * orders and the helicopter behind tabs, and under them a fixed card for the selected contact
 * with its actions (ping, rocket, helicopter).
 */
export function opsCenterStation(): Station {
  const el = h(`<div class="st opz">
    <div class="st-col">
      <div class="panel grow"><div class="hd"><span>Operationszentrale · Lagebild</span><span id="opz-st" class="dim"></span></div>
        <div class="aswstrip" id="asw"></div>
        <div class="fill" id="plot-box"><canvas id="plot"></canvas></div>
        <div class="hint">KLICK WÄHLT · RECHTSKLICK = KURS / RAKETE / BOJE</div>
      </div>
    </div>
    <div class="st-col">
      <div class="panel grow tabbed" id="st-tabs">
        <div class="hd">${tabRow([['list', 'Kontakte', 'Kontakte (eigen + Datalink)'], ['group', 'Verband', 'Verband und Konvoi'], ['helo', 'Hubschrauber', 'Bordhubschrauber und Seefernaufklärer']])}<span id="tab-st" class="dim"></span></div>
        <div class="pane scroll" data-pane="list"><div id="list"></div></div>
        <div class="pane scroll" data-pane="group" id="group-slot"></div>
        <div class="pane scroll" data-pane="helo" id="helo-slot"></div>
      </div>
      <div class="panel selcard"><div class="hd"><span>Gewählter Kontakt</span><span id="oc-lab" class="amber"></span></div>
        <div id="oc-rows"></div>
        <div class="actionbar">
          <button id="oc-ping" class="warn" title="Einzelping: Entfernung zum gewählten Kontakt, verrät aber das eigene Schiff">Ping</button>
          <button id="oc-rocket" class="fire" title="U-Jagd-Rakete auf die letzte Position des gewählten Kontakts (1,8–18 km)">Rakete</button>
          <button id="oc-helo" class="primary" title="Bordhubschrauber zum gewählten Kontakt: Tauchsonar an seiner letzten Position">Hubschrauber hin</button>
        </div>
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
  // A tab is drawn the moment it opens, not at the next snapshot (no empty pane, no buttons jumping under the pointer)
  let redraw = () => {};
  const tabs = panelTabs(q('#st-tabs'), 'opz', () => redraw());
  // The selected-contact card: the three things the OPZ does with a contact
  q<HTMLButtonElement>('#oc-ping').onclick = () => net.send({ t: 'ping', single: true });
  const aimRange = () => {
    const s = store.snap;
    const p = s && contactPoint(s);
    return s && p ? { p, d: distance(s.own, p), b: bearing(s.own, p) } : undefined;
  };
  guardFire(q<HTMLButtonElement>('#oc-rocket'), () => {
    const a = aimRange();
    if (!a) return { block: 'KEINE ENTFERNUNG' };
    if (a.d < ROCKET_MIN_RANGE) return { block: 'ZU NAH · UNTER 1,8 KM' };
    if (a.d > 18_000) return { block: 'ZU WEIT · ÜBER 18 KM' };
    return targetCheck(a.p);
  }, () => {
    const a = aimRange();
    if (a) net.send({ t: 'rocket', bearing: a.b, range: a.d });
  });
  guardFire(q<HTMLButtonElement>('#oc-helo'), () => {
    const a = aimRange();
    if (!store.snap?.air?.helo) return { block: 'KEIN HUBSCHRAUBER' };
    if (!a) return { block: 'KEINE ENTFERNUNG' };
    if (a.d > 30_000) return { block: 'ZU WEIT (30 KM)' };
    return {};
  }, () => {
    const a = aimRange();
    if (a) net.send({ t: 'helo', op: heloMode(), kind: 'dip', bearing: a.b, range: a.d, label: store.selected });
  });

  const station: Station = {
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
      const c = store.selectedContact();
      setText(q('#oc-lab'), c?.label ?? '');
      const p = c && contactPoint(s);
      const range = p ? distance(s.own, p) : undefined;
      const cls = !c ? '' : isFriendlyContact(c, s) ? 'EIGEN' : c.assigned ? CHOICE_LABEL[c.assigned] : c.classified ? CLASS_LABEL[c.classified] : 'UNKLASSIFIZIERT';
      setHtml(q('#oc-rows'), c
        ? `<div class="row"><span class="dim">PEILUNG · ENTFERNUNG</span><span>${tdeg1(p ? bearing(s.own, p) : c.bearing)}° · ${range !== undefined ? km(range) : '—'}</span></div>
           <div class="row"><span class="dim">KLASSE · ALTER</span><span>${cls} · ${Math.round(s.time - c.lastSeen)} S</span></div>`
        : '<div class="dim">KONTAKT IN KARTE ODER LISTE WÄHLEN</div>');
      btnState(q('#oc-rocket'), s.own.loadout.rockets ? { label: String(s.own.loadout.rockets) } : { label: 'LEER', tone: 'empty' });
      q('#oc-helo').hidden = !hasHelo;
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
  redraw = () => {
    if (store.snap) station.snap?.();
  };
  return station;
}
