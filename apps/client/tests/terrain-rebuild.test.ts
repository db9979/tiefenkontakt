import { describe, expect, it } from 'vitest';
import type { SeabedSpec } from '@tk/shared';
import { Terrain, seabedKey } from '../src/widgets/sea3d/terrain.js';

/**
 * Every snapshot carries a fresh copy of the same sea chart: the 3D land must not be rebuilt for
 * it (that was most of a phone's main thread in the periscope and bridge views).
 */
describe('3D land rebuilds', () => {
  const fjord: SeabedSpec = { kind: 'fjord', seed: 7 };

  it('keeps the land for an equal copy of the chart', () => {
    const t = new Terrain();
    t.update(fjord, { x: 0, y: 0 });
    const built = [...t.group.children];
    expect(built.length).toBeGreaterThan(0);
    t.update(structuredClone(fjord), { x: 40, y: -30 });
    expect(t.group.children).toEqual(built);
    expect(t.group.children[0]).toBe(built[0]);
  });

  it('rebuilds for another chart or after moving on', () => {
    const t = new Terrain();
    t.update(fjord, { x: 0, y: 0 });
    const first = t.group.children[0];
    t.update({ ...fjord, seed: 8 }, { x: 0, y: 0 });
    expect(t.group.children[0]).not.toBe(first);
    const second = t.group.children[0];
    t.update({ ...fjord, seed: 8 }, { x: 20_000, y: 0 });
    expect(t.group.children[0]).not.toBe(second);
  });

  it('tells charts apart by content', () => {
    expect(seabedKey(fjord)).toBe(seabedKey({ kind: 'fjord', seed: 7 }));
    expect(seabedKey(fjord)).not.toBe(seabedKey({ kind: 'schelf', seed: 7 }));
    expect(seabedKey({ kind: 'tief', seed: 1, bankY: 100 })).not.toBe(seabedKey({ kind: 'tief', seed: 1, bankY: 200 }));
  });
});
