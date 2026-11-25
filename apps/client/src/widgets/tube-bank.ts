import { setHtml } from './format.js';

/** One tube as the snapshot carries it. */
export interface TubeState {
  loaded: boolean;
  reloadLeft: number;
}

/**
 * Tube bank: one cell per tube (R1…Rn) with its load state and the reload as a fill bar, the
 * same look as the U-boat's fire control (`.tubebank` / `.tube` in stations.css). The longest
 * reload seen per tube is the 100 % mark of its bar.
 */
export function tubeBank(): { el: HTMLElement; update(tubes: readonly TubeState[]): void } {
  const el = document.createElement('div');
  el.className = 'tubebank';
  const reloadMax = new Map<number, number>();
  return {
    el,
    update(tubes) {
      setHtml(el, tubes.map((t, i) => {
        if (t.reloadLeft > (reloadMax.get(i) ?? 0)) reloadMax.set(i, t.reloadLeft);
        if (t.loaded) reloadMax.delete(i);
        const pct = t.loaded ? 100 : t.reloadLeft > 0 ? 100 * (1 - t.reloadLeft / Math.max(1, reloadMax.get(i) ?? t.reloadLeft)) : 0;
        return `<div class="tube ${t.loaded ? 'ok' : t.reloadLeft > 0 ? 'busy' : 'empty'}" title="Rohr ${i + 1}"><span>R${i + 1}</span><i style="width:${pct.toFixed(0)}%"></i>
          <b>${t.loaded ? 'BEREIT' : t.reloadLeft > 0 ? `${Math.ceil(t.reloadLeft)} S` : 'LEER'}</b></div>`;
      }).join(''));
    },
  };
}
