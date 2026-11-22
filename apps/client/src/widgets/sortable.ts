import { esc } from './format.js';
import { onTap } from './touch.js';

/**
 * Sortable column headers and filter chips for the console lists. State lives per list id
 * in localStorage, so a chosen order survives snapshots, station changes and reloads.
 * Lists are rebuilt every snapshot, so clicks are delegated on the container (onTap).
 */

export interface SortState { key: string; dir: 1 | -1 }
type Value = number | string | undefined;

const KEY = (id: string) => `tk_sort_${id}`;
const FKEY = (id: string) => `tk_filter_${id}`;

export function getSort(id: string, def: SortState): SortState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(id)) ?? 'null') as SortState | null;
    return v && typeof v.key === 'string' ? v : def;
  } catch {
    return def;
  }
}

/** Click on a header: first click sorts by it, the next one reverses. */
export function toggleSort(id: string, key: string, def: SortState, firstDir: 1 | -1 = 1): void {
  const cur = getSort(id, def);
  localStorage.setItem(KEY(id), JSON.stringify(cur.key === key ? { key, dir: -cur.dir } : { key, dir: firstDir }));
}

/** A header cell; the active column shows ▲ or ▼. */
export function sortHead(id: string, key: string, label: string, def: SortState): string {
  const s = getSort(id, def);
  const arrow = s.key === key ? (s.dir > 0 ? ' ▲' : ' ▼') : '';
  return `<span class="sorth${s.key === key ? ' on' : ''}" data-sort="${esc(key)}" title="Sortieren">${esc(label)}${arrow}</span>`;
}

/** Sort rows by the active column; missing values always go last, ties keep the previous order. */
export function sortRows<T>(rows: T[], id: string, def: SortState, get: Record<string, (r: T) => Value>): T[] {
  const s = getSort(id, def);
  const f = get[s.key] ?? get[def.key]!;
  return rows
    .map((r, i) => ({ r, i, v: f(r) }))
    .sort((a, b) => {
      if (a.v === undefined || b.v === undefined) return a.v === b.v ? a.i - b.i : a.v === undefined ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'de', { numeric: true });
      return c * s.dir || a.i - b.i;
    })
    .map((x) => x.r);
}

/** Active filter chips of a list (all chips off = no filtering). */
export function getFilters(id: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FKEY(id)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function toggleFilter(id: string, chip: string, exclusive?: string[]): void {
  const f = getFilters(id);
  if (f.has(chip)) f.delete(chip);
  else {
    // Chips in an exclusive group replace each other
    if (exclusive?.includes(chip)) for (const x of exclusive) f.delete(x);
    f.add(chip);
  }
  localStorage.setItem(FKEY(id), JSON.stringify([...f]));
}

/** A row of filter chips. */
export function filterChips(id: string, chips: { key: string; label: string; title?: string }[]): string {
  const f = getFilters(id);
  return `<div class="chips">${chips.map((c) => `<button class="chip${f.has(c.key) ? ' on' : ''}" data-chip="${esc(c.key)}"${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.label)}</button>`).join('')}</div>`;
}

/** Wire header and chip clicks of a container once; `redraw` repaints right away. */
export function bindSortable(el: HTMLElement, id: string, def: SortState, redraw: () => void, opts: { firstDir?: Record<string, 1 | -1>; exclusive?: string[] } = {}): void {
  if (el.dataset.sortBound) return;
  el.dataset.sortBound = '1';
  onTap(el, '[data-sort]', (h) => {
    toggleSort(id, h.dataset.sort!, def, opts.firstDir?.[h.dataset.sort!] ?? 1);
    redraw();
  });
  onTap(el, '[data-chip]', (c) => {
    toggleFilter(id, c.dataset.chip!, opts.exclusive);
    redraw();
  });
}
