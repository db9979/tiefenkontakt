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

  it('an active buoy pings: range for the frigate, an intercept for the boat; buoys drift', () => {
    const { w, ffg } = world();
    w.env.current = { x: 0.5, y: 0 };
    expect(sendBuoy(w, ffg, { x: 9000, y: 1000 }, false, true)).toBe(true);
    for (let i = 0; i < 2000 && !w.air!.buoys.length; i++) stepWorld(w);
    const x0 = w.air!.buoys[0]!.pos.x;
    for (let i = 0; i < 600; i++) stepWorld(w);
    expect(w.air!.buoys[0]!.pos.x).toBeGreaterThan(x0 + 20);
    const tr = w.books.get('f')!.entries().find(([id]) => id === 'u')?.[1];
    expect(tr?.history.some((h) => h.sensor === 'active' && h.r !== undefined)).toBe(true);
    expect(w.books.get('u')!.entries().some(([id]) => id === 'AB-f')).toBe(true);
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

import { BIO_SOURCE, DEFAULT_ENV, NEUTRAL_CLASSES, SIGNATURES, installIncidents, whaleEmitters } from '../src/index.js';

describe('neutral traffic and sea life', () => {
  it('a mission starts with neutral ships that keep steaming and stay in safe water; sea life is heard', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    const w = createWorld([ffg], 7, { ...DEFAULT_ENV, seabed: { kind: 'schelf', seed: 2 }, mission: 'schelf' });
    installWeapons(w);
    installIncidents(w);
    const neutrals = () => w.ships.filter((s) => s.team === 'neutral');
    expect(neutrals().length).toBeGreaterThanOrEqual(4);
    expect(neutrals().every((s) => (NEUTRAL_CLASSES as readonly string[]).includes(s.cls))).toBe(true);
    for (let i = 0; i < 3000; i++) stepWorld(w);
    expect(neutrals().filter((s) => s.alive).length).toBeGreaterThanOrEqual(3);
    expect(w.events.some((e) => e.kind === 'grounded' && neutrals().some((n) => n.id === e.shipId))).toBe(false);
    w.env.incidents!.whales.push({ id: 'W1', x: 3000, y: 0, heading: 0, until: w.time + 600, kind: 'pottwal' });
    const e = whaleEmitters(w).find((x) => x.id === 'W1')!;
    expect(e.sig).toBe('pottwal');
    expect(e.depth).toBe(BIO_SOURCE.pottwal.depth);
    expect(SIGNATURES.pottwal.choice).toBe('bio');
  });
});

import { allPlanes, installAirspace, planesFor, stepAirspace } from '../src/index.js';

describe('air traffic and air sensors', () => {
  it('radar sees an airliner far off, the eye only by day, ESM hears the recon radar; a submerged boat sees nothing', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 5000, y: 0 }, heading: 0, speedKn: 4, depth: 60 });
    const w = createWorld([ffg, sub], 9, { layerDepth: 120, layerLoss: 12, seaState: 2, light: 1 });
    installAirspace(w);
    const st = w.env.airspace!;
    st.planes = [
      { id: 'F1', kind: 'airliner', team: 'neutral', pos: { x: 60_000, y: 0 }, alt: 10_000, heading: 270, speedKn: 450, radar: false },
      { id: 'R1', kind: 'recon', team: 'east', pos: { x: 0, y: 130_000 }, alt: 1500, heading: 180, speedKn: 330, radar: true },
    ];
    ffg.radarOn = true;
    const seen = planesFor(w, ffg);
    expect(seen.find((p) => p.id === 'F1')?.via).toEqual(expect.arrayContaining(['radar']));
    expect(seen.find((p) => p.id === 'R1')?.via).toEqual(['esm']);
    expect(seen.find((p) => p.id === 'R1')?.x).toBeUndefined();
    expect(planesFor(w, sub)).toHaveLength(0);
    w.env.light = 0.05;
    ffg.radarOn = false;
    st.planes[0]!.pos = { x: 20_000, y: 0 };
    expect(planesFor(w, ffg).find((p) => p.id === 'F1')?.via).toEqual(['visual']);
    expect(allPlanes(w)).toHaveLength(2);
  });

  it('the recon aircraft flies to the convoy, orbits low and reports it', () => {
    const m = createShip({ id: 'm', cls: 'merchant', name: 'M', pos: { x: 0, y: 0 }, heading: 0, speedKn: 0 });
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 20_000, y: 0 }, heading: 0, speedKn: 0, depth: 60 });
    const w = createWorld([m, sub], 4, { layerDepth: 120, layerLoss: 12, seaState: 2 });
    installAirspace(w);
    w.env.airspace!.nextRecon = 0;
    for (let i = 0; i < 6000 && !w.events.some((e) => e.kind === 'recon'); i++) {
      w.time += 0.3;
      stepAirspace(w, 0.3);
    }
    expect(w.events.some((e) => e.kind === 'recon')).toBe(true);
    // Reported on identification (20 km out), then it comes down to orbit low
    for (let i = 0; i < 400; i++) {
      w.time += 0.3;
      stepAirspace(w, 0.3);
    }
    expect(w.env.airspace!.planes.find((p) => p.kind === 'recon')!.alt).toBeLessThan(1500);
    expect(w.events.filter((e) => e.kind === 'recon')).toHaveLength(1);
  });
});
