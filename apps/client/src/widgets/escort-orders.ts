import { hasHelicopter } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { h, setHtml, tdeg3 } from './format.js';

/**
 * Verband/Konvoi tab of the OPZ (placeholder until escort tasking lands; it carries what the
 * old OPZ side panel did): the group at a glance and the convoy's detour off its route.
 */

/** Detour steps (m, − = port of the convoy's leg) and their button labels. */
const DETOURS: [number, string][] = [[-3000, '◀ 3 km'], [-1500, '◀ 1,5 km'], [0, 'Route'], [1500, '1,5 km ▶'], [3000, '3 km ▶']];

export function mountEscortOrders(host: HTMLElement): { update(): void; dispose(): void } {
  const el = h(`<div class="escort-orders">
    <div id="group"></div>
    <div id="detour-p"><div class="subhd"><span>Konvoi umleiten</span><span id="detour" class="dim"></span></div>
      <div class="seg wide">${DETOURS.map(([m, l]) => `<button data-detour="${m}" title="${m ? `Kurs des Konvois ${String(Math.abs(m) / 1000).replace('.', ',')} km nach ${m < 0 ? 'Backbord' : 'Steuerbord'} versetzen (z. B. um eine Minensperre)` : 'Zurück auf die befohlene Route'}">${l}</button>`).join('')}</div>
    </div>
  </div>`);
  host.appendChild(el);
  el.querySelectorAll<HTMLButtonElement>('[data-detour]').forEach((b) => (b.onclick = () => net.send({ t: 'convoy_detour', offset: Number(b.dataset.detour) })));
  return {
    update() {
      const s = store.snap;
      if (!s) return;
      const off = s.own.convoyOffset ?? 0;
      const merchants = s.friendlies.filter((f) => f.cls === 'merchant');
      const escorts = s.friendlies.filter((f) => f.cls !== 'merchant');
      el.querySelector<HTMLElement>('#detour-p')!.style.display = merchants.length ? '' : 'none';
      el.querySelector('#detour')!.textContent = off ? `${(Math.abs(off) / 1000).toFixed(1).replace('.', ',')} KM ${off < 0 ? 'BB' : 'STB'}` : 'AUF ROUTE';
      el.querySelectorAll<HTMLButtonElement>('[data-detour]').forEach((b) => b.classList.toggle('on', Number(b.dataset.detour) === off));
      setHtml(el.querySelector('#group')!, `
        ${merchants.length ? `<div class="row"><span class="dim">FRACHTER SCHWIMMEND</span><span>${merchants.filter((m) => m.alive).length} / ${merchants.length}</span></div>` : ''}
        <div class="row"><span class="dim">DATALINK-TEILNEHMER</span><span>${escorts.length}</span></div>
        ${s.env.current ? `<div class="row"><span class="dim">STROM</span><span>${s.env.current.kn >= 0.1 ? `${tdeg3(s.env.current.set)}° · ${s.env.current.kn.toFixed(1).replace('.', ',')} KN` : '—'}${s.env.tide ? ` · ${s.env.tide.flood ? 'FLUT' : 'EBBE'}, KENTERT IN ${Math.round(s.env.tide.turnsInS / 60)} MIN` : ''}</span></div>` : ''}
        <div class="row"><span class="dim">TAGESZEIT</span><span>${(s.env.light ?? 1) > 0.8 ? 'TAG' : (s.env.light ?? 1) > 0.3 ? 'DÄMMERUNG' : 'NACHT · SICHT STARK EINGESCHRÄNKT'}</span></div>
        ${s.air && s.own.team === 'west' ? `<div class="row"><span class="dim">SEEFERNAUFKLÄRER</span><span>${s.air.mpaReadyInS > 0 ? `BEREIT IN ${Math.ceil(s.air.mpaReadyInS / 60)} MIN` : `BEREIT · ${s.air.mpaBuoys} BOJEN`}</span></div>` : ''}
        ${hasHelicopter(s.own.cls) ? '' : '<div class="row"><span class="dim">HUBSCHRAUBER</span><span class="dim">KEINER AN BORD</span></div>'}
        ${escorts.map((e) => `<div class="row"><span>${e.name}</span><span class="${e.alive ? '' : 'red'}">${e.alive ? `${e.speedKn.toFixed(0)} KN` : 'GESUNKEN'}</span></div>`).join('')}`);
    },
    dispose() {
      el.remove();
    },
  };
}
