import { CLASSES, PERISCOPE_DEPTH, angleDiff, asternMaxKn, headingVec, wrap360, type ClassId } from '@tk/shared';
import { t } from '../i18n/index.js';
import { net } from '../net.js';
import { depthBtn } from '../widgets/btn-state.js';
import { store } from '../store.js';
import { COL, FONT, LW, fitCanvas, kn, setHtml, setText, tdeg3 } from '../widgets/format.js';
import { gameDeg, trueDeg } from '../north.js';
import { isFriendlyContact } from '../widgets/friendly.js';
import { isKey } from '../widgets/keys.js';
import { touchable } from '../widgets/touch.js';
import { easeAngle, ownNow } from '../widgets/smooth.js';
import { depthAlarms } from '../widgets/depth-alarm-ui.js';
import { orderedRudder, telegraphOf, type TelStep } from './helm-tel.js';

let TELEGRAPH: TelStep[] = telegraphOf('ssk');
const telKn = (i: number, cls: ClassId): number => {
  const k = TELEGRAPH[i]!.kn;
  const max = CLASSES[cls].maxSpeedKn;
  const ast = asternMaxKn(cls);
  if (k === 'max') return max;
  if (k === 'astern') return -ast;
  if (k === 'halfAstern') return -Math.max(4, Math.round(ast * 0.6));
  return Math.max(-ast, Math.min(max, k));
};
/** Step nearest to a signed speed. */
function telNearest(v: number, cls: ClassId): number {
  let best = 0;
  TELEGRAPH.forEach((_, i) => {
    if (Math.abs(telKn(i, cls) - v) < Math.abs(telKn(best, cls) - v)) best = i;
  });
  return best;
}
/** Name of the step an order matches, or undefined. */
function telName(v: number, cls: ClassId): string | undefined {
  const i = TELEGRAPH.findIndex((_, j) => Math.abs(telKn(j, cls) - v) < 0.5);
  return i < 0 ? undefined : TELEGRAPH[i]!.label;
}


/**
 * Sends at most one order per interval while a control is dragged, and always the last value
 * when the drag ends (flush): the server sees the final course or depth, not a flood of steps.
 */
function throttle<T>(send: (v: T) => void, ms = 100): { push(v: T): void; flush(): void } {
  let last = 0;
  let pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending === undefined) return;
    const v = pending;
    pending = undefined;
    last = performance.now();
    send(v);
  };
  return {
    push(v: T) {
      pending = v;
      const wait = ms - (performance.now() - last);
      if (wait <= 0) flush();
      else timer ??= setTimeout(flush, wait);
    },
    flush,
  };
}

