import { CLASSES, NM, PERISCOPE_DEPTH, REGIONS, regionToGeo, type Snapshot } from '@tk/shared';
import { net } from '../../net.js';
import { btnState, depthBtn } from '../../widgets/btn-state.js';
import { guardFire } from '../../widgets/fire-guard.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { clock, h, latLon, setHtml, tdeg3 } from '../../widgets/format.js';
import { Plot } from '../../widgets/plot.js';
import { courseAction } from '../../widgets/actions.js';
import { DepthProfile, batteryInfo, depthOf } from '../../widgets/depth-profile.js';
import { depthAlarms } from '../../widgets/depth-alarm-ui.js';
import { crashDive } from '../../widgets/emergency.js';
import { fillBox } from '../../widgets/fill.js';
import { keycap } from '../../widgets/keys.js';
import { minePanel } from '../../widgets/mine-panel.js';
import { panelTabs, tabRow } from '../../widgets/panel-tabs.js';

/**
 * Zentrale: the commander's place in the boat, with the diving station merged in. Unlike the
 * frigate's operations room there is no shared picture: one chart (own dead reckoning,
 * contacts, solutions, chart drawings) and under it the depth profile (click = depth). On the
 * right the boat at a glance in four tiles (depth, trim, battery, snorkel), the depth orders
 * and the orders a commander gives most often, then one tabbed panel: navigation with the
 * echo sounder and the current, the depth alarms and the mines. Course, speed and noise are
 * the helm's (and the BOOT side tab's), so they are not repeated here.
 */
