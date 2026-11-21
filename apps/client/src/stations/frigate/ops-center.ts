import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { h } from '../../widgets/format.js';
import { Plot } from '../../widgets/plot.js';
import { buoyAction, courseAction, rocketAction } from '../../widgets/actions.js';

export function opsCenterStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Operationszentrale · Lagebild</span><span class="kbd">KLICK WÄHLT · RECHTSKLICK = KURS / RAKETE</span></div>
      <canvas id="plot"></canvas>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Kontakte (eigen + Datalink)</span></div><div id="list"></div></div>
      <div class="panel"><div class="hd"><span>Verband</span></div><div id="group"></div></div>
    </div>
  </div>`);
  const plot = new Plot(el.querySelector<HTMLCanvasElement>('#plot')!, {
    bearingLines: true, showConvoy: true, esmLines: true, actions: (p) => [...courseAction(p), ...rocketAction(p), ...buoyAction(p)],
  });
  plot.scale = 80;
  return {
    title: 'OPZ',
    el,
    snap() {
      const s = store.snap!;
      renderContactList(el.querySelector('#list')!);
      const merchants = s.friendlies.filter((f) => f.cls === 'merchant');
      const escorts = s.friendlies.filter((f) => f.cls !== 'merchant');
      el.querySelector('#group')!.innerHTML = `
        <div class="row"><span class="dim">FRACHTER SCHWIMMEND</span><span>${merchants.filter((m) => m.alive).length} / ${merchants.length}</span></div>
        <div class="row"><span class="dim">DATALINK-TEILNEHMER</span><span>${escorts.length}</span></div>
        <div class="row"><span class="dim">WASSERTIEFE</span><span class="${(s.env.bottom ?? 999) < 30 ? 'red' : ''}">${s.env.bottom !== undefined ? s.env.bottom + ' M' : '—'}</span></div>
        <div class="row"><span class="dim">TAGESZEIT</span><span>${(s.env.light ?? 1) > 0.8 ? 'TAG' : (s.env.light ?? 1) > 0.3 ? 'DÄMMERUNG' : 'NACHT · SICHT STARK EINGESCHRÄNKT'}</span></div>
        <div class="row"><span class="dim">HUBSCHRAUBER</span><span>${!s.air ? '—' : s.air.heloReadyInS > 0 ? `<span class="amber">UNTERWEGS · BEREIT IN ${Math.ceil(s.air.heloReadyInS / 60)} MIN</span>` : 'AN DECK · BEREIT'}</span></div>
        <div class="row"><span class="dim">SONARBOJEN</span><span>${s.air ? `${s.air.stock} AN BORD · ${s.air.buoys.length} IM WASSER` : '—'}</span></div>
        <div class="dim" style="margin-top:4px">RECHTSKLICK AUF DIE KARTE: SONARBOJE ABWERFEN</div>
        ${escorts.map((e) => `<div class="row"><span>${e.name}</span><span class="${e.alive ? '' : 'red'}">${e.alive ? `${e.speedKn.toFixed(0)} KN` : 'GESUNKEN'}</span></div>`).join('')}`;
    },
    frame() {
      plot.draw(Math.max(360, window.innerHeight - 90));
    },
  };
}
