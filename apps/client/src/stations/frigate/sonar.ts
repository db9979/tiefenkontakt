import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { h } from '../../widgets/format.js';
import { Waterfall } from '../../widgets/waterfall.js';

export function frigateSonarStation(): Station {
  const el = h(`<div class="cols">
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Rumpfsonar</span><span id="hs" class="dim"></span></div><canvas id="hull"></canvas></div>
      <div class="panel"><div class="hd"><span>Schleppsonar · Peilung beidseitig mehrdeutig</span><span id="ts" class="dim"></span></div><canvas id="tow"></canvas></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Steuerung</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="ping" class="warn">Aktiv-Ping alle 30 s</button>
        </div>
        <div class="row" style="margin-top:8px"><span class="dim">SCHLEPPLÄNGE</span><span id="len"></span></div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${[0, 300, 600, 900, 1200].map((l) => `<button data-len="${l}">${l ? l + ' m' : 'Einholen'}</button>`).join('')}</div>
        <div class="dim" style="margin-top:6px">LANGES KABEL = ARRAY UNTER DER SPRUNGSCHICHT. NACH JEDER KURSÄNDERUNG 60 S STABILISIEREN.</div>
      </div>
      <div class="panel"><div class="hd"><span>Kontakte</span></div><div id="list"></div></div>
    </div>
  </div>`);
  const hull = new Waterfall(['hull', 'active', 'intercept']);
  const tow = new Waterfall(['towed']);
  el.querySelector<HTMLButtonElement>('#ping')!.onclick = () => net.send({ t: 'toggle', what: 'active', on: !store.snap?.own.activeSonar });
  el.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => (b.onclick = () => net.send({ t: 'towed', length: Number(b.dataset.len) })));

  return {
    title: 'Sonar',
    el,
    snap() {
      const s = store.snap!;
      hull.push(s);
      tow.push(s, 15);
      const o = s.own;
      renderContactList(el.querySelector('#list')!, (via) => via === 'own');
      el.querySelector('#ping')!.classList.toggle('on', o.activeSonar);
      el.querySelector('#hs')!.textContent = o.activeSonar ? 'AKTIV · VERRÄT EIGENE POSITION' : 'PASSIV';
      el.querySelector('#ts')!.textContent = o.towedLength === 0 ? 'EINGEHOLT' : o.towedReady ? `${o.towedLength} M · BEREIT` : `${o.towedLength} M · STABILISIERT…`;
      el.querySelector('#len')!.textContent = `${o.towedLength} M`;
      el.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => b.classList.toggle('on', Number(b.dataset.len) === o.towedLength));
    },
    frame() {
      hull.draw(el.querySelector<HTMLCanvasElement>('#hull')!, 220, store.snap, store.selected);
      tow.draw(el.querySelector<HTMLCanvasElement>('#tow')!, 220, store.snap, store.selected);
    },
  };
}
