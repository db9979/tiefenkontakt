import { CLASSES, NM, headingVec, targetPosAt, type Debrief, type Vec2 } from '@tk/shared';
import { store } from '../store.js';
import { CLASS_LABEL, COL, clock, esc, fitCanvas, h } from '../widgets/format.js';

const SPEEDS = [30, 120, 480];

function teamColor(team: string, player: boolean): string {
  if (team === 'east') return player ? '#f09595' : '#a35f5f';
  return player ? '#85b7eb' : '#5f7fa3';
}

/**
 * After-action review: replay of the true tracks with a timeline, the player's own
 * track and TMA solutions overlaid for comparison, and per-player statistics.
 */
export function debriefOverlay(d: Debrief, onClose: () => void, live = false): { update(nd: Debrief): void } {
  const ownId = store.snap?.own.id;
  const el = h(`<div class="overlay"><div class="panel" style="max-width:1200px;width:96vw;max-height:94vh;display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:10px">
    <div style="min-width:0">
      <div class="hd"><span>Nachbesprechung · ${esc(d.reason)}</span><span id="db-t"></span></div>
      <canvas id="db-cv" style="cursor:grab"></canvas>
      <div class="steps" style="align-items:center">
        <button id="db-play">Abspielen</button><button id="db-speed">×30</button>
        <input id="db-slider" type="range" min="0" max="${d.duration}" step="1" value="0" style="flex:3">
        <button id="db-mine" class="on" title="Eigener Kurs und eigene TMA-Lösungen einblenden">Meine Lösungen</button>
      </div>
      <div class="dim">ZIEHEN VERSCHIEBT · RAD ZOOMT · BLAU WESTBUND · ROT OSTPAKT · GELB EIGENE TMA-LÖSUNG</div>
    </div>
    <div style="min-width:0;overflow:auto">
      ${live ? '<div class="hd"><span>Zuschauer</span><span class="amber">LIVE · VERZÖGERT</span></div><div class="dim">DU SIEHST DIE WAHRE LAGE MIT EINIGEN MINUTEN VERZÖGERUNG, DAMIT NIEMAND SEINEM TEAM HELFEN KANN.</div>'
        : `<div class="hd"><span>Ergebnis</span><span class="${d.stats.some((s) => s.won && s.playerId === store.playerId) ? '' : 'red'}">${d.winner === 'west' ? 'WESTBUND' : 'OSTPAKT'} SIEGT</span></div>`}
      <div id="db-stats"></div>
      <div class="hd" style="margin-top:10px"><span>Ereignisse</span><span class="dim">KLICK SPRINGT HIN</span></div>
      <div id="db-events"></div>
      <button id="db-close" style="margin-top:10px;width:100%">Zur Lobby</button>
    </div>
  </div></div>`);
  document.body.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const cv = q<HTMLCanvasElement>('#db-cv');
  const name = (id?: string) => d.ships.find((s) => s.id === id)?.name ?? (id ?? '—');

  const renderLists = () => {
  q('#db-stats').innerHTML = `<div class="row dim"><span style="width:90px">SPIELER</span><span>KLASSE</span><span>SCHÜSSE</span><span>TREFFER</span><span>TONNAGE</span><span>KONTAKT</span><span>SM</span></div>` +
    d.stats.map((s) => `<div class="row ${s.playerId === store.playerId ? 'amber' : ''}">
      <span style="width:90px">${esc(s.callsign)}${s.survived ? '' : ' †'}</span><span>${CLASS_LABEL[s.cls]}</span>
      <span>${s.shots + s.rockets}</span><span>${s.kills}</span><span>${(s.tonnageSunk / 1000).toFixed(0)}k</span>
      <span>${s.firstContactS !== undefined ? clock(s.firstContactS) : '—'}</span><span>${s.distanceNm}</span></div>`).join('');
  const evText = (e: Debrief['events'][number]) =>
    e.kind === 'sunk' ? `${name(e.shipId)} versenkt${e.byId ? ` durch ${name(e.byId)}` : ''}`
      : e.kind === 'arrived' ? `${name(e.shipId)} am Ziel`
        : `${name(e.shipId)}: ${e.what === 'torpedo' ? 'Torpedo' : e.what === 'rocket' ? 'U-Jagd-Rakete' : e.what === 'dc' ? 'Wasserbombe' : 'Sonarboje'}`;
  q('#db-events').innerHTML = d.events.map((e, i) => `<div class="row clickable ${e.kind === 'sunk' ? 'red' : ''}" data-ev="${i}"><span>${clock(e.t)}</span><span>${esc(evText(e))}</span></div>`).join('') || '<div class="dim">KEINE</div>';
  };
  renderLists();

  let t = 0;
  let playing = false;
  let speedIdx = 0;
  let showMine = true;
  let scale = 60;
  let pan: Vec2 | undefined;
  let drag: { x: number; y: number; px: number; py: number } | undefined;
  let last = performance.now();
  let raf = 0;

  const slider = q<HTMLInputElement>('#db-slider');
  slider.oninput = () => (t = Number(slider.value));
  q<HTMLButtonElement>('#db-play').onclick = () => {
    if (t >= d.duration) t = 0;
    playing = !playing;
  };
  q<HTMLButtonElement>('#db-speed').onclick = () => (speedIdx = (speedIdx + 1) % SPEEDS.length);
  q<HTMLButtonElement>('#db-mine').onclick = () => (showMine = !showMine);
  q('#db-events').addEventListener('mousedown', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-ev]');
    if (row) t = Math.max(0, d.events[Number(row.dataset.ev)]!.t - 30);
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(400, Math.max(5, scale * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
  }, { passive: false });
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY, px: pan?.x ?? 0, py: pan?.y ?? 0 }));
  window.addEventListener('pointerup', () => (drag = undefined));
  cv.addEventListener('pointermove', (e) => {
    if (!drag || !pan) return;
    pan = { x: drag.px - (e.clientX - drag.x) * scale, y: drag.py + (e.clientY - drag.y) * scale };
  });
  if (live) {
    q('#db-close').textContent = 'Zuschauen beenden';
    t = d.duration;
  }
  q<HTMLButtonElement>('#db-close').onclick = () => {
    cancelAnimationFrame(raf);
    el.remove();
    onClose();
  };

  /** Interpolated frame at time t. */
  function positionsAt(time: number): Map<string, [number, number, number, number]> {
    const out = new Map<string, [number, number, number, number]>();
    const fs = d.frames;
    if (!fs.length) return out;
    let i = fs.findIndex((f) => f[0] > time);
    if (i < 0) i = fs.length;
    const a = fs[Math.max(0, i - 1)]!;
    const b = fs[Math.min(fs.length - 1, i)]!;
    const k = b[0] === a[0] ? 0 : (time - a[0]) / (b[0] - a[0]);
    for (const [id, x, y, hd, alive] of a[1]) {
      const nb = b[1].find((s) => s[0] === id);
      out.set(id, nb ? [x + (nb[1] - x) * k, y + (nb[2] - y) * k, hd, alive] : [x, y, hd, alive]);
    }
    return out;
  }

  function draw(): void {
    const now = performance.now();
    if (playing) {
      t = Math.min(d.duration, t + ((now - last) / 1000) * SPEEDS[speedIdx]!);
      if (t >= d.duration) playing = false;
    }
    last = now;
    slider.value = String(Math.round(t));
    q('#db-play').textContent = playing ? 'Pause' : 'Abspielen';
    q('#db-speed').textContent = `×${SPEEDS[speedIdx]}`;
    q('#db-mine').classList.toggle('on', showMine);
    q('#db-t').textContent = `${clock(t)} / ${clock(d.duration)}`;

    const H = Math.min(620, window.innerHeight * 0.7);
    const ctx = fitCanvas(cv, H);
    const w = cv.clientWidth;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, H);
    const pos = positionsAt(t);
    if (!pan) {
      const first = d.frames[0]?.[1] ?? [];
      const xs = first.map((s) => s[1]);
      const ys = first.map((s) => s[2]);
      pan = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 + 6000 };
    }
    const P = (p: Vec2) => ({ x: w / 2 + (p.x - pan!.x) / scale, y: H / 2 - (p.y - pan!.y) / scale });
    ctx.strokeStyle = COL.grid;
    const step = 5 * NM;
    for (let gx = Math.floor((pan.x - (w / 2) * scale) / step) * step; gx < pan.x + (w / 2) * scale; gx += step) {
      const p = P({ x: gx, y: 0 });
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H); ctx.stroke();
    }
    for (let gy = Math.floor((pan.y - (H / 2) * scale) / step) * step; gy < pan.y + (H / 2) * scale; gy += step) {
      const p = P({ x: 0, y: gy });
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(w, p.y); ctx.stroke();
    }
    // Wakes up to t
    for (const s of d.ships) {
      ctx.strokeStyle = teamColor(s.team, s.player);
      ctx.globalAlpha = s.player ? 0.8 : 0.4;
      ctx.beginPath();
      let started = false;
      for (const [ft, list] of d.frames) {
        if (ft > t) break;
        const e = list.find((x) => x[0] === s.id);
        if (!e) continue;
        const p = P({ x: e[1], y: e[2] });
        if (started) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        started = true;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Torpedoes in flight
    const tf = d.torpedoes.filter((f) => f[0] <= t).pop();
    if (tf && t - tf[0] < 20) {
      ctx.fillStyle = '#fac775';
      for (const [, x, y] of tf[1]) {
        const p = P({ x, y });
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
    }
    // Ships now
    ctx.font = '11px ui-monospace, monospace';
    for (const s of d.ships) {
      const e = pos.get(s.id);
      if (!e) continue;
      const p = P({ x: e[0], y: e[1] });
      const c = teamColor(s.team, s.player);
      ctx.fillStyle = e[3] ? c : '#5f7a72';
      ctx.strokeStyle = ctx.fillStyle;
      if (CLASSES[s.cls].submarine) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill();
      } else {
        const v = headingVec(e[2]);
        ctx.beginPath(); ctx.moveTo(p.x + v.x * 7, p.y - v.y * 7); ctx.lineTo(p.x - v.y * 4, p.y - v.x * 4); ctx.lineTo(p.x + v.y * 4, p.y + v.x * 4); ctx.closePath(); ctx.fill();
      }
      if (!e[3]) ctx.fillText('†', p.x + 6, p.y - 6);
      if (s.player || s.id === ownId) ctx.fillText(s.name, p.x + 8, p.y + 4);
    }
    // The player's own picture: own track and TMA solutions at time t
    if (showMine) {
      ctx.strokeStyle = '#fac775';
      ctx.setLineDash([4, 4]);
      for (const [label, sol] of store.solutions) {
        const p = P(targetPosAt(sol, t));
        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.stroke();
        ctx.fillStyle = '#fac775';
        ctx.fillText(label, p.x + 9, p.y - 6);
      }
      ctx.setLineDash([]);
    }
    ctx.fillStyle = COL.dim;
    ctx.fillText(`RASTER 5 SM`, 8, H - 8);
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return {
    update(nd: Debrief) {
      // Live view: follow the newest frame unless the viewer scrubbed back
      const following = t >= d.duration - 1;
      d = nd;
      slider.max = String(d.duration);
      if (following) t = d.duration;
      renderLists();
    },
  };
}
