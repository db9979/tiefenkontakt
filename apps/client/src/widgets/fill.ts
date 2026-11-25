/**
 * Displays that take the height their station leaves them (E7). The box (a `.fill` element
 * that flexes inside its panel) is measured with a ResizeObserver; the canvas inside is
 * absolutely placed, so drawing it at that height never feeds back into the layout. Below
 * `min` the station scrolls instead of squashing the display.
 */
export interface FillBox {
  /** Height (CSS px) to draw at. */
  readonly h: number;
  dispose(): void;
}

export function fillBox(el: HTMLElement, min = 140, max = Infinity): FillBox {
  let h = min;
  const measure = () => {
    const ch = el.clientHeight;
    if (ch > 0) h = Math.max(min, Math.min(max, Math.floor(ch)));
  };
  // Not in every test environment: there the minimum is drawn
  const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
  ro?.observe(el);
  return {
    get h() {
      if (!ro) measure();
      return h;
    },
    dispose: () => ro?.disconnect(),
  };
}
