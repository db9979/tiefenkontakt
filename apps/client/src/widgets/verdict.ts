import { onTap } from './touch.js';
import { bladeCount, marksCount, rankClasses, type ClassChoice } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { CHOICE_LABEL, esc, setHtml, setParts } from './format.js';

const CHOICES: ClassChoice[] = ['merchant', 'warship', 'submarine', 'torpedo', 'bio', 'unknown'];

/**
 * Blade count, class library ranking and the player's classification buttons
 * for the selected contact. The library grades the player's marks, never the contact.
 */
export function renderVerdict(el: HTMLElement): void {
  const c = store.selectedContact();
  if (!c) {
    setHtml(el, '');
    return;
  }
  const m = store.marks.get(c.label) ?? {};
  const bc = bladeCount(m);
  const ranked = rankClasses(m).slice(0, 3);
  const sure = marksCount(m) >= 2;
  const libRows = ranked.length
    ? ranked.map((r) => `<div class="row"><span>${esc(r.sig.name)}</span><span class="${r.fit > 0.7 ? '' : 'dim'}">${Math.round(r.fit * 100)} %</span></div>`).join('')
    : '<div class="dim">LINIEN MARKIEREN: LOFAR-GRUNDTON, DEMON-WELLE UND -BLATT</div>';
  // Redrawn on every snapshot: the read-out and the buttons are separate pieces, so the buttons
  // stay the same nodes while the fit percentages move (a replaced button can eat a tap on iOS)
  setParts(el, [`
    <div class="hd" style="margin-top:6px"><span>Auswertung ${esc(c.label)}</span><span class="${c.assigned ? 'amber' : 'dim'}">${c.assigned ? CHOICE_LABEL[c.assigned] : 'UNKLASSIFIZIERT'}</span></div>
    ${bc ? `<div class="row" title="Blattrate durch Wellenrate ergibt die Blattzahl; die Abweichung von der ganzen Zahl sagt, wie gut die Marken sitzen (unter ±0,3 passt sie)"><span class="dim">BLATTZAHL / DREHZAHL</span><span>${bc.blades} BLATT <span class="${Math.abs(bc.deviation) > 0.3 ? 'amber' : 'dim'}">(ABW. ${bc.deviation >= 0 ? '+' : '−'}${Math.abs(bc.deviation).toFixed(2).replace('.', ',')})</span> · ${Math.round(bc.rpm)} U/MIN</span></div>` : ''}
    <div class="dim" style="margin:4px 0">KLASSENBIBLIOTHEK${sure ? '' : ' · NUR HINWEIS (WENIGER ALS 2 MARKEN)'}</div>
    ${libRows}`,
    `<div class="steps cls-grid" style="margin-top:6px">${CHOICES.map((ch) => `<button data-cls="${ch}" class="${c.assigned === ch || (!c.assigned && ch === 'unknown') ? 'on' : ''}">${CHOICE_LABEL[ch]}</button>`).join('')}</div>`]);
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    onTap(el, '[data-cls]', (b) => {
      const label = store.selected;
      if (label) net.send({ t: 'classify', label, choice: b.dataset.cls as ClassChoice });
    });
  }
}
