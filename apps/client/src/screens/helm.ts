import { CLASSES, PERISCOPE_DEPTH, angleDiff, asternMaxKn, headingVec, wrap360, type ClassId } from '@tk/shared';
import { t } from '../i18n/index.js';
import { net } from '../net.js';
import { depthBtn } from '../widgets/btn-state.js';
import { store } from '../store.js';
import { COL, fitCanvas, kn, setHtml, tdeg3 } from '../widgets/format.js';
import { gameDeg, trueDeg } from '../north.js';
import { isFriendlyContact } from '../widgets/friendly.js';
import { isKey } from '../widgets/keys.js';
import { touchable } from '../widgets/touch.js';
import { easeAngle, ownNow } from '../widgets/smooth.js';
import { depthAlarms } from '../widgets/depth-alarm-ui.js';

/** Engine telegraph, astern on the left, ahead on the right (kn; null = class limit). */
const TELEGRAPH: { label: string; short: string; kn: number | 'astern' | 'halfAstern' | 'max' }[] = [
  { label: 'AK zurück', short: 'AK', kn: 'astern' }, { label: 'Halbe zurück', short: 'HALBE', kn: 'halfAstern' },
  { label: 'Langsam zurück', short: 'LANGS', kn: -3 }, { label: 'Stopp', short: 'STOPP', kn: 0 },
  { label: 'Schleich', short: 'SCHL', kn: 3 }, { label: 'Langsam', short: 'LANGS', kn: 6 },
  { label: 'Halbe', short: 'HALBE', kn: 12 }, { label: 'AK', short: 'AK', kn: 'max' },
];
const telKn = (i: number, cls: ClassId): number => {
  const k = TELEGRAPH[i]!.kn;
  const max = CLASSES[cls].maxSpeedKn;
  const ast = asternMaxKn(cls);
  if (k === 'max') return max;
  if (k === 'astern') return -ast;
  if (k === 'halfAstern') return -Math.max(4, Math.round(ast * 0.6));
  return Math.max(-ast, Math.min(max, k));
};
/** Dial angle of the telegraph for a signed speed: piecewise between the steps (rad, 0 = left). */
function telAngle(kn: number, cls: ClassId): number {
  const n = TELEGRAPH.length;
  const at = (i: number) => ((i + 0.5) / n) * Math.PI;
  const ks = TELEGRAPH.map((_, i) => telKn(i, cls));
  if (kn <= ks[0]!) return at(0);
  for (let i = 0; i < n - 1; i++) {
    const a = ks[i]!, b = ks[i + 1]!;
    if (kn <= b) return at(i) + ((kn - a) / Math.max(0.01, b - a)) * (at(i + 1) - at(i));
  }
  return at(n - 1);
}
/** Name of the step an order matches, or undefined. */
function telName(kn: number, cls: ClassId): string | undefined {
  const i = TELEGRAPH.findIndex((_, j) => Math.abs(telKn(j, cls) - kn) < 0.5);
  return i < 0 ? undefined : TELEGRAPH[i]!.label;
}

const HELM_CSS = `<style>
.hm-tiles{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin:5px 0}
.hm-tile{border:1px solid var(--line2);border-radius:3px;padding:3px 5px;background:var(--well);min-width:0}
.hm-tile .l{color:var(--dim);font-size:0.75rem;letter-spacing:0.06em}
.hm-tile .v{font-size:1.25rem;color:var(--g2);line-height:1.2;white-space:nowrap}
.hm-tile .o{font-size:0.8333rem;color:var(--amber);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hm-rud{position:relative;height:8px;margin:4px 0 2px;background:linear-gradient(90deg,rgba(240,149,149,0.35),var(--track) 50%,rgba(93,202,165,0.35))}
.hm-rud i{position:absolute;top:-2px;bottom:-2px;width:3px;margin-left:-1.5px;background:var(--g2)}
.hm-rud b{position:absolute;left:50%;top:-1px;bottom:-1px;width:1px;background:var(--dim)}
.hm-ord{display:flex;justify-content:space-between;font-size:0.8333rem;margin:2px 0}
</style>`;

