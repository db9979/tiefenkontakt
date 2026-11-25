import { bearing, distance, targetPosAt, type Vec2 } from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { buoyAction, courseAction, mpaAction } from '../../widgets/actions.js';
import { lastFix } from '../../widgets/contact-pos.js';
import { guardFire } from '../../widgets/fire-guard.js';
import { h, km, setHtml } from '../../widgets/format.js';
import { mountHeloPanel } from '../../widgets/helo-panel.js';
import { Plot } from '../../widgets/plot.js';

/** Where the selected contact probably is: a fresh fix, else the TMA solution. */
function targetPoint(): Vec2 | undefined {
  const s = store.snap;
  const c = store.selectedContact();
  if (!s || !c) return undefined;
  const fix = lastFix(c, s, 120);
  if (fix) return fix.pos;
  const sol = store.solutions.get(c.label);
  return sol ? targetPosAt(sol, s.time + 60) : undefined;
}

/**
 * Flug (frigate with helicopter): the air wing in one place — the helicopter panel (state, load,
 * task queue), the sonobuoys in the water and the patrol aircraft's buoy barrier. The map keeps
 * the helicopter tasks on right-click / long press for any point.
 */
export function flightStation(): Station {
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Fluglage</span><span class="dim">RECHTSKLICK / LANGE TIPPEN = AUFTRAG HIER</span></div><canvas id="plot"></canvas></div>
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div id="fl-helo"></div>
      <div class="panel"><div class="hd"><span>Seefernaufklärer</span><span id="fl-mpa" class="dim"></span></div>
        <button id="fl-barrier" title="Der Seefernaufklärer legt 6 Bojen quer zur Peilung über dem Ziel">Bojensperre über dem Ziel</button>
      </div>
      <div class="panel"><div class="hd"><span>Bojen im Wasser</span></div><div id="fl-buoys"></div></div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const plot = new Plot(q<HTMLCanvasElement>('#plot'), {
    bearingLines: true, showConvoy: true, esmLines: false, actions: (p) => [...courseAction(p), ...buoyAction(p), ...mpaAction(p)],
  });
  plot.scale = 60;
  const at = (): { b: number; d: number } | undefined => {
    const s = store.snap;
    const p = targetPoint();
    return s && p ? { b: bearing(s.own, p), d: distance(s.own, p) } : undefined;
  };
  const helo = mountHeloPanel(q('#fl-helo'));
  guardFire(q<HTMLButtonElement>('#fl-barrier'), () => {
    const a = store.snap?.air;
    if (!at()) return { block: store.selectedContact() ? 'KEINE POSITION' : 'KONTAKT WÄHLEN' };
    if (!a || a.mpaReadyInS > 0) return { block: a ? `BEREIT IN ${Math.ceil(a.mpaReadyInS / 60)} MIN` : 'NICHT VERFÜGBAR' };
    if (a.mpaBuoys < 6) return { block: 'KEINE BOJEN MEHR' };
    return {};
  }, () => {
    const t = at();
    if (t) net.send({ t: 'mpa', bearing: t.b, range: t.d });
  });

  return {
    title: 'Flug',
    el,
    snap() {
      const s = store.snap!;
      const a = s.air;
      helo.update(s);
      q('#fl-mpa').textContent = !a ? '—' : a.mpaReadyInS > 0 ? `BEREIT IN ${Math.ceil(a.mpaReadyInS / 60)} MIN` : `BEREIT · ${a.mpaBuoys} BOJEN`;
      setHtml(q('#fl-buoys'), a?.buoys.length ? a.buoys.map((b) => `<div class="row"><span>${b.id}${b.active ? ' · AKTIV' : ''}</span><span>${km(distance(s.own, b))} · ${b.depth} M</span><span class="dim">NOCH ${Math.ceil(b.leftS / 60)} MIN</span></div>`).join('') : '<div class="dim">KEINE BOJE IM WASSER</div>');
    },
    frame() {
      plot.draw(Math.max(360, window.innerHeight - 90));
    },
  };
}
