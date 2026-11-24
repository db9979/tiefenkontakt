import { angleDiff, PERISCOPE_DEPTH, RECOG, stadimeterRange, type ClassId, type WreckView } from '@tk/shared';
import { BearingRangeFilter, easeAngle, ownNow, simNow } from '../../widgets/smooth.js';
import { planeTargets } from '../../widgets/air-targets.js';
import type { Periscope3D } from '../../widgets/periscope3d.js';
import { blasts } from '../../widgets/blasts.js';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { phoneButton, phoneLook, phonePhoto } from '../../widgets/phone-link.js';
import { isKey } from '../../widgets/keys.js';
import { CHOICE_LABEL, CLASS_LABEL, COL, deg1, deg3, fitCanvas, h, km, mastState } from '../../widgets/format.js';
import { SkySearch } from '../../widgets/sky-search.js';
import { toggleRecogBook } from '../../widgets/recog-book.js';
import { photosTaken, shutterFlash, snapPhoto } from '../../widgets/photo.js';

interface Wave {
  x: number;
  y: number;
  s: number;
  a: number;
}

function silhouette(ctx: CanvasRenderingContext2D, x: number, size: number, cls: ClassId, aspectSin: number): void {
  const len = size * (0.35 + 0.65 * Math.abs(aspectSin));
  ctx.fillStyle = '#46525a';
  ctx.beginPath();
  ctx.moveTo(x - len, 0);
  ctx.lineTo(x - len * 0.92, -size * 0.18);
  ctx.lineTo(x + len * 0.85, -size * 0.18);
  ctx.lineTo(x + len, -size * 0.04);
  ctx.closePath();
  ctx.fill();
  if (cls === 'merchant') {
    ctx.fillRect(x + len * 0.35, -size * 0.42, len * 0.3, size * 0.24);
    ctx.fillRect(x - len * 0.5, -size * 0.6, size * 0.03, size * 0.42);
    ctx.fillRect(x - len * 0.1, -size * 0.55, size * 0.03, size * 0.37);
  } else {
    ctx.fillRect(x - len * 0.2, -size * 0.38, len * 0.45, size * 0.2);
    ctx.fillRect(x, -size * 0.7, size * 0.025, size * 0.32);
    ctx.fillRect(x - size * 0.08, -size * 0.6, size * 0.16, size * 0.015);
  }
}

