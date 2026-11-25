import { onTap } from './touch.js';

/**
 * A panel with a segmented tab row in its header and one pane per tab: keeps a side column to
 * one panel instead of a stack of half-empty ones. The last tab chosen is remembered per key.
 * Panes are the children of `el` marked `data-pane="<id>"`.
 */
export function panelTabs(el: HTMLElement, key: string, onChange?: (id: string) => void): { readonly current: string; show(id: string): void } {
  const store = `tk_ptab_${key}`;
  const ids = [...el.querySelectorAll<HTMLElement>('[data-ptab]')].map((b) => b.dataset.ptab!);
  let current = ids[0] ?? '';
  try {
    const saved = localStorage.getItem(store);
    if (saved && ids.includes(saved)) current = saved;
  } catch {
    // storage blocked: start on the first tab
  }
  const show = (id: string) => {
    if (!ids.includes(id)) return;
    current = id;
    el.querySelectorAll<HTMLElement>('[data-ptab]').forEach((b) => b.classList.toggle('on', b.dataset.ptab === id));
    el.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== id));
    try {
      localStorage.setItem(store, id);
    } catch {
      // not remembered, still shown
    }
    onChange?.(id);
  };
  onTap(el, '[data-ptab]', (b) => show(b.dataset.ptab!));
  show(current);
  return {
    get current() {
      return current;
    },
    show,
  };
}

/** Header tab row markup: `<span class="seg ptabs">…</span>`. */
export function tabRow(tabs: [id: string, label: string, title?: string][]): string {
  return `<span class="seg ptabs">${tabs.map(([id, label, title]) => `<button data-ptab="${id}"${title ? ` title="${title}"` : ''}>${label}<b class="cnt"></b></button>`).join('')}</span>`;
}
