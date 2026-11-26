import { beforeAll, describe, expect, it, vi } from 'vitest';

/** A button stand-in: the status helper only touches classList, dataset and style. */
function fakeButton() {
  const cls = new Set<string>();
  const props = new Map<string, string>();
  return {
    dataset: {} as Record<string, string | undefined>,
    classList: { toggle: (c: string, on?: boolean) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c), contains: (c: string) => cls.has(c) },
    style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) },
    cls,
    props,
  };
}

let m: typeof import('../src/widgets/btn-state.js');
beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'de', setItem: () => undefined });
  vi.stubGlobal('location', { port: '' });
  m = await import('../src/widgets/btn-state.js');
});

describe('status on the button', () => {
  it('toggles show AN/AUS and light up', () => {
    const b = fakeButton();
    m.btnState(b as unknown as HTMLElement, { on: true });
    expect(b.dataset.bst).toBe('AN');
    expect(b.cls.has('on')).toBe(true);
    m.btnState(b as unknown as HTMLElement, { on: false });
    expect(b.dataset.bst).toBe('AUS');
    expect(b.cls.has('on')).toBe(false);
  });

  it('a running process fills the button and clears the fill when done', () => {
    const b = fakeButton();
    m.btnState(b as unknown as HTMLElement, m.mastBtn({ ext: 0.47, moving: 'aus' }, false));
    expect(b.dataset.bst).toBe('47 %');
    expect(b.props.get('--pct')).toBe('47%');
    expect(b.cls.has('st-busy')).toBe(true);
    m.btnState(b as unknown as HTMLElement, m.mastBtn({ ext: 1 }, true));
    expect(b.dataset.bst).toBe('OBEN');
    expect(b.cls.has('prog')).toBe(false);
    expect(m.mastBtn({ ext: 0 }, false, true)).toMatchObject({ label: 'ZU TIEF', tone: 'warn' });
  });

  it('a depth button shows the way to its depth, then a tick', () => {
    const b = fakeButton();
    m.depthBtn(b as unknown as HTMLElement, 80, 18, 18);
    expect(b.dataset.bst).toBe('80↑');
    m.depthBtn(b as unknown as HTMLElement, 49, 18, 18);
    expect(b.props.get('--pct')).toBe('50%');
    m.depthBtn(b as unknown as HTMLElement, 18.4, 18, 18);
    expect(b.dataset.bst).toBe('✓');
    // Another depth ordered: this button goes dark
    m.depthBtn(b as unknown as HTMLElement, 18, 60, 18);
    expect(b.dataset.bst).toBeUndefined();
    expect(b.cls.has('on')).toBe(false);
  });

  it('fire buttons show tubes ready, else the next reload, else empty', () => {
    expect(m.tubeTag([{ loaded: true, reloadLeft: 0 }, { loaded: false, reloadLeft: 40 }]).label).toBe('1/2 BEREIT');
    expect(m.tubeTag([{ loaded: false, reloadLeft: 40.2 }, { loaded: false, reloadLeft: 12.5 }])).toMatchObject({ label: 'LÄDT 13 S', tone: 'busy' });
    expect(m.tubeTag([{ loaded: false, reloadLeft: 0 }])).toMatchObject({ label: 'LEER', tone: 'empty' });
  });
});
