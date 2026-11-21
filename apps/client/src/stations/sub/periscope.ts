import { angleDiff, PERISCOPE_DEPTH, type ClassId } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { CLASS_LABEL, COL, deg1, deg3, fitCanvas, h, km } from '../../widgets/format.js';

const MAST_HEIGHT: Record<ClassId, number> = { merchant: 28, ffg: 32, ssn: 8, ssk: 7 };

interface Wave {
  x: number;
  y: number;
  s: number;
  a: number;
}

function silhouette(ctx: CanvasRenderingContext2D, x: number, size: number, cls: ClassId, aspectSin: number): void {
  const len = size * (0.35 + 0.65 * Math.abs(aspectSin));
  ctx.fillStyle = '#46525a';
  ctx.beginPath();
  ctx.moveTo(x - len, 0);
  ctx.lineTo(x - len * 0.92, -size * 0.18);
  ctx.lineTo(x + len * 0.85, -size * 0.18);
  ctx.lineTo(x + len, -size * 0.04);
  ctx.closePath();
  ctx.fill();
  if (cls === 'merchant') {
    ctx.fillRect(x + len * 0.35, -size * 0.42, len * 0.3, size * 0.24);
    ctx.fillRect(x - len * 0.5, -size * 0.6, size * 0.03, size * 0.42);
    ctx.fillRect(x - len * 0.1, -size * 0.55, size * 0.03, size * 0.37);
  } else {
    ctx.fillRect(x - len * 0.2, -size * 0.38, len * 0.45, size * 0.2);
    ctx.fillRect(x, -size * 0.7, size * 0.025, size * 0.32);
    ctx.fillRect(x - size * 0.08, -size * 0.6, size * 0.16, size * 0.015);
  }
}

