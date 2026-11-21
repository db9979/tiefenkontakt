import { NM, headingVec } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { COL, deg3, esc, fitCanvas, h } from '../../widgets/format.js';

const RANGE = 12 * NM;
const RPM = 24;

/** PPI with rotating sweep and phosphor persistence, painted from radar contacts only. */
export function radarEsmStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Luft-/Seeraumradar · 12 SM</span><span id="rs" class="dim"></span></div><canvas id="ppi"></canvas>
      <div style="display:flex;gap:6px;margin-top:6px"><button id="radar">Radar</button><span class="dim" style="align-self:center">RADAR VERRÄT DIE FREGATTE AUF GROSSE ENTFERNUNG (ESM)</span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Radarspuren</span></div><div id="tracks"></div></div>
      <div class="panel"><div class="hd"><span>ESM / Funkpeilung</span></div><div id="esm"></div></div>
    </div>
  </div>`);
  const canvas = el.querySelector<HTMLCanvasElement>('#ppi')!;
  const phos = document.createElement('canvas');
  phos.width = 520;
  phos.height = 520;
  const pc = phos.getContext('2d')!;
  pc.fillStyle = COL.bg;
  pc.fillRect(0, 0, 520, 520);
  let sweep = 0;
  let last = performance.now();
  el.querySelector<HTMLButtonElement>('#radar')!.onclick = () => net.send({ t: 'toggle', what: 'radar', on: !store.snap?.own.radarOn });

  return {
    title: 'Radar/ESM',
    el,
    snap() {
      const s = store.snap!;
      el.querySelector('#radar')!.classList.toggle('on', s.own.radarOn);
      el.querySelector('#rs')!.textContent = s.own.radarOn ? `SENDET · ${RPM} U/MIN` : 'AUS';
      const radar = s.contacts.filter((c) => c.via === 'own' && c.sensors.includes('radar') && s.time - c.lastSeen < 30);
      el.querySelector('#tracks')!.innerHTML = radar.length
        ? radar.map((c) => `<div class="row ${s.time - c.lastSeen > 5 ? 'amber' : ''}"><span>${esc(c.label)}</span><span>${deg3(c.bearing)}° ${c.range ? (c.range / NM).toFixed(1) + ' SM' : ''}</span><span class="dim">${s.time - c.lastSeen > 5 ? 'KURZ ERFASST' : 'SPUR'}</span></div>`).join('')
        : '<div class="dim">KEINE SPUREN</div>';
      const esm = s.contacts.filter((c) => c.sensors.includes('esm'));
      el.querySelector('#esm')!.innerHTML = esm.length
        ? esm.map((c) => `<div class="row red"><span>${esc(c.label)}</span><span>${deg3(c.bearing)}°</span><span class="dim">VOR ${Math.round(s.time - c.lastSeen)} S</span></div>`).join('')
        : '<div class="dim">KEINE FUNKPEILUNGEN</div>';
    },
    frame() {
      const s = store.snap;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const prev = sweep;
      sweep = (sweep + dt * RPM * 6) % 360;
      const C = 260;
      const R = 250;
      pc.save();
      pc.beginPath(); pc.arc(C, C, R, 0, 7); pc.clip();
      pc.fillStyle = 'rgba(8,12,11,0.03)';
      pc.fillRect(0, 0, 520, 520);
      if (s?.own.radarOn) {
        const span = (sweep - prev + 360) % 360;
        for (let i = 0; i < 40; i++) {
          if (Math.random() > 0.5) continue;
          const a = (prev + (span * i) / 40 - 90) * (Math.PI / 180);
          const rr = Math.random() * (10 + s.env.seaState * 6);
          pc.fillStyle = `rgba(93,202,165,${0.25 + Math.random() * 0.4})`;
          pc.fillRect(C + Math.cos(a) * rr, C + Math.sin(a) * rr, 1.5, 1.5);
        }
        for (const c of s.contacts) {
          if (!c.sensors.includes('radar') || c.range === undefined || s.time - c.lastSeen > 3) continue;
          const d = (c.bearing - prev + 360) % 360;
          if (d > span) continue;
          const v = headingVec(c.bearing);
          const r = (c.range / RANGE) * R;
          if (r > R) continue;
          const friendly = s.friendlies.some((f) => Math.hypot(f.x - (s.own.x + v.x * c.range!), f.y - (s.own.y + v.y * c.range!)) < 400);
          pc.fillStyle = friendly ? COL.g2 : COL.amber;
          pc.beginPath(); pc.arc(C + v.x * r, C - v.y * r, friendly ? 2.6 : 3, 0, 7); pc.fill();
        }
        const a = (sweep - 90) * (Math.PI / 180);
        pc.strokeStyle = 'rgba(159,225,203,0.9)';
        pc.lineWidth = 1.5;
        pc.beginPath(); pc.moveTo(C, C); pc.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R); pc.stroke();
      }
      pc.restore();

      const H = 520;
      const ctx = fitCanvas(canvas, H);
      const w = canvas.clientWidth;
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, w, H);
      const size = Math.min(w, H);
      const ox = (w - size) / 2;
      ctx.drawImage(phos, ox, 0, size, size);
      const k = size / 520;
      ctx.strokeStyle = 'rgba(93,202,165,0.15)';
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath(); ctx.arc(ox + C * k, C * k, (R * k * i) / 4, 0, 7); ctx.stroke();
      }
      if (s) {
        for (const c of s.contacts.filter((x) => x.sensors.includes('esm') && s.time - x.lastSeen < 300)) {
          const v = headingVec(c.bearing);
          ctx.strokeStyle = 'rgba(240,149,149,0.7)';
          ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(ox + C * k, C * k); ctx.lineTo(ox + (C + v.x * R) * k, (C - v.y * R) * k); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = COL.g;
      ctx.textAlign = 'center';
      ctx.fillText('000', ox + C * k, 10);
      ctx.fillText('180', ox + C * k, H - 2);
      ctx.fillText('3 SM', ox + C * k + (R * k) / 4 + 14, C * k - 4);
    },
  };
}
