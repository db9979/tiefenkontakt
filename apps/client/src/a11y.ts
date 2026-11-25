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

function labelButton(b: HTMLButtonElement): void {
  if (b.hasAttribute('aria-label')) return;
  const text = b.textContent?.trim() ?? '';
  // Icon only (⚙, ?, ×, ☀, +, −, ◎ …): the title says what it does
  if (b.title && !/[A-Za-zÄÖÜäöü0-9]{2}/.test(text)) b.setAttribute('aria-label', b.title);
}

function labelCanvas(c: HTMLCanvasElement): void {
  if (c.hasAttribute('role')) return;
  c.setAttribute('role', 'img');
  const hd = c.closest('.panel')?.querySelector('.hd span')?.textContent?.trim();
  const name = c.title || hd;
  if (name) c.setAttribute('aria-label', name);
}

function labelTab(b: HTMLButtonElement): void {
  b.setAttribute('role', 'tab');
  const sel = b.classList.contains('on') ? 'true' : 'false';
  if (b.getAttribute('aria-selected') !== sel) b.setAttribute('aria-selected', sel);
}

function labelClickable(el: HTMLElement): void {
  if (el.tabIndex >= 0 || el.matches('button, a, input, select, textarea')) return;
  el.tabIndex = 0;
  if (!el.getAttribute('role')) el.setAttribute('role', 'button');
}

function labelOverlay(o: HTMLElement): void {
  if (o.hasAttribute('role')) return;
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-modal', 'true');
}

/** Label one element by what it is (no descendants). */
function labelOne(el: Element): void {
  if (!(el instanceof HTMLElement)) return;
  if (el instanceof HTMLButtonElement) {
    labelButton(el);
    if (el.parentElement?.matches('#tabs, #side-tabs')) labelTab(el);
  } else if (el instanceof HTMLCanvasElement) labelCanvas(el);
  if (el.matches('#tabs, #side-tabs')) el.setAttribute('role', 'tablist');
  if (el.matches(CLICKABLE)) labelClickable(el);
  if (el.matches('.overlay')) labelOverlay(el);
}

/** Label an element and everything below it. */
function label(root: Element): void {
  labelOne(root);
  for (const b of root.querySelectorAll<HTMLButtonElement>('button:not([aria-label])')) labelButton(b);
  for (const c of root.querySelectorAll<HTMLCanvasElement>('canvas:not([role])')) labelCanvas(c);
  for (const t of root.querySelectorAll<HTMLElement>('#tabs, #side-tabs')) {
    t.setAttribute('role', 'tablist');
    for (const b of t.querySelectorAll('button')) labelTab(b);
  }
  for (const el of root.querySelectorAll<HTMLElement>(CLICKABLE)) labelClickable(el);
  for (const o of root.querySelectorAll<HTMLElement>('.overlay:not([role])')) labelOverlay(o);
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
  // Only the elements the mutation records name: added subtrees are labelled whole, an element
  // whose class changed only by itself (tabs switching "on", rows becoming clickable). The
  // game rebuilds panels ten times a second, so this runs at most four times a second.
  const added = new Set<Element>();
  const changed = new Set<Element>();
  let queued = false;
  const flush = () => {
    queued = false;
    for (const el of added) {
      // A subtree inside another added subtree is labelled with it
      let up = el.parentElement;
      while (up && !added.has(up)) up = up.parentElement;
      if (!up && el.isConnected) label(el);
    }
    for (const el of changed) if (el.isConnected && !added.has(el)) labelOne(el);
    added.clear();
    changed.clear();
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') {
        if (m.target instanceof Element) changed.add(m.target);
      } else {
        m.addedNodes.forEach((n) => n instanceof Element && added.add(n));
        // A text change inside a button may turn it into (or out of) an icon-only button
        if (m.target instanceof HTMLButtonElement) changed.add(m.target);
      }
    }
    if (queued || (!added.size && !changed.size)) return;
    queued = true;
    setTimeout(flush, 250);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.matches?.(CLICKABLE) && !t.matches('button, a, input, select, textarea')) {
      e.preventDefault();
      activate(t);
    }
  });
}
