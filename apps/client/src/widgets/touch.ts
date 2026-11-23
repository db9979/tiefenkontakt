/**
 * Touch helpers: a long press opens the context menu (iOS Safari never fires
 * `contextmenu` on touch), two fingers pinch to zoom (`onPinch` gets the factor by which the
 * scale in metres per pixel changes: below 1 zooms in), and canvases claim touch gestures so
 * dragging works. While two fingers are down the element carries data-pinch, so one-finger
 * handlers (panning) can step aside.
 */
export function touchable(el: HTMLElement, onPinch?: (factor: number) => void): void {
  el.style.touchAction = 'none';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | undefined;
  const fingers = new Map<number, { x: number; y: number }>();
  let spread = 0;
  const gap = () => {
    const [a, b] = [...fingers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const lift = (e: PointerEvent) => {
    fingers.delete(e.pointerId);
    if (fingers.size < 2) delete el.dataset.pinch;
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) {
      clearTimeout(timer);
      start = undefined;
      spread = gap();
      el.dataset.pinch = '1';
      return;
    }
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start!.x, clientY: start!.y, button: 2 }));
      start = undefined;
    }, 550);
  });
  el.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clearTimeout(timer);
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2 && onPinch) {
      const now = gap();
      if (spread > 20 && now > 20) onPinch(spread / now);
      spread = now;
    }
  });
  const cancel = (e: PointerEvent) => {
    clearTimeout(timer);
    lift(e);
  };
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
}

/**
 * Delegated tap for lists that are rebuilt on every snapshot: the target is remembered on
 * pointerdown and the action fires on release, so a row replaced mid-tap still counts and a
 * scroll gesture (pointercancel or movement) does not trigger it.
 */
export function onTap(el: HTMLElement, selector: string, fn: (target: HTMLElement) => void): void {
  let down: { target: HTMLElement; x: number; y: number; id: number } | undefined;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>(selector);
    down = target ? { target, x: e.clientX, y: e.clientY, id: e.pointerId } : undefined;
  });
  el.addEventListener('pointercancel', () => (down = undefined));
  // On the window: the original row may already be detached when the finger lifts
  window.addEventListener('pointerup', (e) => {
    const d = down;
    down = undefined;
    if (!d || e.pointerId !== d.id || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    fn(d.target);
  });
}