const HELM_CSS = `<style>
.hm-top{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px;align-items:center}
.hm-tiles{display:flex;flex-direction:column;gap:4px;min-width:0}
.hm-tile{border:1px solid var(--line2);border-radius:3px;padding:2px 5px;background:var(--well);min-width:0}
.hm-tile .l{color:var(--dim);font-size:var(--fs-cap);letter-spacing:0.06em}
.hm-tile .v{font-size:var(--fs-read);color:var(--c-data);line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hm-tile .v small{font-size:var(--fs-cap);color:var(--dim)}
.hm-tile .o{font-size:var(--fs-cap);color:var(--c-attn);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:1.2em}
.hm-rud{position:relative;height:6px;margin:3px 0 2px;background:var(--track);border-radius:1px}
.hm-rud b{position:absolute;left:50%;top:-1px;bottom:-1px;width:1px;background:var(--dim)}
.hm-rud i{position:absolute;top:-2px;bottom:-2px;width:2px;margin-left:-1px;background:var(--c-data)}
.hm-telcap{display:flex;justify-content:space-between;font-size:var(--fs-cap);color:var(--dim);letter-spacing:0.08em;margin:6px 0 2px}
.hm-tel{display:grid;grid-template-columns:repeat(var(--n,8),minmax(26px,1fr));gap:0}
.hm-tel button{min-height:24px;padding:0;border-radius:0;margin-left:-1px;font-size:var(--fs-cap);letter-spacing:0;overflow:hidden;text-overflow:clip;white-space:nowrap}
.hm-tel button:first-child{margin-left:0;border-radius:3px 0 0 3px}
.hm-tel button:last-child{border-radius:0 3px 3px 0}
.hm-tel button.ast{color:var(--c-attn)}
.hm-tel button.stop{color:var(--c-data)}
.hm-tel button.made{background:rgba(93,202,165,0.28);color:var(--g2)}
.hm-tel button.made.ast{background:rgba(250,199,117,0.22);color:var(--amber)}
.hm-tel button.made.stop{background:rgba(159,225,203,0.16)}
.hm-tel button.ord{position:relative;z-index:1;box-shadow:inset 0 0 0 2px var(--c-attn)}
.hm-tel button.ord.near{box-shadow:inset 0 0 0 1px var(--c-attn)}
.hm-ord{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px;align-items:center;margin-top:4px}
.hm-ord button{padding:2px 8px}
.hm-ord>span{text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#depth-box{margin-top:4px}
#depth-box .hm-drow{white-space:nowrap}
#depth-box .hm-drow>span{overflow:hidden;text-overflow:ellipsis}
#depth-box .hm-dcap{margin-top:4px;font-size:var(--fs-cap)}
#depth-box input[type=range]{margin-top:0}
/* S26: the three depth buttons keep one row whatever their state tag says */
#depth-box .steps.hm-dbtn{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px}
#depth-box .hm-dbtn button{position:relative;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:3px;padding-right:3px;min-width:0;font-size:var(--fs-cap);letter-spacing:0.02em}
#depth-box .hm-dbtn button[data-bst]::after{position:absolute;right:1px;top:1px;margin:0;padding:0 2px;font-size:10px;line-height:1.1;border:0;background:var(--well)}
@media (min-width:601px) and (max-width:1279px){
.hm-top{grid-template-columns:minmax(0,1fr);justify-items:center}
.hm-tiles{flex-direction:row;width:100%}
.hm-tile{flex:1 1 0}
}
html[data-theme='light'] .hm-tel button.made{background:#cfe9df;color:#0d3a2c}
html[data-theme='light'] .hm-tel button.made.ast{background:#f6e2b8;color:#6e4000}
html[data-theme='light'] .hm-tel button.made.stop{background:#e2ebe7}
</style>`;

