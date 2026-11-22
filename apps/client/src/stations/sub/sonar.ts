import { angleDiff, CLASSES } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { AcousticAnalysis } from '../../widgets/analysis.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { h } from '../../widgets/format.js';
import { Waterfall } from '../../widgets/waterfall.js';

/** Pick the contact nearest to a clicked bearing on a waterfall. */
export function pickByBearing(b: number, maxDeg = 6): string | undefined {
  const s = store.snap;
  if (!s) return undefined;
  let best: string | undefined;
  let bd = maxDeg;
  for (const c of s.contacts) {
    if (c.via !== 'own') continue;
    for (const cb of c.bearingAlt !== undefined ? [c.bearing, c.bearingAlt] : [c.bearing]) {
      const d = Math.abs(angleDiff(cb, b));
      if (d < bd) [best, bd] = [c.label, d];
    }
  }
  return best;
}

export function subSonarStation(): Station {
  const el = h(`<div class="cols">
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel"><div class="hd"><span>Sonar · Breitband</span><span id="own" class="dim"></span></div>
        <canvas id="wf"></canvas>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          <button id="ping" class="warn" title="Aktivsonar: Entfernung, verrät aber das Boot">Aktivsonar</button>
          <button id="tow">Schleppsonar</button>
          <span class="dim" style="align-self:center">KLICK AUF EINE SPUR WÄHLT DEN KONTAKT</span>
        </div>
      </div>
      <div class="panel"><div class="hd"><span>Kontakte</span></div><div id="list"></div></div>
    </div>
    <div class="panel" style="min-width:0"><div class="hd"><span>Signalanalyse</span><span id="lab" class="amber"></span></div><div id="ana"></div></div>
  </div>`);
  const wf = new Waterfall();
  const wfCanvas = el.querySelector<HTMLCanvasElement>('#wf')!;
  const analysis = new AcousticAnalysis(250);
  el.querySelector('#ana')!.appendChild(analysis.el);

  wfCanvas.style.cursor = 'pointer';
  wfCanvas.onmousedown = (e) => {
    const hit = pickByBearing(wf.bearingAt(wfCanvas, e.clientX));
    if (hit) store.selected = hit;
  };
  el.querySelector<HTMLButtonElement>('#ping')!.onclick = () => net.send({ t: 'toggle', what: 'active', on: !store.snap?.own.activeSonar });
  el.querySelector<HTMLButtonElement>('#tow')!.onclick = () => {
    const o = store.snap?.own;
    if (o) net.send({ t: 'towed', length: (o.towedOrder ?? o.towedLength) > 0 ? 0 : (CLASSES[o.cls].towed?.maxLength ?? 0) });
  };

  return {
    title: 'Horchraum',
    el,
    snap() {
      const s = store.snap!;
      wf.push(s);
      renderContactList(el.querySelector('#list')!, (via) => via === 'own');
      const o = s.own;
      el.querySelector('#own')!.textContent = `EIGENGERÄUSCH ${o.noiseDb.toFixed(0)} DB`;
      el.querySelector('#ping')!.classList.toggle('on', o.activeSonar);
      const tow = el.querySelector<HTMLButtonElement>('#tow')!;
      tow.style.display = CLASSES[o.cls].towed ? '' : 'none';
      const tgt = o.towedOrder ?? o.towedLength;
      tow.classList.toggle('on', tgt > 0);
      tow.textContent = tgt !== o.towedLength ? `Schlepp ${tgt > o.towedLength ? 'aus' : 'ein'} ${o.towedLength} m` : o.towedLength > 0 ? (o.towedReady ? 'Schlepp ausgebracht' : 'Schlepp stabilisiert…') : 'Schleppsonar';
      el.querySelector('#lab')!.textContent = store.selected ?? '';
      analysis.update();
    },
    frame() {
      wf.draw(wfCanvas, Math.max(220, window.innerHeight - 420), store.snap, store.selected);
      analysis.draw();
    },
  };
}
