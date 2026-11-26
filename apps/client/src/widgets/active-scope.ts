import { DEFAULT_PING_RANGE, PING_RANGES, pingInterval, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { trueDeg } from '../north.js';
import { btnState } from './btn-state.js';
import { COL, deg3, esc, fitCanvas, FONT, h, km, setHtml } from './format.js';
import { simNow } from './smooth.js';
import { keycap } from './keys.js';

/** Speed of sound for the display (m/s); the ring shows the two-way travel, so it runs at half. */
const C_WATER = 1500;
/** Range scales (m): each sets the ping interval on the server (4 / 8 / 16 km → 6 / 11 / 22 s). */
const RANGES_M = PING_RANGES;

interface Echo { b: number; r: number; ping: number; label: string; doppler?: number }
/** Pings kept for the range-time strip under the PPI (F26). */
const HISTORY_PINGS = 12;
/** Below the round PPI, at least this much free height (px) gets the range-time strip. */
const STRIP_MIN_H = 90;

/**
 * Active sonar console (PPI, north up). After each ping a ring runs out from the own ship at
 * half the speed of sound (the echo has to come back); reverberation crackles close in and
 * dies away (more in shallow water); every return lights up at its bearing and range when the
 * ring reaches it and fades until the next ping, earlier pings as afterglow. CW returns are
 * coloured by Doppler (amber closing, blue opening). Beside it: single ping, continuous
 * pinging, CW/LFM, the range scale (which sets the ping interval), the countdown to the next
 * ping and a table of the returns. A boat sends one ping by default; continuous is a toggle.
 */
export function activeScope(opts: { height?: number | (() => number); compact?: boolean; pingKey?: boolean } = {}): { el: HTMLElement; frame(): void; snap(): void } {
  const compact = !!opts.compact;
  const el = h(`<div class="panel">
    <div class="hd"><span>Aktivsonar</span><span id="as-st" class="dim"></span></div>
    <div class="as-bar">
      <span class="seg"><button id="as-one" class="warn" title="Ein einzelner Ping: Entfernung und Peilung, verrät aber das eigene Schiff weit hinaus">Einzelping${opts.pingKey ? keycap('ping') : ''}</button><button id="as-ping" title="Dauerpingen im Takt des Messbereichs: jeder hört dich weit hinaus">Dauer</button></span>
      <span class="seg"><button data-pulse="cw" title="CW: grobe Entfernung, misst die Annäherung (Doppler)">CW</button><button data-pulse="lfm" title="LFM: genaue Entfernung, findet auch langsame Ziele im Nachhall">LFM</button></span>
      <span class="seg as-range" title="Messbereich">${RANGES_M.map((r) => `<button data-asr="${r}" title="Messbereich ${r / 1000} km: Echos von weiter draußen kommen zu spät · ein Ping alle ${pingInterval({ pingRange: r })} s">${r / 1000} KM</button>`).join('')}</span>
    </div>
    <canvas id="as-ppi"></canvas>
    ${compact ? '' : '<div id="as-echoes" style="margin-top:6px"></div>'}
  </div>`);
  const canvas = el.querySelector<HTMLCanvasElement>('#as-ppi')!;
  const st = el.querySelector<HTMLElement>('#as-st')!;
  const echoes: Echo[] = [];
  /** The last HISTORY_PINGS pings' returns, for the range-time strip. */
  const history: Echo[] = [];
  const pingTimes: number[] = [];
  el.querySelector<HTMLButtonElement>('#as-one')!.onclick = () => net.send({ t: 'ping', single: true });
  el.querySelector<HTMLButtonElement>('#as-ping')!.onclick = () => net.send({ t: 'toggle', what: 'active', on: !store.snap?.own.activeSonar });
  el.querySelectorAll<HTMLButtonElement>('[data-pulse]').forEach((b) => (b.onclick = () => net.send({ t: 'pulse', pulse: b.dataset.pulse as 'cw' | 'lfm' })));
  // The range scale is the sonar's (server side): it sets how long the receiver listens, so the ping interval
  el.querySelectorAll<HTMLButtonElement>('[data-asr]').forEach((b) => (b.onclick = () => net.send({ t: 'ping', range: Number(b.dataset.asr) as (typeof RANGES_M)[number] })));

  const collect = (s: Snapshot) => {
    const ping = s.own.lastPingAt;
    if (ping === undefined) return;
    for (const c of s.contacts) {
      if (c.via !== 'own' || !c.sensors.includes('active') || c.range === undefined || c.lastSeen < ping - 0.5) continue;
      if (echoes.some((e) => e.ping === ping && e.label === c.label)) continue;
      const e = { b: trueDeg(c.bearing), r: c.range, ping, label: c.label, doppler: c.dopplerKn };
      echoes.push(e);
      history.push(e);
    }
    if (!pingTimes.includes(ping)) {
      pingTimes.unshift(ping);
      pingTimes.length = Math.min(pingTimes.length, HISTORY_PINGS);
    }
    for (let i = history.length - 1; i >= 0; i--) if (!pingTimes.includes(history[i]!.ping)) history.splice(i, 1);
    const pings = [...new Set(echoes.map((e) => e.ping))].sort((a, b) => b - a).slice(0, 3);
    for (let i = echoes.length - 1; i >= 0; i--) if (!pings.includes(echoes[i]!.ping)) echoes.splice(i, 1);
  };

  const rangeM = (s: Snapshot) => s.own.pingRange ?? DEFAULT_PING_RANGE;

  /**
   * Range-time strip (F26): one row per ping, newest on top, range across. A closing ship's
   * returns walk left from row to row, an opening one's right; the selected contact in amber.
   */
  const drawStrip = (ctx: CanvasRenderingContext2D, s: Snapshot, y0: number, h: number, w: number, rM: number, now: number) => {
    const x0 = 44, x1 = w - 10;
    const top = y0 + 14;
    // Rows end above the range figures, which end above the scope's captions at the foot
    const rowH = Math.max(4, (h - 30) / HISTORY_PINGS);
    ctx.save();
    ctx.fillStyle = 'rgba(93,202,165,0.04)';
    ctx.fillRect(x0, top, x1 - x0, rowH * HISTORY_PINGS);
    ctx.font = FONT.tick;
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'left';
    ctx.fillText('PING-VERLAUF · ENTFERNUNG →', x0, y0 + 9);
    // Ring ranges as vertical lines with their labels underneath
    ctx.strokeStyle = 'rgba(93,202,165,0.18)';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const x = x0 + ((x1 - x0) * i) / 4;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + rowH * HISTORY_PINGS); ctx.stroke();
      if (i > 0) ctx.fillText(`${((rM * i) / 4000).toLocaleString('de-DE')}${i === 4 ? ' KM' : ''}`, i === 4 ? x1 - 14 : x, top + rowH * HISTORY_PINGS + 11);
    }
    ctx.textAlign = 'right';
    pingTimes.forEach((p, row) => {
      const y = top + row * rowH;
      if (row % 3 === 0) {
        ctx.fillStyle = COL.dim;
        ctx.fillText(`−${Math.max(0, Math.round(now - p))} S`, x0 - 4, y + Math.min(rowH, 10));
      }
      for (const e of history) {
        if (e.ping !== p || e.r > rM) continue;
        // The newest ping's returns appear as the ring reaches them, like on the PPI
        if (row === 0 && ((now - p) * C_WATER) / 2 < e.r) continue;
        const x = x0 + (e.r / rM) * (x1 - x0);
        const sel = e.label === store.selected;
        ctx.fillStyle = sel ? COL.amber : e.doppler !== undefined && Math.abs(e.doppler) >= 1 && s.own.pulse === 'cw' ? (e.doppler > 0 ? COL.amber : COL.blue) : COL.g;
        ctx.globalAlpha = row === 0 ? 1 : Math.max(0.3, 1 - row / HISTORY_PINGS);
        ctx.fillRect(x - 2, y + 1, 4, Math.max(2, rowH - 2));
        ctx.globalAlpha = 1;
        if (row === 0) {
          ctx.textAlign = 'left';
          ctx.fillText(e.label, Math.min(x + 5, x1 - 24), y + Math.min(rowH, 10));
          ctx.textAlign = 'right';
        }
      }
    });
    if (!pingTimes.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = COL.dim;
      ctx.fillText('NOCH KEIN PING', (x0 + x1) / 2, top + (rowH * HISTORY_PINGS) / 2);
    }
    ctx.restore();
  };

  return {
    el,
    snap() {
      const s = store.snap;
      if (!s) return;
      collect(s);
      const o = s.own;
      const since = o.lastPingAt !== undefined ? s.time - o.lastPingAt : undefined;
      const every = o.pingEvery ?? pingInterval({ pingRange: o.pingRange });
      const left = since !== undefined ? Math.max(0, Math.ceil(every - since)) : 0;
      btnState(el.querySelector<HTMLElement>('#as-ping'), o.activeSonar
        ? { on: true, label: since !== undefined ? `NÄCHSTER IN ${left} S` : 'AN', tone: 'warn' } : { on: false });
      // A single ping waits until the last one's echoes are back (the interval of the scale)
      btnState(el.querySelector<HTMLElement>('#as-one'), o.pingPending ? { label: left > 0 ? `IN ${left} S` : '…', tone: 'busy' } : {});
      el.querySelectorAll<HTMLButtonElement>('[data-pulse]').forEach((b) => b.classList.toggle('on', b.dataset.pulse === o.pulse));
      const rM = rangeM(s);
      el.querySelectorAll<HTMLButtonElement>('[data-asr]').forEach((b) => b.classList.toggle('on', Number(b.dataset.asr) === rM));
      st.className = o.activeSonar || o.pingPending ? 'amber' : 'dim';
      st.textContent = o.activeSonar ? `SENDET ALLE ${every} S · JEDER HÖRT DICH WEIT HINAUS` : o.pingPending ? 'EINZELPING · GEHT RAUS'
        : since !== undefined && since < 60 ? 'AUS · NACHHALL' : 'AUS · NUR HORCHEN';
      if (compact) return;
      const last = echoes.filter((e) => e.ping === o.lastPingAt).sort((a, b) => a.r - b.r);
      setHtml(el.querySelector('#as-echoes')!, last.length
        ? `<div class="row dim"><span>ECHO</span><span>PEILUNG</span><span>ENTF.</span><span>DOPPLER</span></div>` + last.map((e) => {
          const dop = e.doppler === undefined || o.pulse === 'lfm' ? '—' : Math.abs(e.doppler) < 1 ? 'STEHT' : e.doppler > 0 ? `↓ ${e.doppler.toFixed(0)} KN NÄHERT` : `↑ ${(-e.doppler).toFixed(0)} KN ENTFERNT`;
          return `<div class="row clickable ${e.label === store.selected ? 'amber selrow' : ''}" data-c="${esc(e.label)}"><span>${esc(e.label)}</span><span>${deg3(e.b)}°</span><span>${km(e.r)}</span><span>${dop}</span></div>`;
        }).join('')
        : `<div class="dim">${o.activeSonar || (since !== undefined && since < every * 2) ? 'NOCH KEIN ECHO IM LETZTEN PING' : 'AKTIVSONAR AUS – EINZELPING FÜR EINE ENTFERNUNG'}</div>`);
      el.querySelectorAll<HTMLElement>('#as-echoes [data-c]').forEach((r) => (r.onclick = () => (store.selected = r.dataset.c)));
    },
    frame() {
      const s = store.snap;
      if (!s) return;
      const now = simNow();
      const o = s.own;
      const H = (typeof opts.height === 'function' ? opts.height() : opts.height) ?? 300;
      const ctx = fitCanvas(canvas, H);
      const w = canvas.clientWidth;
      // The bearing labels stand up to 27 px outside the ring: keep them inside the narrower side, clear of the captions at the foot.
      // F26: a pane taller than wide puts the PPI in the top square and a range-time strip of the last pings below it
      const sq = Math.min(w, H - 14);
      const stripH = H - 14 - sq >= STRIP_MIN_H ? H - 14 - sq : 0;
      const cx = w / 2, cy = sq / 2, R = Math.max(40, sq / 2 - 28);
      const rM = rangeM(s);
      const k = R / rM;
      ctx.fillStyle = '#020605';
      ctx.fillRect(0, 0, w, H);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      // Stern dead angle: the own hull and screw mask about ±30° astern
      const stern = ((trueDeg(o.heading) + 180) * Math.PI) / 180;
      ctx.fillStyle = 'rgba(93,202,165,0.06)';
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, stern - Math.PI / 2 - 0.52, stern - Math.PI / 2 + 0.52); ctx.closePath(); ctx.fill();
      // Range rings
      ctx.strokeStyle = 'rgba(93,202,165,0.2)';
      for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2); ctx.stroke(); }
      const since = o.lastPingAt !== undefined ? now - o.lastPingAt : Infinity;
      const ringR = Number.isFinite(since) ? (since * C_WATER) / 2 : Infinity;
      // Reverberation behind the ring: dense close in, dying with range and time; more in shallow water
      if (ringR < rM * 1.3) {
        const shallow = s.env.bottom !== undefined && s.env.bottom < 300;
        const n = shallow ? 320 : 160;
        for (let i = 0; i < n; i++) {
          const r = Math.pow(Math.random(), 1.8) * Math.min(ringR, rM);
          const a = Math.random() * Math.PI * 2;
          const fade = Math.exp(-r / (shallow ? 5000 : 2500)) * Math.exp(-since / 20);
          ctx.fillStyle = `rgba(110,220,180,${(0.15 + Math.random() * 0.5) * fade})`;
          ctx.fillRect(cx + Math.sin(a) * r * k, cy - Math.cos(a) * r * k, 1.5, 1.5);
        }
        ctx.strokeStyle = `rgba(160,245,210,${Math.max(0.12, 0.75 - since / 30)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, Math.min(ringR, rM) * k, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
      // Returns: appear as the ring passes, fade with age; older pings fainter; CW coloured by Doppler
      ctx.font = FONT.label;
      for (const e of echoes) {
        const age = now - e.ping;
        if (age * C_WATER / 2 < e.r || e.r > rM) continue;
        const latest = e.ping === o.lastPingAt;
        const alpha = (latest ? 1 : 0.35) * Math.max(0.15, 1 - (age - (2 * e.r) / C_WATER) / 40);
        const rad = (e.b * Math.PI) / 180;
        const x = cx + Math.sin(rad) * e.r * k, y = cy - Math.cos(rad) * e.r * k;
        const col = o.pulse === 'cw' && e.doppler !== undefined && Math.abs(e.doppler) >= 1 ? (e.doppler > 0 ? '250,199,117' : '133,183,235') : '230,255,240';
        const g = ctx.createRadialGradient(x, y, 0, x, y, 8);
        g.addColorStop(0, `rgba(${col},${alpha})`);
        g.addColorStop(1, 'rgba(93,202,165,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        // A return smears along the beam: a short arc at its range
        ctx.strokeStyle = `rgba(${col},${alpha * 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, e.r * k, rad - Math.PI / 2 - 0.03, rad - Math.PI / 2 + 0.03); ctx.stroke();
        ctx.lineWidth = 1;
        if (latest) {
          ctx.fillStyle = e.label === store.selected ? COL.amber : COL.g2;
          ctx.fillText(e.label, x + 9, y - 6);
        }
      }
      ctx.restore();
      // Bezel: degree marks, north up, own heading line, ring labels
      ctx.font = FONT.tick;
      ctx.strokeStyle = 'rgba(93,202,165,0.55)';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = COL.g;
      ctx.textAlign = 'center';
      for (let d = 0; d < 360; d += 10) {
        const a = (d * Math.PI) / 180;
        const len = d % 30 === 0 ? 6 : 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
        ctx.lineTo(cx + Math.sin(a) * (R + len), cy - Math.cos(a) * (R + len));
        ctx.stroke();
        // Labels beside the scale stand further out (they are wider than tall), clear of the 30° ticks
        const off = R + 11 + Math.abs(Math.sin(a)) * 6;
        if (d % 30 === 0) ctx.fillText(d === 0 ? 'N' : deg3(d), cx + Math.sin(a) * off, cy - Math.cos(a) * off + 3);
      }
      const hd = (trueDeg(o.heading) * Math.PI) / 180;
      ctx.strokeStyle = COL.blue;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(hd) * R * 0.25, cy - Math.cos(hd) * R * 0.25); ctx.stroke();
      if (stripH) drawStrip(ctx, s, sq + 4, stripH - 8, w, rM, now);
      // Captions in the console's monospace (after restore() the font was the canvas default)
      ctx.font = FONT.tick;
      ctx.textAlign = 'left';
      ctx.fillStyle = COL.dim;
      ctx.fillText(`RING ${(rM / 4000).toLocaleString('de-DE')} KM`, 6, H - 6);
      if (o.pulse === 'cw') {
        ctx.textAlign = 'right';
        ctx.fillText('AMBER NÄHERT · BLAU ENTFERNT', w - 6, H - 6);
      }
    },
  };
}
