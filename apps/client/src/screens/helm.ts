import { CLASSES, PERISCOPE_DEPTH } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { deg3, kn } from '../widgets/format.js';

/** Helm strip: course, speed and depth orders. Visible on every station. */
export function mountHelm(el: HTMLElement) {
  el.innerHTML = `
    <div class="hd"><span>Ruderstand</span><span class="kbd">← → KURS · ↑ ↓ FAHRT · BILD↑↓ TIEFE</span></div>
    <div class="row"><span class="dim">KURS</span><span id="h-hdg"></span></div>
    <div style="display:flex;gap:4px;margin:4px 0"><input id="h-in" type="number" min="0" max="359" style="width:70px" placeholder="047"><button id="h-set">Kurs</button></div>
    <div class="row"><span class="dim">FAHRT</span><span id="h-spd"></span></div>
    <input id="h-speed" type="range" min="0" max="30" step="1">
    <div id="depth-box">
      <div class="row"><span class="dim">TIEFE</span><span id="h-dep"></span></div>
      <input id="h-depth" type="range" min="0" max="400" step="5">
      <div style="display:flex;gap:4px;margin-top:4px"><button id="h-peri">Sehrohrtiefe</button><button id="h-layer">Unter Schicht</button></div>
    </div>`;
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const order = (o: { heading?: number; speedKn?: number; depth?: number }) => net.send({ t: 'order', ...o });

  q<HTMLButtonElement>('#h-set').onclick = () => {
    const v = Number(q<HTMLInputElement>('#h-in').value);
    if (Number.isFinite(v)) order({ heading: ((v % 360) + 360) % 360 });
  };
  q<HTMLInputElement>('#h-in').onkeydown = (e) => {
    if (e.key === 'Enter') q<HTMLButtonElement>('#h-set').click();
    e.stopPropagation();
  };
  q<HTMLInputElement>('#h-speed').oninput = (e) => order({ speedKn: Number((e.target as HTMLInputElement).value) });
  q<HTMLInputElement>('#h-depth').oninput = (e) => order({ depth: Number((e.target as HTMLInputElement).value) });
  q<HTMLButtonElement>('#h-peri').onclick = () => order({ depth: PERISCOPE_DEPTH });
  q<HTMLButtonElement>('#h-layer').onclick = () => order({ depth: (store.snap?.env.layerDepth ?? 120) + 30 });

  return {
    update() {
      const s = store.snap;
      if (!s) return;
      const o = s.own;
      const spec = CLASSES[o.cls];
      q('#h-hdg').textContent = `${deg3(o.heading)}° → ${deg3(o.order.heading)}°`;
      q('#h-spd').innerHTML = `${kn(o.speedKn)} → ${kn(o.order.speedKn)}${o.speedKn > o.cavitationKn ? ' <span class="red">KAVITATION</span>' : ''}`;
      const sp = q<HTMLInputElement>('#h-speed');
      sp.max = String(spec.maxSpeedKn);
      if (document.activeElement !== sp) sp.value = String(o.order.speedKn);
      q('#depth-box').style.display = spec.submarine ? '' : 'none';
      if (spec.submarine) {
        q('#h-dep').textContent = `${o.depth.toFixed(0)} M → ${o.order.depth.toFixed(0)} M`;
        const dp = q<HTMLInputElement>('#h-depth');
        dp.max = String(spec.maxDepth);
        if (document.activeElement !== dp) dp.value = String(o.order.depth);
      }
    },
    key(e: KeyboardEvent) {
      const s = store.snap;
      if (!s) return;
      const o = s.own.order;
      const stepH = e.shiftKey ? 1 : 5;
      if (e.key === 'ArrowLeft') order({ heading: (o.heading - stepH + 360) % 360 });
      else if (e.key === 'ArrowRight') order({ heading: (o.heading + stepH) % 360 });
      else if (e.key === 'ArrowUp') order({ speedKn: Math.min(o.speedKn + 1, CLASSES[s.own.cls].maxSpeedKn) });
      else if (e.key === 'ArrowDown') order({ speedKn: Math.max(o.speedKn - 1, 0) });
      else if (e.key === 'PageUp') order({ depth: Math.max(o.depth - 10, 0) });
      else if (e.key === 'PageDown') order({ depth: o.depth + 10 });
      else return;
      e.preventDefault();
    },
  };
}