/** Helm: compass rose for the course, instrument tiles, engine telegraph strip (ahead and astern), depth. Visible on every station. */
export function mountHelm(el: HTMLElement) {
  el.innerHTML = `${HELM_CSS}
    <div class="hd"><span>Ruderstand<span id="h-ship" class="h-ship"></span></span></div>
    <div class="hm-top">
      <canvas id="h-compass" style="cursor:pointer" title="Klicken oder ziehen, um den Kurs zu setzen"></canvas>
      <div class="hm-tiles">
        <div class="hm-tile"><div class="l">KURS</div><div class="v" id="h-hdg"></div><div class="o" id="h-hdg-o"></div></div>
        <div class="hm-tile"><div class="l">FAHRT</div><div class="v" id="h-spd"></div><div class="o" id="h-spd-o"></div></div>
        <div class="hm-tile" title="Ruderlage, wie der Rudergänger sie legt, und die Drehrate"><div class="l">RUDER</div><div class="v" id="h-rud"></div><div class="hm-rud"><b></b><i id="h-rud-i"></i></div><div class="o" id="h-rot"></div></div>
      </div>
    </div>
    <div class="hm-telcap"><span><span aria-hidden="true">◂ </span><span>ZURÜCK</span></span><span><span>VORAUS</span><span aria-hidden="true"> ▸</span></span></div>
    <div class="hm-tel" id="h-tel" role="group" aria-label="Maschinentelegraf"></div>
    <div class="hm-ord">
      <button id="h-slow" title="Fahrt 1 kn weniger">−1</button>
      <span id="h-ord"></span>
      <button id="h-fast" title="Fahrt 1 kn mehr">+1</button>
    </div>
    <div id="depth-box">
      <div class="row hm-drow"><span class="dim">TIEFE</span><span id="h-dep"></span></div>
      <div class="row hm-drow"><span id="h-env"></span><span id="h-lay"></span></div>
      <div class="steps hm-dbtn">
        <button id="h-peri" title="Sehrohrtiefe ${PERISCOPE_DEPTH} m">Sehrohr</button>
        <button id="h-above" title="Knapp über der Sprungschicht">Über Sch.</button>
        <button id="h-below" title="Unter der Sprungschicht: schwerer zu orten">Unter Sch.</button>
      </div>
      <div class="row hm-drow hm-dcap"><span class="dim">BEFOHLENE TIEFE</span><span id="h-dval"></span></div>
      <input id="h-depth" type="range" min="0" max="400" step="1" title="Befohlene Tiefe in Metern" aria-label="Befohlene Tiefe">
    </div>`;
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const order = (o: { heading?: number; speedKn?: number; depth?: number }) => net.send({ t: 'order', ...o });
  const compass = q<HTMLCanvasElement>('#h-compass');
  /** Compass diameter: 120–160 px, so the whole helm stays within about 42 % of the right column (110 px below 1280 px, tiles under it). */
  let size = 156;
  const MIN = 120, MAX = 160;
  const fit = () => {
    const side = el.parentElement;
    let want = MAX;
    const narrow = window.innerWidth > 600 && window.innerWidth < 1280;
    if (side && window.innerWidth > 600 && side.clientHeight > 0) {
      const rest = el.offsetHeight - size;
      want = Math.floor(side.clientHeight * 0.42 - rest);
    }
    const next = narrow ? 110 : Math.max(MIN, Math.min(MAX, want));
    if (next !== size) size = next;
    const w = `${size}px`;
    if (compass.style.width !== w) compass.style.width = w;
  };
  fit();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => requestAnimationFrame(fit));
    queueMicrotask(() => el.parentElement && ro.observe(el.parentElement));
  }

  // Course by click or drag on the rose: at most 10 orders a second while dragging, the final one on release
  const courseOrder = throttle<number>((heading) => order({ heading }));
  const courseFrom = (e: PointerEvent) => {
    const r = compass.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // The rose is north-up: the click is a true course
    return gameDeg(Math.round(wrap360((Math.atan2(dx, -dy) * 180) / Math.PI)));
  };
  let dragging = false;
  touchable(compass);
  compass.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { compass.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    courseOrder.push(courseFrom(e));
  });
  compass.addEventListener('pointermove', (e) => dragging && courseOrder.push(courseFrom(e)));
  const release = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (e.type === 'pointerup') courseOrder.push(courseFrom(e));
    courseOrder.flush();
  };
  compass.addEventListener('pointerup', release);
  compass.addEventListener('pointercancel', release);
  compass.addEventListener('lostpointercapture', release);

  q('#h-tel').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tel]');
    const o = store.snap?.own;
    if (b && o) order({ speedKn: telKn(Number(b.dataset.tel), o.cls) });
  });
  q<HTMLButtonElement>('#h-slow').onclick = () => nudge({ speedKn: -1 });
  q<HTMLButtonElement>('#h-fast').onclick = () => nudge({ speedKn: 1 });
  const depthOrder = throttle<number>((depth) => order({ depth }));
  const dp = q<HTMLInputElement>('#h-depth');
  /** While dragging the slider's value, otherwise the order as the boat has it (S13). */
  const showDepthValue = (ordered?: number) => setText(q('#h-dval'), `${ordered !== undefined && document.activeElement !== dp ? Math.round(ordered) : dp.value} M`);
  let telFor: ClassId | undefined;
  /** Build the telegraph strip for the class (boat or surface steps). */
  const buildTel = (cls: ClassId) => {
    if (telFor === cls) return;
    telFor = cls;
    TELEGRAPH = telegraphOf(cls);
    const tel = q('#h-tel');
    tel.style.setProperty('--n', String(TELEGRAPH.length));
    tel.innerHTML = TELEGRAPH.map((st, i) => `<button data-tel="${i}" class="${i < 3 ? 'ast' : i === 3 ? 'stop' : ''}" title="${st.label}">${st.short}</button>`).join('');
  };
  buildTel('ssk');
  dp.oninput = () => {
    showDepthValue();
    depthOrder.push(Number(dp.value));
  };
  dp.onchange = () => {
    depthOrder.push(Number(dp.value));
    depthOrder.flush();
  };
  q<HTMLButtonElement>('#h-peri').onclick = () => order({ depth: PERISCOPE_DEPTH });
  q<HTMLButtonElement>('#h-above').onclick = () => {
    const l = store.snap?.env.layerDepth;
    if (l !== undefined) order({ depth: Math.max(30, l - 40) });
  };
  q<HTMLButtonElement>('#h-below').onclick = () => {
    const l = store.snap?.env.layerDepth;
    if (l !== undefined) order({ depth: l + 30 });
  };

  /** Step the ordered course, speed or depth from the current order (keyboard, gamepad, ±1 kn). */
  function nudge(d: { heading?: number; speedKn?: number; depth?: number }): void {
    const s = store.snap;
    if (!s) return;
    const o = s.own.order;
    const spec = CLASSES[s.own.cls];
    if (d.heading) order({ heading: (o.heading + d.heading + 360) % 360 });
    if (d.speedKn) order({ speedKn: Math.min(Math.max(o.speedKn + d.speedKn, -asternMaxKn(s.own.cls)), spec.maxSpeedKn) });
    if (d.depth && spec.submarine) order({ depth: Math.max(o.depth + d.depth, 0) });
  }

  let shownHeading: number | undefined;
  let lastDraw = performance.now();
  /** Rate of turn (deg/s, + = starboard) from the heading over the last snapshots, smoothed. */
  let rot = 0;
  let rotRef: { h: number; t: number } | undefined;

  function drawCompass(): void {
    const s = store.snap;
    const nowMs = performance.now();
    const target = s ? ownNow().heading : 0;
    shownHeading = shownHeading === undefined ? target : easeAngle(shownHeading, target, (nowMs - lastDraw) / 1000, 0.2);
    lastDraw = nowMs;
    const SIZE = size;
    const ctx = fitCanvas(compass, SIZE);
    const w = compass.clientWidth || SIZE;
    const cx = w / 2;
    const cy = SIZE / 2;
    const R = SIZE / 2 - 15;
    const P = (deg: number, r: number) => {
      const v = headingVec(deg);
      return [cx + v.x * r, cy - v.y * r] as const;
    };
    ctx.clearRect(0, 0, w, SIZE);
    // Bezel: a dark ring with the degree scale, the card inside
    ctx.fillStyle = '#0d1715';
    ctx.beginPath(); ctx.arc(cx, cy, R + 13, 0, 7); ctx.fill();
    const card = ctx.createRadialGradient(cx, cy, 4, cx, cy, R);
    card.addColorStop(0, '#0f1f1b');
    card.addColorStop(1, '#070d0c');
    ctx.fillStyle = card;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    ctx.lineWidth = LW.grid;
    ctx.strokeStyle = '#2c3a36';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R + 13, 0, 7); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 5) {
      const l = a % 30 === 0 ? 8 : a % 10 === 0 ? 5 : 3;
      ctx.strokeStyle = a % 30 === 0 ? COL.g2 : a % 10 === 0 ? COL.dim : '#24332f';
      const [x0, y0] = P(a, R);
      const [x1, y1] = P(a, R - l);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      if (a % 30 === 0) {
        const [tx, ty] = P(a, R + 7);
        const card4 = a % 90 === 0;
        ctx.font = card4 ? `bold ${FONT.label}` : FONT.tick;
        ctx.fillStyle = card4 ? COL.g : COL.dim;
        ctx.fillText(card4 ? ['N', 'O', 'S', 'W'][a / 90]! : String(a / 10).padStart(2, '0'), tx, ty);
      }
    }
    if (!s) return;
    const own = s.own;
    const hdg = trueDeg(shownHeading ?? own.heading);
    const ord = trueDeg(own.order.heading);
    // Contacts on the rim
    for (const c of s.contacts) {
      if (s.time - c.lastSeen > 10 || isFriendlyContact(c, s)) continue;
      const b = trueDeg(c.bearing);
      ctx.strokeStyle = c.label === store.selected ? COL.amber : c.label.includes('E') ? COL.red : COL.g;
      ctx.lineWidth = c.label === store.selected ? LW.own : LW.track;
      const [x0, y0] = P(b, R - 2);
      const [x1, y1] = P(b, R - 13);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.lineWidth = LW.grid;
    // Baffles (deaf sector astern)
    const half = CLASSES[own.cls].hull.baffleHalfAngle;
    ctx.fillStyle = 'rgba(95,122,114,0.13)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const a0 = (hdg + 180 - half - 90) * (Math.PI / 180);
    ctx.arc(cx, cy, R - 16, a0, a0 + (2 * half * Math.PI) / 180);
    ctx.fill();
    // The turn still to go: an amber arc from the heading round to the ordered course
    const togo = angleDiff(hdg, ord);
    if (Math.abs(togo) > 1) {
      const r = R - 19;
      const s0 = ((hdg - 90) * Math.PI) / 180;
      const s1 = s0 + (togo * Math.PI) / 180;
      ctx.strokeStyle = 'rgba(250,199,117,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, s0, s1, togo < 0); ctx.stroke();
      ctx.lineWidth = LW.grid;
      const [ax, ay] = P(ord, r);
      ctx.fillStyle = 'rgba(250,199,117,0.8)';
      ctx.beginPath(); ctx.arc(ax, ay, 2.5, 0, 7); ctx.fill();
    }
    // Ordered course: dashed line and a marker just inside the card, its tip on the rim (the
    // bezel numbers outside stay readable)
    ctx.strokeStyle = COL.amber;
    ctx.lineWidth = LW.bearing;
    ctx.setLineDash([3, 3]);
    const [ox, oy] = P(ord, R - 9);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ox, oy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(...P(ord, R - 1));
    ctx.rotate((ord * Math.PI) / 180);
    ctx.fillStyle = COL.amber;
    ctx.strokeStyle = '#070d0c';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-5, 9); ctx.lineTo(5, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // Heading line to the rim and the own ship in the middle (stern first when going astern)
    const [hx, hy] = P(hdg, R - 2);
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = LW.own;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.lineWidth = LW.grid;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((hdg * Math.PI) / 180);
    const L = Math.round(SIZE * 0.16);
    const B = Math.max(5, Math.round(L * 0.24));
    // Wake behind (ahead of her when going astern), longer with speed
    const wake = Math.min(L * 0.85, own.speedKn * 1.4);
    if (wake > 1) {
      const dir = own.sternway ? -1 : 1;
      const g = ctx.createLinearGradient(0, dir * (L / 2), 0, dir * (L / 2 + wake));
      g.addColorStop(0, 'rgba(133,183,235,0.45)');
      g.addColorStop(1, 'rgba(133,183,235,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-B / 2, dir * (L / 2 - 2));
      ctx.lineTo(B / 2, dir * (L / 2 - 2));
      ctx.lineTo(B * 1.3, dir * (L / 2 + wake));
      ctx.lineTo(-B * 1.3, dir * (L / 2 + wake));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#1d3a52';
    ctx.strokeStyle = COL.blue;
    ctx.beginPath();
    ctx.moveTo(0, -L / 2);
    ctx.quadraticCurveTo(B / 2, -L / 4, B / 2, 0);
    ctx.lineTo(B / 2, L / 2 - 2);
    ctx.lineTo(-B / 2, L / 2 - 2);
    ctx.lineTo(-B / 2, 0);
    ctx.quadraticCurveTo(-B / 2, -L / 4, 0, -L / 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  return {
    update() {
      const s = store.snap;
      if (!s) return;
      const o = s.own;
      const spec = CLASSES[o.cls];
      fit();
      // Rate of turn from successive snapshots
      if (rotRef && s.time > rotRef.t + 0.05) {
        const r = angleDiff(rotRef.h, o.heading) / (s.time - rotRef.t);
        rot += (r - rot) * Math.min(1, (s.time - rotRef.t) / 2);
      }
      if (!rotRef || s.time > rotRef.t + 0.05) rotRef = { h: o.heading, t: s.time };
      const togo = angleDiff(o.heading, o.order.heading);
      setHtml(q('#h-hdg'), `${tdeg3(o.heading)}°`);
      setHtml(q('#h-hdg-o'), Math.abs(togo) < 0.5 ? '<span class="dim">LIEGT AN</span>' : `→ ${tdeg3(o.order.heading)}° ${togo > 0 ? 'STB' : 'BB'}`);
      const made = `${o.speedKn.toFixed(1).replace('.', ',')}`;
      setHtml(q('#h-spd'), `${made}<small> KN${o.sternway ? ' <span class="amber">ZUR</span>' : ''}</small>`);
      setHtml(q('#h-spd-o'), `→ ${kn(Math.abs(o.order.speedKn))}${o.order.speedKn < 0 ? ' ZUR.' : ''}${o.speedKn > o.cavitationKn ? ' · KAV' : ''}`);
      // Rudder: estimated from the rate of turn against the class's best rate (about 35° at full)
      // Rudder (S8): the angle the helmsman lays for the turn still to go (going astern the
      // rudder works the other way round); jammed: it holds what it had
      buildTel(o.cls);
      const rudder = o.rudderJam
        ? Math.max(-35, Math.min(35, (rot / Math.max(0.1, spec.turnRateDeg)) * 35))
        : orderedRudder(togo, spec.turnRateDeg) * (o.sternway ? -1 : 1);
      const rAbs = Math.abs(rudder);
      setHtml(q('#h-rud'), rAbs < 1.5 ? '0°<small> MITTE</small>' : `${rAbs.toFixed(0)}°<small> ${rudder > 0 ? 'STB' : 'BB'}</small>`);
      q('#h-rud-i').style.left = `${50 + (rudder / 35) * 50}%`;
      setText(q('#h-ship'), ` · ${o.name}`);
      // Rate of turn in the rudder tile (S12: in the header it cut the ship's name)
      setHtml(q('#h-rot'), o.rudderJam ? '<span class="red">RUDER KLEMMT</span>' : Math.abs(rot) > 0.05 ? `${rot > 0 ? '↻' : '↺'} ${Math.abs(rot).toFixed(1).replace('.', ',')}°/S` : '<span class="dim">0°/S</span>');
      // Telegraph strip: the step she is making filled, the ordered step outlined amber
      const ordered = o.order.speedKn;
      const ordI = telNearest(ordered, o.cls);
      const exact = Math.abs(telKn(ordI, o.cls) - ordered) < 0.5;
      const madeI = telNearest((o.sternway ? -1 : 1) * o.speedKn, o.cls);
      q('#h-tel').querySelectorAll<HTMLButtonElement>('[data-tel]').forEach((b, i) => {
        b.classList.toggle('made', i === madeI);
        b.classList.toggle('ord', i === ordI);
        b.classList.toggle('near', i === ordI && !exact);
        b.setAttribute('aria-pressed', String(i === ordI && exact));
      });
      const name = telName(ordered, o.cls);
      // The step's name with its speed: "HALBE · 12 KN" (F30)
      setHtml(q('#h-ord'), `<span class="amber">${name ? `${t(name).toUpperCase()} · ${Math.abs(Math.round(ordered))} KN` : `${Math.abs(ordered)} KN ${ordered < 0 ? 'ZURÜCK' : 'VORAUS'}`}</span>`);
      q('#depth-box').style.display = spec.submarine ? '' : 'none';
      depthAlarms.update(s);
      if (spec.submarine) {
        // Two short rows that never wrap: depth and order (with the alarm tag), then the water under her
        const under = s.env.bottom !== undefined ? s.env.bottom - o.depth : undefined;
        setHtml(q('#h-dep'), `${depthAlarms.helmTag()} ${o.depth.toFixed(0)} <span class="amber">→ ${o.order.depth.toFixed(0)} M</span>`);
        setHtml(q('#h-env'), s.env.bottom !== undefined ? `<span class="dim">GRUND</span> <span class="${under! < 40 ? 'red blink' : ''}">${s.env.bottom} M</span>` : '<span class="dim">GRUND</span> —');
        const layEl = q('#h-lay');
        setHtml(layEl, `<span class="dim">SCHICHT</span> ${s.env.layerDepth !== undefined ? `${s.env.layerDepth} M` : s.env.noLayer ? 'KEINE' : '—'}`);
        layEl.title = s.env.layerDepth !== undefined ? 'Gemessene Sprungschicht' : s.env.noLayer ? 'Hier keine Sprungschicht: das Wasser ist bis zum Grund durchmischt' : 'Sprungschicht unbekannt: einmal tief durchtauchen, um sie zu messen';
        // Always there (the row doesn't re-flow when the layer is measured), usable once it is
        for (const id of ['#h-above', '#h-below']) {
          const b = q<HTMLButtonElement>(id);
          b.disabled = s.env.layerDepth === undefined;
          if (b.disabled) b.title = 'Sprungschicht noch nicht gemessen: einmal tief durchtauchen';
          else b.title = id === '#h-above' ? 'Knapp über der Sprungschicht' : 'Unter der Sprungschicht: schwerer zu orten';
        }
        const lay = s.env.layerDepth;
        depthBtn(q('#h-peri'), o.depth, o.order.depth, PERISCOPE_DEPTH);
        depthBtn(q('#h-above'), o.depth, o.order.depth, lay === undefined ? undefined : Math.max(30, lay - 40));
        depthBtn(q('#h-below'), o.depth, o.order.depth, lay === undefined ? undefined : lay + 30);
        dp.max = String(spec.maxDepth);
        if (document.activeElement !== dp) dp.value = String(Math.round(o.order.depth));
        showDepthValue(o.order.depth);
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
