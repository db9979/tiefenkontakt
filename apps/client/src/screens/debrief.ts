import { onTap, touchable } from '../widgets/touch.js';
import { CLASSES, NM, targetPosAt, type Debrief, type Vec2 } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { CLASS_LABEL, COL, clock, esc, fitCanvas, h } from '../widgets/format.js';
import { debriefOrders, debriefTips, timelineMarkers } from '../widgets/debrief-extras.js';
import { feedbackBlock } from '../widgets/feedback.js';
import { photoStrip } from '../widgets/photo.js';
import { drawSymbol } from '../widgets/symbols.js';
import { chartToScreen, northUpGrid, panDelta, screenDir } from '../widgets/chart-frame.js';
import { setNorthRegion } from '../north.js';
import { shareBlock, wireShare } from '../widgets/replay-share.js';
import { bandLabel, bandNote, gradePanel, tmaQuality } from './debrief-grade.js';

const SPEEDS = [30, 120, 480];

/** "KNAPPER SIEG · WESTBUND SIEGT": the band from the player's side, then who won under the rules. */
function resultLine(d: Debrief, shared: boolean): string {
  const side = `${d.winner === 'west' ? 'WESTBUND' : 'OSTPAKT'} SIEGT`;
  const own = d.stats.find((s) => s.playerId === store.playerId);
  if (shared || !own) return d.band === 'remis' ? `UNENTSCHIEDEN · ${side} KNAPP` : d.band === 'knapp' ? `${side} KNAPP` : side;
  return d.band === 'remis' ? 'UNENTSCHIEDEN' : `${bandLabel(own.won, d.band)} · ${side}`;
}

function teamColor(team: string, player: boolean): string {
  if (team === 'east') return player ? '#f09595' : '#a35f5f';
  return player ? '#85b7eb' : '#5f7fa3';
}

/**
 * After-action review: replay of the true tracks with a timeline, the player's own
 * track and TMA solutions overlaid for comparison, and per-player statistics.
 */
/** Only one debrief at a time: a re-sent debrief (reconnect, server restart) updates it instead of stacking a new one at 00:00. */
let current: { update(nd: Debrief): void; el: HTMLElement } | undefined;

