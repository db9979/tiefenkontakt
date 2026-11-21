import { angleDiff, CLASSES } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { CLASS_LABEL, COL, deg1, fitCanvas, h } from '../../widgets/format.js';
import { Waterfall } from '../../widgets/waterfall.js';

/** Characteristic narrowband lines (Hz) per class, shown once classified. */
export const SIGNATURE: Record<string, number[]> = {
  merchant: [8.5, 17, 50, 100, 150],
  ffg: [12, 24, 60, 120, 180, 240],
  ssn: [7, 14, 60, 50, 400],
  ssk: [6, 12, 50],
};

export function drawLofar(c: HTMLCanvasElement, height: number, lines: number[], strength: number, buf: HTMLCanvasElement): void {
  const bctx = buf.getContext('2d')!;
  const W = buf.width;
  const row = bctx.createImageData(W, 1);
  for (let x = 0; x < W; x++) {
    const f = (x / W) * 400;
    let v = 0.08 + Math.random() * 0.22;
    for (const l of lines) {
      const d = f - l;
      v += strength * Math.exp((-d * d) / 3) * (0.5 + 0.5 * Math.random());
    }
    v = Math.min(1, v);
    row.data[x * 4] = 8 + v * 85;
    row.data[x * 4 + 1] = 12 + v * 190;
    row.data[x * 4 + 2] = 11 + v * 150;
    row.data[x * 4 + 3] = 255;
  }
  bctx.drawImage(buf, 0, 1);
  bctx.putImageData(row, 0, 0);
  const ctx = fitCanvas(c, height);
  const w = c.clientWidth;
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, w, height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf, 4, 16, w - 8, height - 20);
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = COL.g;
  ctx.textAlign = 'center';
  for (let f = 0; f <= 400; f += 100) ctx.fillText(String(f), 4 + (f / 400) * (w - 8), 11);
}

export function subSonarStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Sonar · Breitband</span><span id="own" class="dim"></span></div>
      <canvas id="wf"></canvas>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button id="ping" class="warn">Aktivsonar</button>
        <button id="tow">Schleppsonar</button>
        <span class="dim" style="align-self:center">KLICK IN DEN WASSERFALL WÄHLT KONTAKT</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Kontakte</span></div><div id="list"></div></div>
      <div class="panel"><div class="hd"><span>LOFAR · Schmalband</span><span id="lab" class="dim"></span></div><canvas id="lofar"></canvas>
        <div id="cls" style="margin-top:6px"></div></div>
    </div>
  </div>`);
  const wf = new Waterfall();
  const wfCanvas = el.querySelector<HTMLCanvasElement>('#wf')!;
  const lofar = el.querySelector<HTMLCanvasElement>('#lofar')!;
  const lbuf = document.createElement('canvas');
  lbuf.width = 200;
  lbuf.height = 140;
  let lastLofar = -1;

  wfCanvas.onclick = (e) => {
    const b = wf.bearingAt(wfCanvas, e.clientX);
    const s = store.snap;
    if (!s) return;
    let best: string | undefined;
    let bd = 6;
    for (const c of s.contacts) {
      const d = Math.abs(angleDiff(c.bearing, b));
      if (d < bd) [best, bd] = [c.label, d];
    }
    if (best) store.selected = best;
  };
  el.querySelector<HTMLButtonElement>('#ping')!.onclick = () => net.send({ t: 'toggle', what: 'active', on: !store.snap?.own.activeSonar });
  el.querySelector<HTMLButtonElement>('#tow')!.onclick = () => {
    const o = store.snap?.own;
    if (o) net.send({ t: 'towed', length: o.towedLength > 0 ? 0 : (CLASSES[o.cls].towed?.maxLength ?? 0) });
  };

  return {
    title: 'Horchraum',
    el,
    snap() {
      const s = store.snap!;
      wf.push(s);
      renderContactList(el.querySelector('#list')!);
      const o = s.own;
      el.querySelector('#own')!.textContent = `EIGENGERÄUSCH ${o.noiseDb.toFixed(0)} DB`;
      el.querySelector('#ping')!.classList.toggle('on', o.activeSonar);
      const tow = el.querySelector<HTMLButtonElement>('#tow')!;
      tow.style.display = CLASSES[o.cls].towed ? '' : 'none';
      tow.classList.toggle('on', o.towedLength > 0);
      tow.textContent = o.towedLength > 0 ? (o.towedReady ? 'Schlepp ausgebracht' : 'Schlepp stabilisiert…') : 'Schleppsonar';
      const c = store.selectedContact();
      el.querySelector('#lab')!.textContent = c ? c.label : 'KEIN KONTAKT GEWÄHLT';
      el.querySelector('#cls')!.innerHTML = c
        ? `<div class="row"><span class="dim">PEILUNG</span><span>${deg1(c.bearing)}°</span></div>
           <div class="row"><span class="dim">SIGNAL</span><span>${c.se.toFixed(1)} DB ÜBER SCHWELLE</span></div>
           <div class="row"><span class="dim">KLASSE</span><span class="${c.classified ? 'amber' : 'dim'}">${c.classified ? CLASS_LABEL[c.classified] : 'NICHT KLASSIFIZIERT'}</span></div>`
        : '';
      if (Math.floor(s.time) !== lastLofar) {
        lastLofar = Math.floor(s.time);
        const strength = c && s.time - c.lastSeen < 3 ? Math.min(0.9, 0.2 + c.se / 15) : 0;
        drawLofar(lofar, 150, c?.classified ? SIGNATURE[c.classified]! : c ? [50, 100] : [], strength, lbuf);
      }
    },
    frame() {
      wf.draw(wfCanvas, 360, store.snap, store.selected);
    },
  };
}
