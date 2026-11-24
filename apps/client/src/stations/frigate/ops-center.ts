import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { h, setHtml } from '../../widgets/format.js';
import { Plot } from '../../widgets/plot.js';
import { buoyAction, courseAction, mpaAction, rocketAction, ssmAction } from '../../widgets/actions.js';

/** Detour steps (m, − = port of the convoy's leg) and their button labels. */
const DETOURS: [number, string][] = [[-3000, '◀ 3 km'], [-1500, '◀ 1,5 km'], [0, 'Route'], [1500, '1,5 km ▶'], [3000, '3 km ▶']];

export function opsCenterStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Operationszentrale · Lagebild</span><span class="kbd">KLICK WÄHLT · RECHTSKLICK = KURS / RAKETE</span></div>
      <canvas id="plot"></canvas>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Kontakte (eigen + Datalink)</span></div><div id="list"></div></div>
      <div class="panel"><div class="hd"><span>Verband</span></div><div id="group"></div></div>
      <div class="panel" id="detour-p"><div class="hd"><span>Konvoi umleiten</span><span id="detour" class="dim"></span></div>
        <div class="steps">${DETOURS.map(([m, l]) => `<button data-detour="${m}" title="${m ? `Kurs des Konvois ${String(Math.abs(m) / 1000).replace('.', ',')} km nach ${m < 0 ? 'Backbord' : 'Steuerbord'} versetzen (z. B. um eine Minensperre)` : 'Zurück auf die befohlene Route'}">${l}</button>`).join('')}</div>
      </div>
    </div>
  </div>`);
  const plot = new Plot(el.querySelector<HTMLCanvasElement>('#plot')!, {
    bearingLines: true, showConvoy: true, esmLines: true, actions: (p) => [...courseAction(p), ...ssmAction(p), ...rocketAction(p), ...buoyAction(p), ...mpaAction(p)],
  });
  plot.scale = 80;
  el.querySelectorAll<HTMLButtonElement>('[data-detour]').forEach((b) => (b.onclick = () => net.send({ t: 'convoy_detour', offset: Number(b.dataset.detour) })));
  return {
    title: 'OPZ',
    el,
    snap() {
      const s = store.snap!;
      renderContactList(el.querySelector('#list')!);
      const off = s.own.convoyOffset ?? 0;
      (el.querySelector('#detour-p') as HTMLElement).style.display = s.friendlies.some((f) => f.cls === 'merchant') ? '' : 'none';
      el.querySelector('#detour')!.textContent = off ? `${(Math.abs(off) / 1000).toFixed(1).replace('.', ',')} KM ${off < 0 ? 'BB' : 'STB'}` : 'AUF ROUTE';
      el.querySelectorAll<HTMLButtonElement>('[data-detour]').forEach((b) => b.classList.toggle('on', Number(b.dataset.detour) === off));
      const merchants = s.friendlies.filter((f) => f.cls === 'merchant');
      const escorts = s.friendlies.filter((f) => f.cls !== 'merchant');
      setHtml(el.querySelector('#group')!, `
        <div class="row"><span class="dim">FRACHTER SCHWIMMEND</span><span>${merchants.filter((m) => m.alive).length} / ${merchants.length}</span></div>
        <div class="row"><span class="dim">DATALINK-TEILNEHMER</span><span>${escorts.length}</span></div>
        <div class="row"><span class="dim">WASSERTIEFE</span><span class="${(s.env.bottom ?? 999) < 30 ? 'red' : ''}">${s.env.bottom !== undefined ? s.env.bottom + ' M' : '—'}</span></div>
        ${s.env.current ? `<div class="row"><span class="dim">STROM</span><span>${s.env.current.kn >= 0.1 ? `${String(s.env.current.set).padStart(3, '0')}° · ${s.env.current.kn.toFixed(1).replace('.', ',')} KN` : '—'}${s.env.tide ? ` · ${s.env.tide.flood ? 'FLUT' : 'EBBE'}, KENTERT IN ${Math.round(s.env.tide.turnsInS / 60)} MIN` : ''}</span></div>` : ''}
        <div class="row"><span class="dim">TAGESZEIT</span><span>${(s.env.light ?? 1) > 0.8 ? 'TAG' : (s.env.light ?? 1) > 0.3 ? 'DÄMMERUNG' : 'NACHT · SICHT STARK EINGESCHRÄNKT'}</span></div>
        <div class="row"><span class="dim">HUBSCHRAUBER</span><span>${!s.air ? '—' : s.air.heloReadyInS > 0 ? `<span class="amber">UNTERWEGS · BEREIT IN ${Math.ceil(s.air.heloReadyInS / 60)} MIN</span>` : 'AN DECK · BEREIT'}</span></div>
        <div class="row"><span class="dim">SONARBOJEN</span><span>${s.air ? `${s.air.stock} AN BORD · ${s.air.buoys.length} IM WASSER` : '—'}</span></div>
        <div class="row"><span class="dim">HUBSCHRAUBER-TORPEDOS</span><span>${s.air?.heloTorps ?? 0}</span></div>
        <div class="row"><span class="dim">SEEFERNAUFKLÄRER</span><span>${!s.air ? '—' : s.air.mpaReadyInS > 0 ? `BEREIT IN ${Math.ceil(s.air.mpaReadyInS / 60)} MIN` : `BEREIT · ${s.air.mpaBuoys} BOJEN`}</span></div>
        <div class="dim" style="margin-top:4px">RECHTSKLICK AUF DIE KARTE: SONARBOJE ABWERFEN</div>
        ${escorts.map((e) => `<div class="row"><span>${e.name}</span><span class="${e.alive ? '' : 'red'}">${e.alive ? `${e.speedKn.toFixed(0)} KN` : 'GESUNKEN'}</span></div>`).join('')}`);
    },
    frame() {
      plot.draw(Math.max(360, window.innerHeight - 90));
    },
  };
}