export function periscopeStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Sehrohr · Angriffsoptik</span><span id="mast" class="dim"></span></div>
      <div style="position:relative"><canvas id="gl" class="gl" style="position:absolute;inset:0;width:100%;height:380px"></canvas><canvas id="view" class="keep" style="position:relative"></canvas></div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button id="up">Mast ausfahren</button><button id="zoom" title="Vergrößerung 1,5× (Rundblick), 6× und 12× (Beobachten, Entfernung)">Vergr 6×</button><button id="stab" title="Stabilisierung: das Bild hält gegen Seegang und Bootsbewegung still (Taste G)">Stab</button>
        <button id="peri">Auf Sehrohrtiefe</button>
        <button id="left" title="Sehrohr nach links drehen">◀</button><button id="right" title="Sehrohr nach rechts drehen">▶</button>
        <button id="totgt" title="Sehrohr auf gewählten Kontakt drehen">Auf Ziel</button>
        <button id="elup" title="Sehrohrprisma anheben (Himmel)">▲</button><button id="eldn" title="Sehrohrprisma absenken">▼</button>
        <button id="sky" title="Prisma anheben und einmal rundum nach Flugzeugen suchen">Himmel absuchen</button>
        <button id="book" title="Erkennungsheft: Klassen vergleichen und dem gewählten Kontakt zuweisen">Erkennung</button><button id="foto" title="Sehrohrfoto (wird in der Nachbesprechung bewertet)">Foto</button>
        <span class="kbd" style="align-self:center">ZIEHEN DREHT UND HEBT · KLICK WÄHLT</span>
      </div>
    </div>
    <div class="panel"><div class="hd"><span>Messwerte</span></div><div id="data"></div></div>
  </div>`);
  const view = el.querySelector<HTMLCanvasElement>('#view')!;
  let glCanvas = el.querySelector<HTMLCanvasElement>('#gl')!;
  let gl: Periscope3D | undefined;
  let glOff = localStorage.getItem('tk_3d') === '0';
  let loading = false;
  let freeTimer: ReturnType<typeof setTimeout> | undefined;
  // three.js is loaded only when the periscope is used (falls back to 2D without WebGL2) and freed 20 s after leaving
  const ensureGl = () => {
    clearTimeout(freeTimer);
    if (gl || loading || glOff) return;
    loading = true;
    import('../../widgets/periscope3d.js')
      .then((m) => {
        loading = false;
        if (m.Periscope3D.supported()) gl = new m.Periscope3D(glCanvas);
        else glOff = true;
      })
      .catch(() => (glOff = true));
  };
  let periBearing = 0;
  /** Where the operator trains the scope; the optic follows smoothly. */
  let periTarget = 0;
  let lastFrame = performance.now();
  /** Until when (s) the lens still drips after a wave washed over it. */
  let wetUntil = 0;
  const filters = new Map<string, BearingRangeFilter>();
  const filteredAt = new Map<string, number>();
  /** Magnification: low power for searching, 6× and 12× for observing and ranging. */
  let mag = 6;
  const pfov = () => 48 / mag;
  /** Stabilised optic: the picture holds still against swell and the boat's motion. */
  let stab = localStorage.getItem('tk_stab_peri') === '1';
  let trained = false;
  const waves: Wave[] = Array.from({ length: 280 }, () => ({
    x: Math.random() * 900, y: Math.pow(Math.random(), 1.6) * 160 + 2, s: 0.3 + Math.random(), a: 0.1 + Math.random() * 0.35,
  }));
  const t0 = performance.now();
  const sky = new SkySearch();
  let photoReq = false;
  let flashAt = -1e9;

  el.querySelector<HTMLButtonElement>('#up')!.onclick = () => net.send({ t: 'toggle', what: 'mast', on: !store.snap?.own.mastUp });
  const setZoom = (m: number) => {
    mag = m;
    el.querySelector('#zoom')!.textContent = `Vergr ${String(mag).replace('.', ',')}×`;
  };
  const nextZoom = () => setZoom(mag === 1.5 ? 6 : mag === 6 ? 12 : 1.5);
  el.querySelector<HTMLButtonElement>('#zoom')!.onclick = nextZoom;
  el.querySelector<HTMLButtonElement>('#stab')!.onclick = () => setStab(!stab);
  queueMicrotask(() => setStab(stab));
  const setStab = (on: boolean) => {
    stab = on;
    localStorage.setItem('tk_stab_peri', on ? '1' : '0');
    el.querySelector('#stab')?.classList.toggle('on', on);
  };
  el.querySelector<HTMLButtonElement>('#peri')!.onclick = () => net.send({ t: 'order', depth: PERISCOPE_DEPTH });
  const train = (d: number) => (periTarget = (periTarget + d + 360) % 360);
  el.querySelector<HTMLButtonElement>('#left')!.onclick = () => train(-pfov() / 4);
  el.querySelector<HTMLButtonElement>('#right')!.onclick = () => train(pfov() / 4);
  el.querySelector<HTMLButtonElement>('#elup')!.onclick = () => sky.nudge(pfov() / 4);
  el.querySelector<HTMLButtonElement>('#eldn')!.onclick = () => sky.nudge(-pfov() / 4);
  el.querySelector<HTMLButtonElement>('#sky')!.onclick = () => (sky.sweeping ? sky.cancel() : (sky.startSweep(performance.now(), periTarget), setZoom(1.5)));
  el.querySelector<HTMLButtonElement>('#book')!.onclick = () => toggleRecogBook('Sehrohr', el);
  el.querySelector<HTMLButtonElement>('#foto')!.onclick = () => (photoReq = true);
  el.querySelector('#foto')!.after(phoneButton());
  el.querySelector<HTMLButtonElement>('#totgt')!.onclick = () => {
    sky.level();
    const c = store.selectedContact();
    if (c) periTarget = filters.get(c.label)?.at(simNow())?.bearing ?? c.bearing;
  };
  let dragX: number | undefined;
  let dragY = 0;
  let dragged = false;
  view.style.cursor = 'move';
  view.style.touchAction = 'none';
  view.addEventListener('pointerdown', (e) => {
    dragX = e.clientX;
    dragY = e.clientY;
    dragged = false;
  });
  window.addEventListener('pointerup', () => (dragX = undefined));
  view.addEventListener('pointermove', (e) => {
    if (dragX === undefined) return;
    const dx = e.clientX - dragX;
    const dy = e.clientY - dragY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragged = true;
    dragX = e.clientX;
    dragY = e.clientY;
    const fov = pfov();
    if (dx) train((-dx / (view.clientWidth * 0.84)) * fov);
    // Drag down: the picture follows the hand, the prism looks up
    if (dy) sky.nudge((dy / (view.clientHeight * 0.84)) * fov);
    periBearing = periTarget;
  });
  view.onclick = (e) => {
    if (dragged) return;
    const s = store.snap;
    if (!s) return;
    const r = view.getBoundingClientRect();
    const fov = pfov();
    const b = periBearing + ((e.clientX - r.left - r.width / 2) / (r.width * 0.42)) * (fov / 2);
    const hit = s.contacts.find((c) => c.sensors.includes('periscope') && Math.abs(angleDiff(c.bearing, b)) < fov / 10);
    if (hit) store.selected = hit.label;
  };

  /** Periscope contacts with a smoothed bearing/range and a fade for ships dipping out of sight. */
  function visible() {
    const s = store.snap;
    if (!s || !mastState(s.own).raised) return [];
    const now = simNow();
    const out: { label: string; cls: ClassId; bearing: number; range: number; alpha: number; lit?: boolean; wreck?: WreckView }[] = [];
    for (const c of s.contacts) {
      if (!c.sensors.includes('periscope')) continue;
      const age = now - c.lastSeen;
      if (age > 6) continue;
      const est = filters.get(c.label)?.at(now);
      if (!est) continue;
      out.push({ label: c.label, cls: c.classified ?? 'merchant', bearing: est.bearing, range: est.range ?? c.range ?? 8000, alpha: Math.max(0, Math.min(1, 1 - (age - 2) / 4)), lit: c.lit, wreck: c.wreck });
    }
    return out;
  }

  return {
    title: 'Sehrohr',
    el,
    key(e) {
      const step = pfov() / 16;
      if (isKey(e, 'scopeLeft')) train(-step);
      else if (isKey(e, 'scopeRight')) train(step);
      else if (isKey(e, 'scopeUp')) sky.nudge(step);
      else if (isKey(e, 'scopeDown')) sky.nudge(-step);
      else if (isKey(e, 'scopeZoom')) nextZoom();
      else if (isKey(e, 'stabilize')) setStab(!stab);
      else return false;
      return true;
    },
    snap() {
      const s = store.snap!;
      if (!trained) {
        periBearing = periTarget = s.own.heading;
        trained = true;
      }
      // Feed the display filters with each new periscope measurement
      for (const c of s.contacts) {
        if (!c.sensors.includes('periscope') || filteredAt.get(c.label) === c.lastSeen) continue;
        filteredAt.set(c.label, c.lastSeen);
        let f = filters.get(c.label);
        if (!f) filters.set(c.label, (f = new BearingRangeFilter(0.2, 0.02)));
        f.update(c.lastSeen, c.bearing, c.range);
      }
      const o = s.own;
      const atDepth = o.depth <= PERISCOPE_DEPTH + 0.5;
      const up = el.querySelector<HTMLButtonElement>('#up')!;
      up.classList.toggle('on', o.mastUp);
      up.textContent = o.mastUp ? 'Mast einfahren' : 'Mast ausfahren';
      const ms = mastState(o);
      const since = o.mastUpSince !== undefined ? s.time - o.mastUpSince : 0;
      const mast = el.querySelector<HTMLElement>('#mast')!;
      mast.className = ms.moving ? 'amber blink' : o.mastUp ? (since > 20 ? 'red' : 'amber') : 'dim';
      mast.textContent = ms.moving ? `MAST FÄHRT ${ms.moving === 'aus' ? 'AUS' : 'EIN'} · ${Math.round(ms.ext * 100)} %` : o.mastUp ? `MAST OBEN ${since.toFixed(0)} S` : atDepth ? 'MAST UNTEN' : `TIEFE ${o.depth.toFixed(0)} M · ZU TIEF`;
      const esm = s.alerts.filter((a) => a.kind === 'esm' && s.time - a.time < 10);
      const skyNow = sky.readout(planeTargets(s, s.own, simNow()), simNow(), ms.raised);
      el.querySelector<HTMLButtonElement>('#foto')!.disabled = !ms.raised;
      el.querySelector('#sky')!.classList.toggle('on', sky.sweeping);
      const sel = store.selectedContact();
      const target = sel?.sensors.includes('periscope') ? sel : undefined;
      el.querySelector('#data')!.innerHTML = `
        <div class="row"><span class="dim">SEHROHRPEILUNG</span><span>${deg1(periBearing)}°</span></div>
        <div class="row"><span class="dim">ZIEL</span><span>${target ? target.label : '—'}</span></div>
        <div class="row"><span class="dim">KLASSE (ZUGEWIESEN)</span><span class="${target && !target.assignedCls ? 'amber' : ''}">${target?.assignedCls ? CLASS_LABEL[target.assignedCls] : target?.assigned ? CHOICE_LABEL[target.assigned] : target ? 'ERKENNUNG ÖFFNEN' : '—'}</span></div>
        <div class="row"><span class="dim">ZIELPEILUNG</span><span>${target ? deg1(target.bearing) + '°' : '—'}</span></div>
        <div class="row"><span class="dim">MASTHÖHE (ANNAHME)</span><span>${target?.assignedCls ? RECOG[target.assignedCls].mast + ' M' : '—'}</span></div>
        <div class="row"><span class="dim">ENTFERNUNG (STADIMETER)</span><span>${target?.range && target.assignedCls && target.classified ? km(stadimeterRange(target.range, target.classified, target.assignedCls)) : '—'}</span></div>
        <div class="row"><span class="dim">LUFT</span><span class="${skyNow.tone === 'alarm' ? 'red blink' : skyNow.tone === 'clear' ? '' : 'dim'}">${skyNow.text}</span></div>
        <div class="row"><span class="dim">FOTOS</span><span>${photosTaken()}</span></div>
        <div class="row"><span class="dim">SEEGANG</span><span>${s.env.seaState}</span></div>
        ${esm.map((a) => `<div class="row red blink"><span>ESM · RADAR</span><span>${deg3(a.bearing ?? 0)}°</span></div>`).join('')}
        ${o.mastUp && since > 20 ? '<div class="row amber"><span>EMPFEHLUNG</span><span>EINFAHREN</span></div>' : ''}`;
    },
    hide() {
      freeTimer = setTimeout(() => {
        if (!gl) return;
        gl.dispose();
        gl = undefined;
        const fresh = glCanvas.cloneNode() as HTMLCanvasElement;
        glCanvas.replaceWith(fresh);
        glCanvas = fresh;
      }, 20_000);
    },
    frame() {
      // Only build the 3D scene while the mast is up: below periscope depth there is nothing to see
      if (store.snap && mastState(store.snap.own).ext > 0) ensureGl();
      const s = store.snap;
      const H = 380;
      const ctx = fitCanvas(view, H);
      const w = view.clientWidth;
      const nowMs = performance.now();
      const t = (nowMs - t0) / 1000;
      const air = s && mastState(s.own).raised ? planeTargets(s, s.own, simNow()) : [];
      // A paired phone steers the optic: bearing, elevation and power
      const pl = phoneLook();
      if (pl) {
        periTarget = periBearing = ((pl.bearing % 360) + 360) % 360;
        sky.nudge(pl.elev - sky.elevTarget);
        const want = pl.mag < 3 ? 1.5 : pl.mag < 9 ? 6 : 12;
        if (want !== mag) setZoom(want);
      }
      if (phonePhoto()) photoReq = true;
      const sweepTo = sky.frame(nowMs, (nowMs - lastFrame) / 1000, periBearing, pfov(), air, simNow());
      if (sweepTo !== undefined) periTarget = periBearing = ((sweepTo % 360) + 360) % 360;
      if (s && !mastState(s.own).raised) sky.cancel();
      periBearing = easeAngle(periBearing, periTarget, (nowMs - lastFrame) / 1000, 0.15);
      lastFrame = nowMs;
      const cx = w / 2;
      const cy = H / 2;
      const R = Math.min(w * 0.42, H * 0.47);
      const mst = s ? mastState(s.own) : { ext: 0, raised: false, moving: undefined };
      // The head breaks the surface at about 55 % of its travel
      const use3d = !!gl && mst.ext >= 0.55;
      glCanvas.style.visibility = use3d ? 'visible' : 'hidden';
      if (use3d && s) {
        const fov = pfov();
        const sols = store.solutions;
        const vis = visible();
        gl!.render({
          bearing: periBearing, fovDeg: (fov * w) / (2 * R), t, sea: s.env.seaState, light: s.env.light ?? 1,
          targets: [...vis.map((c) => ({ ...c, course: sols.get(c.label)?.course, speedKn: sols.get(c.label)?.speedKn })), ...air],
          rain: s.env.rain, hour: s.env.clock, effects: blasts(s, vis, nowMs), pitchDeg: sky.elev, met: s.env.met, own: ownNow(), stabilize: stab,
          missiles: { list: s.airdef?.missiles ?? [], me: s.own },
        });
        // Overlay: black mask outside the optic, reticle drawn below
        ctx.clearRect(0, 0, w, H);
        ctx.fillStyle = '#030504';
        ctx.beginPath();
        ctx.rect(0, 0, w, H);
        ctx.moveTo(cx + R, cy);
        ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        // Crests wash over the head in a rough sea: green water, then the lens drains for a few seconds
        const wash = gl!.wash;
        if (wash > 0) waterWash(ctx, cx, cy, R, wash, t);
        if (wash > 0.3) wetUntil = t + 3 + wash * 3;
        if (s.env.rain || t < wetUntil) lensDrops(ctx, cx, cy, R, t);
        if (mst.ext < 1) waterWash(ctx, cx, cy, R, (1 - mst.ext) / 0.45, t);
      } else if (s && mst.ext > 0) {
        // Head still under water: green murk, light from above, rising bubbles
        ctx.fillStyle = '#030504';
        ctx.fillRect(0, 0, w, H);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
        const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
        const lit = 0.25 + 0.75 * (s.env.light ?? 1);
        g.addColorStop(0, `rgba(${Math.round(60 * lit)},${Math.round(120 * lit)},${Math.round(115 * lit)},1)`);
        g.addColorStop(1, '#02100e');
        ctx.fillStyle = g;
        ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
        ctx.fillStyle = 'rgba(200,240,230,0.35)';
        for (let i = 0; i < 26; i++) {
          const bx = cx - R + ((i * 73.1) % (2 * R));
          const by = cy + R - (((t * (40 + (i % 7) * 9)) + i * 37) % (2 * R));
          ctx.beginPath(); ctx.arc(bx, by, 1.5 + (i % 3), 0, 7); ctx.fill();
        }
        ctx.restore();
      } else {
        ctx.fillStyle = '#030504';
        ctx.fillRect(0, 0, w, H);
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 7);
      ctx.clip();
      if (use3d) {
        // 3D scene already rendered underneath
      } else if (s && mst.raised) {
        const sea = s.env.seaState;
        // Slow, swell-like pitch and roll (no fast jitter)
        const sway = stab ? 0 : 1;
        const hy = cy + (Math.sin(t * 0.55) * (1.5 + sea * 1.1) + Math.sin(t * 0.23 + 1.3) * sea * 0.6) * sway + (sky.elev * 2 * R) / pfov();
        ctx.translate(cx, hy);
        ctx.rotate(Math.sin(t * 0.4) * 0.004 * (1 + sea * 0.6) * sway);
        ctx.fillStyle = '#24343b'; ctx.fillRect(-w, -H, 2 * w, H);
        ctx.fillStyle = '#2f4048'; ctx.fillRect(-w, -30, 2 * w, 30);
        ctx.fillStyle = '#3a4b52'; ctx.fillRect(-w, -7, 2 * w, 7);
        ctx.fillStyle = '#10222a'; ctx.fillRect(-w, 0, 2 * w, H);
        const fov = pfov();
        const pxPerDeg = (2 * R) / fov;
        for (const c of visible()) {
          const dx = angleDiff(periBearing, c.bearing) * pxPerDeg;
          if (Math.abs(dx) > R + 200) continue;
          const size = Math.min(400, (mag * 9000) / Math.max(300, c.range) * 6);
          ctx.globalAlpha = c.alpha;
          silhouette(ctx, dx, size, c.cls, 0.9);
          ctx.globalAlpha = 1;
          if (c.label === store.selected) {
            ctx.strokeStyle = COL.amber;
            ctx.strokeRect(dx - size * 0.6, -size * 0.8, size * 1.2, size * 0.9);
          }
        }
        for (const wv of waves) {
          const x = ((wv.x + t * wv.s * 12 - periBearing * pxPerDeg) % 900 + 900) % 900 - 450;
          ctx.strokeStyle = `rgba(170,200,205,${wv.a})`;
          ctx.lineWidth = wv.y > 60 ? 1.5 : 1;
          ctx.beginPath(); ctx.moveTo(x, wv.y); ctx.lineTo(x + 2 + wv.y * 0.12, wv.y - 0.4); ctx.stroke();
        }
        if (sea >= 4 && Math.sin(t * 0.37) > 0.92) {
          ctx.fillStyle = 'rgba(200,220,225,0.55)';
          ctx.fillRect(-w, -H, 2 * w, 2 * H);
        }
      } else {
        underwater(ctx, cx, cy, R, t, s?.env.light ?? 1);
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(159,225,203,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - R + 10, cy); ctx.lineTo(cx - 14, cy); ctx.moveTo(cx + 14, cy); ctx.lineTo(cx + R - 10, cy);
      ctx.moveTo(cx, cy - R + 10); ctx.lineTo(cx, cy - 14); ctx.moveTo(cx, cy + 14); ctx.lineTo(cx, cy + R - 10);
      ctx.stroke();
      for (let k = -10; k <= 10; k++) {
        if (!k) continue;
        const x = cx + (k * R) / 11;
        const hh = k % 5 ? 3 : 7;
        ctx.beginPath(); ctx.moveTo(x, cy - hh); ctx.lineTo(x, cy + hh); ctx.stroke();
      }
      ctx.strokeStyle = '#2c3a36';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillStyle = COL.g2;
      ctx.textAlign = 'center';
      ctx.fillText(deg3(periBearing), cx, cy + R + 16 > H ? H - 4 : cy + R + 16);
      if (s && mst.ext > 0 && mst.ext < 1) {
        ctx.fillText(`MAST FÄHRT ${mst.moving === 'ein' ? 'EIN' : 'AUS'} · ${Math.round(mst.ext * 100)} %`, cx, cy + 34);
      } else if (!s || !mst.raised) {
        ctx.fillText('MAST EINGEFAHREN', cx, cy - 20);
        ctx.fillStyle = COL.dim;
        ctx.fillText(s && s.own.depth > 19 ? 'AUF SEHROHRTIEFE GEHEN, DANN MAST AUSFAHREN' : 'MAST AUSFAHREN ZUM BEOBACHTEN', cx, cy + 34);
      }
      ctx.textAlign = 'left';
      ctx.fillText('BB', 10, cy + 4);
      ctx.textAlign = 'right';
      ctx.fillText('STB', w - 10, cy + 4);
      if (s && mst.raised) sky.draw(ctx, cx, cy, R, sky.readout(air, simNow(), true), t);
      if (photoReq) {
        photoReq = false;
        if (s && mst.raised) {
          const fov = pfov();
          snapPhoto({ layers: [glCanvas, view], crop: { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R }, bearing: periBearing, fov, vfov: fov, pitch: sky.elev, label: store.selected });
          flashAt = nowMs;
        }
      }
      shutterFlash(ctx, cx - R, cy - R, 2 * R, 2 * R, nowMs - flashAt);
    },
  };
}

/** Raindrops on the top lens: fixed beads that refract the light, slowly running down. */
function lensDrops(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number): void {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
  for (let i = 0; i < 34; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const rr = R * Math.sqrt(((i * 0.618) % 1));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr + ((t * (4 + (i % 5)) + i * 37) % (R * 0.5));
    const size = 2 + (i % 4) * 1.6;
    const g = ctx.createRadialGradient(x - size * 0.3, y - size * 0.3, 0, x, y, size);
    g.addColorStop(0, 'rgba(235,245,248,0.55)');
    g.addColorStop(0.6, 'rgba(120,140,150,0.18)');
    g.addColorStop(1, 'rgba(20,30,35,0.35)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, size, 0, 7); ctx.fill();
  }
  ctx.restore();
}

/** Mast down: the optic looks into the water: blue-green murk, drifting particles, light from above by day. */
function underwater(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number, light: number): void {
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  g.addColorStop(0, `rgba(${Math.round(20 + 30 * light)},${Math.round(55 + 50 * light)},${Math.round(60 + 45 * light)},1)`);
  g.addColorStop(1, '#020807');
  ctx.fillStyle = g;
  ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  if (light > 0.3) {
    ctx.globalAlpha = 0.07 * light;
    ctx.fillStyle = '#cfe';
    for (let i = 0; i < 5; i++) {
      const x = cx - R + ((i * 97 + t * 6) % (2 * R));
      ctx.beginPath(); ctx.moveTo(x, cy - R); ctx.lineTo(x + 30, cy - R); ctx.lineTo(x + 80, cy + R); ctx.lineTo(x + 40, cy + R); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(190,220,210,0.35)';
  for (let i = 0; i < 60; i++) {
    const x = cx - R + ((i * 53.3 + Math.sin(t * 0.3 + i) * 8) % (2 * R));
    const y = cy + R - ((i * 31.7 + t * (2 + (i % 3))) % (2 * R));
    ctx.fillRect(x, y, 1.5, 1.5);
  }
}

/** Water sheeting off the head window just after it breaks the surface: a falling waterline and runs. */
function waterWash(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, cover: number, t: number): void {
  const k = Math.max(0, Math.min(1, cover));
  if (k <= 0) return;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
  const top = cy + R - 2 * R * k;
  const g = ctx.createLinearGradient(0, top - 20, 0, cy + R);
  g.addColorStop(0, 'rgba(40,90,90,0)');
  g.addColorStop(0.15, 'rgba(40,90,90,0.85)');
  g.addColorStop(1, 'rgba(5,25,24,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - R, top - 20, 2 * R, cy + R - top + 20);
  ctx.strokeStyle = 'rgba(210,240,235,0.35)';
  for (let i = 0; i < 14; i++) {
    const x = cx - R + ((i * 61.7) % (2 * R));
    const y0 = cy - R + ((i * 29 + t * 90) % (2 * R)) * (1 - k);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + 1, y0 + 14 + (i % 4) * 6); ctx.stroke();
  }
  ctx.restore();
}
