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

import { callMpa, sendDip, sendHeloTorpedo } from '../src/index.js';

describe('dipping sonar, helicopter torpedo, patrol aircraft', () => {
  function world() {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 9000, y: 3000 }, heading: 0, speedKn: 3, depth: 60 });
    const w = createWorld([ffg, sub], 5, { layerDepth: 120, layerLoss: 12, seaState: 3 });
    installWeapons(w);
    installAir(w);
    return { w, ffg, sub };
  }

  it('a dipping sonar gets range from the hover point; the boat hears the ping', () => {
    const { w, ffg } = world();
    expect(sendDip(w, ffg, { x: 8000, y: 1500 }, false)).toBe(true);
    for (let i = 0; i < 3000; i++) stepWorld(w);
    const tr = w.books.get('f')!.entries().find(([id]) => id === 'u')?.[1];
    const echo = tr?.history.find((h) => h.sensor === 'active' && h.ox !== undefined);
    expect(echo?.r).toBeGreaterThan(500);
    expect(echo?.ox).toBeCloseTo(8000, 0);
    expect(w.books.get('u')!.entries().some(([id]) => id === 'H-f')).toBe(true);
  });

  it('the helicopter drops a searching torpedo; the patrol aircraft lays a buoy line', () => {
    const { w, ffg } = world();
    expect(sendHeloTorpedo(w, ffg, { x: 9000, y: 3000 })).toBe(true);
    for (let i = 0; i < 2000 && !w.weapons!.torpedoes.length; i++) stepWorld(w);
    expect(w.weapons!.torpedoes[0]?.kind).toBe('light');
    expect(callMpa(w, ffg, { x: 0, y: 20_000 }, 90)).toBe(true);
    expect(callMpa(w, ffg, { x: 0, y: 20_000 }, 90)).toMatch(/bereit in/);
    for (let i = 0; i < 6000 && w.air!.buoys.length < 6; i++) stepWorld(w);
    const xs = w.air!.buoys.map((b) => Math.round(b.pos.y));
    expect(w.air!.buoys).toHaveLength(6);
    expect(new Set(xs).size).toBe(6);
  });
});
