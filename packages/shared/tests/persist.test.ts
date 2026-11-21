import { describe, expect, it } from 'vitest';
import {
  createConvoy, createShip, createWorld, fireTorpedo, installAir, installWeapons, restoreWorld, saveWorld, sendBuoy, stepWorld,
} from '../src/index.js';

function scenario() {
  const ms = Array.from({ length: 4 }, (_, i) =>
    createShip({ id: `m${i}`, cls: 'merchant', name: `M${i}`, pos: { x: i * 900, y: 0 }, heading: 0, speedKn: 9 }));
  const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 3000, y: 2000 }, heading: 0, speedKn: 12 });
  const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 1000, y: 9000 }, heading: 180, speedKn: 4, depth: 60 });
  const w = createWorld([...ms, ffg, sub], 42);
  w.convoy = createConvoy(ms, [{ x: 0, y: 30_000 }], 9);
  installWeapons(w);
  installAir(w);
  return { w, ffg, sub };
}

describe('save and restore', () => {
  it('a restored world continues exactly like the original', () => {
    const { w, ffg, sub } = scenario();
    for (let i = 0; i < 300; i++) stepWorld(w);
    fireTorpedo(w, sub, { heading: 170 });
    sendBuoy(w, ffg, { x: 2000, y: 8000 }, true);
    for (let i = 0; i < 200; i++) stepWorld(w);
    const copy = restoreWorld(JSON.parse(JSON.stringify(saveWorld(w))));
    for (let i = 0; i < 1500; i++) {
      stepWorld(w);
      stepWorld(copy);
    }
    expect(JSON.parse(JSON.stringify(saveWorld(copy)))).toEqual(JSON.parse(JSON.stringify(saveWorld(w))));
    expect(copy.books.get('u')!.tracks().length).toBeGreaterThan(0);
  });
});
