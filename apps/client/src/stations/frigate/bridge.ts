import { trueDeg } from '../../north.js';
import { angleDiff, fogAt, lookoutRanges, type AlertView, type Sighting } from '@tk/shared';
import type { Periscope3D, PeriscopeTarget } from '../../widgets/periscope3d.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { phoneButton, phoneLook, phonePhoto } from '../../widgets/phone-link.js';
import { isKey } from '../../widgets/keys.js';
import { easeAngle, moverNow, ownNow, simNow } from '../../widgets/smooth.js';
import { planeTargets } from '../../widgets/air-targets.js';
import { bridgeTargets } from '../../widgets/scope-targets.js';
import { reticle } from '../../widgets/reticle.js';
import { blasts } from '../../widgets/blasts.js';
import { CLASS_LABEL, esc, fitCanvas, h, km, setHtml, setText, tdeg3 } from '../../widgets/format.js';
import { LazyGl } from '../../widgets/lazy-gl.js';
import { onRelease } from '../../widgets/touch.js';
import { btnState } from '../../widgets/btn-state.js';
import { fillBox } from '../../widgets/fill.js';
import { toggleRecogBook } from '../../widgets/recog-book.js';
import { photosTaken, shutterFlash, snapPhoto } from '../../widgets/photo.js';

/** View height: follows the window (set each frame). */
let H = 380;
const WIDE_FOV = 75;
/** Binocular magnifications: true field of view is about 52° / magnification (7×50: 7.4°). */
const MAGS = [6, 8, 10, 12];
const WHAT: Record<Sighting, string> = { mast: 'SEHROHR', snorkel: 'SCHNORCHEL', surfaced: 'AUFGETAUCHT' };

/** What a report shows in the sightings list (undefined: not something the lookouts see). */
export function sightWhat(a: Pick<AlertView, 'kind' | 'what' | 'sink' | 'text'>): string | undefined {
  if (a.kind === 'sighting') return WHAT[a.what ?? 'mast'];
  if (a.kind === 'hit') return a.sink ? 'SINKT' : 'EXPLOSION';
  if (a.kind === 'torpedo') return 'TORPEDO';
  if (a.kind === 'boat' && a.text.startsWith('AUSGUCK')) return 'RAKETENSTART';
  return undefined;
}

/** Screen x of a bearing d degrees off the look on a w px view of f degrees (perspective, as the 3D view). */
export function tapeX(d: number, f: number, w: number): number {
  return w / 2 + (Math.tan((d * Math.PI) / 180) / Math.tan((f * Math.PI) / 360)) * (w / 2);
}

