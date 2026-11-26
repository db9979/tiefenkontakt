import { CLASSES, NM, PERISCOPE_DEPTH, REGIONS, cavitationSpeedAt, regionToGeo, type Snapshot } from '@tk/shared';
import { navErrorText } from '../../widgets/plot-marks.js';
import { net } from '../../net.js';
import { btnState, depthBtn } from '../../widgets/btn-state.js';
import { guardFire } from '../../widgets/fire-guard.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { clock, h, latLon, setHtml, tdeg3 } from '../../widgets/format.js';
import { Plot } from '../../widgets/plot.js';
import { courseAction } from '../../widgets/actions.js';
import { BATTERY_TIP, DepthProfile, batteryInfo, depthOf, ownDepthLimit, trimDeg, trimText } from '../../widgets/depth-profile.js';
import { airThreat, exposed } from './air-alarm.js';
import { depthAlarms } from '../../widgets/depth-alarm-ui.js';
import { crashDive } from '../../widgets/emergency.js';
import { fillBox } from '../../widgets/fill.js';
import { keycap } from '../../widgets/keys.js';
import { minePanel } from '../../widgets/mine-panel.js';
import { panelTabs, tabRow } from '../../widgets/panel-tabs.js';

/** Knots with one decimal comma, no unit ("6,5"). */
const kn1 = (v: number) => v.toFixed(1).replace('.', ',');

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
      <div class="c-air" id="c-air" hidden><span class="red blink" id="c-air-txt"></span><button data-crash class="warn" title="Alarmtauchen: Mast und Schnorchel ein, tief und schnell weg">ALARMTAUCHEN${keycap('crashDive')}</button></div>
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
        <div class="depthgrid">
          <button data-depth="${PERISCOPE_DEPTH}" title="Auf Sehrohrtiefe (${PERISCOPE_DEPTH} m)">Sehrohr</button><button data-depth="60" title="Auf 60 m">60 m</button><button data-depth="max" title="Auf die größte Tauchtiefe">Max. Tiefe</button>
          <button data-depth="layer-" title="40 m über die gemessene Sprungschicht">Über Schicht</button><button data-depth="layer+" title="30 m unter die gemessene Sprungschicht">Unter Schicht</button>
        </div>
      </div>
      <div class="panel"><div class="hd"><span>Befehle</span><span id="c-cmd-st" class="dim"></span></div>
        <div class="cmdgrid">
          <button data-cmd="alarm" class="warn" title="Alarmtauchen: Mast und Schnorchel ein, tief und schnell weg">Alarmtauchen${keycap('crashDive')}</button>
          <button data-cmd="blow" class="fire" title="Alle Tauchzellen anblasen: schnell nach oben, sehr laut, kostet eine Pressluftflasche (zweimal drücken)">Notanblasen</button>
          <button id="snort" title="Schnorcheln lädt die Batterie: nur auf Sehrohrtiefe, laut und mit Mast über Wasser">Schnorcheln</button>
          <button data-cmd="silent" title="Ruhe im Boot: Hilfsmaschinen aus, keine lauten Arbeiten (leiser, die Besatzung ermüdet schneller)">Ruhe im Boot</button>
          <button data-cmd="battle" title="Gefechtsstationen: +10 % Leistung, ermüdet die Besatzung in etwa 90 Minuten">Gefechtsstationen</button>
          <button data-cmd="sound" title="Echolot: ein Lotimpuls nach unten, mit der Seekarte verglichen. Hilft nur, wo der Grund geneigt ist; ein Geleitschiff in wenigen Kilometern kann ihn hören">Echolot</button>
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
      store.lastError = s.env.noLayer ? 'Hier keine Sprungschicht: das Wasser ist bis zum Grund durchmischt' : 'Sprungschicht unbekannt: einmal tief durchtauchen, um sie zu messen';
      return;
    }
    const depth = depthOf(v, layer, ownDepthLimit(s.own));
    if (depth !== undefined) net.send({ t: 'order', depth });
  }));
  q<HTMLButtonElement>('#c-air [data-crash]').onclick = () => crashDive();
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
      // Torpedo first; an aircraft in sight while the mast or snorkel shows is the next worst
      const air = exposed(s) ? airThreat(s) : undefined;
      q('#c-alarm').textContent = s.alerts.some((a) => a.kind === 'torpedo' && s.time - a.time < 60) ? 'TORPEDO!' : air ? `FLIEGER · ${air.text}` : '';
      // S3: the call to action stands on top of the Zentrale too, not only on the periscope
      q('#c-air').hidden = !air;
      if (air) q('#c-air-txt').textContent = `FLIEGERALARM · ${air.text}`;
      const crash = q<HTMLButtonElement>('[data-cmd="alarm"]');
      btnState(crash, air ? { label: 'FLIEGER!', tone: 'warn' } : { label: '' });
      // Cavitation limit here and at the ordered depth: it grows with √pressure, so deep is where a boat sprints quietly
      const cavHere = o.cavitationKn < 90 ? o.cavitationKn : undefined;
      const cavThere = cavHere !== undefined ? cavitationSpeedAt(o.cls, o.order.depth) : undefined;
      const cavTxt = cavHere === undefined ? '' : ` · KAV AB ${kn1(cavHere)}${cavThere !== undefined && Math.abs(cavThere - cavHere) >= 0.5 ? ` → ${kn1(cavThere)}` : ''} KN`;
      q('#dd').textContent = `${o.depth.toFixed(0)} M → ${o.order.depth.toFixed(0)} M${cavTxt}`;
      q('#dd').title = cavHere === undefined ? '' : 'Kavitationsgrenze auf der jetzigen (und der befohlenen) Tiefe: darüber knistert die Schraube, das Boot ist weit zu hören';
      setHtml(q('#c-layer'), layer !== undefined ? `SCHICHT ${layer} M · ${o.depth > layer ? 'DARUNTER' : 'DARÜBER'}` : s.env.noLayer ? 'KEINE SCHICHT · DURCHMISCHT BIS GRUND' : '<span class="amber">SCHICHT UNBEKANNT</span>');
      // Tiles: the four figures a diving officer watches
      const moving = Math.abs(o.order.depth - o.depth) > 2;
      q('#t-depth').textContent = `${o.depth.toFixed(0)} M`;
      // A damaged hull: the reduced test depth takes the place of the bottom figure (the danger now)
      const limit = ownDepthLimit(o);
      const hurt = limit < spec.maxDepth;
      q('#t-depth2').textContent = `${moving ? `→ ${o.order.depth.toFixed(0)} M · ` : ''}${hurt ? `MAX ${limit} M` : `GRUND ${s.env.bottom !== undefined ? `${s.env.bottom} M` : '—'}`}`;
      q('#t-depth2').className = hurt ? (o.depth > limit ? 'red' : 'amber') : 'dim';
      q('[data-tile="depth"]').title = hurt ? `Druckkörper beschädigt: Testtiefe ${limit} M statt ${spec.maxDepth} M, Zerstörungstiefe etwa ${Math.round(limit * 1.475)} M` : '';
      // Trim in degrees, the same figure damage control shows; the weight out of trim in the tooltip
      const trim = trimDeg(o);
      const tons = o.trim ?? 0;
      q('#t-trim').textContent = trimText(trim);
      q('#t-trim').className = Math.abs(trim) > 3 ? 'red' : Math.abs(trim) > 1 ? 'amber' : '';
      q('[data-tile="trim"]').title = `Trimmwinkel (+ Bug unten). ${Math.abs(tons) < 0.05 ? 'Boot ausgetrimmt' : `Trimmlast ${Math.abs(tons).toFixed(1).replace('.', ',')} t ${tons > 0 ? 'zu leicht' : 'zu schwer'} · Trimmpumpen laufen`}`;
      q('#t-trim2').textContent = `PRESSLUFT ${'●'.repeat(o.hpAir ?? 3)}${'○'.repeat(Math.max(0, 3 - (o.hpAir ?? 3)))}${o.blowing ? ' · BLÄST AN' : ''}`;
      const bat = batteryInfo(o, s.env.seaState);
      q('#t-bat').textContent = bat ? `${bat.pct.toFixed(0)} %` : 'REAKTOR';
      q('#t-bat').className = bat ? (bat.pct < 25 ? 'red' : bat.pct < 50 ? 'amber' : '') : '';
      q('#t-bat2').textContent = bat ? bat.range : 'UNBEGRENZT';
      q('#t-bat2').className = bat?.short || bat?.slow ? 'amber' : 'dim';
      q('[data-tile="bat"]').title = bat ? BATTERY_TIP : '';
      const sx = o.snorkelExt ?? (o.snorkel ? 1 : 0);
      q('[data-tile="snort"]').hidden = !spec.battery;
      q('#t-sn').textContent = o.snorkel ? (o.depth > PERISCOPE_DEPTH + 0.5 ? 'ZU TIEF' : sx < 1 ? `${Math.round(sx * 100)} %` : 'LÄUFT') : sx > 0 ? 'FÄHRT EIN' : 'AUS';
      q('#t-sn').className = o.snorkel ? 'amber' : '';
      q('#t-sn2').textContent = o.snorkel ? 'LAUT · MAST ÜBER WASSER' : `NUR AUF ${PERISCOPE_DEPTH} M`;
      // Orders
      q('#snort').style.display = spec.battery ? '' : 'none';
      btnState(q('#snort'), o.snorkel && o.depth > PERISCOPE_DEPTH + 0.5 ? { on: true, label: 'ZU TIEF', tone: 'warn' } : o.snorkel && sx < 1 ? { on: true, label: `${Math.round(sx * 100)} %`, pct: sx * 100, tone: 'busy' }
        : !o.snorkel && sx > 0 ? { on: false, label: 'FÄHRT EIN', pct: sx * 100, tone: 'busy' } : { on: o.snorkel });
      btnState(q('[data-cmd="silent"]'), { on: !!o.crew?.silent });
      btnState(q('[data-cmd="battle"]'), { on: !!o.crew?.battle });
      el.querySelectorAll<HTMLButtonElement>('[data-depth]').forEach((b) => {
        depthBtn(b, o.depth, o.order.depth, depthOf(b.dataset.depth!, layer, limit));
        // Over/under the layer only once it is measured; the tooltip says why not
        if (!b.dataset.depth!.startsWith('layer')) return;
        b.disabled = layer === undefined;
        b.title = layer !== undefined ? (b.dataset.depth === 'layer-' ? '40 m über die gemessene Sprungschicht' : '30 m unter die gemessene Sprungschicht')
          : s.env.noLayer ? 'Hier keine Sprungschicht: das Wasser ist bis zum Grund durchmischt' : 'Sprungschicht unbekannt: einmal tief durchtauchen, um sie zu messen';
      });
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
  // Position error in the chart's unit (S20: M/KM, as the circle's label on the chart)
  const err = o.navUncertainty !== undefined ? navErrorText(o.navUncertainty) : '';
  const last = n?.lastFix ? `${FIX[n.lastFix]} VOR ${clock(n.lastFixAgo ?? 0)}` : 'NUR KOPPELORT';
  const busy = n?.sat ? `SATELLIT EMPFANG ${Math.min(100, Math.round((n.sat / 120) * 100))} %` : n?.stars ? `STERNE ${Math.min(100, Math.round((n.stars / 180) * 100))} %` : '';
  const sat = n ? (n.satIn === 0 ? '<span class="amber">SATELLIT ÜBER DEM HORIZONT · MAST HOCH</span>' : `NÄCHSTER SATELLIT IN ${clock(n.satIn)}`) : '';
  // One short value per row, right-aligned; the explanations are in the tooltips and the hint line
  const cur = s.env.current;
  const tide = s.env.tide;
  return `<div class="row"><span class="dim">KOPPELORT</span><span class="${(o.navUncertainty ?? 0) > 2 * NM ? 'amber' : ''}">${pos} ${err}</span></div>
        <div class="row"><span class="dim">LETZTER STANDORT</span><span>${last}</span></div>
        ${busy || sat ? `<div class="row"><span class="dim">NAVIGATION</span><span>${busy || sat}</span></div>` : ''}
        <div class="row" title="Echolot: ein Lotimpuls nach unten, mit der Seekarte verglichen. Gibt einen Fix nur, wo der Grund geneigt ist; in der Nähe hörbar"><span class="dim">ECHOLOT</span><span>${o.nav?.lastFix === 'sounding' ? 'LETZTER FIX' : 'BEREIT'}</span></div>
        ${cur ? `<div class="row" title="Strom laut Atlas: wohin er setzt und wie schnell"><span class="dim">STROM</span><span>${cur.kn >= 0.1 ? `SETZT ${tdeg3(cur.set)}° · ${cur.kn.toFixed(1).replace('.', ',')} KN` : 'KEIN NENNENSWERTER'}</span></div>` : ''}
        ${cur && tide ? `<div class="row"><span class="dim">GEZEIT</span><span>${tide.flood ? 'FLUT' : 'EBBE'} · KENTERT IN ${clock(tide.turnsInS)}</span></div>` : ''}
        <div class="hint" title="Echolot: gibt einen Fix nur, wo der Grund geneigt ist; ein Geleitschiff in der Nähe hört ihn">ECHOLOT: FIX NUR AN GENEIGTEM GRUND · HÖRBAR</div>`;
}
