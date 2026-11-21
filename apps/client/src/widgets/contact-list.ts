import { CHOICE_LABEL, CLASS_LABEL, deg1, esc, km } from './format.js';
import { isFriendlyContact } from './friendly.js';
import { fixRange } from './contact-pos.js';
import { store } from '../store.js';

const SENSOR_LABEL: Record<string, string> = {
  hull: 'RUMPF', towed: 'SCHLEPP', active: 'AKTIV', intercept: 'PING', periscope: 'OPTIK', radar: 'RADAR', esm: 'ESM', buoy: 'BOJE',
};

/** Clickable contact table; selection is shared across stations. Friendly contacts sink to the bottom. */
export function renderContactList(el: HTMLElement, filter: (via: string) => boolean = () => true): void {
  const s = store.snap;
  if (!s) return;
  const rows = s.contacts
    .filter((c) => filter(c.via))
    .map((c) => ({ c, own: isFriendlyContact(c, s) }))
    .sort((a, b) => Number(a.own) - Number(b.own) || a.c.label.localeCompare(b.c.label, 'de', { numeric: true }));
  const head = `<div class="row dim ctable"><span>KONTAKT</span><span>PEILUNG</span><span>ENTF.</span><span>SENSOR</span><span>KLASSE</span></div>`;
  el.innerHTML = rows.length
    ? head + rows.map(({ c, own }) => {
      const age = s.time - c.lastSeen;
      const sol = store.solutions.get(c.label);
      const cls = c.label === store.selected ? 'amber selrow' : own || age > 30 ? 'dim' : '';
      const fr = fixRange(c, s);
      let range = fr !== undefined ? km(fr) : sol ? '≈ LSG' : '—';
      if (c.dopplerKn !== undefined && c.rangeAt !== undefined && s.time - c.rangeAt < 90 && Math.abs(c.dopplerKn) >= 1) {
        range += c.dopplerKn > 0 ? ` ↓${c.dopplerKn.toFixed(0)}` : ` ↑${(-c.dopplerKn).toFixed(0)}`;
      }
      const side = store.tasSide.get(c.label);
      const tasNote = c.tas?.ghost ? '<span class="red"> GEIST?</span>' : c.bearingAlt !== undefined ? (side ? ` (${side === 'stb' ? 'STB' : 'BB'})` : ' <span class="amber">S/B?</span>') : '';
      const name = c.assigned ? CHOICE_LABEL[c.assigned] : c.classified ? CLASS_LABEL[c.classified] : '';
      const what = own ? `EIGEN${name ? ' · ' + name : ''}` : name || (age > 30 ? `ALT ${Math.round(age)} S` : `? ${c.se.toFixed(0)} DB`);
      const color = c.assigned === 'torpedo' ? 'red' : '';
      return `<div class="row ctable clickable ${cls}" data-c="${esc(c.label)}" title="Klicken zum Auswählen">
        <span>${esc(c.label)}</span>
        <span>${c.bearingAlt !== undefined && side ? deg1(side === 'stb' ? c.bearing : c.bearingAlt) + '°' : `${deg1(c.bearing)}°${c.bearingAlt !== undefined ? `/${deg1(c.bearingAlt)}°` : ''}`}${tasNote}${c.originX !== undefined ? ' <span class="blue">(BOJE)</span>' : ''}</span>
        <span>${range}</span>
        <span>${c.sensors.map((x) => SENSOR_LABEL[x]).join('/')}</span>
        <span class="${color}">${what}</span>
      </div>`;
    }).join('')
    : '<div class="dim">KEINE KONTAKTE</div>';
  if (!el.dataset.bound) {
    // Delegated mousedown: rows are rebuilt on every snapshot, so per-row handlers would lose clicks
    el.dataset.bound = '1';
    el.addEventListener('mousedown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
      if (row) store.selected = row.dataset.c;
    });
  }
}
