import { onTap } from './touch.js';
import { CHOICE_LABEL, CLASS_LABEL, deg1, esc, km } from './format.js';
import { isFriendlyContact } from './friendly.js';
import { fixRange } from './contact-pos.js';
import { store } from '../store.js';
import { steadyBearing } from './smooth.js';
import { CLASSES, type SensorKind } from '@tk/shared';
import { bindSortable, filterChips, getFilters, sortHead, sortRows, type SortState } from './sortable.js';

const SENSOR_LABEL: Record<string, string> = {
  hull: 'RUMPF', towed: 'SCHLEPP', active: 'AKTIV', intercept: 'PING', periscope: 'OPTIK', radar: 'RADAR', esm: 'ESM', buoy: 'BOJE', visual: 'AUSGUCK', mad: 'MAD',
};

const ID = 'contacts';
const DEF: SortState = { key: 'label', dir: 1 };
const GROUPS: Record<string, SensorKind[]> = {
  sonar: ['hull', 'towed', 'active', 'intercept', 'buoy'], radar: ['radar', 'mad'], esm: ['esm'], visual: ['visual', 'periscope'],
};
const filters = new WeakMap<HTMLElement, (via: string) => boolean>();

/** Bearing as shown (towed-array side applied). */
function shownBearing(c: { label: string; bearing: number; bearingAlt?: number; lastSeen: number }): number {
  const side = store.tasSide.get(c.label);
  // Smoothed, so sorting by bearing doesn't reshuffle rows on every noisy update
  return c.bearingAlt !== undefined && side === 'port' ? steadyBearing(c.label, c.bearingAlt, c.lastSeen) : steadyBearing(c.label, c.bearing, c.lastSeen);
}

/**
 * Clickable contact table; selection is shared across stations. Columns sort on click,
 * chips filter by freshness, own forces and sensor. Friendly contacts sink to the bottom.
 */
export function renderContactList(el: HTMLElement, filter: (via: string) => boolean = () => true): void {
  const s = store.snap;
  if (!s) return;
  filters.set(el, filter);
  bindSortable(el, ID, DEF, () => renderContactList(el, filters.get(el)));
  const f = getFilters(ID);
  const groups = Object.keys(GROUPS).filter((g) => f.has(`g:${g}`));
  const all = s.contacts.filter((c) => filter(c.via));
  const whatOf = (c: (typeof all)[number], own: boolean) => {
    const age = s.time - c.lastSeen;
    const name = c.assigned ? CHOICE_LABEL[c.assigned] : c.classified ? CLASS_LABEL[c.classified] : '';
    return own ? `EIGEN${name ? ' · ' + name : ''}` : name || (age > 30 ? `ALT ${Math.round(age)} S` : `? ${c.se.toFixed(0)} DB`);
  };
  const shown = all
    .map((c) => ({ c, own: isFriendlyContact(c, s) }))
    .filter(({ c, own }) => (!f.has('fresh') || s.time - c.lastSeen <= 30) && (!f.has('hostile') || !own)
      && (!groups.length || groups.some((g) => c.sensors.some((x) => GROUPS[g]!.includes(x)))));
  const rows = sortRows(shown, ID, DEF, {
    label: (r) => r.c.label,
    brg: (r) => shownBearing(r.c),
    range: (r) => fixRange(r.c, s),
    sensor: (r) => r.c.sensors.map((x) => SENSOR_LABEL[x]).join('/'),
    cls: (r) => whatOf(r.c, r.own),
    age: (r) => s.time - r.c.lastSeen,
  }).sort((a, b) => Number(a.own) - Number(b.own));
  const sub = CLASSES[s.own.cls].submarine;
  const chips = filterChips(ID, [
    { key: 'fresh', label: 'AKTUELL', title: 'Nur Kontakte der letzten 30 s' },
    { key: 'hostile', label: 'OHNE EIGENE', title: 'Eigene und verbündete Einheiten ausblenden' },
    { key: 'g:sonar', label: 'SONAR' },
    ...(sub ? [] : [{ key: 'g:radar', label: 'RADAR' }]),
    { key: 'g:esm', label: 'ESM' },
    { key: 'g:visual', label: sub ? 'OPTIK' : 'SICHT' },
  ]).replace('</div>', `<span class="dim chipcount">${rows.length}/${all.length}</span></div>`);
  const head = `<div class="row dim ctable">${sortHead(ID, 'label', 'KONTAKT', DEF)}${sortHead(ID, 'brg', 'PEILUNG', DEF)}${sortHead(ID, 'range', 'ENTF.', DEF)}${sortHead(ID, 'sensor', 'SENSOR', DEF)}${sortHead(ID, 'cls', 'KLASSE', DEF)}</div>`;
  el.innerHTML = chips + (rows.length

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
      const what = whatOf(c, own);
      const color = c.assigned === 'torpedo' ? 'red' : '';
      return `<div class="row ctable clickable ${cls}" data-c="${esc(c.label)}" title="Klicken zum Auswählen">
        <span>${esc(c.label)}</span>
        <span>${c.bearingAlt !== undefined && side ? deg1(steadyBearing(c.label, side === 'stb' ? c.bearing : c.bearingAlt, c.lastSeen)) + '°' : `${deg1(steadyBearing(c.label, c.bearing, c.lastSeen))}°${c.bearingAlt !== undefined ? `/${deg1(steadyBearing(c.label + '/alt', c.bearingAlt, c.lastSeen))}°` : ''}`}${tasNote}${c.originX !== undefined ? ' <span class="blue">(BOJE)</span>' : ''}</span>
        <span>${range}</span>
        <span>${c.sensors.map((x) => SENSOR_LABEL[x]).join('/')}</span>
        <span class="${color}">${what}</span>
      </div>`;
    }).join('')
    : `<div class="dim">${all.length ? 'KEINE KONTAKTE FÜR DIESEN FILTER' : 'KEINE KONTAKTE'}</div>`);
  if (!el.dataset.bound) {
    // Delegated mousedown: rows are rebuilt on every snapshot, so per-row handlers would lose clicks
    el.dataset.bound = '1';
    onTap(el, '[data-c]', (row) => {
      store.selected = row.dataset.c;
    });
  }
}