export function centralStation(): Station {
  const el = h(`<div class="st two sub-central stack">
    <div class="st-col">
      <div class="panel grow"><div class="hd"><span>Zentrale · Koppeltisch</span><span id="c-alarm" class="red"></span></div>
        <div class="fill" id="plot-box"><canvas id="plot"></canvas></div>
        <div class="hint">KLICK WÄHLT · RECHTSKLICK = KURS</div>
      </div>
      <div class="panel zc-prof"><div class="hd"><span>Tiefenprofil</span><span id="dd" class="dim"></span></div>
        <div class="fill" id="prof-box"><canvas id="prof"></canvas></div>
        <div class="hint">KLICK IN DAS PROFIL = BEFOHLENE TIEFE</div>
      </div>
    </div>
    <div class="st-col">
      <div class="tiles" id="tiles">
        <div class="tile" data-tile="depth"><span class="tl">TIEFE</span><b id="t-depth"></b><span id="t-depth2" class="dim"></span></div>
        <div class="tile" data-tile="trim"><span class="tl">TRIMM</span><b id="t-trim"></b><span id="t-trim2" class="dim"></span></div>
        <div class="tile" data-tile="bat"><span class="tl">BATTERIE</span><b id="t-bat"></b><span id="t-bat2" class="dim"></span></div>
        <div class="tile" data-tile="snort"><span class="tl">SCHNORCHEL</span><b id="t-sn"></b><span id="t-sn2" class="dim"></span></div>
      </div>
      <div class="panel"><div class="hd"><span>Tiefe befehlen</span><span id="c-layer" class="dim"></span></div>
        <div class="seg wide">
          <button data-depth="${PERISCOPE_DEPTH}" title="Auf Sehrohrtiefe (${PERISCOPE_DEPTH} m)">Sehrohrtiefe</button><button data-depth="60">60 m</button>
          <button data-depth="layer-" title="40 m über die gemessene Sprungschicht">Über Schicht</button><button data-depth="layer+" title="30 m unter die gemessene Sprungschicht">Unter Schicht</button><button data-depth="max">Max. Tiefe</button>
        </div>
      </div>
      <div class="panel"><div class="hd"><span>Befehle</span><span id="c-cmd-st" class="dim"></span></div>
        <div class="cmdgrid">
          <button data-cmd="alarm" class="warn" title="Alarmtauchen: Mast und Schnorchel ein, tief und schnell weg">Alarmtauchen${keycap('crashDive')}</button>
          <button id="snort" title="Schnorcheln lädt die Batterie: nur auf Sehrohrtiefe, laut und mit Mast über Wasser">Schnorcheln</button>
          <button data-cmd="silent" title="Ruhe im Boot: Hilfsmaschinen aus, keine lauten Arbeiten (leiser, die Besatzung ermüdet schneller)">Ruhe im Boot</button>
          <button data-cmd="battle" title="Gefechtsstationen: +10 % Leistung, ermüdet die Besatzung in etwa 90 Minuten">Gefechtsstationen</button>
          <button data-cmd="sound" title="Echolot: ein Lotimpuls nach unten, mit der Seekarte verglichen. Hilft nur, wo der Grund geneigt ist; ein Geleitschiff in wenigen Kilometern kann ihn hören">Echolot</button>
          <button data-cmd="blow" class="fire" title="Alle Tauchzellen anblasen: schnell nach oben, sehr laut, kostet eine Pressluftflasche (zweimal drücken)">Notanblasen</button>
        </div>
      </div>
      <div class="panel grow tabbed" id="zc-tabs">
        <div class="hd">${tabRow([['nav', 'Navigation', 'Koppelort, Standort, Echolot, Strom und Gezeit'], ['alarms', 'Tiefenalarme', 'Obergrenze, Untergrenze, Wasser unter dem Kiel'], ['mines', 'Minen']])}<span id="snd-st" class="dim"></span></div>
        <div class="pane" data-pane="nav"><div id="c-nav"></div></div>
        <div class="pane" data-pane="alarms" id="alarms"></div>
        <div class="pane" data-pane="mines"><div id="mines"></div></div>
      </div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const plot = new Plot(q<HTMLCanvasElement>('#plot'), { bearingLines: true, showConvoy: false, esmLines: true, route: true, actions: (p) => courseAction(p) });
  plot.scale = 60;
  const box = fillBox(q('#plot-box'), 220);
  const profBox = fillBox(q('#prof-box'), 90, 170);
  const profile = new DepthProfile(q<HTMLCanvasElement>('#prof'));
  q('#alarms').appendChild(depthAlarms.panel());
  const mines = minePanel();
  q('#mines').replaceWith(mines.el);
  const tabs = panelTabs(q('#zc-tabs'), 'zentrale');

  el.querySelectorAll<HTMLButtonElement>('[data-depth]').forEach((b) => (b.onclick = () => {
    const s = store.snap;
    if (!s) return;
    const v = b.dataset.depth!;
    const layer = s.env.layerDepth;
    if ((v === 'layer-' || v === 'layer+') && layer === undefined) {
      store.lastError = 'Sprungschicht unbekannt: einmal tief durchtauchen, um sie zu messen';
      return;
    }
    const depth = depthOf(v, layer, CLASSES[s.own.cls].maxDepth);
    if (depth !== undefined) net.send({ t: 'order', depth });
  }));
  q<HTMLButtonElement>('#snort').onclick = () => net.send({ t: 'toggle', what: 'snorkel', on: !store.snap?.own.snorkel });
  // Emergency blow: loud and irreversible, so it asks for a second press
  guardFire(q<HTMLButtonElement>('[data-cmd="blow"]'), () => ({ warn: 'WIRKLICH ANBLASEN' }), () => net.send({ t: 'blow' }));
  el.querySelectorAll<HTMLButtonElement>('[data-cmd]:not([data-cmd="blow"])').forEach((b) => (b.onclick = () => {
    const o = store.snap?.own;
    if (!o) return;
    const cmd = b.dataset.cmd;
    if (cmd === 'alarm') crashDive();
    else if (cmd === 'silent') net.send({ t: 'toggle', what: 'silent', on: !o.crew?.silent });
    else if (cmd === 'sound') net.send({ t: 'toggle', what: 'sounding', on: true });
    else if (cmd === 'battle') net.send({ t: 'toggle', what: 'battle', on: !o.crew?.battle });
  }));

  return {
    id: 'zentrale',
    title: 'Zentrale',
    el,
    collect() {
      if (store.snap) profile.collect(store.snap);
    },
    snap() {
      const s = store.snap!;
      const o = s.own;
      const spec = CLASSES[o.cls];
      const layer = s.env.layerDepth;
      mines.update();
      // The mines tab only on a boat that carries mines
      const hasMines = o.loadout.mines !== undefined;
      q('[data-ptab="mines"]').hidden = !hasMines;
      if (!hasMines && tabs.current === 'mines') tabs.show('nav');
      q('#c-alarm').textContent = s.alerts.some((a) => a.kind === 'torpedo' && s.time - a.time < 60) ? 'TORPEDO!' : '';
      q('#dd').textContent = `${o.depth.toFixed(0)} M → ${o.order.depth.toFixed(0)} M`;
      setHtml(q('#c-layer'), layer !== undefined ? `SCHICHT ${layer} M · ${o.depth > layer ? 'DARUNTER' : 'DARÜBER'}` : '<span class="amber">SCHICHT UNBEKANNT</span>');
      // Tiles: the four figures a diving officer watches
      const moving = Math.abs(o.order.depth - o.depth) > 2;
      q('#t-depth').textContent = `${o.depth.toFixed(0)} M`;
      q('#t-depth2').textContent = `${moving ? `→ ${o.order.depth.toFixed(0)} M · ` : ''}GRUND ${s.env.bottom !== undefined ? `${s.env.bottom} M` : '—'}`;
      const trim = o.trim ?? 0;
      q('#t-trim').textContent = Math.abs(trim) < 0.05 ? 'AUS' : `${trim > 0 ? '+' : '−'}${Math.abs(trim).toFixed(1).replace('.', ',')} T`;
      q('#t-trim').className = Math.abs(trim) > 0.2 ? 'amber' : '';
      q('#t-trim2').textContent = `PRESSLUFT ${'●'.repeat(o.hpAir ?? 3)}${'○'.repeat(Math.max(0, 3 - (o.hpAir ?? 3)))}${o.blowing ? ' · BLÄST AN' : ''}`;
      const bat = batteryInfo(o);
      q('#t-bat').textContent = bat ? `${bat.pct.toFixed(0)} %` : 'REAKTOR';
      q('#t-bat').className = bat ? (bat.pct < 25 ? 'red' : bat.pct < 50 ? 'amber' : '') : '';
      q('#t-bat2').textContent = bat ? bat.range : 'UNBEGRENZT';
      q('#t-bat2').className = bat?.short ? 'amber' : 'dim';
      const sx = o.snorkelExt ?? (o.snorkel ? 1 : 0);
      q('[data-tile="snort"]').hidden = !spec.battery;
      q('#t-sn').textContent = o.snorkel ? (o.depth > PERISCOPE_DEPTH + 0.5 ? 'ZU TIEF' : sx < 1 ? `${Math.round(sx * 100)} %` : 'LÄUFT') : sx > 0 ? 'FÄHRT EIN' : 'AUS';
      q('#t-sn').className = o.snorkel ? 'amber' : '';
      q('#t-sn2').textContent = o.snorkel ? 'LAUT · MAST ÜBER WASSER' : `NUR AUF ${PERISCOPE_DEPTH} M`;
      // Orders
      q('#snort').style.display = spec.battery ? '' : 'none';
      btnState(q('#snort'), o.snorkel && o.depth > PERISCOPE_DEPTH + 0.5 ? { on: true, label: 'ZU TIEF', tone: 'warn' } : o.snorkel && sx < 1 ? { on: true, label: `${Math.round(sx * 100)} %`, pct: sx * 100, tone: 'busy' }
        : !o.snorkel && sx > 0 ? { on: false, label: 'EIN…', pct: sx * 100, tone: 'busy' } : { on: o.snorkel });
      btnState(q('[data-cmd="silent"]'), { on: !!o.crew?.silent });
      btnState(q('[data-cmd="battle"]'), { on: !!o.crew?.battle });
      el.querySelectorAll<HTMLButtonElement>('[data-depth]').forEach((b) => depthBtn(b, o.depth, o.order.depth, depthOf(b.dataset.depth!, layer, spec.maxDepth)));
      q('#c-cmd-st').textContent = o.crew?.silent ? 'RUHE IM BOOT' : '';
      // Navigation and echo sounder
      q('#snd-st').textContent = s.env.bottom !== undefined ? `UNTER KIEL ${Math.round(s.env.bottom - o.depth)} M` : '';
      setHtml(q('#c-nav'), navRows(s));
    },
    frame() {
      plot.draw(box.h);
      profile.draw(profBox.h);
    },
    dispose() {
      box.dispose();
      profBox.dispose();
    },
  };
}

const FIX = { land: 'LANDPEILUNG', sat: 'SATELLIT', stars: 'STERNE', sounding: 'ECHOLOT' } as const;

/** The navigator's rows: believed position in degrees, its error, the last fix, what is coming. */
function navRows(s: Snapshot): string {
  const o = s.own;
  const region = s.env.seabed?.region;
  const pos = region ? (() => { const g = regionToGeo(REGIONS[region], o.x, o.y); return latLon(g.lat, g.lon); })() : `${(o.x / 1000).toFixed(1)} / ${(o.y / 1000).toFixed(1)} KM`;
  const n = o.nav;
  const err = o.navUncertainty !== undefined ? (o.navUncertainty < 1000 ? `± ${o.navUncertainty} M` : `± ${(o.navUncertainty / NM).toFixed(1).replace('.', ',')} SM`) : '';
  const last = n?.lastFix ? `${FIX[n.lastFix]} VOR ${clock(n.lastFixAgo ?? 0)}` : 'NUR KOPPELORT';
  const busy = n?.sat ? `SATELLIT EMPFANG ${Math.min(100, Math.round((n.sat / 120) * 100))} %` : n?.stars ? `STERNE ${Math.min(100, Math.round((n.stars / 180) * 100))} %` : '';
  const sat = n ? (n.satIn === 0 ? '<span class="amber">SATELLIT ÜBER DEM HORIZONT · MAST HOCH</span>' : `NÄCHSTER SATELLIT IN ${clock(n.satIn)}`) : '';
  return `<div class="row"><span class="dim">KOPPELORT</span><span class="${(o.navUncertainty ?? 0) > 2 * NM ? 'amber' : ''}">${pos} ${err}</span></div>
        <div class="row"><span class="dim">LETZTER STANDORT</span><span>${last}${busy ? ` · ${busy}` : ''}</span></div>
        ${sat ? `<div class="row"><span class="dim">NAVIGATION</span><span>${sat}</span></div>` : ''}
        <div class="row"><span class="dim">ECHOLOT</span><span>${o.nav?.lastFix === 'sounding' ? 'LETZTER FIX: ECHOLOT' : 'GIBT EINEN FIX, WO DER GRUND GENEIGT IST · IN DER NÄHE HÖRBAR'}</span></div>
        ${s.env.current ? `<div class="row"><span class="dim">STROM (ATLAS)</span><span>${s.env.current.kn >= 0.1 ? `SETZT ${tdeg3(s.env.current.set)}° · ${s.env.current.kn.toFixed(1)} KN` : 'KEIN NENNENSWERTER'}${s.env.tide ? ` · ${s.env.tide.flood ? 'FLUT' : 'EBBE'} KENTERT IN ${clock(s.env.tide.turnsInS)}` : ''}</span></div>` : ''}`;
}
