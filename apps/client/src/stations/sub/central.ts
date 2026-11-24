import { CLASSES, NM, PERISCOPE_DEPTH, REGIONS, regionToGeo, type Snapshot } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { clock, esc, h, latLon, setHtml, tdeg3 } from '../../widgets/format.js';
import { Plot } from '../../widgets/plot.js';
import { courseAction } from '../../widgets/actions.js';
import { Waterfall } from '../../widgets/waterfall.js';
import { pickByBearing } from './sonar.js';

/**
 * Zentrale: the commander's place in the boat. Unlike the frigate's operations room there is
 * no shared picture: what the boat knows is what it hears, what it saw through the periscope
 * and what came by radio while the mast was up. One chart (own dead reckoning, contacts,
 * solutions, the chart drawings), the boat's state at a glance, the pack's radio log, the
 * commands a commander gives most often, and a narrow waterfall so a new contact is not missed.
 */

export function centralStation(): Station {
  const el = h(`<div class="cols">
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel"><div class="hd"><span>Zentrale · Koppeltisch</span><span class="kbd">KLICK WÄHLT · RECHTSKLICK = KURS</span></div>
        <canvas id="plot"></canvas>
      </div>
      <div class="panel"><div class="hd"><span>Horchraum · Breitband</span><span class="dim">KLICK WÄHLT</span></div><canvas id="wf"></canvas></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Boot</span><span id="c-alarm" class="red"></span></div><div id="c-boat"></div></div>
      <div class="panel"><div class="hd"><span>Befehle</span></div>
        <div class="steps" style="flex-wrap:wrap">
          <button data-cmd="peri" title="Auf Sehrohrtiefe (${PERISCOPE_DEPTH} m)">Sehrohrtiefe</button>
          <button data-cmd="under" title="30 m unter die gemessene Sprungschicht">Unter die Schicht</button>
          <button data-cmd="alarm" class="warn" title="Alarmtauchen: Mast und Schnorchel ein, tief und schnell weg">Alarmtauchen</button>
          <button data-cmd="silent" title="Ruhe im Boot: Hilfsmaschinen aus, keine lauten Arbeiten (leiser, die Besatzung ermüdet schneller)">Ruhe im Boot</button>
          <button data-cmd="mast" title="Sehrohr / Funkmast aus- oder einfahren">Mast</button>
          <button data-cmd="sound" title="Echolot: ein Lotimpuls nach unten, mit der Seekarte verglichen. Hilft nur, wo der Grund geneigt ist; ein Geleitschiff in wenigen Kilometern kann ihn hören">Echolot</button>
        </div>
      </div>
      <div class="panel"><div class="hd"><span>Funkbuch</span><span class="dim" id="c-sched">NUR MIT MAST OBEN</span></div><div id="c-radio" style="max-height:180px;overflow:auto"></div></div>
      <div class="panel"><div class="hd"><span>Kontakte</span></div><div id="list"></div></div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const plot = new Plot(q<HTMLCanvasElement>('#plot'), { bearingLines: true, showConvoy: false, esmLines: true, actions: (p) => courseAction(p) });
  plot.scale = 60;
  const wf = new Waterfall(['hull', 'towed']);
  const wfCanvas = q<HTMLCanvasElement>('#wf');
  wfCanvas.style.cursor = 'pointer';
  wfCanvas.onmousedown = (e) => {
    const hit = pickByBearing(wf.bearingAt(wfCanvas, e.clientX));
    if (hit) store.selected = hit;
  };

  el.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => (b.onclick = () => {
    const s = store.snap;
    if (!s) return;
    const o = s.own;
    const layer = s.env.layerDepth;
    const maxD = CLASSES[o.cls].maxDepth;
    const bottom = s.env.bottom ?? 9999;
    const cmd = b.dataset.cmd;
    if (cmd === 'peri') net.send({ t: 'order', depth: PERISCOPE_DEPTH });
    else if (cmd === 'under') {
      if (layer === undefined) store.lastError = 'Sprungschicht unbekannt: einmal tief durchtauchen, um sie zu messen';
      else net.send({ t: 'order', depth: Math.min(maxD * 0.9, layer + 30, bottom - 30) });
    } else if (cmd === 'alarm') {
      // Down and away: masts in, deep (under the layer if known), full speed for now
      if (o.mastUp) net.send({ t: 'toggle', what: 'mast', on: false });
      if (o.snorkel) net.send({ t: 'toggle', what: 'snorkel', on: false });
      net.send({ t: 'order', depth: Math.max(40, Math.min(maxD * 0.8, bottom - 30, layer !== undefined ? layer + 40 : 150)), speedKn: CLASSES[o.cls].maxSpeedKn });
    } else if (cmd === 'silent') net.send({ t: 'toggle', what: 'silent', on: !o.crew?.silent });
    else if (cmd === 'mast') net.send({ t: 'toggle', what: 'mast', on: !o.mastUp });
    else if (cmd === 'sound') net.send({ t: 'toggle', what: 'sounding', on: true });
  }));

  return {
    title: 'Zentrale',
    el,
    snap() {
      const s = store.snap!;
      const o = s.own;
      const spec = CLASSES[o.cls];
      wf.push(s);
      renderContactList(q('#list'));
      const layer = s.env.layerDepth;
      const pct = spec.battery && o.battery !== undefined ? (100 * o.battery) / spec.battery.capacityKnH : undefined;
      const torp = s.alerts.some((a) => a.kind === 'torpedo' && s.time - a.time < 60);
      q('#c-alarm').textContent = torp ? 'TORPEDO!' : '';
      const mast = (o.mastExt ?? (o.mastUp ? 1 : 0));
      setHtml(q('#c-boat'), `
        <div class="row"><span class="dim">TIEFE</span><span>${o.depth.toFixed(0)} M${Math.abs(o.order.depth - o.depth) > 2 ? ` → ${o.order.depth.toFixed(0)} M` : ''} · GRUND ${s.env.bottom !== undefined ? `${s.env.bottom} M` : '—'}</span></div>
        <div class="row"><span class="dim">SPRUNGSCHICHT</span><span class="${layer === undefined ? 'amber' : ''}">${layer !== undefined ? `${layer} M · ${o.depth > layer ? 'DARUNTER' : 'DARÜBER'}` : 'UNBEKANNT'}</span></div>
        ${navRows(s)}
        <div class="row"><span class="dim">KURS · FAHRT</span><span>${tdeg3(o.heading)}° · ${o.speedKn.toFixed(1)} KN${o.crew?.silent ? ' · <span class="amber">RUHE IM BOOT</span>' : ''}</span></div>
        ${s.env.current ? `<div class="row"><span class="dim">STROM (ATLAS)</span><span>${s.env.current.kn >= 0.1 ? `SETZT ${tdeg3(s.env.current.set)}° · ${s.env.current.kn.toFixed(1)} KN` : 'KEIN NENNENSWERTER'}${s.env.tide ? ` · ${s.env.tide.flood ? 'FLUT' : 'EBBE'} KENTERT IN ${clock(s.env.tide.turnsInS)}` : ''}</span></div>` : ''}
        <div class="row"><span class="dim">EIGENGERÄUSCH</span><span class="${o.noiseDb > 135 ? 'red' : o.noiseDb > 122 ? 'amber' : ''}">${o.noiseDb.toFixed(0)} DB</span></div>
        ${pct !== undefined ? `<div class="row"><span class="dim">BATTERIE</span><span class="${pct < 25 ? 'red' : pct < 50 ? 'amber' : ''}">${pct.toFixed(0)} %${o.batteryEnduranceS !== undefined ? ` · ${clock(o.batteryEnduranceS)} BEI DIESER FAHRT` : ''}</span></div>` : '<div class="row"><span class="dim">ANTRIEB</span><span>REAKTOR</span></div>'}
        <div class="row"><span class="dim">MAST</span><span class="${mast > 0.5 ? 'amber' : ''}">${mast >= 1 ? 'OBEN · SICHTBAR UND PEILBAR' : mast > 0 ? `FÄHRT ${Math.round(mast * 100)} %` : 'EINGEFAHREN'}${o.snorkel ? ' · SCHNORCHELT' : ''}</span></div>
        <div class="row"><span class="dim">TORPEDOS</span><span>${o.loadout.heavy} · ROHRE ${o.loadout.tubes.filter((t) => t.loaded).length}/${o.loadout.tubes.length} GELADEN · TÄUSCHKÖRPER ${o.loadout.noisemakers}</span></div>`);
      q<HTMLButtonElement>('[data-cmd="silent"]').classList.toggle('on', !!o.crew?.silent);
      q<HTMLButtonElement>('[data-cmd="mast"]').classList.toggle('on', !!o.mastUp);
      // VLF schedule of fleet command: every 20 minutes, three minutes on air
      const cmd = o.command;
      q('#c-sched').textContent = cmd ? (cmd.nextS > 0 ? `VLF IN ${clock(cmd.nextS)}` : cmd.done ? 'VLF EMPFANGEN' : 'VLF SENDET JETZT') : 'NUR MIT MAST OBEN';
      const radio = [...s.radio].reverse().slice(0, 12);
      setHtml(q('#c-radio'), radio.length
        ? radio.map((r) => `<div class="row" style="display:block"><span class="dim">${clock(r.time)} · ${esc(r.from)}</span><br>${esc(r.text)}</div>`).join('')
        : '<div class="dim">NOCH KEIN FUNKSPRUCH EMPFANGEN</div>');
    },
    frame() {
      const tall = Math.max(300, window.innerHeight - 330);
      plot.draw(tall);
      wf.draw(wfCanvas, 150, store.snap, store.selected);
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
        ${sat ? `<div class="row"><span class="dim">NAVIGATION</span><span>${sat}</span></div>` : ''}`;
}
