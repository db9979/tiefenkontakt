import { CLASSES, angleDiff, bearing, distance, type ClassId, type Snapshot } from '@tk/shared';
import type { Periscope3D, PeriscopeTarget } from './periscope3d.js';
import { deg3, km } from './format.js';
import { lang } from '../i18n/index.js';

const L = (de: string, en: string) => (lang === 'en' ? en : de);

/**
 * "Lookout reports a hit": when an explosion is seen (escorts always, boats with the mast up),
 * a small 3D inset pops up wherever the player is, showing the blast through binoculars:
 * water column, smoke, fire at night, the struck ship going down. Closes by itself.
 */

const SHOW_S = 14;
const MAX_RANGE = 25_000;

interface Shot { id: string; bearing: number; range: number; cls: ClassId; startMs: number }

export function hitCam(root: HTMLElement): { snap(s: Snapshot): void; frame(s: Snapshot | undefined): void } {
  const box = document.createElement('div');
  box.className = 'hitcam';
  box.innerHTML = `<div class="hd"><span id="hc-t"></span><button id="hc-x" title="Schließen">×</button></div><canvas id="hc-gl"></canvas>`;
  box.style.display = 'none';
  root.appendChild(box);
  const canvas = box.querySelector<HTMLCanvasElement>('#hc-gl')!;
  let gl: Periscope3D | undefined;
  let loading = false;
  let shot: Shot | undefined;
  let lastAlert = -1;
  box.querySelector<HTMLButtonElement>('#hc-x')!.onclick = () => close();

  function close(): void {
    shot = undefined;
    box.style.display = 'none';
  }

  function ensureGl(): void {
    if (gl || loading || localStorage.getItem('tk_3d') === '0') return;
    loading = true;
    import('./periscope3d.js')
      .then((m) => {
        if (m.Periscope3D.supported()) gl = new m.Periscope3D(canvas, { eye: 18 });
      })
      .catch(() => undefined);
  }

  return {
    snap(s) {
      const canSee = !CLASSES[s.own.cls].submarine || s.own.mastUp;
      for (const a of s.alerts) {
        if (a.kind !== 'hit' || a.bearing === undefined || a.time <= lastAlert) continue;
        lastAlert = a.time;
        if (!canSee || s.time - a.time > 20) continue;
        // Range and type from our own formation if the victim is one of ours; otherwise a guess
        let range = 6_000;
        let cls: ClassId = 'merchant';
        let best = 6;
        for (const f of s.friendlies) {
          const b = bearing(s.own, f);
          const d = Math.abs(angleDiff(b, a.bearing));
          if (d < best) {
            best = d;
            range = distance(s.own, f);
            cls = f.cls;
          }
        }
        if (range > MAX_RANGE) continue;
        shot = { id: `${a.time}|${a.bearing}`, bearing: a.bearing, range, cls, startMs: performance.now() };
        ensureGl();
        box.style.display = '';
        box.querySelector('#hc-t')!.textContent = L(`AUSGUCK · TREFFER PEILUNG ${deg3(a.bearing)} · CA. ${km(range)}`, `LOOKOUT · HIT BEARING ${deg3(a.bearing)} · ABOUT ${km(range)}`);
      }
    },
    frame(s) {
      if (!shot) return;
      const age = (performance.now() - shot.startMs) / 1000;
      if (age > SHOW_S) return close();
      box.style.opacity = String(Math.min(1, (SHOW_S - age) / 1.5));
      if (!gl || !s) return;
      // The struck ship is shown for a moment, then dropped: the scene lets it go down by the bow
      const targets: PeriscopeTarget[] = age < 3.5 ? [{ label: shot.id, cls: shot.cls, bearing: shot.bearing, range: shot.range, alpha: 1, speedKn: 4 }] : [];
      gl.render({
        bearing: shot.bearing, fovDeg: Math.max(4, Math.min(14, 9000 / shot.range * 2)), t: age, sea: s.env.seaState, light: s.env.light ?? 1,
        // The blast starts a moment later, once the ship stands in the scene (so it is marked to sink)
        targets, rain: s.env.rain, hour: s.env.clock, effects: age > 0.4 ? [{ id: shot.id, bearing: shot.bearing, range: shot.range, age: age - 0.4 }] : [],
        pitchDeg: -0.1,
      });
    },
  };
}
