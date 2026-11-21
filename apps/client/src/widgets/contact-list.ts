import { CLASS_LABEL, deg1, esc, km } from './format.js';
import { store } from '../store.js';

const SENSOR_LABEL: Record<string, string> = {
  hull: 'RUMPF', towed: 'SCHLEPP', active: 'AKTIV', intercept: 'PING', periscope: 'OPTIK', radar: 'RADAR', esm: 'ESM',
};

/** Clickable contact table; selection is shared across stations. */
export function renderContactList(el: HTMLElement, filter: (via: string) => boolean = () => true): void {
  const s = store.snap;
  if (!s) return;
  const rows = s.contacts
    .filter((c) => filter(c.via))
    .sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }));
  el.innerHTML = rows.length
    ? rows.map((c) => {
      const age = s.time - c.lastSeen;
      const sol = store.solutions.get(c.label);
      const cls = c.label === store.selected ? 'amber' : age > 10 ? 'dim' : '';
      return `<div class="row ${cls}" data-c="${esc(c.label)}" style="cursor:pointer">
        <span style="width:62px">${esc(c.label)}</span>
        <span style="width:110px">${deg1(c.bearing)}°${c.bearingAlt !== undefined ? ` / ${deg1(c.bearingAlt)}°` : ''}</span>
        <span style="width:70px">${c.range !== undefined && c.rangeAt !== undefined && s.time - c.rangeAt < 60 ? km(c.range) : sol ? '≈ LSG' : '—'}</span>
        <span style="width:60px">${c.sensors.map((x) => SENSOR_LABEL[x]).join('/')}</span>
        <span style="flex:1;text-align:right">${c.classified ? CLASS_LABEL[c.classified] : age > 10 ? `ALT ${Math.round(age)} S` : `${c.se.toFixed(0)} DB`}</span>
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
