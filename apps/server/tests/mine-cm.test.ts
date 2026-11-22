import { describe, expect, it } from 'vitest';
import { createConvoy, createShip, createWorld, stepConvoy, setConvoyOffset } from '@tk/shared';
import { DETOUR_BAND_M, detourDecision, wantMineAvoid } from '../src/bots/mine-cm.js';

// Northbound leg from the origin; + offset = starboard = east
const leg = { legFrom: { x: 0, y: 0 }, legTo: { x: 0, y: 40_000 } };
const guide = { x: 0, y: 10_000 };
/** A barrage across the track 3 km ahead, from x0 to x1 every 115 m. */
const barrage = (x0: number, x1: number, y = 13_000) => {
  const out = [];
  for (let x = x0; x <= x1; x += 115) out.push({ x, y });
  return out;
};

describe('escort mine countermeasures: convoy detour', () => {
  it('keeps the route with no or a single known mine ahead', () => {
    expect(detourDecision({ ...leg, guide, offset: 0, mines: [] })).toBeUndefined();
    expect(detourDecision({ ...leg, guide, offset: 0, mines: [{ x: 100, y: 12_000 }] })).toBeUndefined();
    // A barrage well off to the side or far ahead is no reason to turn
    expect(detourDecision({ ...leg, guide, offset: 0, mines: barrage(3000, 3600) })).toBeUndefined();
    expect(detourDecision({ ...leg, guide, offset: 0, mines: barrage(-300, 300, 25_000) })).toBeUndefined();
  });

  it('turns a barrage on the track to the side with fewer known mines, just clear of them', () => {
    // Barrage across the starboard column: more mines east of the track → go to port (west)
    const mines = barrage(-200, 700);
    const off = detourDecision({ ...leg, guide, offset: 0, mines })!;
    expect(off).toBeLessThan(0);
    // Clear of the westernmost mine by the convoy's band, not much further
    expect(off).toBeLessThanOrEqual(-200 - DETOUR_BAND_M);
    expect(off).toBeGreaterThan(-200 - DETOUR_BAND_M - 200);
    // Mirror image → starboard
    const mirrored = detourDecision({ ...leg, guide, offset: 0, mines: mines.map((p) => ({ x: -p.x, y: p.y })) })!;
    expect(mirrored).toBeGreaterThan(0);
  });

  it('stays out of the shallows: the detour goes to the side with water', () => {
    const mines = barrage(-200, 700);
    // Land west of x = -1500: the port detour would put the columns aground
    const depth = (p: { x: number }) => (p.x < -1500 ? 5 : 150);
    const off = detourDecision({ ...leg, guide, offset: 0, mines, depth })!;
    expect(off).toBeGreaterThan(700 + DETOUR_BAND_M - 1);
  });

  it('holds the detour while the barrage is alongside, returns to the route once past', () => {
    const mines = barrage(-300, 300);
    const off = detourDecision({ ...leg, guide, offset: 0, mines })!;
    expect(Math.abs(off)).toBeGreaterThan(DETOUR_BAND_M);
    // Alongside: keep it
    expect(detourDecision({ ...leg, guide: { x: off, y: 13_000 }, offset: off, mines })).toBeUndefined();
    // Rear rows still near the line: keep it
    expect(detourDecision({ ...leg, guide: { x: off, y: 14_500 }, offset: off, mines })).toBeUndefined();
    // Well past: back to the route
    expect(detourDecision({ ...leg, guide: { x: off, y: 16_000 }, offset: off, mines })).toBe(0);
  });

  it('a second barrage on the detour track moves the convoy further', () => {
    const first = barrage(-300, 300);
    const off = detourDecision({ ...leg, guide, offset: 0, mines: first })!;
    const second = barrage(off - 300, off + 300, 14_000);
    const next = detourDecision({ ...leg, guide, offset: off, mines: [...first, ...second] });
    expect(next).toBeDefined();
    expect(Math.abs(next! - off)).toBeGreaterThan(DETOUR_BAND_M);
  });

  it('on the first leg the convoy settles on the parallel track instead of drifting off', () => {
    const m = createShip({ id: 'm1', cls: 'merchant', name: 'M', team: 'west', pos: { x: 0, y: 0 }, heading: 0, speedKn: 9 });
    const c = createConvoy([m], [{ x: 0, y: 40_000 }], 9);
    c.zigzag = false;
    setConvoyOffset(c, 2000);
    for (let t = 0; t < 2400; t++) stepConvoy(c, [], 1, t);
    expect(c.guide.x).toBeGreaterThan(1800);
    expect(c.guide.x).toBeLessThan(2200);
  });
});

describe('escort mine countermeasures: mine-avoidance sonar', () => {
  it('on in water where mines can lie and below 15 kn, off when sprinting or in deep water', () => {
    const f = createShip({ id: 'f', cls: 'ffg', name: 'F', team: 'west', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    const shelf = createWorld([f], 3, { layerDepth: 80, layerLoss: 12, seaState: 3, seabed: { kind: 'schelf', seed: 3 } });
    f.order.speedKn = 12;
    expect(wantMineAvoid(shelf, f)).toBe(true);
    f.order.speedKn = 20;
    expect(wantMineAvoid(shelf, f)).toBe(false);
    const deep = createWorld([f], 3, { layerDepth: 80, layerLoss: 12, seaState: 3, seabed: { kind: 'tief', seed: 3 } });
    f.order.speedKn = 12;
    expect(wantMineAvoid(deep, f)).toBe(false);
  });
});
