import { describe, expect, it } from 'vitest';
import { angleDiff, createShip, createWorld, installAir, installWeapons, sendBuoy, stepWorld } from '../src/index.js';

describe('helicopter and sonobuoys', () => {
  function world() {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    const sub = createShip({ id: 'u', cls: 'ssn', name: 'U', pos: { x: 12_000, y: 0 }, heading: 0, speedKn: 8, depth: 60 });
    const w = createWorld([ffg, sub], 3, { layerDepth: 120, layerLoss: 12, seaState: 3 });
    installWeapons(w);
    installAir(w);
    return { w, ffg, sub };
  }

  it('drops a buoy after the flight and reports bearings from the buoy position', () => {
    const { w, ffg } = world();
    expect(sendBuoy(w, ffg, { x: 10_000, y: 500 }, false)).toBe(true);
    expect(sendBuoy(w, ffg, { x: 9000, y: 0 }, false)).toBe('Hubschrauber ist unterwegs');
    for (let i = 0; i < 2000 && !w.air!.buoys.length; i++) stepWorld(w);
    expect(w.air!.buoys).toHaveLength(1);
    for (let i = 0; i < 50; i++) stepWorld(w);
    const tr = w.books.get('f')?.entries().find(([id]) => id === 'u')?.[1];
    expect(tr?.sensors).toContain('buoy');
    const sample = tr!.history.find((h) => h.sensor === 'buoy')!;
    expect(sample.ox).toBeCloseTo(10_000, 0);
    // Bearing measured from the buoy (east of it, slightly north) rather than from the frigate
    expect(Math.abs(angleDiff(sample.b, 75))).toBeLessThan(25);
  });

  it('refuses targets out of helicopter range', () => {
    const { w, ffg } = world();
    expect(sendBuoy(w, ffg, { x: 40_000, y: 0 }, false)).toMatch(/Reichweite/);
  });
});
