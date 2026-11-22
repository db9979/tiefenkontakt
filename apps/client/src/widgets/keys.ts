/**
 * Rebindable keyboard shortcuts. Bindings are KeyboardEvent.code values (layout
 * independent physical keys), stored per browser. Mouse remains the primary control.
 */

export type KeyAction =
  | 'station1' | 'station2' | 'station3' | 'station4' | 'station5'
  | 'left' | 'right' | 'faster' | 'slower' | 'up' | 'down'
  | 'scopeLeft' | 'scopeRight' | 'help' | 'mute' | 'ptt';

export const KEY_LABEL: Record<KeyAction, string> = {
  station1: 'Station 1', station2: 'Station 2', station3: 'Station 3', station4: 'Station 4', station5: 'Station 5',
  left: 'Kurs links', right: 'Kurs rechts', faster: 'Fahrt +1 kn', slower: 'Fahrt −1 kn',
  up: 'Tiefe −10 m (auftauchen)', down: 'Tiefe +10 m (tauchen)',
  scopeLeft: 'Sehrohr links', scopeRight: 'Sehrohr rechts', help: 'Hilfe', mute: 'Ton an/aus', ptt: 'Sprechfunk (halten)',
};

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  station1: 'Digit1', station2: 'Digit2', station3: 'Digit3', station4: 'Digit4', station5: 'Digit5',
  left: 'ArrowLeft', right: 'ArrowRight', faster: 'ArrowUp', slower: 'ArrowDown', up: 'PageUp', down: 'PageDown',
  scopeLeft: 'KeyA', scopeRight: 'KeyD', help: 'KeyH', mute: 'KeyM', ptt: 'KeyV',
};

const STORE = 'tk_keys';
let bindings: Record<KeyAction, string> = load();

function load(): Record<KeyAction, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<KeyAction, string>>;
    const out = { ...DEFAULT_KEYS };
    for (const k of Object.keys(out) as KeyAction[]) if (typeof saved[k] === 'string') out[k] = saved[k];
    return out;
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

/** True when the event is the key bound to `action`. */
export function isKey(e: KeyboardEvent, action: KeyAction): boolean {
  return e.code === bindings[action];
}

/** Station index (0-based) for the event, or -1. */
export function stationKey(e: KeyboardEvent): number {
  return (['station1', 'station2', 'station3', 'station4', 'station5'] as const).findIndex((a) => isKey(e, a));
}

/** Readable name for a key code: "KeyA" → "A", "ArrowLeft" → "←". */
export function keyName(code: string): string {
  const arrows: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', PageUp: 'Bild ↑', PageDown: 'Bild ↓', Space: 'Leertaste' };
  return arrows[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

export function currentKeys(): Record<KeyAction, string> {
  return { ...bindings };
}

/** Bind a key; a key used elsewhere is swapped so no two actions share one. */
export function rebind(action: KeyAction, code: string): void {
  const clash = (Object.keys(bindings) as KeyAction[]).find((a) => a !== action && bindings[a] === code);
  if (clash) bindings[clash] = bindings[action];
  bindings[action] = code;
  localStorage.setItem(STORE, JSON.stringify(bindings));
}

export function resetKeys(): void {
  bindings = { ...DEFAULT_KEYS };
  localStorage.removeItem(STORE);
}

/** Editor table: click an action, press the new key (Escape cancels). */
export function keysEditor(): HTMLElement {
  const el = document.createElement('div');
  let waiting: KeyAction | undefined;
  const render = () => {
    el.innerHTML = `<table>${(Object.keys(KEY_LABEL) as KeyAction[]).map((a) => `<tr><td>${KEY_LABEL[a]}</td><td>
      <button data-k="${a}" class="${waiting === a ? 'on' : ''}" style="min-width:90px">${waiting === a ? 'Taste drücken …' : keyName(bindings[a])}</button></td></tr>`).join('')}</table>
      <button data-reset="1" style="margin-top:6px">Standard wiederherstellen</button>`;
  };
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.reset) resetKeys();
    else waiting = b.dataset.k as KeyAction;
    render();
  });
  // Capture phase: the binding press must not also trigger the game or close the overlay
  const onKey = (e: KeyboardEvent) => {
    if (!waiting) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code !== 'Escape') rebind(waiting, e.code);
    waiting = undefined;
    render();
  };
  window.addEventListener('keydown', onKey, true);
  new MutationObserver((_, obs) => {
    if (!el.isConnected) {
      window.removeEventListener('keydown', onKey, true);
      obs.disconnect();
    }
  }).observe(document.body, { childList: true, subtree: true });
  render();
  return el;
}