/** Escorts' bridge: lookout view in 3D with 7× binoculars, own formation in sight, lookout reports. */
export function bridgeStation(): Station {
  // The view takes everything but a 300 px lookout column; buttons in groups: optics, look, report.
  const el = h(`<div class="st bridge">
    <div class="st-col">
      <div class="panel grow"><div class="hd"><span>Brücke · Ausguck</span><span id="b-brg" class="dim"></span></div>
        <div class="fill" id="view-box"><canvas id="gl" class="gl" style="position:absolute;inset:0;width:100%;height:100%"></canvas><canvas id="view" class="keep"></canvas></div>
        <div class="btnrows">
          <div class="btngroup"><span class="seg"><button id="left" title="Blick nach links">◀</button><button id="right" title="Blick nach rechts">▶</button><button id="tup" title="Blick nach oben (W)">▲</button><button id="tdn" title="Blick nach unten (S)">▼</button></span>
            <button id="ahead">Voraus</button><button id="report" class="warn">Auf Meldung</button><button id="tocontact">Auf Kontakt</button><button id="toair" title="Nacheinander auf jedes sichtbare Flugzeug schwenken und ihm folgen">Luft</button></div>
          <div class="btngroup"><button id="glass" title="Fernglas mit Strichplatte (Taste E wechselt die Vergrößerung)">Fernglas</button><button id="mag" title="Vergrößerung 6×, 8×, 10×, 12×">8×</button><button id="stab" title="Stabilisierung: das Bild hält gegen Schiffsbewegung und Handzittern still (Taste G)">Stab</button></div>
          <div class="hint">ZIEHEN SCHWENKT · WASD · RAD ZOOMT</div>
        </div>
      </div>
    </div>
    <div class="st-col">
      <div class="panel" title="Die Ausgucks melden Sehrohr-Fahnen, Schnorchel und Torpedolaufbahnen selbst. Nachts, bei Regen und hohem Seegang sehen sie kaum etwas."><div class="hd"><span>Ausguck</span><span class="dim">20 M AUGENHÖHE</span></div><div id="b-data"></div>
        <div class="btnrow b-acts"><button id="book" title="Erkennungsheft: Klassen vergleichen und dem gewählten Kontakt zuweisen">Erkennung</button><button id="foto" title="Foto vom Ausguck (wird in der Nachbesprechung bewertet)">Foto</button></div></div>
      <div class="panel listpanel b-sightp"><div class="hd"><span>Sichtungen</span><span id="b-sn" class="dim"></span></div><div id="b-sight" class="scroll sightlist" title="Klick dreht den Blick auf die Sichtung"></div></div>
    </div>
  </div>`);
  const view = el.querySelector<HTMLCanvasElement>('#view')!;
  const box = fillBox(el.querySelector<HTMLElement>('#view-box')!, 300);
  /** The 3D scene is created on first view and freed 20 s after the player leaves the bridge. */
  const ownCls = () => (store.snap?.own.cls === 'kor' || store.snap?.own.cls === 'ffv' ? store.snap.own.cls : store.snap?.own.cls === 'ffk' ? 'ffv' : 'ffg');
  const g3 = new LazyGl<Periscope3D>(el.querySelector<HTMLCanvasElement>('#gl')!, (c) =>
    import('../../widgets/periscope3d.js').then((m) => (m.Periscope3D.supported() ? new m.Periscope3D(c, { eye: 20, own: ownCls() }) : undefined)));

  /** Look direction relative to the bow, so the view turns with the ship like a real bridge wing. */
  let relTarget = 0;
  let rel = 0;
  let glass = false;
  let mag = 8;
  /** Manual tilt of the look (degrees, up positive) on top of the horizon look. */
  let tilt = 0;
  let stab = localStorage.getItem('tk_stab_glass') === '1';
  let last = performance.now();
  const t0 = performance.now();
  let photoReq = false;
  let flashAt = -1e9;
  /** Smoothed screen positions per target (bearing, range), so 1 Hz updates glide. */
  const shown = new Map<string, { b: number; r: number }>();

  const fov = () => (glass ? 52 / mag : WIDE_FOV);
  const setMag = (m: number) => {
    mag = m;
    el.querySelector('#mag')!.textContent = `${mag}×`;
  };
  const nextMag = () => setMag(MAGS[(MAGS.indexOf(mag) + 1) % MAGS.length]!);
  const setStab = (on: boolean) => {
    stab = on;
    localStorage.setItem('tk_stab_glass', on ? '1' : '0');
    btnState(el.querySelector<HTMLElement>('#stab'), { on });
  };
  const tiltBy = (d: number) => (tilt = Math.max(-30, Math.min(75, tilt + d)));
  let maskCanvas: HTMLCanvasElement | undefined;
  const mask = (w: number, hgt: number) => {
    if (!maskCanvas) {
      maskCanvas = document.createElement('canvas');
      maskCanvas.className = 'keep';
    }
    if (maskCanvas.width !== w || maskCanvas.height !== hgt) {
      maskCanvas.width = w;
      maskCanvas.height = hgt;
    }
    return maskCanvas;
  };
  const turn = (d: number) => (relTarget = ((relTarget + d + 540) % 360) - 180);
  const lookAt = (bearing: number) => {
    const s = store.snap;
    if (s) relTarget = angleDiff(s.own.heading, bearing);
  };
  /** The sightings list as last drawn (its rows point into it by index). */
  let sightings: { label?: string; bearing: number; what: string; time: number; range?: number }[] = [];
  el.querySelector<HTMLElement>('#b-sight')!.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-sight]');
    const a = row && sightings[Number(row.dataset.sight)];
    if (!a) return;
    airTrack = undefined;
    const c = a.label ? store.snap?.contacts.find((x) => x.label === a.label) : undefined;
    if (c) store.selected = c.label;
    lookAt(c?.bearing ?? a.bearing);
  });
  el.querySelector<HTMLButtonElement>('#glass')!.onclick = (e) => {
    glass = !glass;
    btnState(e.currentTarget as HTMLElement, { on: glass });
  };
  el.querySelector<HTMLButtonElement>('#mag')!.onclick = () => {
    if (!glass) {
      glass = true;
      el.querySelector('#glass')!.classList.add('on');
    } else nextMag();
  };
  el.querySelector<HTMLButtonElement>('#stab')!.onclick = () => setStab(!stab);
  queueMicrotask(() => setStab(stab));
  el.querySelector<HTMLButtonElement>('#tup')!.onclick = () => tiltBy(glass ? 1 : 5);
  el.querySelector<HTMLButtonElement>('#tdn')!.onclick = () => tiltBy(glass ? -1 : -5);
  view.addEventListener('wheel', (e) => {
    if (!glass) return;
    e.preventDefault();
    const i = MAGS.indexOf(mag) + (e.deltaY < 0 ? 1 : -1);
    setMag(MAGS[Math.max(0, Math.min(MAGS.length - 1, i))]!);
  }, { passive: false });
  el.querySelector<HTMLButtonElement>('#left')!.onclick = () => turn(glass ? -3 : -20);
  el.querySelector<HTMLButtonElement>('#right')!.onclick = () => turn(glass ? 3 : 20);
  el.querySelector<HTMLButtonElement>('#ahead')!.onclick = () => ((relTarget = 0), (tilt = 0));
  el.querySelector<HTMLButtonElement>('#report')!.onclick = () => {
    const a = [...(store.snap?.alerts ?? [])].reverse().find((x) => x.kind === 'sighting');
    if (a?.bearing !== undefined) {
      lookAt(a.bearing);
      glass = true;
      el.querySelector('#glass')!.classList.add('on');
    }
  };
  el.querySelector<HTMLButtonElement>('#tocontact')!.onclick = () => {
    airTrack = undefined;
    const c = store.selectedContact();
    if (c) lookAt(c.bearing);
  };
  // Aircraft: cycle through those in sight and follow one, looking up to its elevation
  let airTrack: string | undefined;
  let pitch = -8;
  el.querySelector<HTMLButtonElement>('#toair')!.onclick = () => {
    const s = store.snap;
    const air = s ? planeTargets(s, ownNow(), simNow()).sort((a, b) => a.bearing - b.bearing) : [];
    if (!air.length) return void (airTrack = undefined);
    const i = air.findIndex((p) => p.label === airTrack);
    airTrack = air[(i + 1) % air.length]!.label;
  };
  el.querySelector<HTMLButtonElement>('#book')!.onclick = () => toggleRecogBook('Brücke', el);
  // "Klasse zuweisen" in the lookout panel opens the recognition book as well
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-recog]')) toggleRecogBook('Brücke', el);
  });
  el.querySelector<HTMLButtonElement>('#foto')!.onclick = () => (photoReq = true);
  el.querySelector('#foto')!.after(phoneButton());
  for (const id of ['#left', '#right', '#ahead', '#report']) el.querySelector(id)!.addEventListener('click', () => (airTrack = undefined));
  let dragX: number | undefined;
  let dragY = 0;
  view.style.cursor = 'move';
  view.style.touchAction = 'none';
  let downX = 0;
  view.addEventListener('pointerdown', (e) => {
    dragX = downX = e.clientX;
    dragY = e.clientY;
    onRelease(e, () => (dragX = undefined));
  });
  // A click (no drag) on a sighting selects that contact, e.g. to assign its class
  view.addEventListener('click', (e) => {
    const s = store.snap;
    if (!s || Math.abs(e.clientX - downX) > 3) return;
    const r = view.getBoundingClientRect();
    const f = fov();
    const b = (s.own.heading + rel + ((e.clientX - r.left - r.width / 2) / (r.width / 2)) * (f / 2) + 360) % 360;
    const hit = s.contacts.filter((c) => c.sighting && Math.abs(angleDiff(c.bearing, b)) < f / 12).sort((x, y) => Math.abs(angleDiff(x.bearing, b)) - Math.abs(angleDiff(y.bearing, b)))[0];
    if (hit) store.selected = hit.label;
  });
  view.addEventListener('pointermove', (e) => {
    if (dragX === undefined) return;
    const dx = e.clientX - dragX;
    const dy = e.clientY - dragY;
    dragX = e.clientX;
    dragY = e.clientY;
    turn((-dx / view.clientWidth) * fov());
    // Drag down: the picture follows the hand, the look goes up
    tiltBy((dy / view.clientHeight) * fov() * (view.clientHeight / view.clientWidth));
    rel = relTarget;
  });

  /** What the bridge can see (scope-targets.ts), sightings gliding between sweeps. */
  function targets(): PeriscopeTarget[] {
    const s = store.snap;
    if (!s) return [];
    const out = bridgeTargets(s);
    // Sightings only come once per sweep: glide toward the latest values
    for (const tg of out) {
      if (!tg.sighting) continue;
      const p = shown.get(tg.label);
      if (!p) shown.set(tg.label, { b: tg.bearing, r: tg.range });
      else {
        p.b = (p.b + angleDiff(p.b, tg.bearing) * 0.08 + 360) % 360;
        p.r += (tg.range - p.r) * 0.08;
        tg.bearing = p.b;
        tg.range = p.r;
      }
    }
    return out;
  }

  /** Aircraft in sight and the one the lookout follows. */
  const airLine = (s: NonNullable<typeof store.snap>) => {
    const air = (s.planes ?? []).filter((p) => p.via.includes('visual'));
    const f = air.find((p) => p.id === airTrack);
    const NAME = { airliner: 'VERKEHRSFLUGZEUG', light: 'KLEINFLUGZEUG', recon: 'FERNAUFKLÄRER', mpa: 'SEEAUFKLÄRER', helo: 'HUBSCHRAUBER' } as const;
    // What is in the air, by kind ("1 VERKEHRSFLUGZEUG"), not a bare count
    const kinds = new Map<string, number>();
    for (const p of air) kinds.set(NAME[p.kind], (kinds.get(NAME[p.kind]) ?? 0) + 1);
    const what = [...kinds].map(([k, n]) => `${n} ${k}`).join(' · ');
    return `<div class="row"><span class="dim">FLUGZEUGE</span><span>${what || 'KEINE'}</span></div>${f && f.x !== undefined ? `<div class="row amber"><span>${NAME[f.kind]}</span><span>${tdeg3(f.bearing)}° · ${km(Math.hypot(f.x - s.own.x, f.y! - s.own.y))} · ${km(f.alt ?? 0)} HOCH</span></div>` : ''}`;
  };

  /** Selected contact with its assigned class (from the recognition book) and the photo counter. */
  const selLine = () => {
    const c = store.selectedContact();
    return `${c ? `<div class="row"><span class="dim">KONTAKT · ${c.label}</span><button data-recog class="${c.assignedCls ? '' : 'warn'}" style="min-height:22px;padding:1px 8px" title="Erkennungsheft öffnen und dem Kontakt eine Klasse zuweisen">${c.assignedCls ? `${CLASS_LABEL[c.assignedCls]} ✎` : 'KLASSE ZUWEISEN ▸'}</button></div>` : ''}<div class="row"><span class="dim">FOTOS</span><span>${photosTaken()}</span></div>`;
  };

  return {
    id: 'bruecke',
    title: 'Brücke',
    el,
    key(e) {
      if (isKey(e, 'scopeLeft')) turn(glass ? -1 : -5);
      else if (isKey(e, 'scopeRight')) turn(glass ? 1 : 5);
      else if (isKey(e, 'scopeUp')) tiltBy(glass ? 0.5 : 3);
      else if (isKey(e, 'scopeDown')) tiltBy(glass ? -0.5 : -3);
      else if (isKey(e, 'scopeZoom')) el.querySelector<HTMLButtonElement>('#mag')!.click();
      else if (isKey(e, 'stabilize')) setStab(!stab);
      else return false;
      return true;
    },
    snap() {
      const s = store.snap!;
      const env = { layerDepth: 0, layerLoss: 0, seaState: s.env.seaState, light: s.env.light, rain: s.env.rain };
      const fog = fogAt(s.env.met, s.own);
      const r = lookoutRanges(env, fog);
      const quality = r.mast > 1500 ? 'GUT' : r.mast > 600 ? 'MÄSSIG' : 'SCHLECHT';
      setHtml(el.querySelector('#b-data')!, `
        <div class="row"><span class="dim">SICHT</span><span class="${quality === 'GUT' ? '' : 'amber'}">${quality}${fog > 0.3 ? ' · NEBEL' : ''}${s.env.rain ? ' · REGEN' : ''}${(s.env.light ?? 1) < 0.3 ? ' · NACHT' : ''}</span></div>
        <div class="row"><span class="dim">SEHROHR (6 KN) BIS</span><span>${km(r.mast)}</span></div>
        <div class="row"><span class="dim">SCHNORCHEL BIS</span><span>${km(r.snorkel)}</span></div>
        <div class="row"><span class="dim">AUFGETAUCHT BIS</span><span>${km(r.surfaced)}</span></div>
        ${airLine(s)}
        ${selLine()}
`);
      // Sightings: the latest report per contact, plus explosions, sinkings, torpedoes and launches
      // with their bearing, newest first; a click turns the view to it
      sightings = [];
      for (const a of [...s.alerts].reverse()) {
        if (a.bearing === undefined) continue;
        const what = sightWhat(a);
        if (!what) continue;
        if (a.label && sightings.some((x) => x.label === a.label)) continue;
        sightings.push({ label: a.label, bearing: a.bearing, what, time: a.time, range: a.range });
        if (sightings.length >= 30) break;
      }
      setText(el.querySelector('#b-sn')!, sightings.length ? String(sightings.length) : '');
      setHtml(el.querySelector('#b-sight')!, sightings.length ? sightings.map((a, i) => {
        const age = Math.max(0, Math.round(s.time - a.time));
        return `<div class="row clickable ${age < 60 ? 'amber' : ''}" data-sight="${i}"><span>${a.label ? `${esc(a.label)} ` : ''}${a.what}</span><span>${tdeg3(a.bearing)}°${a.range ? ` · ${km(a.range)}` : ''}</span><span class="dim">${age < 120 ? `${age} S` : `${Math.round(age / 60)} MIN`}</span></div>`;
      }).join('') : '<div class="dim">NOCH KEINE SICHTUNG</div>');
    },
    hide() {
      g3.freeLater();
    },
    dispose() {
      g3.dispose();
      box.dispose();
    },
    frame() {
      g3.ensure();
      const s = store.snap;
      H = box.h;
      const ctx = fitCanvas(view, H);
      const w = view.clientWidth;
      const nowMs = performance.now();
      // A paired phone steers the look: bearing, tilt, binoculars and their power
      const pl = phoneLook();
      if (pl && s) {
        glass = pl.glass;
        btnState(el.querySelector<HTMLElement>('#glass'), { on: glass });
        if (glass) setMag(MAGS.reduce((a, b) => (Math.abs(b - pl.mag) < Math.abs(a - pl.mag) ? b : a)));
        relTarget = rel = angleDiff(s.own.heading, pl.bearing);
        tilt = Math.max(-30, Math.min(75, pl.elev - (glass ? -0.15 : -8)));
        airTrack = undefined;
      }
      if (phonePhoto()) photoReq = true;
      rel = ((easeAngle(rel, relTarget, (nowMs - last) / 1000, 0.15) + 540) % 360) - 180;
      last = nowMs;
      const t = (nowMs - t0) / 1000;
      const heading = s ? ownNow().heading : 0;
      const look = (heading + rel + 360) % 360;
      const f = fov();
      el.querySelector('#b-brg')!.textContent = `BLICK ${tdeg3(look)}° · ${rel === 0 ? 'VORAUS' : `${Math.abs(Math.round(rel))}° ${rel > 0 ? 'STB' : 'BB'}`}`;
      const gl = g3.scene;
      const live = !!gl && !!s;
      g3.canvas.style.visibility = live ? 'visible' : 'hidden';
      const tg = live ? targets() : [];
      // Following an aircraft: bearing and elevation of the plane, else the normal look over the sea
      const followed = airTrack ? tg.find((x) => x.label === airTrack) : undefined;
      if (airTrack && !followed && live) airTrack = undefined;
      if (followed && s) relTarget = angleDiff(s.own.heading, followed.bearing);
      const wantPitch = followed ? Math.min(70, (Math.atan2((followed.alt ?? 0) - 20, followed.range) * 180) / Math.PI) : (glass ? -0.15 : -8) + tilt;
      pitch += (wantPitch - pitch) * 0.1;
      if (live) {
        gl!.render({
          bearing: look, fovDeg: f, t, sea: s!.env.seaState, light: s!.env.light ?? 1, targets: tg,
          rain: s!.env.rain, hour: s!.env.clock, pitchDeg: pitch, ownHeading: heading, ownKn: s!.own.speedKn, met: s!.env.met, stabilize: stab, shake: glass ? 0.012 * mag : 0.05,
          effects: blasts(s!, tg.filter((x) => !x.sunk && !x.plane && !x.sighting), nowMs), own: ownNow(), seabed: s!.env.seabed, ownWreck: s!.own.wreck,
          missiles: { list: s!.airdef?.missiles ?? [], me: ownNow() },
        });
      }
      ctx.clearRect(0, 0, w, H);
      if (!live) {
        ctx.fillStyle = '#030504';
        ctx.fillRect(0, 0, w, H);
        ctx.fillStyle = '#6f8a78';
        ctx.font = '12px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(g3.off ? 'KEINE 3D-GRAFIK (WEBGL2) · MELDUNGEN RECHTS' : 'LADE …', w / 2, H / 2);
        return;
      }
      // Sighting markers in view
      for (const c of tg) {
        if (!c.sighting) continue;
        const d = angleDiff(look, c.bearing);
        if (Math.abs(d) > f / 2) continue;
        const x = tapeX(d, f, w);
        // Vertical: the object sits just below the horizon by the dip from 20 m eye height
        const pitchR = (pitch * Math.PI) / 180;
        const tanV = Math.tan((f * Math.PI) / 360) / (w / H);
        const y = H / 2 - (Math.tan(-Math.atan(20 / c.range) - pitchR) / tanV) * (H / 2);
        ctx.strokeStyle = `rgba(255,120,110,${c.alpha})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 10, y - 12, 20, 18);
        ctx.fillStyle = `rgba(255,170,160,${c.alpha})`;
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${c.label} · ${km(c.range)}`, x, y - 18);
      }
      if (glass) {
        // Binocular mask: two overlapping circles
        const r = Math.min(w * 0.3, H * 0.46);
        // Mask on an offscreen layer: fill black, then cut out both lenses
        const m = mask(w, H);
        const mc = m.getContext('2d')!;
        mc.globalCompositeOperation = 'source-over';
        mc.fillStyle = '#020303';
        mc.fillRect(0, 0, w, H);
        mc.globalCompositeOperation = 'destination-out';
        const lens = mc.createRadialGradient(0, 0, r * 0.82, 0, 0, r);
        lens.addColorStop(0, 'rgba(0,0,0,1)');
        lens.addColorStop(1, 'rgba(0,0,0,0)');
        for (const dx of [-0.55, 0.55]) {
          mc.save();
          mc.translate(w / 2 + dx * r, H / 2);
          mc.fillStyle = lens;
          mc.beginPath(); mc.arc(0, 0, r, 0, Math.PI * 2); mc.fill();
          mc.restore();
        }
        ctx.drawImage(m, 0, 0, w, H);
        reticle(ctx, w, H, fov(), r);
      } else {
        // Open bridge roof: no window frame, only spray on the lens of the eye in rain
        if (s!.env.rain) {
          ctx.fillStyle = 'rgba(200,215,220,0.18)';
          for (let i = 0; i < 40; i++) {
            const x = ((i * 97.3 + t * 3) % 1) * w;
            const y = ((i * 41.7 + t * (20 + (i % 5) * 6)) % H);
            ctx.fillRect(x, y, 1.5, 6);
          }
        }
      }
      // Bearing tape in true degrees, in the same perspective as the picture (and the markers)
      const lookT = trueDeg(look);
      ctx.fillStyle = 'rgba(3,8,8,0.6)';
      ctx.fillRect(0, 0, w, 16);
      ctx.strokeStyle = '#9fd8c4';
      ctx.fillStyle = '#9fd8c4';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      const step = glass ? 1 : 5;
      for (let a = Math.ceil((lookT - f / 2) / step) * step; a <= lookT + f / 2; a += step) {
        const x = tapeX(angleDiff(lookT, a), f, w);
        const major = a % (glass ? 5 : 30) === 0;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, major ? 7 : 4); ctx.stroke();
        if (major) ctx.fillText(String(((a % 360) + 360) % 360).padStart(3, '0'), x, 15);
      }
      // Bow marker on the tape
      const bd = angleDiff(look, heading);
      const bx = Math.abs(bd) < f / 2 ? tapeX(bd, f, w) : -1;
      if (bx > 0 && bx < w) {
        ctx.fillStyle = '#e8c37a';
        ctx.beginPath(); ctx.moveTo(bx, 1); ctx.lineTo(bx - 5, 9); ctx.lineTo(bx + 5, 9); ctx.fill();
      }
      if (photoReq) {
        photoReq = false;
        const vfov = (2 * Math.atan(Math.tan((f * Math.PI) / 360) * (H / w)) * 180) / Math.PI;
        snapPhoto({ layers: [g3.canvas, view], crop: { x: 0, y: 0, w, h: H }, bearing: look, fov: f, vfov, pitch, label: store.selected });
        flashAt = nowMs;
      }
      shutterFlash(ctx, 0, 0, w, H, nowMs - flashAt);
    },
  };
}
