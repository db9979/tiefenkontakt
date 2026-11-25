import { MINE_BOTTOM_MAX, MINE_LAY_MAX_KN, MINE_MAX_WATER, MINE_MIN_WATER } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { h, kn, setHtml } from './format.js';

/**
 * The boat's mines (fire-control station): how many are left, whether the water here takes
 * one (depth under the keel from the chart, speed), and "Mine legen" at the current position.
 */
export function minePanel(): { el: HTMLElement; update(): void } {
  const el = h(`<div class="panel"><div class="hd"><span>Minen</span><span id="mn-n"></span></div>
    <div id="mn-st"></div>
    <button id="mn-lay" class="fire" style="width:100%;margin-top:6px">Mine legen</button>
    <div class="dim" style="margin-top:4px">GRUNDMINE BIS ${MINE_BOTTOM_MAX} M WASSERTIEFE, ANKERTAUMINE BIS ${MINE_MAX_WATER} M. SCHARF NACH 3 MIN, TRIFFT JEDES SCHIFF.</div>
  </div>`);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  q<HTMLButtonElement>('#mn-lay').onclick = () => net.send({ t: 'mine' });
  return {
    el,
    update() {
      const s = store.snap;
      const n = s?.own.loadout.mines;
      el.style.display = n === undefined ? 'none' : '';
      if (!s || n === undefined) return;
      const water = s.env.bottom;
      const laid = (s.mines ?? []).filter((m) => m.own);
      q('#mn-n').textContent = `${n} AN BORD · ${laid.length} GELEGT`;
      const depthOk = water !== undefined && water <= MINE_MAX_WATER && water >= MINE_MIN_WATER;
      const slow = s.own.speedKn <= MINE_LAY_MAX_KN + 0.3;
      setHtml(q('#mn-st'), `
        <div class="row"><span class="dim">WASSERTIEFE</span><span class="${depthOk ? '' : 'amber'}">${water !== undefined ? `${water} M` : '—'} · ${
          !depthOk ? (water !== undefined && water < MINE_MIN_WATER ? 'ZU FLACH' : 'ZU TIEF') : water! <= MINE_BOTTOM_MAX ? 'GRUNDMINE' : 'ANKERTAUMINE'}</span></div>
        <div class="row"><span class="dim">FAHRT</span><span class="${slow ? '' : 'amber'}">${kn(s.own.speedKn)}${slow ? '' : ` · MAX. ${kn(MINE_LAY_MAX_KN)}`}</span></div>`);
      // Red only when a mine can go: disabled in the neutral grey, not as a red alarm
      const lay = q<HTMLButtonElement>('#mn-lay');
      lay.disabled = n <= 0 || !depthOk || !slow || !s.own.alive;
      lay.classList.toggle('fire', !lay.disabled);
    },
  };
}
