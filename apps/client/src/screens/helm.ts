import { CLASSES, PERISCOPE_DEPTH, headingVec, wrap360 } from '@tk/shared';
import { net } from '../net.js';
import { depthBtn } from '../widgets/btn-state.js';
import { store } from '../store.js';
import { COL, fitCanvas, kn, setHtml, tdeg3 } from '../widgets/format.js';
import { gameDeg, trueDeg } from '../north.js';
import { isFriendlyContact } from '../widgets/friendly.js';
import { isKey } from '../widgets/keys.js';
import { touchable } from '../widgets/touch.js';
import { easeAngle, ownNow } from '../widgets/smooth.js';

const SPEEDS = [
  { label: 'Stopp', kn: 0 }, { label: 'Schleich', kn: 3 }, { label: 'Langsam', kn: 6 },
  { label: 'Halbe', kn: 12 }, { label: 'AK', kn: 99 },
];

/** Helm: clickable compass for course, speed steps, depth. Visible on every station. */
export function mountHelm(el: HTMLElement) {
  el.innerHTML = `
    <div class="hd"><span>Ruderstand</span><span class="dim">KLICK IN KOMPASS = KURS</span></div>
    <canvas id="h-compass" style="cursor:pointer" title="Klicken oder ziehen, um den Kurs zu setzen"></canvas>
    <div class="row"><span class="dim">KURS</span><span id="h-hdg"></span></div>
    <div class="row"><span class="dim">FAHRT</span><span id="h-spd"></span></div>
    <div class="steps" id="h-steps">${SPEEDS.map((s, i) => `<button data-s="${i}">${s.label}</button>`).join('')}</div>
    <input id="h-speed" type="range" min="0" max="30" step="1" title="Fahrt in Knoten">
    <div id="depth-box">
      <div class="row"><span class="dim">TIEFE</span><span id="h-dep"></span></div>
      <div class="steps">
        <button id="h-peri" title="Sehrohrtiefe ${PERISCOPE_DEPTH} m">Sehrohr</button>
        <button id="h-above" title="Knapp über der Sprungschicht">Über Schicht</button>
        <button id="h-below" title="Unter der Sprungschicht: schwerer zu orten">Unter Schicht</button>
      </div>
      <input id="h-depth" type="range" min="0" max="400" step="5" title="Tiefe in Metern">
    </div>`;
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const order = (o: { heading?: number; speedKn?: number; depth?: number }) => net.send({ t: 'order', ...o });
  const compass = q<HTMLCanvasElement>('#h-compass');
  const SIZE = 170;
  let dragging = false;

  const courseFromMouse = (e: MouseEvent) => {
    const r = compass.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + SIZE / 2);
    // The rose is north-up: the click is a true course
    order({ heading: gameDeg(Math.round(wrap360((Math.atan2(dx, -dy) * 180) / Math.PI))) });
  };
  touchable(compass);
  compass.addEventListener('pointerdown', (e) => {
    dragging = true;
    courseFromMouse(e);
  });
  window.addEventListener('pointerup', () => (dragging = false));
  compass.addEventListener('pointermove', (e) => dragging && courseFromMouse(e));

  el.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => {
    b.onclick = () => {
      const o = store.snap?.own;
      if (o) order({ speedKn: Math.min(SPEEDS[Number(b.dataset.s)]!.kn, CLASSES[o.cls].maxSpeedKn) });
    };
  });
  q<HTMLInputElement>('#h-speed').oninput = (e) => order({ speedKn: Number((e.target as HTMLInputElement).value) });
  q<HTMLInputElement>('#h-depth').oninput = (e) => order({ depth: Number((e.target as HTMLInputElement).value) });
  q<HTMLButtonElement>('#h-peri').onclick = () => order({ depth: PERISCOPE_DEPTH });
  q<HTMLButtonElement>('#h-above').onclick = () => {
    const l = store.snap?.env.layerDepth;
    if (l !== undefined) order({ depth: Math.max(30, l - 40) });
  };
  q<HTMLButtonElement>('#h-below').onclick = () => {
    const l = store.snap?.env.layerDepth;
    if (l !== undefined) order({ depth: l + 30 });
  };

  /** Step the ordered course, speed or depth from the current order (keyboard, gamepad). */
  function nudge(d: { heading?: number; speedKn?: number; depth?: number }): void {
    const s = store.snap;
    if (!s) return;
    const o = s.own.order;
    const spec = CLASSES[s.own.cls];
    if (d.heading) order({ heading: (o.heading + d.heading + 360) % 360 });
    if (d.speedKn) order({ speedKn: Math.min(Math.max(o.speedKn + d.speedKn, 0), spec.maxSpeedKn) });
    if (d.depth && spec.submarine) order({ depth: Math.max(o.depth + d.depth, 0) });
  }

  let shownHeading: number | undefined;
  let lastDraw = performance.now();

  function drawCompass(): void {
    const s = store.snap;
    const nowMs = performance.now();
    const target = s ? ownNow().heading : 0;
    shownHeading = shownHeading === undefined ? target : easeAngle(shownHeading, target, (nowMs - lastDraw) / 1000, 0.2);
    lastDraw = nowMs;
    const ctx = fitCanvas(compass, SIZE);
    const w = compass.clientWidth;
    const cx = w / 2;
    const cy = SIZE / 2;
    const R = SIZE / 2 - 14;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, SIZE);
    ctx.strokeStyle = '#2c3a36';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (let a = 0; a < 360; a += 10) {
      const v = headingVec(a);
      const l = a % 30 ? 4 : 8;
      ctx.strokeStyle = a % 30 ? '#1d2a27' : COL.dim;
      ctx.beginPath(); ctx.moveTo(cx + v.x * R, cy - v.y * R); ctx.lineTo(cx + v.x * (R - l), cy - v.y * (R - l)); ctx.stroke();
      if (a % 90 === 0) {
        ctx.fillStyle = COL.g;
        ctx.fillText(['N', 'O', 'S', 'W'][a / 90]!, cx + v.x * (R + 8), cy - v.y * (R + 8) + 3);
      }
    }
    if (!s) return;
    for (const c of s.contacts) {
      if (s.time - c.lastSeen > 10 || isFriendlyContact(c, s)) continue;
      const v = headingVec(trueDeg(c.bearing));
      ctx.strokeStyle = c.label === store.selected ? COL.amber : c.label.includes('E') ? COL.red : COL.g;
      ctx.beginPath(); ctx.moveTo(cx + v.x * (R - 2), cy - v.y * (R - 2)); ctx.lineTo(cx + v.x * (R - 14), cy - v.y * (R - 14)); ctx.stroke();
    }
    const half = CLASSES[s.own.cls].hull.baffleHalfAngle;
    ctx.fillStyle = 'rgba(95,122,114,0.15)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const a0 = (trueDeg(shownHeading ?? s.own.heading) + 180 - half - 90) * (Math.PI / 180);
    ctx.arc(cx, cy, R - 16, a0, a0 + (2 * half * Math.PI) / 180);
    ctx.fill();
    const ov = headingVec(trueDeg(s.own.order.heading));
    ctx.strokeStyle = COL.amber;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + ov.x * (R - 6), cy - ov.y * (R - 6)); ctx.stroke();
    ctx.setLineDash([]);
    const hv = headingVec(trueDeg(shownHeading ?? s.own.heading));
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + hv.x * (R - 10), cy - hv.y * (R - 10)); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = COL.g2;
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(tdeg3(shownHeading ?? s.own.heading), cx, cy + 26);
  }

  return {
    update() {
      const s = store.snap;
      if (!s) return;
      const o = s.own;
      const spec = CLASSES[o.cls];
      setHtml(q('#h-hdg'), `${tdeg3(o.heading)}° <span class="amber">→ ${tdeg3(o.order.heading)}°</span>`);
      setHtml(q('#h-spd'), `${kn(o.speedKn)} <span class="amber">→ ${kn(o.order.speedKn)}</span>${o.speedKn > o.cavitationKn ? ' <span class="red">KAVITATION</span>' : ''}`);
      el.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => {
        const k = Math.min(SPEEDS[Number(b.dataset.s)]!.kn, spec.maxSpeedKn);
        b.classList.toggle('on', Math.abs(o.order.speedKn - k) < 0.5);
      });
      const sp = q<HTMLInputElement>('#h-speed');
      sp.max = String(spec.maxSpeedKn);
      if (document.activeElement !== sp) sp.value = String(o.order.speedKn);
      q('#depth-box').style.display = spec.submarine ? '' : 'none';
      if (spec.submarine) {
        const under = s.env.bottom !== undefined ? s.env.bottom - o.depth : undefined;
        const ground = s.env.bottom !== undefined ? ` <span class="${under! < 40 ? 'red blink' : 'dim'}">GRUND ${s.env.bottom} M</span>` : '';
        setHtml(q('#h-dep'), `${o.depth.toFixed(0)} M <span class="amber">→ ${o.order.depth.toFixed(0)} M</span> <span class="dim">SCHICHT ${s.env.layerDepth ?? '?'}</span>${ground}`);
        q('#h-above').style.display = q('#h-below').style.display = s.env.layerDepth === undefined ? 'none' : '';
        const lay = s.env.layerDepth;
        depthBtn(q('#h-peri'), o.depth, o.order.depth, PERISCOPE_DEPTH);
        depthBtn(q('#h-above'), o.depth, o.order.depth, lay === undefined ? undefined : Math.max(30, lay - 40));
        depthBtn(q('#h-below'), o.depth, o.order.depth, lay === undefined ? undefined : lay + 30);
        const dp = q<HTMLInputElement>('#h-depth');
        dp.max = String(spec.maxDepth);
        if (document.activeElement !== dp) dp.value = String(o.order.depth);
      }
    },
    frame: drawCompass,
    /** Set the ordered course (gamepad stick). */
    course(heading: number) {
      if (store.snap) order({ heading: Math.round(wrap360(heading)) });
    },
    nudge,
    key(e: KeyboardEvent) {
      const stepH = e.shiftKey ? 1 : 5;
      if (isKey(e, 'left')) nudge({ heading: -stepH });
      else if (isKey(e, 'right')) nudge({ heading: stepH });
      else if (isKey(e, 'faster')) nudge({ speedKn: 1 });
      else if (isKey(e, 'slower')) nudge({ speedKn: -1 });
      else if (isKey(e, 'up')) nudge({ depth: -10 });
      else if (isKey(e, 'down')) nudge({ depth: 10 });
      else return;
      e.preventDefault();
    },
  };
}
