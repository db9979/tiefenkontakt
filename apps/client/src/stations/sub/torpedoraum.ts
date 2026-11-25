import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { btnState } from '../../widgets/btn-state.js';
import { clock, h, km, setHtml, tdeg1 } from '../../widgets/format.js';
import { minePanel } from '../../widgets/mine-panel.js';
import { onTap } from '../../widgets/touch.js';

/**
 * Torpedoraum: the weapons as hardware — every tube with its load state and reload time, the
 * stock, the running torpedoes on the wire (steer the selected one in small or big steps), the
 * mines and the decoys. Aiming and firing stay in fire control.
 */
export function torpedoRoomStation(): Station {
  const el = h(`<div class="cols">
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel"><div class="hd"><span>Rohre</span><span id="tr-stock" class="dim"></span></div><div id="tr-tubes"></div></div>
      <div class="panel"><div class="hd"><span>Am Draht</span><span class="dim">UNTER 12 KN BLEIBEN, SONST REISST DER DRAHT</span></div><div id="tr-wires"></div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="panel"><div class="hd"><span>Täuschkörper</span><span class="dim">GERÄUSCHBOJE GEGEN ANLAUFENDE TORPEDOS</span></div>
        <div style="display:flex;gap:6px;align-items:center"><button id="tr-nm" class="warn">Täuschkörper ausstoßen</button><span class="dim">DANACH ABDREHEN UND TIEFE WECHSELN</span></div>
      </div>
      <div id="mines"></div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  // Fill of a reloading tube: share of the reload seen since it started (the reload time itself is not sent)
  const reloadMax = new Map<number, number>();
  const mines = minePanel();
  q('#mines').replaceWith(mines.el);
  q<HTMLButtonElement>('#tr-nm').onclick = () => net.send({ t: 'noisemaker' });
  onTap(q('#tr-wires'), '[data-steer]', (b) => {
    const t = store.snap?.torpedoes.find((x) => x.id === b.dataset.steer);
    if (t) net.send({ t: 'steer', torpId: t.id, heading: (t.heading + Number(b.dataset.d) + 360) % 360 });
  });
  onTap(q('#tr-wires'), '[data-pick]', (b) => (store.selected = b.dataset.pick));

  return {
    title: 'Torpedoraum',
    el,
    snap() {
      const s = store.snap!;
      const l = s.own.loadout;
      mines.update();
      q('#tr-stock').textContent = `VORRAT ${l.heavy} TORPEDOS`;
      setHtml(q('#tr-tubes'), l.tubes.map((t, i) => {
        if (t.reloadLeft > (reloadMax.get(i) ?? 0)) reloadMax.set(i, t.reloadLeft);
        if (t.loaded) reloadMax.delete(i);
        const pct = t.loaded ? 100 : t.reloadLeft > 0 ? 100 * (1 - t.reloadLeft / Math.max(1, reloadMax.get(i) ?? t.reloadLeft)) : 0;
        return `<div class="row" style="align-items:center"><span>ROHR ${i + 1}</span>
          <span style="flex:1;margin:0 8px;height:8px;border:1px solid var(--line2);position:relative"><i style="position:absolute;inset:0;width:${pct.toFixed(0)}%;background:${t.loaded ? 'var(--g)' : 'var(--amber)'};opacity:0.6"></i></span>
          <span class="${t.loaded ? '' : 'amber'}">${t.loaded ? 'GELADEN · BEREIT' : t.reloadLeft > 0 ? `LÄDT · ${Math.ceil(t.reloadLeft)} S` : l.heavy ? 'LEER' : 'LEER · KEIN VORRAT'}</span></div>`;
      }).join(''));
      setHtml(q('#tr-wires'), s.torpedoes.length ? s.torpedoes.map((t) => {
        const sel = t.id === store.selected;
        return `<div class="row ${sel ? 'amber selrow' : ''}" style="align-items:center">
          <span class="clickable" data-pick="${t.id}">${t.id} ${t.homing ? '<span class="red">ZIEL ERFASST</span>' : 'LÄUFT'}</span>
          <span>${tdeg1(t.heading)}° · ${km(t.run)} · LAUFZEIT <span class="${(t.leftS ?? Infinity) < 60 ? 'amber' : ''}">${t.leftS !== undefined ? clock(t.leftS) : '—'}</span></span>
          <span><button data-steer="${t.id}" data-d="-10">◀◀</button><button data-steer="${t.id}" data-d="-2">◀</button><button data-steer="${t.id}" data-d="2">▶</button><button data-steer="${t.id}" data-d="10">▶▶</button></span></div>`;
      }).join('') : '<div class="dim">KEIN TORPEDO AM DRAHT</div>');
      btnState(q('#tr-nm'), { label: String(l.noisemakers), tone: l.noisemakers ? undefined : 'empty' });
    },
    frame() {},
  };
}
