import { describe, expect, it } from 'vitest';
import { createShip, createWorld, depthAt, stepWorld, transmissionLoss } from '../src/index.js';

const env = { layerDepth: 120, layerLoss: 12, seaState: 3 };

describe('seabed', () => {
  it('produces the right depth ranges per mission type', () => {
    for (let i = 0; i < 50; i++) {
      const x = (i * 7919) % 40_000 - 20_000;
      const y = (i * 104_729) % 40_000;
      const deep = depthAt({ kind: 'tief', seed: 3 }, x, y);
      const shelf = depthAt({ kind: 'schelf', seed: 3 }, x, y);
      expect(deep).toBeGreaterThan(2000);
      expect(shelf).toBeGreaterThan(100);
      expect(shelf).toBeLessThan(300);
    }
    // Greenland's bank across the route: shallow enough for mines on its crest, deep sea beyond
    for (let x = -20_000; x <= 20_000; x += 2500) {
      const crest = depthAt({ kind: 'tief', seed: 3, bankY: 17_000 }, x, 17_000);
      expect(crest).toBeGreaterThan(120);
      expect(crest).toBeLessThan(270);
      expect(depthAt({ kind: 'tief', seed: 3, bankY: 17_000 }, x, 30_000)).toBeGreaterThan(2000);
    }
    expect(depthAt({ kind: 'fjord', seed: 3 }, 0, 10_000)).toBeGreaterThan(100);
    expect(depthAt({ kind: 'fjord', seed: 3 }, 15_000, 10_000)).toBeLessThan(0);
  });

  it('shallow water weakens the layer; deep water has a convergence zone', () => {
    const deepCross = transmissionLoss(5000, 50, 200, env, undefined, 3000) - transmissionLoss(5000, 50, 60, env, undefined, 3000);
    const shallowCross = transmissionLoss(5000, 50, 200, env, undefined, 250) - transmissionLoss(5000, 50, 60, env, undefined, 250);
    expect(shallowCross).toBeLessThan(deepCross);
    expect(transmissionLoss(55_000, 50, 50, env, undefined, 3000)).toBeLessThan(transmissionLoss(45_000, 50, 50, env, undefined, 3000));
  });

  it('a submarine cannot dive into the shelf; a ship in the shoals runs aground', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 60 });
    sub.order.depth = 290;
    const w = createWorld([sub], 1, { ...env, seabed: { kind: 'schelf', seed: 1 } });
    for (let i = 0; i < 2000; i++) stepWorld(w);
    expect(sub.depth).toBeLessThan(depthAt(w.env.seabed, sub.pos.x, sub.pos.y));
    const ship = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 16_000, y: 10_000 }, heading: 90, speedKn: 12 });
    const w2 = createWorld([ship], 1, { ...env, seabed: { kind: 'fjord', seed: 3 } });
    for (let i = 0; i < 50; i++) stepWorld(w2);
    expect(w2.events.some((e) => e.kind === 'grounded')).toBe(true);
    expect(ship.order.speedKn).toBe(0);
  });
});

describe('what the ear hears', () => {
  it('marks a cavitating screw and the voices of whales and torpedoes', async () => {
    const { Rng, measureEvidence } = await import('../src/index.js');
    const rng = new Rng(4);
    expect(measureEvidence('ffg', 25, 15, { cavitating: true }, rng).cav).toBe(true);
    expect(measureEvidence('ffg', 10, 15, {}, rng).cav).toBeUndefined();
    expect(measureEvidence('buckelwal', 3, 10, {}, rng).voice).toBe('gesang');
    expect(measureEvidence('pottwal', 3, 10, {}, rng).voice).toBe('klicks');
    expect(measureEvidence('torpedo', 40, 10, { cavitating: true }, rng).voice).toBe('torpedo');
    expect(measureEvidence('merchant', 10, 10, {}, rng).voice).toBeUndefined();
  });
});
