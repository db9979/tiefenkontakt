import { audio } from '../audio.js';
import { esc } from './format.js';

export interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
}

let open: HTMLElement | undefined;

export function closeMenu(): void {
  open?.remove();
  open = undefined;
}

/** Context menu at page coordinates. Closes on any outside click or Escape. */
export function openMenu(x: number, y: number, items: MenuItem[], title?: string): void {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'ctxmenu';
  el.innerHTML = (title ? `<div class="dim" style="padding:4px 10px">${esc(title)}</div>` : '') +
    items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'fire' : ''}">${esc(it.label)}</button>`).join('');
  el.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
  el.style.top = `${Math.min(y, window.innerHeight - 40 - items.length * 30)}px`;
  el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      audio.click();
      items[Number(b.dataset.i)]!.run();
      closeMenu();
    };
  });
  document.body.appendChild(el);
  open = el;
  setTimeout(() => window.addEventListener('pointerdown', outside), 0);
}

function outside(e: MouseEvent): void {
  if (open && !open.contains(e.target as Node)) {
    closeMenu();
    window.removeEventListener('pointerdown', outside);
  }
}

window.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
