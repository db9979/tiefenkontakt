import { CLASSES, type ServerMsg, type Snapshot } from '@tk/shared';
import { audio } from '../audio.js';
import { store } from '../store.js';
import { h } from '../widgets/format.js';
import { lookFromOrientation, turnFrom } from '../widgets/gyro.js';
import { reticle } from '../widgets/reticle.js';
import { bridgeTargets, periscopeTargets } from '../widgets/scope-targets.js';
import { ownNow } from '../widgets/smooth.js';
import type { Periscope3D } from '../widgets/periscope3d.js';

/**
 * The phone view (#phone=<code>): the player's periscope or binoculars, full screen. Turn and
 * tilt the phone to look around (gyro; dragging works too), pinch for power, tap a ship to
 * select it. The PC's station follows where the phone looks. Sound from the phone's speaker.
 */

const SUB_MAGS = [1.5, 6, 12];
const GLASS_MAGS = [6, 8, 10, 12];

export function phoneScreen(root: HTMLElement, code: string): void {
  document.body.classList.add('phone-view');
  const el = h(`<div style="position:fixed;inset:0;background:#000;touch-action:none;user-select:none">
    <canvas id="ph-gl" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
    <canvas id="ph-ov" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
    <div id="ph-top" style="position:absolute;top:0;left:0;right:0;padding:6px 10px;color:#9fd8c4;font:13px ui-monospace,monospace;background:rgba(0,0,0,0.45);display:flex;justify-content:space-between"></div>
    <div id="ph-bar" style="position:absolute;bottom:0;left:0;right:0;padding:8px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center;background:rgba(0,0,0,0.5)">
      <button id="ph-ahead">Voraus</button><button id="ph-mag"></button><button id="ph-glass">Fernglas</button><button id="ph-stab">Stab</button>
      <button id="ph-photo">Foto</button><button id="ph-snd">Ton</button>
    </div>
    <div id="ph-start" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#030606;color:#9fd8c4;font:15px ui-monospace,monospace;text-align:center;padding:20px">
      <div>TIEFENKONTAKT · HANDY-ANSICHT</div><div id="ph-msg" class="dim">VERBINDE …</div>
      <button id="ph-go" style="font-size:18px;padding:12px 22px">Start</button>
      <div class="dim" style="font-size:12px;line-height:1.5">Drehen und Neigen zum Umschauen, zwei Finger zoomen,<br>Tippen wählt ein Schiff. „Voraus“ richtet neu aus.</div>
    </div>
  </div>`);
  root.replaceChildren(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const glCanvas = q<HTMLCanvasElement>('#ph-gl');
  const ov = q<HTMLCanvasElement>('#ph-ov');
  let gl: Periscope3D | undefined;
  let glFor = '';

  // Look state: the phone's own yaw plus an offset that makes "Voraus" the bow
  let yaw = 0, elev = 0, offset = 0, calibrated = false, gyro = false;
  let mag = 6, glass = true, stab = false, sound = true;
  let selected: string | undefined;
  const sub = () => !!store.snap && CLASSES[store.snap.own.cls].submarine;
  const mags = () => (sub() ? SUB_MAGS : GLASS_MAGS);
  const fov = () => (sub() ? 48 / mag : glass ? 52 / mag : 75);
  const bearing = () => (((yaw + offset) % 360) + 360) % 360;
  const label = () => {
    q('#ph-mag').textContent = !sub() && !glass ? 'Auge' : `${String(mag).replace('.', ',')}×`;
    q('#ph-glass').style.display = sub() ? 'none' : '';
    q('#ph-glass').classList.toggle('on', glass);
    q('#ph-stab').classList.toggle('on', stab);
    q('#ph-snd').classList.toggle('on', sound);
  };
  const calibrate = () => {
    const s = store.snap;
    offset = ((s ? ownNow().heading : 0) - yaw + 360) % 360;
    calibrated = true;
  };

  // Socket to the server with the one-time code
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?phone=${encodeURIComponent(code)}`);
  const send = (m: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  ws.onopen = () => (q('#ph-msg').textContent = 'VERBUNDEN · WARTE AUF DIE LAGE …');
  ws.onclose = (e) => {
    q('#ph-start').style.display = 'flex';
    q('#ph-msg').textContent = e.code === 4003 ? 'CODE UNGÜLTIG ODER ABGELAUFEN · AM PC EINEN NEUEN QR-CODE ÖFFNEN' : 'VERBINDUNG GETRENNT';
    q('#ph-go').style.display = 'none';
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as ServerMsg;
    if (m.t === 'snap') {
      store.ingest(m.s);
      if (q('#ph-msg').textContent!.startsWith('VERBUNDEN')) q('#ph-msg').textContent = 'BEREIT';
      if (sound) audio.update(m.s, CLASSES[m.s.own.cls].submarine);
      if (!mags().includes(mag)) mag = mags()[1]!;
      label();
    } else if (m.t === 'end') q('#ph-top').textContent = `PARTIE ZU ENDE · ${m.reason.toUpperCase()}`;
  };

  // Start: sensors need a tap (iOS asks for permission), sound needs it too
  q('#ph-go').onclick = async () => {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    try {
      if (typeof DOE.requestPermission === 'function') await DOE.requestPermission();
    } catch { /* drag still works */ }
    audio.unlock();
    q('#ph-start').style.display = 'none';
    calibrated = false;
  };
  window.addEventListener('deviceorientation', (e) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    gyro = true;
    const l = lookFromOrientation(e.alpha, e.beta, e.gamma);
    // Stabilised: a stronger low-pass takes the tremor out of the hands
    const k = stab ? 0.12 : 0.5;
    yaw = calibrated ? (yaw + turnFrom(yaw, l.yaw) * k + 360) % 360 : l.yaw;
    elev += (l.elev - elev) * k;
    if (!calibrated && store.snap) calibrate();
  });

  // Drag (no gyro, or to fine-tune), pinch to zoom, tap to select
  const touches = new Map<number, { x: number; y: number }>();
  let pinch0 = 0, mag0 = mag, moved = false;
  ov.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch0 = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      mag0 = mag;
    }
  });
  ov.addEventListener('pointermove', (e) => {
    const p = touches.get(e.pointerId);
    if (!p) return;
    if (touches.size === 2) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...touches.values()];
      const f = Math.hypot(a!.x - b!.x, a!.y - b!.y) / Math.max(1, pinch0);
      const list = mags();
      const want = mag0 * f;
      mag = list.reduce((x, y) => (Math.abs(Math.log(y / want)) < Math.abs(Math.log(x / want)) ? y : x));
      label();
      moved = true;
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    offset -= (dx / ov.clientWidth) * fov();
    if (!gyro) elev = Math.max(-30, Math.min(75, elev + (dy / ov.clientHeight) * fov()));
  });
  const up = (e: PointerEvent) => {
    const wasTap = touches.size === 1 && !moved;
    touches.delete(e.pointerId);
    if (!wasTap || !store.snap) return;
    // Tap: the ship nearest to the tapped bearing
    const b = bearing() + ((e.clientX - ov.clientWidth / 2) / (ov.clientWidth / 2)) * (fov() / 2);
    const tg = (sub() ? periscopeTargets(store.snap) : bridgeTargets(store.snap)).filter((t) => !t.sunk && !t.plane)
      .sort((x, y) => Math.abs(turnFrom(x.bearing, b)) - Math.abs(turnFrom(y.bearing, b)))[0];
    if (tg && Math.abs(turnFrom(tg.bearing, b)) < fov() / 8) {
      selected = tg.label;
      send({ t: 'select', label: tg.label });
    }
  };
  ov.addEventListener('pointerup', up);
  ov.addEventListener('pointercancel', (e) => touches.delete(e.pointerId));

  q('#ph-ahead').onclick = calibrate;
  q('#ph-mag').onclick = () => {
    const list = mags();
    if (!sub() && !glass) glass = true;
    else mag = list[(list.indexOf(mag) + 1) % list.length]!;
    label();
  };
  q('#ph-glass').onclick = () => ((glass = !glass), label());
  q('#ph-stab').onclick = () => ((stab = !stab), label());
  q('#ph-photo').onclick = () => send({ t: 'photo' });
  q('#ph-snd').onclick = () => {
    sound = !sound;
    audio.setMuted(!sound);
    label();
  };
  label();

  // Render loop; the look goes to the PC a few times a second
  let sentAt = 0;
  const t0 = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const s = store.snap;
    if (!s) return;
    const kind = sub() ? 'sub' : s.own.cls;
    if (!gl || glFor !== kind) void ensureGl(s, kind);
    if (now - sentAt > 200) {
      sentAt = now;
      send({ t: 'look', bearing: bearing(), elev, mag, glass: sub() || glass });
    }
    draw(s, (now - t0) / 1000);
  };
  requestAnimationFrame(frame);

  async function ensureGl(s: Snapshot, kind: string): Promise<void> {
    if (glFor === kind) return;
    glFor = kind;
    const m = await import('../widgets/periscope3d.js');
    gl?.dispose();
    const surface = !CLASSES[s.own.cls].submarine;
    gl = new m.Periscope3D(glCanvas, surface ? { eye: 20, own: s.own.cls === 'kor' || s.own.cls === 'ffv' ? s.own.cls : 'ffg' } : {});
  }

  function draw(s: Snapshot, t: number): void {
    const w = ov.clientWidth, hgt = ov.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (ov.width !== Math.round(w * dpr)) [ov.width, ov.height] = [Math.round(w * dpr), Math.round(hgt * dpr)];
    const ctx = ov.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const isSub = sub();
    const mastUp = (s.own.mastExt ?? (s.own.mastUp ? 1 : 0)) >= 0.55;
    const f = fov();
    glCanvas.style.visibility = gl && (!isSub || mastUp) ? 'visible' : 'hidden';
    if (gl && (!isSub || mastUp)) {
      const own = ownNow();
      gl.render({
        bearing: bearing(), fovDeg: isSub ? f * (w / Math.min(w, hgt)) : f, t, sea: s.env.seaState, light: s.env.light ?? 1,
        targets: isSub ? periscopeTargets(s) : bridgeTargets(s), rain: s.env.rain, hour: s.env.clock,
        pitchDeg: isSub ? elev : glass ? elev - 0.15 : elev - 8, met: s.env.met, own, ownHeading: own.heading, ownKn: s.own.speedKn,
        stabilize: stab, shake: !isSub && glass ? 0.012 * mag : 0,
      });
    }
    // Optic: a round periscope field or the binocular mask with its reticle
    ctx.fillStyle = '#020303';
    if (isSub) {
      const r = Math.min(w, hgt) * 0.47;
      ctx.beginPath(); ctx.rect(0, 0, w, hgt); ctx.moveTo(w / 2 + r, hgt / 2); ctx.arc(w / 2, hgt / 2, r, 0, 7, true); ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(20,24,22,0.85)';
      ctx.beginPath(); ctx.moveTo(w / 2 - r, hgt / 2); ctx.lineTo(w / 2 + r, hgt / 2); ctx.moveTo(w / 2, hgt / 2 - r); ctx.lineTo(w / 2, hgt / 2 + r); ctx.stroke();
      if (!mastUp) {
        ctx.fillStyle = '#9fd8c4'; ctx.font = '14px ui-monospace, monospace'; ctx.textAlign = 'center';
        ctx.fillText('SEHROHR EINGEFAHREN', w / 2, hgt / 2);
      }
    } else if (glass) {
      const r = Math.min(w * 0.3, hgt * 0.46);
      ctx.beginPath(); ctx.rect(0, 0, w, hgt);
      for (const dx of [-0.55, 0.55]) { ctx.moveTo(w / 2 + dx * r + r, hgt / 2); ctx.arc(w / 2 + dx * r, hgt / 2, r, 0, 7, true); }
      ctx.fill('evenodd');
      reticle(ctx, w, hgt, f, r);
    }
    const sel = selected ? ` · ${selected}` : '';
    q('#ph-top').textContent = `PEILUNG ${String(Math.round(bearing()) % 360).padStart(3, '0')}° · ELEV ${elev >= 0 ? '+' : ''}${elev.toFixed(0)}° · ${!isSub && !glass ? 'AUGE' : `${String(mag).replace('.', ',')}×`}${stab ? ' · STAB' : ''}${sel}`;
  }
}
