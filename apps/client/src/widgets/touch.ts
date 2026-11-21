/**
 * Touch helpers: a long press opens the context menu (iOS Safari never fires
 * `contextmenu` on touch), and canvases claim touch gestures so dragging works.
 */
export function touchable(el: HTMLElement): void {
  el.style.touchAction = 'none';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | undefined;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start!.x, clientY: start!.y, button: 2 }));
      start = undefined;
    }, 550);
  });
  el.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clearTimeout(timer);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
}
