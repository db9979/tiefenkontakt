/**
 * Accessibility across all screens, without touching every template:
 * - screen-reader announcements (polite for warnings, assertive for alarms),
 * - names for icon-only buttons (from their title), roles for the station tabs,
 *   canvases named after their panel,
 * - clickable rows and cells reachable with Tab and triggered with Enter or Space
 *   (help, briefing and menus close with Escape on their own).
 * The focus ring itself is in style.css (:focus-visible).
 */
let polite: HTMLElement | undefined;
let assertive: HTMLElement | undefined;

function regions(): void {
  if (polite) return;
  const mk = (live: 'polite' | 'assertive') => {
    const d = document.createElement('div');
    d.className = 'sr-only';
    d.setAttribute('aria-live', live);
    d.setAttribute('role', live === 'assertive' ? 'alert' : 'status');
    document.body.appendChild(d);
    return d;
  };
  polite = mk('polite');
  assertive = mk('assertive');
}

/** Read a message to screen-reader users (warnings politely, alarms at once). */
export function announce(text: string, level: 'info' | 'warn' | 'alarm'): void {
  if (level === 'info') return;
  regions();
  const r = level === 'alarm' ? assertive! : polite!;
  // Same text twice in a row is only read again when the node changes
  r.textContent = r.textContent === text ? `${text} ` : text;
}

/** Elements that act on a click but are no buttons: rows of lists, map symbols, cards. */
const CLICKABLE = '.clickable, [data-c], [data-ev], [data-sys], [data-log], [data-cls], [data-sort], [data-st], [data-mission], .mcard';

function label(root: ParentNode): void {
  for (const b of root.querySelectorAll<HTMLButtonElement>('button:not([aria-label])')) {
    const text = b.textContent?.trim() ?? '';
    // Icon only (⚙, ?, ×, ☀, +, −, ◎ …): the title says what it does
    if (b.title && !/[A-Za-zÄÖÜäöü0-9]{2}/.test(text)) b.setAttribute('aria-label', b.title);
  }
  for (const c of root.querySelectorAll<HTMLCanvasElement>('canvas:not([role])')) {
    c.setAttribute('role', 'img');
    const hd = c.closest('.panel')?.querySelector('.hd span')?.textContent?.trim();
    const name = c.title || hd;
    if (name) c.setAttribute('aria-label', name);
  }
  for (const t of root.querySelectorAll<HTMLElement>('#tabs, #side-tabs')) {
    t.setAttribute('role', 'tablist');
    for (const b of t.querySelectorAll('button')) {
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', b.classList.contains('on') ? 'true' : 'false');
    }
  }
  for (const el of root.querySelectorAll<HTMLElement>(CLICKABLE)) {
    if (el.tabIndex >= 0 || el.matches('button, a, input, select, textarea')) continue;
    el.tabIndex = 0;
    if (!el.getAttribute('role')) el.setAttribute('role', 'button');
  }
  for (const o of root.querySelectorAll<HTMLElement>('.overlay:not([role])')) {
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
  }
}

/**
 * Keyboard activation of a clickable row: the handlers listen for pointer events (onTap) or
 * clicks, so both are sent, at the row's centre.
 */
export function activate(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', at));
  el.dispatchEvent(new PointerEvent('pointerup', at));
  el.dispatchEvent(new MouseEvent('click', at));
}

export function installA11y(): void {
  regions();
  label(document.body);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    // At most four passes a second: the game redraws its panels ten times a second
    setTimeout(() => {
      queued = false;
      label(document.body);
    }, 250);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.matches?.(CLICKABLE) && !t.matches('button, a, input, select, textarea')) {
      e.preventDefault();
      activate(t);
    }
  });
}
