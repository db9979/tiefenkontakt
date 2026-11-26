import { onTap } from './touch.js';
import { CHOICE_LABEL, CLASS_LABEL, esc, kmNum, setParts, setText, tbrg, tdeg3 } from './format.js';
import { isFriendlyContact } from './friendly.js';
import { fixRange } from './contact-pos.js';
import { store } from '../store.js';
import { trueDeg } from '../north.js';
import { steadyBearing } from './smooth.js';
import { CLASSES, bearing, distance, targetPosAt, type ClassChoice, type SensorKind } from '@tk/shared';
import { bindSortable, filterChips, getFilters, sortHead, sortRows, type SortState } from './sortable.js';

/**
 * The one contact list of every station (E6): same columns and size everywhere, so a player
 * who learnt it once reads it on any station. New contacts stand on top with an amber NEU,
 * own and allied units sink to the bottom in the muted colour, each sensor is one letter
 * (the tooltip names it), and the range column appears only once some contact has a range.
 */

/** One letter per sensor; the tooltip of the column spells them out. */
export const SENSOR_GLYPH: Record<SensorKind, string> = {
  hull: 'H', towed: 'S', active: 'A', intercept: 'P', periscope: 'O', radar: 'R', esm: 'E', buoy: 'B', visual: 'V', mad: 'M',
};
const SENSOR_NAME: Record<SensorKind, string> = {
  hull: 'Rumpfsonar', towed: 'Schleppsonar', active: 'Aktivsonar', intercept: 'Ping gehört', periscope: 'Optik', radar: 'Radar', esm: 'ESM', buoy: 'Sonarboje', visual: 'Ausguck', mad: 'MAD',
};
const GLYPH_TITLE = Object.entries(SENSOR_GLYPH).map(([k, g]) => `${g} = ${SENSOR_NAME[k as SensorKind]}`).join(', ')
  + ' · ? = Seite ungeklärt, ! = möglicher Geist, ◆ = Peilung von der Boje';

/** Class words short enough for the column (the full word is the cell's tooltip, S18). */
const CHOICE_SHORT: Record<ClassChoice, string> = {
  merchant: 'FRACHTER', warship: 'KRIEGSSCH.', submarine: 'U-BOOT', torpedo: 'TORPEDO', bio: 'BIOLOGISCH', unknown: 'UNBEKANNT',
};

/** A contact counts as new this long after it first appeared (game seconds). */
export const NEW_FOR_S = 60;

const ID = 'contacts';
const DEF: SortState = { key: 'label', dir: 1 };
const GROUPS: Record<string, SensorKind[]> = {
  sonar: ['hull', 'towed', 'active', 'intercept', 'buoy'], radar: ['radar', 'mad'], esm: ['esm'], visual: ['visual', 'periscope'],
};
const filters = new WeakMap<HTMLElement, (via: string) => boolean>();

/** First time each label was seen (game time); cleared when the clock runs backwards (a new match). */
const firstSeen = new Map<string, number>();
let lastTime = -1;
/**
 * Note the contacts of a snapshot (the game screen calls this for every snapshot, so a contact
 * that appeared while no list was on screen still has its true age). What is there on the first
 * snapshot of a match was known before and is not "new".
 */
export function noteContacts(s: { time: number; contacts: { label: string }[] }): void {
  const start = lastTime < 0 || s.time < lastTime;
  if (s.time < lastTime) firstSeen.clear();
  lastTime = s.time;
  for (const c of s.contacts) if (!firstSeen.has(c.label)) firstSeen.set(c.label, start ? -Infinity : s.time);
}
/** Seconds since the contact first appeared (Infinity when it was there from the start). */
export function contactAge(label: string, time: number): number {
  const t = firstSeen.get(label);
  return t === undefined ? Infinity : time - t;
}

/** Bearing as shown (towed-array side applied). */
function shownBearing(c: { label: string; bearing: number; bearingAlt?: number; lastSeen: number }): number {
  const side = store.tasSide.get(c.label);
  // Smoothed, so sorting by bearing doesn't reshuffle rows on every noisy update
  return c.bearingAlt !== undefined && side === 'port' ? steadyBearing(c.label, c.bearingAlt, c.lastSeen) : steadyBearing(c.label, c.bearing, c.lastSeen);
}

/** Sensor letters of a contact, in a fixed order. */
export function sensorGlyphs(sensors: readonly SensorKind[]): string {
  return (Object.keys(SENSOR_GLYPH) as SensorKind[]).filter((k) => sensors.includes(k)).map((k) => SENSOR_GLYPH[k]).join('');
}

/**
 * Clickable contact table; selection is shared across stations. Columns sort on click,
 * chips filter by freshness, own forces and sensor.
 */
