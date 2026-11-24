import { NM, angleDiff, headingVec } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { esc, fitCanvas, h, setHtml, tdeg3 } from '../../widgets/format.js';
import { RadarScope, SCOPE } from '../../widgets/radar-scope.js';
import { fromNorthUp, trueDeg } from '../../north.js';
import { onTap } from '../../widgets/touch.js';
import { samAction } from '../../widgets/airdef-panel.js';
import { openMenu } from '../../widgets/menu.js';

const RPM = 24;
// 48 SM: air search – aircraft at height show far beyond the surface horizon
const RANGES = [3, 6, 12, 24, 48] as const;
/** How far an enemy ESM receiver hears this radar (sensors.ts ESM_RANGE). */
const ESM_HEARS_NM = 40;

/** Radar room: phosphor PPI with range scales, radar status and an ESM bearing rose. */
export function radarEsmStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Luft-/Seeraumradar · <span id="rng">12</span> SM</span><span id="rs" class="dim"></span></div><canvas id="ppi"></canvas>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">
        <button id="radar">Radar</button>
        ${RANGES.map((r) => `<button data-rng="${r}" title="Bereich ${r} SM">${r} SM</button>`).join('')}
        <span class="dim">KLICK AUF ECHO WÄHLT</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Radarstatus</span><span id="emit" class="dim"></span></div><div id="status"></div></div>
      <div class="panel"><div class="hd"><span>ESM · Funkpeilung</span><span class="dim">ROSE UND LISTE</span></div>
        <canvas id="rose" style="display:block;margin:0 auto"></canvas><div id="esm"></div></div>
      <div class="panel"><div class="hd"><span>Radarspuren</span></div><div id="tracks"></div></div>
    </div>
  </div>`);
  const canvas = el.querySelector<HTMLCanvasElement>('#ppi')!;
  const rose = el.querySelector<HTMLCanvasElement>('#rose')!;
  const scope = new RadarScope();
  let rangeNm: number = Number(localStorage.getItem('tk_radar_rng')) || 12;
  let last = performance.now();
  let geo = { ox: 0, oy: 0, k: 1 };
  const setRange = (r: number) => {
    rangeNm = r;
    localStorage.setItem('tk_radar_rng', String(r));
    el.querySelector('#rng')!.textContent = String(r);
    el.querySelectorAll<HTMLButtonElement>('[data-rng]').forEach((b) => b.classList.toggle('on', Number(b.dataset.rng) === r));
  };
  setRange(rangeNm);
  el.querySelectorAll<HTMLButtonElement>('[data-rng]').forEach((b) => (b.onclick = () => setRange(Number(b.dataset.rng))));
  el.querySelector<HTMLButtonElement>('#radar')!.onclick = () => net.send({ t: 'toggle', what: 'radar', on: !store.snap?.own.radarOn });
  canvas.style.cursor = 'pointer';
  canvas.addEventListener('click', (e) => {
    const s = store.snap;
    if (!s) return;
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left - geo.ox) / geo.k - SCOPE.C;
    const my = SCOPE.C - (e.clientY - r.top - geo.oy) / geo.k;
    let best: string | undefined;
    let bd = 14;
    for (const c of s.contacts) {
      if (!c.sensors.includes('radar') || c.range === undefined) continue;
      const v = headingVec(trueDeg(c.bearing)); // the scope is north-up
      const rr = (c.range / (rangeNm * NM)) * SCOPE.R;
      const d = Math.hypot(v.x * rr - mx, v.y * rr - my);
      if (d < bd) [best, bd] = [c.label, d];
    }
    if (best) store.selected = best;
  });
  // Right-click on an air track: air defence (fire, interceptors)
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const s = store.snap;
    if (!s) return;
    const r = canvas.getBoundingClientRect();
    const k = (rangeNm * NM) / SCOPE.R;
    const d = fromNorthUp(((e.clientX - r.left - geo.ox) / geo.k - SCOPE.C) * k, (SCOPE.C - (e.clientY - r.top - geo.oy) / geo.k) * k);
    const p = { x: s.own.x + d.x, y: s.own.y + d.y };
    const items = samAction(p, 16 * k / geo.k);
    if (items.length) openMenu(e.clientX, e.clientY, items, 'LUFTZIEL');
  });
  const tracksEl = el.querySelector<HTMLElement>('#tracks')!;
  onTap(tracksEl, '[data-c]', (row) => (store.selected = row.dataset.c));

  /** ESM rose: intercepted emitters as strobes around the own ship, newest brightest. */
  function drawRose(): void {
    const s = store.snap;
    const size = 170;
    const ctx = fitCanvas(rose, size);
    const w = rose.clientWidth;
    const cx = w / 2, cy = size / 2, r = size / 2 - 16;
    ctx.fillStyle = '#030807';
    ctx.fillRect(0, 0, w, size);
    ctx.strokeStyle = 'rgba(93,202,165,0.3)';
    for (const f of [0.5, 1]) { ctx.beginPath(); ctx.arc(cx, cy, r * f, 0, 7); ctx.stroke(); }
    ctx.fillStyle = 'rgba(159,230,204,0.7)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [d, l] of [[0, 'N'], [90, 'O'], [180, 'S'], [270, 'W']] as const) {
      const a = ((d - 90) * Math.PI) / 180;
      ctx.fillText(l, cx + Math.cos(a) * (r + 9), cy + Math.sin(a) * (r + 9));
    }
    if (!s) return;
    const hm = ((trueDeg(s.own.heading) - 90) * Math.PI) / 180;
    ctx.strokeStyle = 'rgba(232,195,122,0.7)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(hm) * r * 0.5, cy + Math.sin(hm) * r * 0.5); ctx.stroke();
    const t = performance.now() / 1000;
    for (const c of s.contacts) {
      if (!c.sensors.includes('esm')) continue;
      const age = s.time - c.lastSeen;
      if (age > 600) continue;
      const a = ((trueDeg(c.bearing) - 90) * Math.PI) / 180;
      const fresh = age < 20;
      ctx.strokeStyle = `rgba(240,149,149,${fresh ? 0.6 + 0.4 * Math.sin(t * 6) : Math.max(0.15, 0.8 - age / 700)})`;
      ctx.lineWidth = fresh ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.15, cy + Math.sin(a) * r * 0.15); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#f09595';
      ctx.fillText(c.label, cx + Math.cos(a) * (r - 12) + 10, cy + Math.sin(a) * (r - 12));
    }
  }

  return {
    title: 'Radar/ESM',
    el,
    snap() {
      const s = store.snap!;
      const on = s.own.radarOn;
      el.querySelector('#radar')!.classList.toggle('on', on);
      el.querySelector('#rs')!.textContent = on ? `SENDET · ${RPM} U/MIN` : 'STANDBY';
      const emit = el.querySelector<HTMLElement>('#emit')!;
      emit.textContent = on ? '● ABSTRAHLUNG' : '○ STILL';
      emit.className = on ? 'red blink' : 'dim';
      const radar = s.contacts.filter((c) => c.via === 'own' && c.sensors.includes('radar') && s.time - c.lastSeen < 30);
      const friends = radar.filter((c) => s.friendlies.some((f) => {
        const v = headingVec(c.bearing);
        return Math.hypot(f.x - (s.own.x + v.x * (c.range ?? 0)), f.y - (s.own.y + v.y * (c.range ?? 0))) < 600;
      }));
      setHtml(el.querySelector('#status')!, `
        <div class="row"><span class="dim">SENDER</span><span class="${on ? 'red' : ''}">${on ? 'EIN · SENDET' : 'AUS · STANDBY'}</span></div>
        <div class="row"><span class="dim">BEREICH / ANTENNE</span><span>${rangeNm} SM · ${RPM} U/MIN</span></div>
        <div class="row"><span class="dim">ECHOS</span><span>${radar.length} · DAVON EIGENE ${friends.length}</span></div>
        <div class="row"><span class="dim">SEEGANG-STÖRUNG</span><span>${['GERING', 'GERING', 'MÄSSIG', 'MÄSSIG', 'STARK', 'STARK', 'SEHR STARK'][s.env.seaState] ?? '—'}${s.env.rain ? ' · REGEN' : ''}</span></div>
        <div class="row"><span class="dim">GEGNER-ESM HÖRT UNS</span><span class="${on ? 'amber' : 'dim'}">${on ? `BIS ${ESM_HEARS_NM} SM` : '—'}</span></div>
        <div class="dim" style="margin-top:6px;line-height:1.5">${on ? 'Jede U-Boot-Funkpeilantenne in 40 SM peilt uns jetzt. Schnorchel und Sehrohre zeigt das Radar nur auf kurze Distanz.' : 'Ohne Radar bleibt die Fregatte still. Kurz einschalten, Lage aufnehmen, wieder aus.'}</div>`);
      setHtml(tracksEl, radar.length
        ? radar.map((c) => {
          const fr = friends.includes(c);
          const rel = angleDiff(s.own.heading, c.bearing);
          return `<div class="row clickable ${c.label === store.selected ? 'amber selrow' : fr ? 'dim' : ''}" data-c="${esc(c.label)}"><span>${esc(c.label)}${fr ? ' · EIGEN' : ''}</span><span>${tdeg3(c.bearing)}° ${c.range ? (c.range / NM).toFixed(1) + ' SM' : ''}</span><span class="dim">${rel >= 0 ? 'STB' : 'BB'} ${Math.abs(Math.round(rel))}° · ${s.time - c.lastSeen > 5 ? 'KURZ' : 'SPUR'}</span></div>`;
        }).join('')
        : `<div class="dim">${on ? 'KEINE SPUREN' : 'RADAR AUS · KEINE SPUREN'}</div>`);
      const esm = s.contacts.filter((c) => c.sensors.includes('esm')).sort((a, b) => b.lastSeen - a.lastSeen);
      const airEsm = (s.planes ?? []).filter((p) => p.via.includes('esm'));
      const airRows = airEsm.map((p) => `<div class="row red"><span>✈ FLUGZEUGRADAR</span><span>${tdeg3(p.bearing)}°</span><span class="dim">JETZT</span></div>`).join('');
      setHtml(el.querySelector('#esm')!, airRows + (esm.length
        ? esm.map((c) => `<div class="row ${s.time - c.lastSeen < 60 ? 'red' : 'dim'}"><span>${esc(c.label)}</span><span>${tdeg3(c.bearing)}°</span><span class="dim">VOR ${Math.round(s.time - c.lastSeen)} S</span></div>`).join('')
        : airRows ? '' : '<div class="dim">KEINE FUNKPEILUNGEN · ALLES STILL</div>'));
    },
    frame() {
      const s = store.snap;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      scope.update(s, dt, RPM, rangeNm * NM);
      const H = 540;
      const ctx = fitCanvas(canvas, H);
      geo = scope.draw(ctx, canvas.clientWidth, H, s, rangeNm, store.selected);
      drawRose();
    },
  };
}