/** Helm: compass rose for the course, instrument tiles, engine telegraph (ahead and astern), depth. Visible on every station. */
export function mountHelm(el: HTMLElement) {
  el.innerHTML = `${HELM_CSS}
    <div class="hd"><span>Ruderstand</span><span class="dim">KLICK IN KOMPASS = KURS</span></div>
    <canvas id="h-compass" style="cursor:pointer" title="Klicken oder ziehen, um den Kurs zu setzen"></canvas>
    <div class="hm-tiles">
      <div class="hm-tile"><div class="l">KURS</div><div class="v" id="h-hdg"></div><div class="o" id="h-hdg-o"></div></div>
      <div class="hm-tile"><div class="l">FAHRT</div><div class="v" id="h-spd"></div><div class="o" id="h-spd-o"></div></div>
      <div class="hm-tile"><div class="l">RUDER</div><div class="v" id="h-rud" style="font-size:1rem"></div><div class="hm-rud"><b></b><i id="h-rud-i"></i></div></div>
    </div>
    <canvas id="h-tel" style="cursor:pointer" title="Maschinentelegraf: klicken, um die Fahrstufe zu befehlen (links zurück, rechts voraus)"></canvas>
    <div class="hm-ord"><span class="dim">MASCHINE</span><span id="h-ord"></span></div>
    <input id="h-speed" type="range" min="-8" max="30" step="1" title="Fahrt in Knoten (negativ = zurück)">
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
  const tel = q<HTMLCanvasElement>('#h-tel');
  const SIZE = 196;
  const TEL_H = 104;
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

  // Telegraph: a click picks the step under the pointer (by its angle on the dial)
  touchable(tel);
  tel.addEventListener('pointerdown', (e) => {
    const o = store.snap?.own;
    if (!o) return;
    const r = tel.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = r.top + TEL_H - 10 - e.clientY;
    const a = Math.atan2(Math.max(0, dy), -dx); // 0 = left, π = right
    const i = Math.max(0, Math.min(TELEGRAPH.length - 1, Math.floor((a / Math.PI) * TELEGRAPH.length)));
    order({ speedKn: telKn(i, o.cls) });
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
    const ctx = fitCanvas(compass, SIZE);
    const w = compass.clientWidth;
    const cx = w / 2;
    const cy = SIZE / 2;
    const R = SIZE / 2 - 16;
    const P = (deg: number, r: number) => {
      const v = headingVec(deg);
      return [cx + v.x * r, cy - v.y * r] as const;
    };
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, SIZE);
    // Bezel: a dark ring with the degree scale, the card inside
    ctx.fillStyle = '#0d1715';
    ctx.beginPath(); ctx.arc(cx, cy, R + 13, 0, 7); ctx.fill();
    const card = ctx.createRadialGradient(cx, cy, 4, cx, cy, R);
    card.addColorStop(0, '#0f1f1b');
    card.addColorStop(1, '#070d0c');
    ctx.fillStyle = card;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    ctx.strokeStyle = '#2c3a36';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R + 13, 0, 7); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 5) {
      const l = a % 30 === 0 ? 9 : a % 10 === 0 ? 5 : 3;
      ctx.strokeStyle = a % 30 === 0 ? COL.g2 : a % 10 === 0 ? COL.dim : '#24332f';
      const [x0, y0] = P(a, R);
      const [x1, y1] = P(a, R - l);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      if (a % 30 === 0) {
        const [tx, ty] = P(a, R + 7);
        const card4 = a % 90 === 0;
        ctx.font = card4 ? 'bold 11px ui-monospace, monospace' : '9px ui-monospace, monospace';
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
      ctx.lineWidth = c.label === store.selected ? 2.5 : 1.5;
      const [x0, y0] = P(b, R - 2);
      const [x1, y1] = P(b, R - 15);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.lineWidth = 1;
    // Baffles (deaf sector astern)
    const half = CLASSES[own.cls].hull.baffleHalfAngle;
    ctx.fillStyle = 'rgba(95,122,114,0.13)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const a0 = (hdg + 180 - half - 90) * (Math.PI / 180);
    ctx.arc(cx, cy, R - 18, a0, a0 + (2 * half * Math.PI) / 180);
    ctx.fill();
    // The turn still to go: an amber arc from the heading round to the ordered course
    const togo = angleDiff(hdg, ord);
    if (Math.abs(togo) > 1) {
      const r = R - 22;
      const s0 = ((hdg - 90) * Math.PI) / 180;
      const s1 = s0 + (togo * Math.PI) / 180;
      ctx.strokeStyle = 'rgba(250,199,117,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, s0, s1, togo < 0); ctx.stroke();
      ctx.lineWidth = 1;
      const [ax, ay] = P(ord, r);
      ctx.fillStyle = 'rgba(250,199,117,0.8)';
      ctx.beginPath(); ctx.arc(ax, ay, 2.5, 0, 7); ctx.fill();
    }
    // Ordered course: dashed line and a marker on the bezel
    ctx.strokeStyle = COL.amber;
    ctx.setLineDash([3, 3]);
    const [ox, oy] = P(ord, R - 4);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ox, oy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(...P(ord, R + 2));
    ctx.rotate((ord * Math.PI) / 180);
    ctx.fillStyle = COL.amber;
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(-5, -7); ctx.lineTo(5, -7); ctx.closePath(); ctx.fill();
    ctx.restore();
    // Heading line to the rim and the own ship in the middle (stern first when going astern)
    const [hx, hy] = P(hdg, R - 2);
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((hdg * Math.PI) / 180);
    const L = 30;
    const B = 7;
    // Wake behind (ahead of her when going astern), longer with speed
    const wake = Math.min(26, own.speedKn * 1.6);
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
    // Digital heading in a box at the top of the card
    ctx.font = 'bold 13px ui-monospace, monospace';
    const txt = `${tdeg3(shownHeading ?? own.heading)}°`;
    ctx.fillStyle = 'rgba(8,12,11,0.85)';
    ctx.fillRect(cx - 24, cy + 30, 48, 17);
    ctx.strokeStyle = '#2c3a36';
    ctx.strokeRect(cx - 24 + 0.5, cy + 30.5, 47, 16);
    ctx.fillStyle = COL.g2;
    ctx.fillText(txt, cx, cy + 39);
    drawTelegraph();
  }

  function drawTelegraph(): void {
    const s = store.snap;
    const ctx = fitCanvas(tel, TEL_H);
    const w = tel.clientWidth;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, TEL_H);
    if (!s) return;
    const own = s.own;
    const cx = w / 2;
    const cy = TEL_H - 10;
    const R = Math.min(w / 2 - 6, TEL_H - 14);
    const n = TELEGRAPH.length;
    const ang = (a: number) => Math.PI + a; // canvas angle: π (left) .. 2π (right)
    const ordered = own.order.speedKn;
    const orderedI = TELEGRAPH.findIndex((_, i) => Math.abs(telKn(i, own.cls) - ordered) < 0.5);
    // Sectors: astern red-tinted, stop neutral, ahead green-tinted; the ordered one lit
    for (let i = 0; i < n; i++) {
      const a0 = ang((i / n) * Math.PI);
      const a1 = ang(((i + 1) / n) * Math.PI);
      const k = telKn(i, own.cls);
      const lit = i === orderedI;
      ctx.fillStyle = lit ? 'rgba(250,199,117,0.32)' : k < 0 ? 'rgba(240,149,149,0.10)' : k === 0 ? 'rgba(159,225,203,0.06)' : 'rgba(93,202,165,0.10)';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2c3a36';
      ctx.stroke();
      // Label along the rim
      const am = (a0 + a1) / 2;
      ctx.save();
      // Written along the radius, reading outwards on the right half and inwards on the left
      ctx.translate(cx + Math.cos(am) * R * 0.66, cy + Math.sin(am) * R * 0.66);
      ctx.rotate(am > 1.5 * Math.PI ? am : am - Math.PI);
      ctx.font = `${lit ? 'bold ' : ''}9px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = lit ? COL.amber : k < 0 ? COL.red : k === 0 ? COL.g2 : COL.g;
      ctx.fillText(t(TELEGRAPH[i]!.short), 0, 0);
      ctx.restore();
    }
    // ZURÜCK / VORAUS
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COL.red;
    ctx.textAlign = 'left';
    ctx.fillText(t('ZURÜCK'), 4, TEL_H - 2);
    ctx.fillStyle = COL.g;
    ctx.textAlign = 'right';
    ctx.fillText(t('VORAUS'), w - 4, TEL_H - 2);
    // Ordered lever (amber) and the speed actually made (blue needle)
    const lever = ang(telAngle(ordered, own.cls));
    ctx.strokeStyle = COL.amber;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(lever) * (R - 4), cy + Math.sin(lever) * (R - 4)); ctx.stroke();
    const made = (own.sternway ? -1 : 1) * own.speedKn;
    const needle = ang(telAngle(made, own.cls));
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needle) * (R * 0.55), cy + Math.sin(needle) * (R * 0.55)); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#1d2a27';
    ctx.strokeStyle = COL.dim;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 7); ctx.fill(); ctx.stroke();
  }

  return {
    update() {
      const s = store.snap;
      if (!s) return;
      const o = s.own;
      const spec = CLASSES[o.cls];
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
      setHtml(q('#h-spd'), `${made}<span class="dim" style="font-size:0.75rem"> KN${o.sternway ? ' <span class="red">ZUR</span>' : ''}</span>`);
      setHtml(q('#h-spd-o'), `→ ${kn(Math.abs(o.order.speedKn))}${o.order.speedKn < 0 ? ' ZUR.' : ''}${o.speedKn > o.cavitationKn ? ' <span class="red">KAV</span>' : ''}`);
      // Rudder: estimated from the rate of turn against the class's best rate (about 35° at full)
      const rudder = Math.max(-35, Math.min(35, (rot / Math.max(0.1, spec.turnRateDeg)) * 35 * (o.sternway ? -1 : 1)));
      const rAbs = Math.abs(rudder);
      setHtml(q('#h-rud'), rAbs < 1.5 ? '0° <span class="dim" style="font-size:0.75rem">MITTE</span>' : `${rAbs.toFixed(0)}° <span class="${rudder > 0 ? '' : 'red'}" style="font-size:0.75rem">${rudder > 0 ? 'STB' : 'BB'}</span>`);
      q('#h-rud-i').style.left = `${50 + (rudder / 35) * 50}%`;
      const name = telName(o.order.speedKn, o.cls);
      setHtml(q('#h-ord'), `<span class="amber">${name ? t(name).toUpperCase() : `${Math.abs(o.order.speedKn)} KN ${o.order.speedKn < 0 ? 'ZURÜCK' : 'VORAUS'}`}</span>${Math.abs(rot) > 0.05 ? ` <span class="dim">· DREHT ${Math.abs(rot).toFixed(1).replace('.', ',')}°/S</span>` : ''}`);
      const sp = q<HTMLInputElement>('#h-speed');
      sp.max = String(spec.maxSpeedKn);
      sp.min = String(-asternMaxKn(o.cls));
      if (document.activeElement !== sp) sp.value = String(o.order.speedKn);
      q('#depth-box').style.display = spec.submarine ? '' : 'none';
      depthAlarms.update(s);
      if (spec.submarine) {
        const under = s.env.bottom !== undefined ? s.env.bottom - o.depth : undefined;
        const ground = s.env.bottom !== undefined ? ` <span class="${under! < 40 ? 'red blink' : 'dim'}">GRUND ${s.env.bottom} M</span>` : '';
        setHtml(q('#h-dep'), `${o.depth.toFixed(0)} M <span class="amber">→ ${o.order.depth.toFixed(0)} M</span> <span class="dim">SCHICHT ${s.env.layerDepth ?? '?'}</span>${ground} ${depthAlarms.helmTag()}`);
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
