import { angleDiff, fogAt, lookoutRanges, type Sighting } from '@tk/shared';
import type { Periscope3D, PeriscopeTarget } from '../../widgets/periscope3d.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { isKey } from '../../widgets/keys.js';
import { easeAngle, moverNow, ownNow, simNow } from '../../widgets/smooth.js';
import { planeTargets } from '../../widgets/air-targets.js';
import { blasts } from '../../widgets/blasts.js';
import { deg3, fitCanvas, h, km, setHtml } from '../../widgets/format.js';

const H = 380;
const WIDE_FOV = 75;
const GLASS_FOV = 7;
/** Visual contacts stay in the picture this long after the last sighting (s). */
const SIGHT_HOLD = 8;
const WHAT: Record<Sighting, string> = { mast: 'SEHROHR', snorkel: 'SCHNORCHEL', surfaced: 'AUFGETAUCHT' };

/** Escorts' bridge: lookout view in 3D with 7× binoculars, own formation in sight, lookout reports. */
export function bridgeStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Brücke · Ausguck</span><span id="b-brg" class="dim"></span></div>
      <div style="position:relative"><canvas id="gl" style="position:absolute;inset:0;width:100%;height:${H}px"></canvas><canvas id="view" style="position:relative"></canvas></div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button id="glass">Fernglas 7×</button>
        <button id="left" title="Blick nach links">◀</button><button id="right" title="Blick nach rechts">▶</button>
        <button id="ahead">Voraus</button><button id="report" class="warn">Auf Meldung</button><button id="tocontact">Auf Kontakt</button><button id="toair" title="Nacheinander auf jedes sichtbare Flugzeug schwenken und ihm folgen">Luft</button>
        <span class="kbd" style="align-self:center">ZIEHEN DREHT · A / D</span>
      </div>
    </div>
    <div class="panel"><div class="hd"><span>Ausguck</span><span class="dim">20 M AUGENHÖHE</span></div><div id="b-data"></div></div>
  </div>`);
  const view = el.querySelector<HTMLCanvasElement>('#view')!;
  let glCanvas = el.querySelector<HTMLCanvasElement>('#gl')!;
  let gl: Periscope3D | undefined;
  let failed = localStorage.getItem('tk_3d') === '0';
  let loading = false;
  let freeTimer: ReturnType<typeof setTimeout> | undefined;
  /** The 3D scene is created on first view and freed 20 s after the player leaves the bridge. */
  const ensureGl = () => {
    clearTimeout(freeTimer);
    if (gl || loading || failed) return;
    loading = true;
    import('../../widgets/periscope3d.js')
      .then((m) => {
        loading = false;
        if (m.Periscope3D.supported()) gl = new m.Periscope3D(glCanvas, { eye: 20, own: store.snap?.own.cls === 'kor' || store.snap?.own.cls === 'ffv' ? store.snap.own.cls : 'ffg' });
        else failed = true;
      })
      .catch(() => (failed = true));
  };

  /** Look direction relative to the bow, so the view turns with the ship like a real bridge wing. */
  let relTarget = 0;
  let rel = 0;
  let glass = false;
  let last = performance.now();
  const t0 = performance.now();
  /** Smoothed screen positions per target (bearing, range), so 1 Hz updates glide. */
  const shown = new Map<string, { b: number; r: number }>();

  const fov = () => (glass ? GLASS_FOV : WIDE_FOV);
  let maskCanvas: HTMLCanvasElement | undefined;
  const mask = (w: number, hgt: number) => {
    if (!maskCanvas) maskCanvas = document.createElement('canvas');
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
  el.querySelector<HTMLButtonElement>('#glass')!.onclick = (e) => {
    glass = !glass;
    (e.target as HTMLButtonElement).classList.toggle('on', glass);
  };
  el.querySelector<HTMLButtonElement>('#left')!.onclick = () => turn(glass ? -3 : -20);
  el.querySelector<HTMLButtonElement>('#right')!.onclick = () => turn(glass ? 3 : 20);
  el.querySelector<HTMLButtonElement>('#ahead')!.onclick = () => (relTarget = 0);
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
  for (const id of ['#left', '#right', '#ahead', '#report']) el.querySelector(id)!.addEventListener('click', () => (airTrack = undefined));
  let dragX: number | undefined;
  view.style.cursor = 'ew-resize';
  view.style.touchAction = 'none';
  view.addEventListener('pointerdown', (e) => (dragX = e.clientX));
  window.addEventListener('pointerup', () => (dragX = undefined));
  view.addEventListener('pointermove', (e) => {
    if (dragX === undefined) return;
    const dx = e.clientX - dragX;
    dragX = e.clientX;
    turn((-dx / view.clientWidth) * fov());
    rel = relTarget;
  });

  /** What the bridge can see: own formation within visual range, and lookout sightings. */
  function targets(): PeriscopeTarget[] {
    const s = store.snap;
    if (!s) return [];
    const env = { layerDepth: 0, layerLoss: 0, seaState: s.env.seaState, light: s.env.light, rain: s.env.rain };
    const reach = Math.max(4_000, lookoutRanges(env).surfaced * 1.8);
    const out: PeriscopeTarget[] = [];
    // Own ship and formation extrapolated to this frame, so the picture glides between 1 Hz updates
    const me = ownNow();
    for (const f of s.friendlies) {
      if (f.id === s.own.id) continue;
      // A mate that sank: shown going down if she was in sight
      if (!f.alive) {
        out.push({ label: f.id, cls: f.cls, bearing: 0, range: 0, alpha: 0, sunk: true });
        continue;
      }
      const fp = s.time - f.reportedAt < 3 ? moverNow(f, f.reportedAt) : f;
      const dx = fp.x - me.x;
      const dy = fp.y - me.y;
      const r = Math.hypot(dx, dy);
      if (r > reach || r < 50) continue;
      out.push({ label: f.id, cls: f.cls, bearing: (Math.atan2(dx, dy) * 180) / Math.PI, range: r, course: f.heading, speedKn: f.speedKn, alpha: 1, lit: f.lit, wreck: f.wreck });
    }
    const now = simNow();
    for (const c of s.contacts) {
      if (!c.sighting || c.sightedAt === undefined || c.range === undefined) continue;
      const age = now - c.sightedAt;
      if (age > SIGHT_HOLD) continue;
      out.push({ label: c.label, cls: 'ssk', sighting: c.sighting, bearing: c.bearing, range: c.range, alpha: Math.min(1, (SIGHT_HOLD - age) / 2), speedKn: 6, course: c.bearing + 90 });
    }
    // Aircraft in sight (helicopters, patrol aircraft, airliners, the enemy's recon)
    out.push(...planeTargets(s, me, now));
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
    return `<div class="row"><span class="dim">LUFT IN SICHT</span><span>${air.length || '—'}</span></div>${f && f.x !== undefined ? `<div class="row amber"><span>${NAME[f.kind]}</span><span>${deg3(f.bearing)}° · ${km(Math.hypot(f.x - s.own.x, f.y! - s.own.y))} · ${km(f.alt ?? 0)} HOCH</span></div>` : ''}`;
  };

  return {
    title: 'Brücke',
    el,
    key(e) {
      if (isKey(e, 'scopeLeft')) turn(glass ? -1 : -5);
      else if (isKey(e, 'scopeRight')) turn(glass ? 1 : 5);
      else return false;
      return true;
    },
    snap() {
      const s = store.snap!;
      const env = { layerDepth: 0, layerLoss: 0, seaState: s.env.seaState, light: s.env.light, rain: s.env.rain };
      const fog = fogAt(s.env.met, s.own);
      const r = lookoutRanges(env, fog);
      const quality = r.mast > 1500 ? 'GUT' : r.mast > 600 ? 'MÄSSIG' : 'SCHLECHT';
      const reports = s.alerts.filter((a) => a.kind === 'sighting').slice(-6).reverse();
      setHtml(el.querySelector('#b-data')!, `
        <div class="row"><span class="dim">SICHT</span><span class="${quality === 'GUT' ? '' : 'amber'}">${quality}${fog > 0.3 ? ' · NEBEL' : ''}${s.env.rain ? ' · REGEN' : ''}${(s.env.light ?? 1) < 0.3 ? ' · NACHT' : ''}</span></div>
        <div class="row"><span class="dim">SEHROHR (6 KN) BIS</span><span>${km(r.mast)}</span></div>
        <div class="row"><span class="dim">SCHNORCHEL BIS</span><span>${km(r.snorkel)}</span></div>
        <div class="row"><span class="dim">AUFGETAUCHT BIS</span><span>${km(r.surfaced)}</span></div>
        ${airLine(s)}
        <div class="dim" style="margin:8px 0 4px">MELDUNGEN</div>
        ${reports.length ? reports.map((a) => `<div class="row ${s.time - a.time < 60 ? 'amber' : 'dim'}"><span>${a.label ?? ''} ${WHAT[a.what ?? 'mast']}</span><span>${deg3(a.bearing ?? 0)}° · ${km(a.range ?? 0)}</span></div>`).join('') : '<div class="dim">NOCH KEINE SICHTUNG</div>'}
        <div class="dim" style="margin-top:8px;line-height:1.5">Die Ausgucks melden Sehrohr-Fahnen, Schnorchel und Torpedolaufbahnen selbst. Nachts, bei Regen und hohem Seegang sehen sie kaum etwas.</div>`);
    },
    hide() {
      freeTimer = setTimeout(() => {
        if (!gl) return;
        gl.dispose();
        gl = undefined;
        // A context that was given up cannot be reused: start the next scene on a fresh canvas
        const fresh = glCanvas.cloneNode() as HTMLCanvasElement;
        glCanvas.replaceWith(fresh);
        glCanvas = fresh;
      }, 20_000);
    },
    frame() {
      ensureGl();
      const s = store.snap;
      const ctx = fitCanvas(view, H);
      const w = view.clientWidth;
      const nowMs = performance.now();
      rel = ((easeAngle(rel, relTarget, (nowMs - last) / 1000, 0.15) + 540) % 360) - 180;
      last = nowMs;
      const t = (nowMs - t0) / 1000;
      const heading = s ? ownNow().heading : 0;
      const look = (heading + rel + 360) % 360;
      const f = fov();
      el.querySelector('#b-brg')!.textContent = `BLICK ${deg3(look)}° · ${rel === 0 ? 'VORAUS' : `${Math.abs(Math.round(rel))}° ${rel > 0 ? 'STB' : 'BB'}`}`;
      const live = !!gl && !!s;
      glCanvas.style.visibility = live ? 'visible' : 'hidden';
      const tg = live ? targets() : [];
      // Following an aircraft: bearing and elevation of the plane, else the normal look over the sea
      const followed = airTrack ? tg.find((x) => x.label === airTrack) : undefined;
      if (airTrack && !followed && live) airTrack = undefined;
      if (followed && s) relTarget = angleDiff(s.own.heading, followed.bearing);
      const wantPitch = followed ? Math.min(70, (Math.atan2((followed.alt ?? 0) - 20, followed.range) * 180) / Math.PI) : glass ? -0.15 : -8;
      pitch += (wantPitch - pitch) * 0.1;
      if (live) {
        gl!.render({
          bearing: look, fovDeg: f, t, sea: s!.env.seaState, light: s!.env.light ?? 1, targets: tg,
          rain: s!.env.rain, hour: s!.env.clock, pitchDeg: pitch, ownHeading: heading, ownKn: s!.own.speedKn, met: s!.env.met,
          effects: blasts(s!, tg.filter((x) => !x.sunk && !x.plane && !x.sighting), nowMs), own: ownNow(), ownWreck: s!.own.wreck,
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
        ctx.fillText(failed ? 'KEINE 3D-GRAFIK (WEBGL2) · MELDUNGEN RECHTS' : 'LADE …', w / 2, H / 2);
        return;
      }
      // Sighting markers in view
      for (const c of tg) {
        if (!c.sighting) continue;
        const d = angleDiff(look, c.bearing);
        if (Math.abs(d) > f / 2) continue;
        const x = w / 2 + (Math.tan((d * Math.PI) / 180) / Math.tan((f * Math.PI) / 360)) * (w / 2);
        // Vertical: the object sits just below the horizon by the dip from 20 m eye height
        const pitch = ((glass ? -0.15 : -8) * Math.PI) / 180;
        const tanV = Math.tan((f * Math.PI) / 360) / (w / H);
        const y = H / 2 - (Math.tan(-Math.atan(20 / c.range) - pitch) / tanV) * (H / 2);
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
      // Bearing tape
      ctx.fillStyle = 'rgba(3,8,8,0.6)';
      ctx.fillRect(0, 0, w, 16);
      ctx.strokeStyle = '#9fd8c4';
      ctx.fillStyle = '#9fd8c4';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      const step = glass ? 1 : 5;
      for (let a = Math.ceil((look - f / 2) / step) * step; a <= look + f / 2; a += step) {
        const x = w / 2 + (angleDiff(look, a) / (f / 2)) * (w / 2);
        const major = a % (glass ? 5 : 30) === 0;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, major ? 7 : 4); ctx.stroke();
        if (major) ctx.fillText(String(((a % 360) + 360) % 360).padStart(3, '0'), x, 15);
      }
      // Bow marker on the tape
      const bx = w / 2 + (angleDiff(look, heading) / (f / 2)) * (w / 2);
      if (bx > 0 && bx < w) {
        ctx.fillStyle = '#e8c37a';
        ctx.beginPath(); ctx.moveTo(bx, 1); ctx.lineTo(bx - 5, 9); ctx.lineTo(bx + 5, 9); ctx.fill();
      }
    },
  };
}

