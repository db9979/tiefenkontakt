import { angleDiff, PERISCOPE_DEPTH, type ClassId } from '@tk/shared';
import { BearingRangeFilter, easeAngle, simNow } from '../../widgets/smooth.js';
import type { Periscope3D, PeriscopeEffect } from '../../widgets/periscope3d.js';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { isKey } from '../../widgets/keys.js';
import { CLASS_LABEL, COL, deg1, deg3, fitCanvas, h, km } from '../../widgets/format.js';

const MAST_HEIGHT: Record<ClassId, number> = { merchant: 28, ffg: 32, kor: 24, ssn: 8, ssk: 7, ssc: 5 };

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
      <div style="position:relative"><canvas id="gl" style="position:absolute;inset:0;width:100%;height:380px"></canvas><canvas id="view" style="position:relative"></canvas></div>
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
  const glCanvas = el.querySelector<HTMLCanvasElement>('#gl')!;
  let gl: Periscope3D | undefined;
  // three.js is loaded only when the periscope is first used; falls back to 2D without WebGL2
  if (localStorage.getItem('tk_3d') !== '0') {
    import('../../widgets/periscope3d.js')
      .then((m) => {
        if (m.Periscope3D.supported()) gl = new m.Periscope3D(glCanvas);
      })
      .catch(() => undefined);
  }
  let periBearing = 0;
  /** Where the operator trains the scope; the optic follows smoothly. */
  let periTarget = 0;
  let lastFrame = performance.now();
  const filters = new Map<string, BearingRangeFilter>();
  const filteredAt = new Map<string, number>();
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
  const train = (d: number) => (periTarget = (periTarget + d + 360) % 360);
  el.querySelector<HTMLButtonElement>('#left')!.onclick = () => train(zoom6 ? -2 : -8);
  el.querySelector<HTMLButtonElement>('#right')!.onclick = () => train(zoom6 ? 2 : 8);
  el.querySelector<HTMLButtonElement>('#totgt')!.onclick = () => {
    const c = store.selectedContact();
    if (c) periTarget = filters.get(c.label)?.at(simNow())?.bearing ?? c.bearing;
  };
  let dragX: number | undefined;
  let dragged = false;
  view.style.cursor = 'ew-resize';
  view.style.touchAction = 'none';
  view.addEventListener('pointerdown', (e) => {
    dragX = e.clientX;
    dragged = false;
  });
  window.addEventListener('pointerup', () => (dragX = undefined));
  view.addEventListener('pointermove', (e) => {
    if (dragX === undefined) return;
    const dx = e.clientX - dragX;
    if (Math.abs(dx) > 2) dragged = true;
    dragX = e.clientX;
    const fov = zoom6 ? 8 : 32;
    train((-dx / (view.clientWidth * 0.84)) * fov);
    periBearing = periTarget;
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

  /** Periscope contacts with a smoothed bearing/range and a fade for ships dipping out of sight. */
  function visible() {
    const s = store.snap;
    if (!s || !s.own.mastUp) return [];
    const now = simNow();
    const out: { label: string; cls: ClassId; bearing: number; range: number; alpha: number }[] = [];
    for (const c of s.contacts) {
      if (!c.sensors.includes('periscope')) continue;
      const age = now - c.lastSeen;
      if (age > 6) continue;
      const est = filters.get(c.label)?.at(now);
      if (!est) continue;
      out.push({ label: c.label, cls: c.classified ?? 'merchant', bearing: est.bearing, range: est.range ?? c.range ?? 8000, alpha: Math.max(0, Math.min(1, 1 - (age - 2) / 4)) });
    }
    return out;
  }

  return {
    title: 'Sehrohr',
    el,
    key(e) {
      const step = zoom6 ? 0.5 : 2;
      if (isKey(e, 'scopeLeft')) train(-step);
      else if (isKey(e, 'scopeRight')) train(step);
      else return false;
      return true;
    },
    snap() {
      const s = store.snap!;
      if (!trained) {
        periBearing = periTarget = s.own.heading;
        trained = true;
      }
      // Feed the display filters with each new periscope measurement
      for (const c of s.contacts) {
        if (!c.sensors.includes('periscope') || filteredAt.get(c.label) === c.lastSeen) continue;
        filteredAt.set(c.label, c.lastSeen);
        let f = filters.get(c.label);
        if (!f) filters.set(c.label, (f = new BearingRangeFilter(0.2, 0.02)));
        f.update(c.lastSeen, c.bearing, c.range);
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
      const nowMs = performance.now();
      const t = (nowMs - t0) / 1000;
      periBearing = easeAngle(periBearing, periTarget, (nowMs - lastFrame) / 1000, 0.15);
      lastFrame = nowMs;
      const cx = w / 2;
      const cy = H / 2;
      const R = Math.min(w * 0.42, H * 0.47);
      const use3d = !!gl && !!s?.own.mastUp;
      glCanvas.style.visibility = use3d ? 'visible' : 'hidden';
      if (use3d && s) {
        const fov = zoom6 ? 8 : 32;
        const sols = store.solutions;
        const vis = visible();
        gl!.render({
          bearing: periBearing, fovDeg: (fov * w) / (2 * R), t, sea: s.env.seaState, light: s.env.light ?? 1,
          targets: vis.map((c) => ({ ...c, course: sols.get(c.label)?.course, speedKn: sols.get(c.label)?.speedKn })),
          rain: s.env.rain, hour: s.env.clock, effects: blasts(s, vis, nowMs),
        });
        // Overlay: black mask outside the optic, reticle drawn below
        ctx.clearRect(0, 0, w, H);
        ctx.fillStyle = '#030504';
        ctx.beginPath();
        ctx.rect(0, 0, w, H);
        ctx.moveTo(cx + R, cy);
        ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        if (s.env.seaState >= 4 && Math.sin(t * 0.37) > 0.92) {
          ctx.fillStyle = 'rgba(200,220,225,0.5)';
          ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
        }
        if (s.env.rain) lensDrops(ctx, cx, cy, R, t);
      } else {
        ctx.fillStyle = '#030504';
        ctx.fillRect(0, 0, w, H);
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 7);
      ctx.clip();
      if (use3d) {
        // 3D scene already rendered underneath
      } else if (s?.own.mastUp) {
        const sea = s.env.seaState;
        // Slow, swell-like pitch and roll (no fast jitter)
        const hy = cy + Math.sin(t * 0.55) * (1.5 + sea * 1.1) + Math.sin(t * 0.23 + 1.3) * sea * 0.6;
        ctx.translate(cx, hy);
        ctx.rotate(Math.sin(t * 0.4) * 0.004 * (1 + sea * 0.6));
        ctx.fillStyle = '#24343b'; ctx.fillRect(-w, -H, 2 * w, H);
        ctx.fillStyle = '#2f4048'; ctx.fillRect(-w, -30, 2 * w, 30);
        ctx.fillStyle = '#3a4b52'; ctx.fillRect(-w, -7, 2 * w, 7);
        ctx.fillStyle = '#10222a'; ctx.fillRect(-w, 0, 2 * w, H);
        const fov = zoom6 ? 8 : 32;
        const pxPerDeg = (2 * R) / fov;
        for (const c of visible()) {
          const dx = angleDiff(periBearing, c.bearing) * pxPerDeg;
          if (Math.abs(dx) > R + 200) continue;
          const size = Math.min(400, ((zoom6 ? 6 : 1.5) * 9000) / Math.max(300, c.range) * 6);
          ctx.globalAlpha = c.alpha;
          silhouette(ctx, dx, size, c.cls, 0.9);
          ctx.globalAlpha = 1;
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
        underwater(ctx, cx, cy, R, t, s?.env.light ?? 1);
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
      if (!s?.own.mastUp) {
        ctx.fillText('MAST EINGEFAHREN', cx, cy - 20);
        ctx.fillStyle = COL.dim;
        ctx.fillText(s && s.own.depth > 19 ? 'AUF SEHROHRTIEFE GEHEN, DANN MAST AUSFAHREN' : 'MAST AUSFAHREN ZUM BEOBACHTEN', cx, cy + 34);
      }
      ctx.textAlign = 'left';
      ctx.fillText('BB', 10, cy + 4);
      ctx.textAlign = 'right';
      ctx.fillText('STB', w - 10, cy + 4);
    },
  };
}

/** Raindrops on the top lens: fixed beads that refract the light, slowly running down. */
function lensDrops(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number): void {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
  for (let i = 0; i < 34; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const rr = R * Math.sqrt(((i * 0.618) % 1));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr + ((t * (4 + (i % 5)) + i * 37) % (R * 0.5));
    const size = 2 + (i % 4) * 1.6;
    const g = ctx.createRadialGradient(x - size * 0.3, y - size * 0.3, 0, x, y, size);
    g.addColorStop(0, 'rgba(235,245,248,0.55)');
    g.addColorStop(0.6, 'rgba(120,140,150,0.18)');
    g.addColorStop(1, 'rgba(20,30,35,0.35)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, size, 0, 7); ctx.fill();
  }
  ctx.restore();
}

/** Mast down: the optic looks into the water: blue-green murk, drifting particles, light from above by day. */
function underwater(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number, light: number): void {
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  g.addColorStop(0, `rgba(${Math.round(20 + 30 * light)},${Math.round(55 + 50 * light)},${Math.round(60 + 45 * light)},1)`);
  g.addColorStop(1, '#020807');
  ctx.fillStyle = g;
  ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  if (light > 0.3) {
    ctx.globalAlpha = 0.07 * light;
    ctx.fillStyle = '#cfe';
    for (let i = 0; i < 5; i++) {
      const x = cx - R + ((i * 97 + t * 6) % (2 * R));
      ctx.beginPath(); ctx.moveTo(x, cy - R); ctx.lineTo(x + 30, cy - R); ctx.lineTo(x + 80, cy + R); ctx.lineTo(x + 40, cy + R); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(190,220,210,0.35)';
  for (let i = 0; i < 60; i++) {
    const x = cx - R + ((i * 53.3 + Math.sin(t * 0.3 + i) * 8) % (2 * R));
    const y = cy + R - ((i * 31.7 + t * (2 + (i % 3))) % (2 * R));
    ctx.fillRect(x, y, 1.5, 1.5);
  }
}

const blastSeen = new Map<string, number>();
/** Hits reported as explosions within the last two minutes, placed at the nearest seen ship on that bearing. */
function blasts(s: import('@tk/shared').Snapshot, vis: { bearing: number; range: number }[], nowMs: number): PeriscopeEffect[] {
  const out: PeriscopeEffect[] = [];
  for (const a of s.alerts) {
    if (a.kind !== 'hit' || a.bearing === undefined || s.time - a.time > 120) continue;
    const id = `${a.time}|${a.bearing}`;
    if (!blastSeen.has(id)) blastSeen.set(id, nowMs);
    const near = vis.filter((c) => Math.abs(angleDiff(c.bearing, a.bearing!)) < 5).sort((x, y) => Math.abs(angleDiff(x.bearing, a.bearing!)) - Math.abs(angleDiff(y.bearing, a.bearing!)))[0];
    out.push({ id, bearing: a.bearing, range: near?.range ?? 6000, age: (nowMs - blastSeen.get(id)!) / 1000 });
  }
  return out;
}
