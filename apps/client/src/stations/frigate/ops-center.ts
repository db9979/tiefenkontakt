import { hasHelicopter } from '@tk/shared';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { h, setHtml, tdeg3 } from '../../widgets/format.js';
import { Plot } from '../../widgets/plot.js';
import { buoyAction, courseAction, escortOrderActions, mpaAction, rocketAction, ssmAction } from '../../widgets/actions.js';
import { mountEscortOrders } from '../../widgets/escort-orders.js';

export function opsCenterStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Operationszentrale · Lagebild</span><span class="kbd">KLICK WÄHLT · RECHTSKLICK = KURS / RAKETE</span></div>
      <canvas id="plot"></canvas>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Kontakte (eigen + Datalink)</span></div><div id="list"></div></div>
      <div class="panel"><div class="hd"><span>Verband</span></div><div id="group"></div></div>
      <div class="panel" id="detour-p"><div class="hd"><span>Geleitführung · Konvoi und Aufträge</span></div><div id="escort-orders"></div></div>
    </div>
  </div>`);
  const plot = new Plot(el.querySelector<HTMLCanvasElement>('#plot')!, {
    bearingLines: true, showConvoy: true, esmLines: true, route: true, actions: (p) => [...courseAction(p), ...ssmAction(p), ...rocketAction(p), ...(store.snap && hasHelicopter(store.snap.own.cls) ? buoyAction(p) : []), ...mpaAction(p), ...escortOrderActions(p)],
  });
  plot.scale = 80;
  const orders = mountEscortOrders(el.querySelector<HTMLElement>('#escort-orders')!);
  return {
    title: 'OPZ',
    el,
    snap() {
      const s = store.snap!;
      renderContactList(el.querySelector('#list')!);
      (el.querySelector('#detour-p') as HTMLElement).style.display = s.command ? '' : 'none';
      orders.update(s);
      const merchants = s.friendlies.filter((f) => f.cls === 'merchant');
      const escorts = s.friendlies.filter((f) => f.cls !== 'merchant');
      // Only what this ship and side actually have: convoy lines with a convoy, flight lines with a helicopter
      const helo = hasHelicopter(s.own.cls) && s.air;
      setHtml(el.querySelector('#group')!, `
        ${merchants.length ? `<div class="row"><span class="dim">FRACHTER SCHWIMMEND</span><span>${merchants.filter((m) => m.alive).length} / ${merchants.length}</span></div>` : ''}
        <div class="row"><span class="dim">DATALINK-TEILNEHMER</span><span>${escorts.length}</span></div>
        <div class="row"><span class="dim">WASSERTIEFE</span><span class="${(s.env.bottom ?? 999) < 30 ? 'red' : ''}">${s.env.bottom !== undefined ? s.env.bottom + ' M' : '—'}</span></div>
        ${s.env.current ? `<div class="row"><span class="dim">STROM</span><span>${s.env.current.kn >= 0.1 ? `${tdeg3(s.env.current.set)}° · ${s.env.current.kn.toFixed(1).replace('.', ',')} KN` : '—'}${s.env.tide ? ` · ${s.env.tide.flood ? 'FLUT' : 'EBBE'}, KENTERT IN ${Math.round(s.env.tide.turnsInS / 60)} MIN` : ''}</span></div>` : ''}
        <div class="row"><span class="dim">TAGESZEIT</span><span>${(s.env.light ?? 1) > 0.8 ? 'TAG' : (s.env.light ?? 1) > 0.3 ? 'DÄMMERUNG' : 'NACHT · SICHT STARK EINGESCHRÄNKT'}</span></div>
        ${helo ? `<div class="row"><span class="dim">HUBSCHRAUBER</span><span>${helo.heloReadyInS > 0 ? `<span class="amber">UNTERWEGS · BEREIT IN ${Math.ceil(helo.heloReadyInS / 60)} MIN</span>` : 'AN DECK · BEREIT'}</span></div>
        <div class="row"><span class="dim">SONARBOJEN</span><span>${helo.stock} AN BORD · ${helo.buoys.length} IM WASSER</span></div>
        <div class="row"><span class="dim">HUBSCHRAUBER-TORPEDOS</span><span>${helo.heloTorps ?? 0}</span></div>
        <div class="dim" style="margin-top:4px">KARTE: RECHTSKLICK BZW. LANGE TIPPEN FÜR BOJEN UND HUBSCHRAUBER</div>` : ''}
        ${s.air && s.own.team === 'west' ? `<div class="row"><span class="dim">SEEFERNAUFKLÄRER</span><span>${s.air.mpaReadyInS > 0 ? `BEREIT IN ${Math.ceil(s.air.mpaReadyInS / 60)} MIN` : `BEREIT · ${s.air.mpaBuoys} BOJEN`}</span></div>` : ''}
        ${escorts.map((e) => `<div class="row"><span>${e.name}</span><span class="${e.alive ? '' : 'red'}">${e.alive ? `${e.speedKn.toFixed(0)} KN` : 'GESUNKEN'}</span></div>`).join('')}`);
    },
    frame() {
      plot.draw(Math.max(360, window.innerHeight - 90));
    },
  };
}
