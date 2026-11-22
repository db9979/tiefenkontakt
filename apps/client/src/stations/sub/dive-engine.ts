import { CLASSES, PERISCOPE_DEPTH } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { COL, clock, fitCanvas, h, setHtml } from '../../widgets/format.js';

const STEPS = [
  { label: 'Schleich', kn: 3 }, { label: 'Langsam', kn: 6 }, { label: 'Halbe', kn: 12 }, { label: 'Volle', kn: 99 },
];

export function diveEngineStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Tauchstand · Tiefenprofil (Klick = Tiefe)</span><span id="dd" class="dim"></span></div>
      <canvas id="prof"></canvas>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button data-depth="${PERISCOPE_DEPTH}">Sehrohrtiefe</button><button data-depth="60">60 m</button>
        <button data-depth="layer-">Über Schicht</button><button data-depth="layer+">Unter Schicht</button><button data-depth="max">Max. Tiefe</button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Maschine</span></div>
        <div class="grid2" id="steps"></div>
        <div style="display:flex;gap:6px;margin-top:8px"><button id="snort">Schnorcheln</button><button id="nm" class="warn">Täuschkörper</button></div>
      </div>
      <div class="panel"><div class="hd"><span>Status</span></div><div id="stat"></div></div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const depthHist: { t: number; d: number }[] = [];

  setHtml(q('#steps'), STEPS.map((s, i) => `<button data-step="${i}">${s.label}</button>`).join(''));
  el.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
    b.onclick = () => {
      const o = store.snap?.own;
      if (!o) return;
      net.send({ t: 'order', speedKn: Math.min(STEPS[Number(b.dataset.step)]!.kn, CLASSES[o.cls].maxSpeedKn) });
    };
  });
  el.querySelectorAll<HTMLButtonElement>('[data-depth]').forEach((b) => {
    b.onclick = () => {
      const s = store.snap;
      if (!s) return;
      const v = b.dataset.depth!;
      const layer = s.env.layerDepth;
      if ((v === 'layer-' || v === 'layer+') && layer === undefined) {
        store.lastError = 'Sprungschicht unbekannt: einmal tief durchtauchen, um sie zu messen';
        return;
      }
      const depth = v === 'layer-' ? Math.max(30, layer! - 40) : v === 'layer+' ? layer! + 30 : v === 'max' ? CLASSES[s.own.cls].maxDepth * 0.9 : Number(v);
      net.send({ t: 'order', depth });
    };
  });
  const prof = q<HTMLCanvasElement>('#prof');
  prof.style.cursor = 'ns-resize';
  prof.title = 'Klicken setzt die befohlene Tiefe';
  prof.onmousedown = (e) => {
    const s = store.snap;
    if (!s) return;
    const r = prof.getBoundingClientRect();
    const maxD = CLASSES[s.own.cls].maxDepth;
    const d = ((e.clientY - r.top - 20) / (r.height - 40)) * maxD;
    net.send({ t: 'order', depth: Math.round(Math.min(maxD, Math.max(0, d)) / 5) * 5 });
  };
  q<HTMLButtonElement>('#snort').onclick = () => net.send({ t: 'toggle', what: 'snorkel', on: !store.snap?.own.snorkel });
  q<HTMLButtonElement>('#nm').onclick = () => net.send({ t: 'noisemaker' });

  return {
    title: 'Tauchstand',
    el,
    snap() {
      const s = store.snap!;
      const o = s.own;
      const spec = CLASSES[o.cls];
      const last = depthHist[depthHist.length - 1];
      if (!last || s.time - last.t >= 2) depthHist.push({ t: s.time, d: o.depth });
      if (depthHist.length > 300) depthHist.shift();
      q('#dd').textContent = `${o.depth.toFixed(0)} M → ${o.order.depth.toFixed(0)} M`;
      q('#snort').style.display = spec.battery ? '' : 'none';
      q('#snort').classList.toggle('on', o.snorkel);
      el.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
        const kn = Math.min(STEPS[Number(b.dataset.step)]!.kn, spec.maxSpeedKn);
        b.classList.toggle('on', Math.abs(o.order.speedKn - kn) < 0.5);
      });
      const pct = spec.battery && o.battery !== undefined ? (100 * o.battery) / spec.battery.capacityKnH : undefined;
      const cav = o.speedKn > o.cavitationKn;
      setHtml(q('#stat'), `
        <div class="row"><span class="dim">ANTRIEB</span><span>${spec.battery ? (o.snorkel && o.depth <= PERISCOPE_DEPTH + 0.5 ? ((o.snorkelExt ?? 1) >= 1 ? 'DIESEL / SCHNORCHEL' : `SCHNORCHEL FÄHRT AUS ${Math.round((o.snorkelExt ?? 0) * 100)} %`) : (o.snorkelExt ?? 0) > 0 ? `E-MASCHINE · SCHNORCHEL FÄHRT EIN` : 'E-MASCHINE') : 'REAKTOR'}</span></div>
        <div class="row"><span class="dim">EIGENGERÄUSCH</span><span class="${o.noiseDb > 135 ? 'red' : o.noiseDb > 122 ? 'amber' : ''}">${o.noiseDb.toFixed(0)} DB</span></div>
        <div class="row"><span class="dim">KAVITATION AB</span><span class="${cav ? 'red' : ''}">${o.cavitationKn.toFixed(1)} KN${cav ? ' · KAVITIERT' : ''}</span></div>
        ${pct !== undefined ? `<div class="row"><span class="dim">BATTERIE</span><span class="${pct < 25 ? 'red' : pct < 50 ? 'amber' : ''}">${pct.toFixed(0)} %</span></div>
        <div class="row"><span class="dim">RESTZEIT BEI FAHRT</span><span>${o.batteryEnduranceS !== undefined ? clock(o.batteryEnduranceS) : '—'}</span></div>` : ''}
        <div class="row"><span class="dim">SPRUNGSCHICHT</span><span>${s.env.layerDepth !== undefined ? `${s.env.layerDepth} M (GEMESSEN) · ${o.depth > s.env.layerDepth ? 'DARUNTER' : 'DARÜBER'}` : '<span class="amber">UNBEKANNT · DURCHTAUCHEN MISST SIE</span>'}</span></div>
        <div class="row"><span class="dim">TÄUSCHKÖRPER</span><span>${o.loadout.noisemakers}</span></div>
        <div class="row"><span class="dim">ZUSTAND</span><span class="${o.hp < spec.hp / 2 ? 'red' : ''}">${Math.max(0, (100 * o.hp) / spec.hp).toFixed(0)} %</span></div>`);
    },
    frame() {
      const s = store.snap;
      const c = q<HTMLCanvasElement>('#prof');
      const H = 360;
      const ctx = fitCanvas(c, H);
      const w = c.clientWidth;
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, w, H);
      if (!s) return;
      const maxD = CLASSES[s.own.cls].maxDepth;
      const Y = (d: number) => 20 + (d / maxD) * (H - 40);
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = COL.dim;
      ctx.strokeStyle = COL.grid;
      for (let d = 0; d <= maxD; d += 50) {
        ctx.beginPath(); ctx.moveTo(40, Y(d)); ctx.lineTo(w, Y(d)); ctx.stroke();
        ctx.fillText(`${d}`, 4, Y(d) + 4);
      }
      const layer = s.env.layerDepth;
      if (layer !== undefined) {
        ctx.fillStyle = 'rgba(250,199,117,0.18)';
        ctx.fillRect(40, Y(layer) - 4, w - 40, 8);
        ctx.fillStyle = COL.amber;
        ctx.fillText(`SPRUNGSCHICHT ${layer} M`, w - 170, Y(layer) - 8);
      } else {
        ctx.fillStyle = COL.dim;
        ctx.fillText('SPRUNGSCHICHT UNBEKANNT', w - 190, 40);
      }
      const bottom = s.env.bottom;
      if (bottom !== undefined && bottom < maxD) {
        ctx.fillStyle = 'rgba(120, 96, 60, 0.35)';
        ctx.fillRect(40, Y(bottom), w - 40, H - Y(bottom));
        ctx.fillStyle = COL.amber;
        ctx.fillText(`MEERESGRUND ${bottom} M`, w - 170, Y(bottom) + 14);
      }
      ctx.strokeStyle = COL.blue;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(40, Y(PERISCOPE_DEPTH)); ctx.lineTo(w, Y(PERISCOPE_DEPTH)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.blue;
      ctx.fillText('SEHROHRTIEFE', w - 170, Y(PERISCOPE_DEPTH) - 4);
      ctx.strokeStyle = COL.blue;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const span = 600;
      depthHist.forEach((p, i) => {
        const x = 40 + ((p.t - (s.time - span)) / span) * (w - 60);
        if (i) ctx.lineTo(x, Y(p.d));
        else ctx.moveTo(x, Y(p.d));
      });
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(w - 20, Y(s.own.depth), 5, 0, 7); ctx.fill();
      ctx.strokeStyle = COL.amber;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(w - 60, Y(s.own.order.depth)); ctx.lineTo(w, Y(s.own.order.depth)); ctx.stroke();
      ctx.setLineDash([]);
    },
  };
}
