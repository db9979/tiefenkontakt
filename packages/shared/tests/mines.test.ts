import { describe, expect, it } from 'vitest';
import {
  MINE_ARM_S, MINE_DETECT_M, createConvoy, createShip, createWorld, installWeapons, knownMines, layMine, mineStateOf, mineSystem,
  minesFor, steerClear, headingVec, stepConvoy, triggerRadius, type Ship, type World,
} from '../src/index.js';

function scene(extra: Ship[] = [], seabed: 'schelf' | 'tief' = 'schelf'): World {
  const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 40 });
  const w = createWorld([sub, ...extra], 3, { layerDepth: 80, layerLoss: 12, seaState: 2, seabed: { kind: seabed, seed: 3 } });
  installWeapons(w);
  return w;
}

const tick = (w: World, s: number) => {
  for (let t = 0; t < s; t += 0.1) {
    w.time += 0.1;
    mineSystem(w, 0.1);
  }
};

describe('naval mines', () => {
  it('a Kilo-type boat lays a mine in shallow water through a tube; not in deep water, not fast', () => {
    const w = scene();
    const sub = w.ships[0]!;
    expect(w.weapons!.loadouts.get('u')!.mines).toBe(4);
    expect(layMine(w, sub)).toBe(true);
    expect(w.weapons!.loadouts.get('u')!.mines).toBe(3);
    const m = mineStateOf(w).mines[0]!;
    expect(m.bottom).toBe(false);
    expect(m.depth).toBe(10);
    // One tube is busy with the mine for a reload cycle
    expect(w.weapons!.loadouts.get('u')!.tubes.filter((t) => !t.loaded)).toHaveLength(1);
    expect(layMine(w, sub)).toMatch(/Rohr/);
    sub.speed = 12 * 0.5144;
    w.time += 60;
    expect(layMine(w, sub)).toMatch(/kn/);
    const deep = scene([], 'tief');
    expect(layMine(deep, deep.ships[0]!)).toMatch(/tief/);
    const ssn = createShip({ id: 'n', cls: 'ssn', name: 'N', team: 'east', pos: { x: 0, y: 0 }, heading: 0, depth: 40 });
    const w2 = scene([ssn]);
    expect(layMine(w2, ssn)).toMatch(/Keine Minen/);
  });

  it('arms after a delay, then any ship passing inside the trigger radius sets it off (convoy, neutral, own side)', () => {
    const merchant = createShip({ id: 'm', cls: 'merchant', name: 'M', pos: { x: 0, y: 2000 }, heading: 180, speedKn: 0 });
    const w = scene([merchant]);
    const sub = w.ships[0]!;
    layMine(w, sub);
    sub.pos = { x: 5000, y: 0 };
    merchant.pos = { x: triggerRadius(merchant) * 0.5, y: 0 };
    tick(w, 10);
    // Not armed yet
    expect(merchant.hp).toBe(110);
    tick(w, MINE_ARM_S);
    expect(merchant.hp).toBeLessThan(110);
    expect(w.events.some((e) => e.kind === 'mine' && e.what === 'detonated' && e.shipId === 'm')).toBe(true);
    expect(mineStateOf(w).mines).toHaveLength(0);
    // A small yacht has a small signature: it slips past at 40 m
    const yacht = createShip({ id: 'y', cls: 'yacht', name: 'Y', team: 'neutral', pos: { x: 40, y: 0 }, heading: 0 });
    expect(triggerRadius(yacht)).toBeLessThan(40);
    expect(triggerRadius(merchant)).toBeGreaterThan(40);
  });

  it('escorts find mines ahead with active sonar at short range, share them and steer clear', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: -600 }, heading: 0, speedKn: 10 });
    const far = createShip({ id: 'k', cls: 'kor', name: 'K', pos: { x: 0, y: -MINE_DETECT_M * 2 }, heading: 0, speedKn: 10 });
    const w = scene([ffg, far]);
    const sub = w.ships[0]!;
    layMine(w, sub);
    sub.pos = { x: 9000, y: 0 };
    // Sonar off: nothing
    tick(w, 20);
    expect(minesFor(w, ffg)).toHaveLength(0);
    ffg.activeSonar = true;
    far.activeSonar = true;
    tick(w, 20);
    expect(minesFor(w, ffg)).toHaveLength(1);
    // Shared over the datalink: the far corvette (out of sonar range) sees it too
    expect(minesFor(w, far)).toHaveLength(1);
    expect(w.events.some((e) => e.kind === 'mine' && e.what === 'detected' && e.shipId === 'f')).toBe(true);
    // The layer sees its own mine; the escort's course is turned away from it
    expect(minesFor(w, sub)[0]!.own).toBe(true);
    const h = steerClear(ffg.pos, 0, knownMines(w, 'west'));
    expect(Math.abs(h - 0) > 20 && Math.abs(h - 360) > 20).toBe(true);
    expect(steerClear({ x: 3000, y: -600 }, 0, knownMines(w, 'west'))).toBe(0);
  });

  it('a mine further than the sonar reaches stays hidden', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: -MINE_DETECT_M * 1.6 }, heading: 0, speedKn: 10 });
    const w = scene([ffg]);
    layMine(w, w.ships[0]!);
    ffg.activeSonar = true;
    tick(w, 60);
    expect(minesFor(w, ffg)).toHaveLength(0);
  });

  it('the convoy routes around known mines', () => {
    const m = createShip({ id: 'm1', cls: 'merchant', name: 'M', pos: { x: 0, y: 0 }, heading: 0, speedKn: 9 });
    const c = createConvoy([m], [{ x: 0, y: 30_000 }], 9);
    stepConvoy(c, [m], 0.1, 0);
    const straight = m.order.heading;
    const v = headingVec(straight);
    c.hazards = [{ x: v.x * 1200, y: v.y * 1200 }];
    stepConvoy(c, [m], 0.1, 0.1);
    expect(Math.abs(m.order.heading - straight)).toBeGreaterThan(20);
  });
});