/** `shared`: the public replay page (/r/<id>): no own solutions, tips or photos, no lobby. */
export function debriefOverlay(d: Debrief, onClose: () => void, live = false, shared = false): { update(nd: Debrief): void } {
  // North-up chart of the match's sea area (debrief, spectating, replay, series); the next live snapshot sets it again
  setNorthRegion(d.region);
  if (current && document.body.contains(current.el)) {
    current.update(d);
    return current;
  }
  const ownId = shared ? undefined : store.snap?.own.id;
  const mine = !live && !shared;
  const canShare = mine && d.stats.some((s) => s.playerId === store.playerId);
  const el = h(`<div class="overlay"><div class="panel" style="max-width:1200px;width:96vw;max-height:94vh;display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:10px">
    <div style="min-width:0">
      <div class="hd"><span>${shared ? 'Wiederholung' : 'Nachbesprechung'} · ${esc(d.reason)}</span><span id="db-t"></span></div>
      <canvas id="db-cv" style="cursor:grab"></canvas>
      <div class="steps" style="align-items:center">
        <button id="db-play">Abspielen</button><button id="db-speed">×30</button>
        <input id="db-slider" type="range" min="0" max="${d.duration}" step="1" value="0" style="flex:3">
        ${shared ? '' : '<button id="db-mine" class="on" title="Eigener Kurs und eigene TMA-Lösungen einblenden">Meine Lösungen</button>'}
      </div>
      ${timelineMarkers(d)}
      <div class="dim">${shared ? 'ZIEHEN VERSCHIEBT · RAD ZOOMT · BLAU WESTBUND · ROT OSTPAKT' : 'ZIEHEN VERSCHIEBT · RAD ZOOMT · BLAU WESTBUND · ROT OSTPAKT · GELB EIGENE TMA-LÖSUNG'}</div>
    </div>
    <div style="min-width:0;overflow:auto">
      ${live ? '<div class="hd"><span>Zuschauer</span><span class="amber">LIVE · VERZÖGERT</span></div><div class="dim">DU SIEHST DIE WAHRE LAGE MIT EINIGEN MINUTEN VERZÖGERUNG, DAMIT NIEMAND SEINEM TEAM HELFEN KANN.</div>'
        : d.provisional ? '<div class="hd"><span>Zwischenstand</span><span class="amber">PARTIE LÄUFT NOCH</span></div><div class="dim">DIE LAGE ENDET EINIGE MINUTEN VOR JETZT, DAMIT NIEMAND SEINEM TEAM HELFEN KANN. „ZUR LOBBY“ VERLÄSST DIE PARTIE.</div>'
        : `<div class="hd"><span>Ergebnis</span><span class="${shared || d.stats.some((s) => s.won && s.playerId === store.playerId) ? '' : 'red'}">${resultLine(d, shared)}</span></div>${!shared && bandNote(d.band, d.winner) ? `<div class="dim">${bandNote(d.band, d.winner)}</div>` : ''}`}
      ${mine && !d.provisional ? gradePanel(d, store.playerId, store.snap ? tmaQuality(d, store.snap.own.team, store.solutions.values()) : undefined) : ''}
      ${mine ? debriefTips(d.stats.find((s) => s.playerId === store.playerId)) : ''}
      ${mine ? photoStrip(d, store.playerId) : ''}
      ${mine ? '<div id="db-fb"></div>' : ''}
      ${mine && d.learned?.length ? `<div class="panel" style="margin:6px 0;border-color:var(--amber-line)"><div class="hd"><span class="amber">Der Gegner lernt</span></div>${d.learned.map((l) => `<div class="row" style="display:block">${esc(l)}</div>`).join('')}</div>` : ''}
      ${live ? '' : debriefOrders(d, d.stats.find((s) => s.playerId === store.playerId)?.team)}
      <div id="db-stats"></div>
      <div class="hd" style="margin-top:10px"><span>Ereignisse</span><span class="dim">KLICK SPRINGT HIN</span></div>
      <div id="db-events"></div>
      ${canShare ? shareBlock() : ''}
      ${mine && d.setup ? `<button id="db-again" style="margin-top:10px;width:100%" title="Neue Partie mit denselben Startpositionen, derselben Route und demselben Wetter">Gleiche Lage nochmal · #${d.setup.seed}</button>` : ''}
      <button id="db-close" style="margin-top:10px;width:100%">${shared ? 'Selbst spielen' : 'Zur Lobby'}</button>
    </div>
  </div></div>`);
  document.body.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  el.querySelector('#db-fb')?.replaceWith(feedbackBlock(d, store.playerId));
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
  let showMine = !shared;
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
  const mineBtn = el.querySelector<HTMLButtonElement>('#db-mine');
  if (mineBtn) mineBtn.onclick = () => (showMine = !showMine);
  wireShare(el);
  el.querySelector('.tl')!.addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).closest<HTMLElement>('[data-ev]');
    if (m) t = Math.max(0, d.events[Number(m.dataset.ev)]!.t - 30);
  });
  onTap(q('#db-events'), '[data-ev]', (row) => {
    t = Math.max(0, d.events[Number(row.dataset.ev)]!.t - 30);
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(400, Math.max(5, scale * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
  }, { passive: false });
  touchable(cv, (f) => (scale = Math.min(400, Math.max(5, scale * f))));
  cv.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY, px: pan?.x ?? 0, py: pan?.y ?? 0 }));
  window.addEventListener('pointerup', () => (drag = undefined));
  cv.addEventListener('pointermove', (e) => {
    if (!drag || !pan) return;
    if (cv.dataset.pinch) {
      drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      return;
    }
    const dp = panDelta(e.clientX - drag.x, e.clientY - drag.y, scale);
    pan = { x: drag.px + dp.x, y: drag.py + dp.y };
  });
  if (live) {
    q('#db-close').textContent = 'Zuschauen beenden';
    t = d.duration;
  }
  q<HTMLButtonElement>('#db-close').onclick = () => {
    cancelAnimationFrame(raf);
    el.remove();
    current = undefined;
    onClose();
  };
  const again = el.querySelector<HTMLButtonElement>('#db-again');
  if (again && d.setup) {
    const setup = d.setup;
    again.onclick = () => {
      q<HTMLButtonElement>('#db-close').click();
      net.send({ t: 'create_match', name: `Gleiche Lage #${setup.seed}`, setup });
    };
  }

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
    // Always keep the loop alive, even if one frame fails on odd data
    raf = requestAnimationFrame(draw);
    try {
      frame();
    } catch (e) {
      console.error('Nachbesprechung:', e);
    }
  }

  function frame(): void {
    if (!document.body.contains(el)) return cancelAnimationFrame(raf);
    const now = performance.now();
    if (playing) {
      t = Math.min(d.duration, t + ((now - last) / 1000) * SPEEDS[speedIdx]!);
      if (t >= d.duration) playing = false;
    }
    last = now;
    slider.value = String(Math.round(t));
    q('#db-play').textContent = playing ? 'Pause' : 'Abspielen';
    q('#db-speed').textContent = `×${SPEEDS[speedIdx]}`;
    mineBtn?.classList.toggle('on', showMine);
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
    const c = pan;
    const P = (p: Vec2) => chartToScreen(p, c, scale, w, H);
    ctx.strokeStyle = COL.grid;
    northUpGrid(ctx, c, scale, w, H, 5 * NM);
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
      // APP-6 frames from the viewer's side: friend circle, hostile diamond; submerged boats as lower halves
      const myTeam = d.ships.find((x) => x.id === ownId)?.team ?? 'west';
      ctx.lineWidth = 1.8;
      drawSymbol(ctx, p.x, p.y, s.team === myTeam ? 'friend' : 'hostile', CLASSES[s.cls].submarine ? 'subsurface' : 'surface', s.cls === 'merchant' ? 4 : 6, true);
      const v = screenDir(e[2]);
      ctx.beginPath(); ctx.moveTo(p.x + v.x * 6, p.y + v.y * 6); ctx.lineTo(p.x + v.x * 12, p.y + v.y * 12); ctx.stroke();
      ctx.lineWidth = 1;
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
  }
  raf = requestAnimationFrame(draw);
  const api = {
    el,
    update(nd: Debrief) {
      // Live view: follow the newest frame unless the viewer scrubbed back
      const following = t >= d.duration - 1;
      d = nd;
      setNorthRegion(d.region);
      slider.max = String(d.duration);
      if (following) t = d.duration;
      renderLists();
    },
  };
  current = api;
  return api;
}
