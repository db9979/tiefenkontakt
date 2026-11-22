import { CLASSES, headingVec, type ClassId, type ServerMsg, type TruthView } from '@tk/shared';
import { net } from '../net.js';
import { CLASS_LABEL, deg3, esc, h } from './format.js';
import { Plot } from './plot.js';

/**
 * Sandbox / training mode: time controls, the god's-eye truth view ("Wahrheitsansicht") on
 * every plot, and helpers to place targets and give them course and speed. The server only
 * sends any of this in sandbox matches; the panel stays hidden otherwise.
 */

export const truth = { on: false, view: undefined as TruthView | undefined, at: 0, scale: 3 };

const TEAM_COL: Record<string, string> = { west: '#85b7eb', east: '#f09595', neutral: '#9aa7a3' };
const SPAWN: ClassId[] = ['merchant', 'fischer', 'tanker', 'container', 'ssk', 'ssn', 'ssc', 'ssa', 'ffg', 'kor', 'ffv'];

/** Draw the true picture over a plot (after the plot's own drawing). */
function drawTruth(plot: Plot): void {
  const v = truth.view;
  if (!truth.on || !v || performance.now() - truth.at > 4000) return;
  const canvas = plot.el.querySelector('canvas');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  // Extrapolate the twice-a-second picture along each unit's course
  const dt = ((performance.now() - truth.at) / 1000) * truth.scale;
  ctx.save();
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1.5;
  for (const s of v.ships) {
    const d = headingVec(s.heading);
    const p = plot.toScreen({ x: s.x + d.x * s.speedKn * 0.514444 * dt, y: s.y + d.y * s.speedKn * 0.514444 * dt });
    const col = s.alive ? TEAM_COL[s.team] ?? '#ccc' : '#555';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x + 7, p.y); ctx.lineTo(p.x, p.y + 7); ctx.lineTo(p.x - 7, p.y); ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + d.x * (6 + s.speedKn), p.y - d.y * (6 + s.speedKn));
    ctx.stroke();
    ctx.fillText(`${s.name}${CLASSES[s.cls].submarine ? ` ${s.depth} M` : ''}`, p.x + 9, p.y - 6);
  }
  ctx.fillStyle = '#ffd34d';
  for (const t of v.torpedoes) {
    const p = plot.toScreen(t);
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.fillStyle = 'rgba(255,211,77,0.9)';
  ctx.fillText('WAHRHEITSANSICHT · SANDKASTEN', 8, 14);
  ctx.restore();
}

// Every plot (operations center, fire control, weapons) gets the overlay after its own frame
const plotDraw = Plot.prototype.draw;
Plot.prototype.draw = function (this: Plot, height: number) {
  plotDraw.call(this, height);
  drawTruth(this);
};

