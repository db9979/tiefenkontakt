import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A scene built for one graphics level is rebuilt when Auto steps down or the player picks another level. */
const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
});
afterEach(() => vi.unstubAllGlobals());

const canvas = (): HTMLCanvasElement => {
  const c = { cloneNode: () => canvas(), replaceWith: () => undefined };
  return c as unknown as HTMLCanvasElement;
};

describe('LazyGl and the graphics level', () => {
  it('builds anew for the level in effect, and only when it changed', async () => {
    const { LazyGl } = await import('../src/widgets/lazy-gl.js');
    const { quality, stepDown } = await import('../src/widgets/perf.js');
    const built: string[] = [];
    const disposed: string[] = [];
    const gl = new LazyGl(canvas(), async () => {
      const level = quality();
      built.push(level);
      return { level, dispose: () => void disposed.push(level) };
    });
    gl.ensure();
    await Promise.resolve();
    await Promise.resolve();
    expect(built).toEqual(['mittel']);
    gl.ensure();
    await Promise.resolve();
    expect(built).toEqual(['mittel']);
    // The device could not keep up: Auto goes one level down, the scene follows
    expect(stepDown()).toBe(true);
    gl.ensure();
    await Promise.resolve();
    await Promise.resolve();
    expect(disposed).toEqual(['mittel']);
    expect(built).toEqual(['mittel', 'niedrig']);
    expect(gl.scene?.level).toBe('niedrig');
  });

  it('leaves scenes without a level alone', async () => {
    const { LazyGl } = await import('../src/widgets/lazy-gl.js');
    let n = 0;
    const gl = new LazyGl(canvas(), async () => (n++, { dispose: () => undefined }));
    gl.ensure();
    await Promise.resolve();
    await Promise.resolve();
    storage.setItem('tk_quality', 'hoch');
    gl.ensure();
    await Promise.resolve();
    expect(n).toBe(1);
  });
});