export function periscopeStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Sehrohr · Angriffsoptik</span><span id="mast" class="dim"></span></div>
      <canvas id="view"></canvas>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button id="up">Mast ausfahren</button><button id="zoom">Vergr 6×</button>
        <button id="peri">Auf Sehrohrtiefe</button>
        <button id="left" title="Sehrohr nach links drehen">◀</button><button id="right" title="Sehrohr nach rechts drehen">▶</button>
        <button id="totgt" title="Sehrohr auf gewählten Kontakt drehen">Auf Ziel</button>
        <span class="kbd" style="align-self:center">ZIEHEN DREHT · KLICK WÄHLT</span>
      </div>
    </div>
    <div class="panel"><div class="hd"><span>Messwerte</span></div><div id="data"></div></div>
  </div>`);
  const view = el.querySelector<HTMLCanvasElement>('#view')!;
  let periBearing = 0;
  let zoom6 = true;
  let trained = false;
  const waves: Wave[] = Array.from({ length: 280 }, () => ({
    x: Math.random() * 900, y: Math.pow(Math.random(), 1.6) * 160 + 2, s: 0.3 + Math.random(), a: 0.1 + Math.random() * 0.35,
  }));
  const t0 = performance.now();

  el.querySelector<HTMLButtonElement>('#up')!.onclick = () => net.send({ t: 'toggle', what: 'mast', on: !store.snap?.own.mastUp });
  el.querySelector<HTMLButtonElement>('#zoom')!.onclick = (e) => {
    zoom6 = !zoom6;
    (e.target as HTMLButtonElement).textContent = zoom6 ? 'Vergr 6×' : 'Vergr 1,5×';
  };
  el.querySelector<HTMLButtonElement>('#peri')!.onclick = () => net.send({ t: 'order', depth: PERISCOPE_DEPTH });
  const train = (d: number) => (periBearing = (periBearing + d + 360) % 360);
  el.querySelector<HTMLButtonElement>('#left')!.onclick = () => train(zoom6 ? -2 : -8);
  el.querySelector<HTMLButtonElement>('#right')!.onclick = () => train(zoom6 ? 2 : 8);
  el.querySelector<HTMLButtonElement>('#totgt')!.onclick = () => {
    const c = store.selectedContact();
    if (c) periBearing = c.bearing;
  };
  let dragX: number | undefined;
  let dragged = false;
  view.style.cursor = 'ew-resize';
  view.addEventListener('mousedown', (e) => {
    dragX = e.clientX;
    dragged = false;
  });
  window.addEventListener('mouseup', () => (dragX = undefined));
  view.addEventListener('mousemove', (e) => {
    if (dragX === undefined) return;
    const dx = e.clientX - dragX;
    if (Math.abs(dx) > 2) dragged = true;
    dragX = e.clientX;
    const fov = zoom6 ? 8 : 32;
    train((-dx / (view.clientWidth * 0.84)) * fov);
  });
  view.onclick = (e) => {
    if (dragged) return;
    const s = store.snap;
    if (!s) return;
    const r = view.getBoundingClientRect();
    const fov = zoom6 ? 8 : 32;
    const b = periBearing + ((e.clientX - r.left - r.width / 2) / (r.width * 0.42)) * (fov / 2);
    const hit = s.contacts.find((c) => c.sensors.includes('periscope') && Math.abs(angleDiff(c.bearing, b)) < fov / 10);
    if (hit) store.selected = hit.label;
  };

  function visible() {
    const s = store.snap;
    if (!s || !s.own.mastUp) return [];
    return s.contacts.filter((c) => c.sensors.includes('periscope') && s.time - c.lastSeen < 2.5);
  }

  return {
    title: 'Sehrohr',
    el,
    key(e) {
      const step = zoom6 ? 0.5 : 2;
      if (e.key === 'a' || e.key === 'A') periBearing = (periBearing - step + 360) % 360;
      else if (e.key === 'd' || e.key === 'D') periBearing = (periBearing + step) % 360;
      else return false;
      return true;
    },
    snap() {
      const s = store.snap!;
      if (!trained) {
        periBearing = s.own.heading;
        trained = true;
      }
      const o = s.own;
      const atDepth = o.depth <= PERISCOPE_DEPTH + 0.5;
      const up = el.querySelector<HTMLButtonElement>('#up')!;
      up.classList.toggle('on', o.mastUp);
      up.textContent = o.mastUp ? 'Mast einfahren' : 'Mast ausfahren';
      const since = o.mastUpSince !== undefined ? s.time - o.mastUpSince : 0;
      const mast = el.querySelector<HTMLElement>('#mast')!;
      mast.className = o.mastUp ? (since > 20 ? 'red' : 'amber') : 'dim';
      mast.textContent = o.mastUp ? `MAST OBEN ${since.toFixed(0)} S` : atDepth ? 'MAST UNTEN' : `TIEFE ${o.depth.toFixed(0)} M · ZU TIEF`;
      const esm = s.alerts.filter((a) => a.kind === 'esm' && s.time - a.time < 10);
      const sel = store.selectedContact();
      const target = sel?.sensors.includes('periscope') ? sel : undefined;
      el.querySelector('#data')!.innerHTML = `
        <div class="row"><span class="dim">SEHROHRPEILUNG</span><span>${deg1(periBearing)}°</span></div>
        <div class="row"><span class="dim">ZIEL</span><span>${target ? target.label : '—'}</span></div>
        <div class="row"><span class="dim">KLASSE</span><span>${target?.classified ? CLASS_LABEL[target.classified] : '—'}</span></div>
        <div class="row"><span class="dim">ZIELPEILUNG</span><span>${target ? deg1(target.bearing) + '°' : '—'}</span></div>
        <div class="row"><span class="dim">MASTHÖHE (ANNAHME)</span><span>${target?.classified ? MAST_HEIGHT[target.classified] + ' M' : '—'}</span></div>
        <div class="row"><span class="dim">ENTFERNUNG (MESSUNG)</span><span>${target?.range ? km(target.range) : '—'}</span></div>
        <div class="row"><span class="dim">SEEGANG</span><span>${s.env.seaState}</span></div>
        ${esm.map((a) => `<div class="row red blink"><span>ESM · RADAR</span><span>${deg3(a.bearing ?? 0)}°</span></div>`).join('')}
        ${o.mastUp && since > 20 ? '<div class="row amber"><span>EMPFEHLUNG</span><span>EINFAHREN</span></div>' : ''}`;
    },
    frame() {
      const s = store.snap;
      const H = 380;
      const ctx = fitCanvas(view, H);
      const w = view.clientWidth;
      const t = (performance.now() - t0) / 1000;
      ctx.fillStyle = '#030504';
      ctx.fillRect(0, 0, w, H);
      const cx = w / 2;
      const cy = H / 2;
      const R = Math.min(w * 0.42, H * 0.47);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 7);
      ctx.clip();
      if (s?.own.mastUp) {
        const sea = s.env.seaState;
        const hy = cy + Math.sin(t * 0.9) * (2 + sea * 1.5) + Math.sin(t * 2.3) * sea * 0.4;
        ctx.translate(cx, hy);
        ctx.rotate(Math.sin(t * 0.7) * 0.01 * (1 + sea));
        ctx.fillStyle = '#24343b'; ctx.fillRect(-w, -H, 2 * w, H);
        ctx.fillStyle = '#2f4048'; ctx.fillRect(-w, -30, 2 * w, 30);
        ctx.fillStyle = '#3a4b52'; ctx.fillRect(-w, -7, 2 * w, 7);
        ctx.fillStyle = '#10222a'; ctx.fillRect(-w, 0, 2 * w, H);
        const fov = zoom6 ? 8 : 32;
        const pxPerDeg = (2 * R) / fov;
        for (const c of visible()) {
          const dx = angleDiff(periBearing, c.bearing) * pxPerDeg;
          if (Math.abs(dx) > R + 200) continue;
          const range = c.range ?? 8000;
          const size = Math.min(400, ((zoom6 ? 6 : 1.5) * 9000) / range * 6);
          silhouette(ctx, dx, size, c.classified ?? 'merchant', 0.9);
          if (c.label === store.selected) {
            ctx.strokeStyle = COL.amber;
            ctx.strokeRect(dx - size * 0.6, -size * 0.8, size * 1.2, size * 0.9);
          }
        }
        for (const wv of waves) {
          const x = ((wv.x + t * wv.s * 12 - periBearing * pxPerDeg) % 900 + 900) % 900 - 450;
          ctx.strokeStyle = `rgba(170,200,205,${wv.a})`;
          ctx.lineWidth = wv.y > 60 ? 1.5 : 1;
          ctx.beginPath(); ctx.moveTo(x, wv.y); ctx.lineTo(x + 2 + wv.y * 0.12, wv.y - 0.4); ctx.stroke();
        }
        if (sea >= 4 && Math.sin(t * 0.37) > 0.92) {
          ctx.fillStyle = 'rgba(200,220,225,0.55)';
          ctx.fillRect(-w, -H, 2 * w, 2 * H);
        }
      } else {
        ctx.fillStyle = '#060a09';
        ctx.fillRect(0, 0, w, H);
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(159,225,203,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - R + 10, cy); ctx.lineTo(cx - 14, cy); ctx.moveTo(cx + 14, cy); ctx.lineTo(cx + R - 10, cy);
      ctx.moveTo(cx, cy - R + 10); ctx.lineTo(cx, cy - 14); ctx.moveTo(cx, cy + 14); ctx.lineTo(cx, cy + R - 10);
      ctx.stroke();
      for (let k = -10; k <= 10; k++) {
        if (!k) continue;
        const x = cx + (k * R) / 11;
        const hh = k % 5 ? 3 : 7;
        ctx.beginPath(); ctx.moveTo(x, cy - hh); ctx.lineTo(x, cy + hh); ctx.stroke();
      }
      ctx.strokeStyle = '#2c3a36';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillStyle = COL.g2;
      ctx.textAlign = 'center';
      ctx.fillText(deg3(periBearing), cx, cy + R + 16 > H ? H - 4 : cy + R + 16);
      if (!s?.own.mastUp) ctx.fillText('MAST EINGEFAHREN', cx, cy - 20);
      ctx.textAlign = 'left';
      ctx.fillText('BB', 10, cy + 4);
      ctx.textAlign = 'right';
      ctx.fillText('STB', w - 10, cy + 4);
    },
  };
}
