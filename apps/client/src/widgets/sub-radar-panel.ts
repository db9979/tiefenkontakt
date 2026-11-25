import { NM } from '@tk/shared';
import { store } from '../store.js';
import { fitCanvas, h, mastState } from './format.js';
import { RadarScope } from './radar-scope.js';

/** The mast radar's screen: out to its short horizon (about 14 nm), so 16 nm rings. */
const RANGE_NM = 16;
/** A small mast antenna turns faster than a frigate's. */
const RPM = 24;
const ANTENNA_M = 4;
const H = 300;

/**
 * Radar screen of the submarine's mast radar beside the periscope: shown only while the radar
 * is switched on; it sweeps once the mast is fully up. Same tube as the frigate's scope.
 */
export function subRadarPanel(): { el: HTMLElement; frame(): void } {
  const el = h(`<div class="panel" style="display:none"><div class="hd"><span>Mastradar · ${RANGE_NM} SM</span><span id="sr-st" class="dim"></span></div><canvas id="sr-ppi"></canvas></div>`);
  const canvas = el.querySelector<HTMLCanvasElement>('#sr-ppi')!;
  const st = el.querySelector<HTMLElement>('#sr-st')!;
  const scope = new RadarScope();
  let last = performance.now();
  return {
    el,
    frame() {
      const s = store.snap;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const shown = !!s?.own.radarOn;
      el.style.display = shown ? '' : 'none';
      if (!s || !shown) return;
      const on = mastState(s.own).raised;
      st.className = on ? 'amber' : 'dim';
      st.textContent = on ? 'SENDET · JEDES ESM PEILT DICH' : 'WARTET AUF DEN MAST';
      scope.update(s, dt, RPM, RANGE_NM * NM, { on, antennaM: ANTENNA_M });
      const ctx = fitCanvas(canvas, H);
      scope.draw(ctx, canvas.clientWidth, H, s, RANGE_NM, store.selected);
    },
  };
}
