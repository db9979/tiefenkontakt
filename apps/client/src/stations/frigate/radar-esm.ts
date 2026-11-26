import { NM, esmReach, headingVec } from '@tk/shared';
import { net } from '../../net.js';
import { btnState } from '../../widgets/btn-state.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { FONT, fitCanvas, h, setHtml } from '../../widgets/format.js';
import { fillBox } from '../../widgets/fill.js';
import { RadarScope, SCOPE, esmStrobeRgb } from '../../widgets/radar-scope.js';
import { fromNorthUp, trueDeg } from '../../north.js';
import { airDefPanel, samAction } from '../../widgets/airdef-panel.js';
import { openMenu } from '../../widgets/menu.js';
import { esmRow, esmTone } from '../../widgets/esm-text.js';

const RPM = 24;
// 48 SM: air search – aircraft at height show far beyond the surface horizon
const RANGES = [3, 6, 12, 24, 48] as const;
/** How far a boat's radar warner on its mast (3 m) hears this radar (20 m): a little past the radio horizon (sensors.ts). */
const ESM_HEARS_NM = Math.round(esmReach(3, 20) / NM);

/** Radar room: phosphor PPI with range scales, radar status and an ESM bearing rose. */
export function radarEsmStation(): Station {
  // The PPI fills the left column; ESM bearings show as strobes on its outer ring (no separate
  // rose). Right: radar status and air defence at their own height, then the ESM list, the one
  // part that scrolls.
  const el = h(`<div class="st two fradar">
    <div class="st-col">
      <div class="panel grow"><div class="hd"><span>Luft-/Seeraumradar · <span id="rng">12</span> SM</span><span id="rs" class="dim"></span></div>
        <div class="fill" id="ppi-box" title="Klick auf ein Echo wählt · Striche am Rand = ESM-Peilungen (rot = Feuerleit- oder Flugzeugradar, gelb = unbekannt oder Funk)"><canvas id="ppi"></canvas></div>
        <div class="foot"><button id="radar" class="primary">Radar</button>
          <span class="seg">${RANGES.map((r) => `<button data-rng="${r}" title="Bereich ${r} SM">${r} SM</button>`).join('')}</span></div>
      </div>
    </div>
    <div class="st-col">
      <div class="panel"><div class="hd"><span>Radarstatus</span><span id="emit" class="dim"></span></div><div id="status"></div></div>
      <div id="airdef"></div>
      <div class="panel grow listpanel"><div class="hd"><span>ESM · Radar- und Funkpeilung</span><span id="esm-n" class="dim"></span></div><div id="esm" class="scroll"></div></div>
    </div>
  </div>`);
  // Air defence sits with the air picture: radar, ESM and the SAM in one place
  const ad = airDefPanel();
  el.querySelector('#airdef')!.replaceWith(ad.el);
  const canvas = el.querySelector<HTMLCanvasElement>('#ppi')!;
  const box = fillBox(el.querySelector<HTMLElement>('#ppi-box')!, 300, 900);
  // The PPI stays a dark tube in the light theme (phosphor on glass, readable in both)
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

  /**
   * ESM strobes on the PPI's outer ring: one line per intercepted emitter at its bearing, from
   * the bezel inwards, newest brightest and pulsing; aircraft radars too.
   */
  function drawStrobes(ctx: CanvasRenderingContext2D): void {
    const s = store.snap;
    if (!s) return;
    const cx = geo.ox + SCOPE.C * geo.k;
    const cy = geo.oy + SCOPE.C * geo.k;
    const r = SCOPE.R * geo.k;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.font = FONT.label;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const strobe = (brg: number, age: number, label: string, emitter: string | undefined) => {
      const a = ((trueDeg(brg) - 90) * Math.PI) / 180;
      const fresh = age < 20;
      const rgb = esmStrobeRgb(emitter);
      ctx.strokeStyle = `rgba(${rgb},${fresh ? 0.6 + 0.4 * Math.sin(t * 6) : Math.max(0.15, 0.8 - age / 700)})`;
      ctx.lineWidth = fresh ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fillText(label, cx + Math.cos(a) * r * 0.79, cy + Math.sin(a) * r * 0.79);
    };
    for (const c of s.contacts) {
      if (!c.sensors.includes('esm')) continue;
      const age = s.time - c.lastSeen;
      if (age <= 600) strobe(c.bearing, age, c.label, c.emitter);
    }
    for (const p of s.planes ?? []) if (p.via.includes('esm')) strobe(p.bearing, 0, '✈', p.emitter);
    ctx.restore();
  }

  return {
    id: 'radar',
    title: 'Radar/ESM',
    el,
    snap() {
      const s = store.snap!;
      ad.update();
      const on = s.own.radarOn;
      btnState(el.querySelector<HTMLElement>('#radar'), { on, tone: on ? 'warn' : undefined });
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
        <div class="dim" style="margin-top:6px;line-height:1.5">${on ? `RADARWARNER DER U-BOOTE HÖREN UNS BIS ${ESM_HEARS_NM} SM. SCHNORCHEL UND SEHROHRE ZEIGT DAS RADAR NUR AUF KURZE DISTANZ.` : 'OHNE RADAR BLEIBT DIE FREGATTE STILL. KURZ EINSCHALTEN, LAGE AUFNEHMEN, WIEDER AUS.'}</div>`);
      const esm = s.contacts.filter((c) => c.sensors.includes('esm')).sort((a, b) => b.lastSeen - a.lastSeen);
      const airEsm = (s.planes ?? []).filter((p) => p.via.includes('esm'));
      const airRows = airEsm.map((p) => esmRow('✈', p.bearing, 'JETZT', p.emitter, p.esmLvl, p.esmTrend, esmTone(p.emitter))).join('');
      // Only the count in the header (the list says when all is quiet): the title keeps its room
      el.querySelector('#esm-n')!.textContent = esm.length + airEsm.length ? String(esm.length + airEsm.length) : '';
      setHtml(el.querySelector('#esm')!, airRows + (esm.length
        ? esm.map((c) => {
          const fresh = s.time - c.lastSeen < 60;
          return esmRow(c.label, c.bearing, `VOR ${Math.round(s.time - c.lastSeen)} S`, c.emitter, fresh ? c.esmLvl : undefined, fresh ? c.esmTrend : undefined, fresh ? esmTone(c.emitter) : 'dim');
        }).join('')
        : airRows ? '' : '<div class="dim">KEINE FUNKPEILUNGEN · ALLES STILL</div>'));
    },
    frame() {
      const s = store.snap;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      scope.update(s, dt, RPM, rangeNm * NM);
      const H = box.h;
      const ctx = fitCanvas(canvas, H);
      geo = scope.draw(ctx, canvas.clientWidth, H, s, rangeNm, store.selected);
      drawStrobes(ctx);
    },
    dispose() {
      box.dispose();
    },
  };
}