export function renderContactList(el: HTMLElement, filter: (via: string) => boolean = () => true): void {
  const s = store.snap;
  if (!s) return;
  filters.set(el, filter);
  el.classList.add('clist');
  bindSortable(el, ID, DEF, () => renderContactList(el, filters.get(el)));
  const f = getFilters(ID);
  const groups = Object.keys(GROUPS).filter((g) => f.has(`g:${g}`));
  const all = s.contacts.filter((c) => filter(c.via));
  noteContacts(s);
  // Two columns: what it is (class or "?"), and how loud it is or, once it has gone quiet, how old
  const nameOf = (c: (typeof all)[number]) => (c.assigned ? CHOICE_LABEL[c.assigned] : c.classified ? CLASS_LABEL[c.classified] : '');
  // Own units: EIGEN (the class is in the tooltip); the rest the short class word
  const whatOf = (c: (typeof all)[number], own: boolean) => (own ? 'EIGEN' : c.assigned ? CHOICE_SHORT[c.assigned] : c.classified ? CLASS_LABEL[c.classified] : '?');
  const levelOf = (c: (typeof all)[number]) => {
    const age = s.time - c.lastSeen;
    return age > 30 ? (age < 100 ? `ALT ${Math.round(age)} S` : `ALT ${Math.round(age / 60)}MIN`) : `${c.se.toFixed(0)} DB`;
  };
  const shown = all
    .map((c) => ({ c, own: isFriendlyContact(c, s) }))
    .map((r) => ({ ...r, fresh: !r.own && contactAge(r.c.label, s.time) < NEW_FOR_S }))
    .filter(({ c, own }) => (!f.has('fresh') || s.time - c.lastSeen <= 30) && (!f.has('hostile') || !own)
      && (!groups.length || groups.some((g) => c.sensors.some((x) => GROUPS[g]!.includes(x)))));
  // Order: new contacts first, then the chosen sort, own and allied units last
  const rows = sortRows(shown, ID, DEF, {
    label: (r) => r.c.label,
    brg: (r) => trueDeg(shownBearing(r.c)),
    range: (r) => fixRange(r.c, s),
    sensor: (r) => sensorGlyphs(r.c.sensors),
    cls: (r) => whatOf(r.c, r.own),
    lvl: (r) => (s.time - r.c.lastSeen > 30 ? -1000 - (s.time - r.c.lastSeen) : r.c.se),
  }).sort((a, b) => Number(b.fresh) - Number(a.fresh) || Number(a.own) - Number(b.own));
  // The range column only when there is something to show in it
  const ranged = rows.some(({ c }) => fixRange(c, s) !== undefined || store.solutions.has(c.label)) || s.torpedoes.length > 0;
  el.classList.toggle('norange', !ranged);
  const sub = CLASSES[s.own.cls].submarine;
  const chips = filterChips(ID, [
    { key: 'fresh', label: 'AKTUELL', title: 'Nur Kontakte der letzten 30 s' },
    // Short, so all chips fit on one row in the narrow OPZ column (the tooltip says what it does)
    { key: 'hostile', label: 'FREMDE', title: 'Nur fremde Kontakte: eigene und verbündete Einheiten ausblenden' },
    { key: 'g:sonar', label: 'SONAR' },
    ...(sub ? [] : [{ key: 'g:radar', label: 'RADAR' }]),
    { key: 'g:esm', label: 'ESM' },
    { key: 'g:visual', label: sub ? 'OPTIK' : 'SICHT' },
  ]);
  // The count stands outside the scrolling chip strip, so a narrow column never cuts it ("17/1", N3)
  // The count is written as text below: the chips stay the same nodes while it changes
  const chipRow = `<div class="chiprow">${chips}<span class="dim chipcount" title="Gezeigt / alle Kontakte"></span></div>`;
  const head = `<div class="row dim ctable">${sortHead(ID, 'label', 'KONTAKT', DEF)}${sortHead(ID, 'brg', 'PEILUNG', DEF)}${ranged ? `<span title="Entfernung in km · ≈ aus der TMA-Lösung">${sortHead(ID, 'range', 'KM', DEF)}</span>` : ''}<span title="${esc(GLYPH_TITLE)}">${sortHead(ID, 'sensor', 'SENS', DEF)}</span>${sortHead(ID, 'cls', 'KLASSE', DEF)}<span title="Signalpegel in dB · ALT: Zeit seit der letzten Peilung">${sortHead(ID, 'lvl', 'PEGEL', DEF)}</span></div>`;
  // Chips, header and rows apart: the header's sort buttons stay put while the rows move
  setParts(el, [chipRow, rows.length ? head : '', (rows.length
    ? rows.map(({ c, own, fresh }) => {
      const age = s.time - c.lastSeen;
      const sol = store.solutions.get(c.label);
      const cls = c.label === store.selected ? 'amber selrow' : own ? 'mute' : age > 30 ? 'dim' : '';
      const fr = fixRange(c, s);
      // Measured range, else the TMA solution's (S36), in km (the header says so)
      let range = fr !== undefined ? kmNum(fr) : sol ? `≈ ${kmNum(distance(s.own, targetPosAt(sol, s.time)))}` : '—';
      // Doppler in the tooltip (the column holds the range whole)
      let rangeTitle = fr !== undefined ? `${range} KM` : sol ? `${range} KM AUS DER TMA-LÖSUNG` : '';
      if (c.dopplerKn !== undefined && c.rangeAt !== undefined && s.time - c.rangeAt < 90 && Math.abs(c.dopplerKn) >= 1) {
        range += c.dopplerKn > 0 ? '↓' : '↑';
        rangeTitle += ` · DOPPLER ${c.dopplerKn > 0 ? 'NÄHERT SICH' : 'ENTFERNT SICH'} ${Math.abs(c.dopplerKn).toFixed(0)} KN`;
      }
      const side = store.tasSide.get(c.label);
      // N3: the bearing column holds only the bearing (a mirror pair compact, "114/166°"); the side
      // cue and the buoy mark are glyphs in the SENS column, spelled out in their tooltips
      const pair = c.bearingAlt !== undefined && !side;
      const brgText = c.bearingAlt !== undefined && side
        ? tbrg(steadyBearing(c.label, side === 'stb' ? c.bearing : c.bearingAlt, c.lastSeen))
        : pair ? `${tdeg3(steadyBearing(c.label, c.bearing, c.lastSeen))}/${tbrg(steadyBearing(c.label + '/alt', c.bearingAlt!, c.lastSeen))}`
          : tbrg(steadyBearing(c.label, c.bearing, c.lastSeen));
      const brgTitle = [
        pair ? 'SCHLEPPSONAR: ZWEI SPIEGELPEILUNGEN, SEITE UNGEKLÄRT' : side && c.bearingAlt !== undefined ? `SEITE ${side === 'stb' ? 'STEUERBORD' : 'BACKBORD'}` : '',
        c.tas?.ghost ? 'MÖGLICHER GEIST (SPIEGELPEILUNG)' : '',
        c.originX !== undefined ? 'PEILUNG VON DER SONARBOJE, NICHT VOM EIGENEN SCHIFF' : '',
      ].filter(Boolean).join(' · ');
      const cues = (c.tas?.ghost ? '<b class="red cue" title="Möglicher Geist: Spiegelpeilung des Schleppsonars">!</b>' : pair ? '<b class="amber cue" title="Seite ungeklärt (STB/BB?): Rumpfsonar oder Kursänderung klärt sie">?</b>' : '')
        + (c.originX !== undefined ? '<b class="blue cue" title="Peilung von der Sonarboje, nicht vom eigenen Schiff">◆</b>' : '');
      const what = whatOf(c, own);
      const whatTitle = own ? `EIGEN${nameOf(c) ? ' · ' + nameOf(c) : ''}` : nameOf(c) || 'UNKLASSIFIZIERT';
      const color = c.assigned === 'torpedo' ? 'red' : '';
      const sensors = c.sensors.map((x) => SENSOR_NAME[x]).join(', ');
      return `<div class="row ctable clickable ${cls}" data-c="${esc(c.label)}" title="Klicken zum Auswählen">
        <span>${esc(c.label)}${fresh ? ' <b class="newbadge">NEU</b>' : ''}</span>
        <span${brgTitle ? ` title="${esc(brgTitle)}"` : ''}>${brgText}</span>
        ${ranged ? `<span title="${esc(rangeTitle)}">${range}</span>` : ''}
        <span class="glyphs" title="${esc(sensors)}">${sensorGlyphs(c.sensors)}${cues}</span>
        <span class="${color}" title="${esc(whatTitle)}">${what}</span>
        <span class="lvl${age > 30 ? ' dim' : ''}">${levelOf(c)}</span>
      </div>`;
    }).join('') + torpRows(s, ranged)
    : `<div class="dim">${all.length ? 'KEINE KONTAKTE FÜR DIESEN FILTER' : 'KEINE KONTAKTE'}</div>` + torpRows(s, ranged))]);
  setText(el.querySelector('.chipcount')!, `${rows.length}/${all.length}`);
  if (!el.dataset.bound) {
    // Delegated mousedown: rows are rebuilt on every snapshot, so per-row handlers would lose clicks
    el.dataset.bound = '1';
    onTap(el, '[data-c]', (row) => {
      store.selected = row.dataset.c;
    });
  }
}

/** Own wire-guided torpedoes at the end of the list: bearing and range from the wire, selectable. */
function torpRows(s: NonNullable<typeof store.snap>, ranged: boolean): string {
  return s.torpedoes.map((t) => {
    const sel = t.id === store.selected;
    return `<div class="row ctable clickable ${sel ? 'amber selrow' : ''}" data-c="${esc(t.id)}" title="Eigener Torpedo am Draht · Klicken zum Auswählen">
      <span class="${sel ? '' : 'red'}">${esc(t.id)}</span>
      <span>${tbrg(bearing(s.own, t))}</span>
      ${ranged ? `<span>${kmNum(distance(s.own, t))}</span>` : ''}
      <span class="glyphs" title="Draht">D</span>
      <span class="${sel ? '' : 'red'}" title="Eigener Torpedo am Draht">EIG. TORPEDO</span>
      <span class="lvl">${t.homing ? 'ERFASST' : 'LÄUFT'}</span>
    </div>`;
  }).join('');
}
