import { CLASSES, NM, type Snapshot } from '@tk/shared';
import { store } from '../store.js';
import { trueDeg } from '../north.js';
import { COL, fitCanvas, h } from './format.js';
import { simNow } from './smooth.js';

/** Speed of sound for the display (m/s); the ring shows the two-way travel, so it runs at half. */
const C_WATER = 1500;
const H = 260;

interface Echo { b: number; r: number; ping: number; label: string }

/**
 * Active sonar screen (PPI, north up): after each ping a ring runs out from the own ship at
 * half the speed of sound (the echo has to come back), reverberation crackles close in and
 * dies away, and every return lights up at its bearing and range as the ring passes it, then
 * fades until the next ping. Shown while the active sonar is on or a ping is still ringing.
 */
export function activeScope(): { el: HTMLElement; frame(): void } {
  const el = h(`<div class="panel" style="display:none"><div class="hd"><span>Aktivsonar · <span id="as-rng"></span></span><span id="as-st" class="dim"></span></div><canvas id="as-ppi"></canvas></div>`);
  const canvas = el.querySelector<HTMLCanvasElement>('#as-ppi')!;
  const st = el.querySelector<HTMLElement>('#as-st')!;
  const echoes: Echo[] = [];
  let lastPing = -1;

  const collect = (s: Snapshot) => {
    const ping = s.own.lastPingAt;
    if (ping === undefined) return;
    if (ping !== lastPing) lastPing = ping;
    for (const c of s.contacts) {
      if (c.via !== 'own' || !c.sensors.includes('active') || c.range === undefined || c.lastSeen < ping - 0.5) continue;
      if (echoes.some((e) => e.ping === ping && e.label === c.label)) continue;
      echoes.push({ b: trueDeg(c.bearing), r: c.range, ping, label: c.label });
    }
    // Keep the returns of the last three pings
    const pings = [...new Set(echoes.map((e) => e.ping))].sort((a, b) => b - a).slice(0, 3);
    for (let i = echoes.length - 1; i >= 0; i--) if (!pings.includes(echoes[i]!.ping)) echoes.splice(i, 1);
  };

  return {
    el,
    frame() {
      const s = store.snap;
      const now = simNow();
      const ringing = s?.own.lastPingAt !== undefined && now - s.own.lastPingAt < 60;
      const shown = !!s && (s.own.activeSonar || ringing);
      el.style.display = shown ? '' : 'none';
      if (!s || !shown) return;
      collect(s);
      const sub = CLASSES[s.own.cls].submarine;
      const rangeM = (sub ? 6 : 10) * NM;
      el.querySelector('#as-rng')!.textContent = `${rangeM / NM} SM · ${s.own.pulse === 'lfm' ? 'LFM' : 'CW'}`;
      const since = s.own.lastPingAt !== undefined ? now - s.own.lastPingAt : Infinity;
      st.className = s.own.activeSonar ? 'amber' : 'dim';
      st.textContent = s.own.activeSonar ? `PING VOR ${Number.isFinite(since) ? Math.round(since) : '—'} S · VERRÄT DICH` : 'AUS · NACHHALL';

      const ctx = fitCanvas(canvas, H);
      const w = canvas.clientWidth;
      const cx = w / 2, cy = H / 2, R = H / 2 - 14;
      const k = R / rangeM;
      ctx.fillStyle = '#020605';
      ctx.fillRect(0, 0, w, H);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      // Rings and bearing marks
      ctx.strokeStyle = 'rgba(93,202,165,0.18)';
      for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2); ctx.stroke(); }
      const ringR = Number.isFinite(since) ? (since * C_WATER) / 2 : Infinity;
      // Reverberation: speckle behind the ring, dense close in, dying with range and time
      if (ringR < rangeM * 1.2) {
        const shallow = s.env.bottom !== undefined && s.env.bottom < 300;
        const n = shallow ? 260 : 140;
        for (let i = 0; i < n; i++) {
          const r = Math.pow(Math.random(), 1.8) * Math.min(ringR, rangeM);
          const a = Math.random() * Math.PI * 2;
          const fade = Math.exp(-r / (shallow ? 5000 : 2500)) * Math.exp(-since / 20);
          ctx.fillStyle = `rgba(110,220,180,${(0.15 + Math.random() * 0.5) * fade})`;
          ctx.fillRect(cx + Math.sin(a) * r * k, cy - Math.cos(a) * r * k, 1.5, 1.5);
        }
        // The outgoing ring
        ctx.strokeStyle = `rgba(160,245,210,${Math.max(0.1, 0.7 - since / 30)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, Math.min(ringR, rangeM) * k, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
      // Returns: appear as the ring passes them, fade with age; older pings fainter
      for (const e of echoes) {
        const age = now - e.ping;
        const reached = age * C_WATER / 2 >= e.r;
        if (!reached || e.r > rangeM) continue;
        const latest = e.ping === s.own.lastPingAt;
        const alpha = (latest ? 1 : 0.35) * Math.max(0.15, 1 - (age - (2 * e.r) / C_WATER) / 40);
        const rad = (e.b * Math.PI) / 180;
        const x = cx + Math.sin(rad) * e.r * k, y = cy - Math.cos(rad) * e.r * k;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, `rgba(230,255,240,${alpha})`);
        g.addColorStop(1, 'rgba(93,202,165,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
        if (latest) {
          ctx.fillStyle = e.label === store.selected ? COL.amber : COL.g2;
          ctx.font = '10px ui-monospace, monospace';
          ctx.fillText(e.label, x + 8, y - 6);
        }
      }
      ctx.restore();
      // Bezel: north up, own heading
      ctx.strokeStyle = 'rgba(93,202,165,0.5)';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = COL.g;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N', cx, cy - R - 3);
      const hd = (trueDeg(s.own.heading) * Math.PI) / 180;
      ctx.strokeStyle = COL.blue;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(hd) * 18, cy - Math.cos(hd) * 18); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = COL.dim;
      ctx.fillText(`${(rangeM / NM / 3).toFixed(0)} SM / RING`, 6, H - 6);
    },
  };
}