/** Mount the sandbox panel into the station area. */
export function mountSandbox(parent: HTMLElement): { dispose(): void } {
  truth.on = false;
  truth.view = undefined;
  const el = h(`<div class="panel sandbox-panel" style="display:none">
    <div class="hd"><span>Sandkasten</span><button id="sb-min" title="Ein-/ausklappen">–</button></div>
    <div id="sb-body">
      <div class="steps" id="sb-speed">${[0, 1, 2, 5, 10].map((n) => `<button data-sc="${n}" title="${n ? `Zeitraffer ${n}×` : 'Pause'}">${n ? `${n}×` : '⏸'}</button>`).join('')}</div>
      <div class="steps"><button id="sb-truth" title="Alle Einheiten an ihrer wahren Position zeigen">Wahrheitsansicht</button></div>
      <div class="dim" style="margin-top:4px">ZIEL SETZEN (VOM EIGENEN SCHIFF)</div>
      <div class="sb-grid">
        <select id="sb-cls">${SPAWN.map((c) => `<option value="${c}">${esc(CLASS_LABEL[c])}</option>`).join('')}</select>
        <label>PEIL. <input id="sb-brg" type="number" min="0" max="359" value="45"></label>
        <label>KM <input id="sb-rng" type="number" min="0.5" max="40" step="0.5" value="6"></label>
        <label>KURS <input id="sb-crs" type="number" min="0" max="359" value="270"></label>
        <label>KN <input id="sb-kn" type="number" min="0" max="30" value="8"></label>
        <label>TIEFE <input id="sb-dep" type="number" min="18" max="400" value="80"></label>
      </div>
      <div class="steps"><button id="sb-spawn" class="on">Ziel setzen</button></div>
      <div class="dim" style="margin-top:4px">EINHEIT STEUERN</div>
      <select id="sb-unit" style="width:100%"><option value="">WAHRHEITSANSICHT EINSCHALTEN</option></select>
      <div class="sb-grid">
        <label>KURS <input id="sb-ucrs" type="number" min="0" max="359" value="0"></label>
        <label>KN <input id="sb-ukn" type="number" min="0" max="30" value="6"></label>
        <label>TIEFE <input id="sb-udep" type="number" min="18" max="400" value="80"></label>
      </div>
      <div class="steps"><button id="sb-steer">Befehl geben</button><button id="sb-del" title="Ziel aus dem Sandkasten nehmen">Entfernen</button></div>
    </div></div>`);
  parent.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const num = (id: string) => Number(q<HTMLInputElement>(id).value);
  // Typing into the fields must not steer the own ship (station shortcuts)
  el.addEventListener('keydown', (e) => e.stopPropagation());
  q('#sb-min').onclick = () => {
    const b = q('#sb-body');
    b.style.display = b.style.display === 'none' ? '' : 'none';
  };
  el.querySelectorAll<HTMLButtonElement>('[data-sc]').forEach((b) => (b.onclick = () => net.send({ t: 'sandbox', op: 'speed', scale: Number(b.dataset.sc) })));
  q('#sb-truth').onclick = () => {
    truth.on = !truth.on;
    q('#sb-truth').classList.toggle('on', truth.on);
    net.send({ t: 'sandbox', op: 'truth', on: truth.on });
  };
  q('#sb-spawn').onclick = () => net.send({
    t: 'sandbox', op: 'spawn', cls: q<HTMLSelectElement>('#sb-cls').value as ClassId, bearing: num('#sb-brg') % 360, range: num('#sb-rng') * 1000,
    heading: num('#sb-crs') % 360, speedKn: num('#sb-kn'), depth: num('#sb-dep'),
  });
  const unit = () => q<HTMLSelectElement>('#sb-unit').value;
  q('#sb-steer').onclick = () => unit() && net.send({ t: 'sandbox', op: 'steer', id: unit(), heading: num('#sb-ucrs') % 360, speedKn: num('#sb-ukn'), depth: num('#sb-udep') });
  q('#sb-del').onclick = () => unit() && net.send({ t: 'sandbox', op: 'remove', id: unit() });

  let units = '';
  const off = net.on((m: ServerMsg) => {
    if (m.t !== 'sandbox') return;
    el.style.display = '';
    truth.scale = m.scale;
    el.querySelectorAll<HTMLButtonElement>('[data-sc]').forEach((b) => b.classList.toggle('on', Number(b.dataset.sc) === m.scale));
    if (!m.truth) return;
    truth.view = m.truth;
    truth.at = performance.now();
    const list = m.truth.ships.filter((s) => s.alive && (!s.id.startsWith('p_') || s.id.startsWith('p_bot-')) && !(s.cls === 'merchant' && s.team !== 'neutral'));
    const key = list.map((s) => s.id).join();
    const sel = q<HTMLSelectElement>('#sb-unit');
    if (key !== units && document.activeElement !== sel) {
      units = key;
      const cur = sel.value;
      sel.innerHTML = list.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(CLASS_LABEL[s.cls])} · ${deg3(s.heading)}° ${Math.round(s.speedKn)} KN</option>`).join('');
      if (list.some((s) => s.id === cur)) sel.value = cur;
    }
  });
  return {
    dispose() {
      off();
      el.remove();
      truth.on = false;
      truth.view = undefined;
    },
  };
}
