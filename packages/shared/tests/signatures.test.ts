import { describe, expect, it } from 'vitest';
import {
  Rng,
  SIGNATURES,
  bladeCount,
  createShip,
  createWorld,
  fireTorpedo,
  installWeapons,
  measureEvidence,
  rankClasses,
  runSensors,
  shaftHz,
  stepWorld,
} from '../src/index.js';

describe('acoustic evidence', () => {
  it('DEMON lines follow speed and blade count', () => {
    const ev = measureEvidence('merchant', 10, 15, {}, new Rng(1));
    const expected = shaftHz(SIGNATURES.merchant, 10);
    expect(ev.shaftHz).toBeCloseTo(expected, 0);
    expect(Math.round(ev.bladeHz! / ev.shaftHz!)).toBe(4);
  });

  it('weak contacts show weaker lines and no DEMON', () => {
    const weak = measureEvidence('merchant', 10, 0.5, {}, new Rng(2));
    const strong = measureEvidence('merchant', 10, 15, {}, new Rng(2));
    const maxSnr = (e: typeof weak) => Math.max(...e.tonals.map((t) => t.snr));
    expect(maxSnr(weak)).toBeLessThan(maxSnr(strong) - 8);
    expect(weak.shaftHz).toBeUndefined();
    expect(strong.shaftHz).toBeDefined();
  });

  it('a diesel boat on battery is nearly tonal-free but snorkeling lights it up', () => {
    const quiet = measureEvidence('ssk', 4, 4, {}, new Rng(3));
    const snort = measureEvidence('ssk', 6, 4, { snorkel: true }, new Rng(3));
    expect(quiet.tonals.length).toBeLessThanOrEqual(1);
    expect(snort.tonals.length).toBeGreaterThanOrEqual(3);
  });
});

describe('class library', () => {
  it('ranks the true class first from correct marks', () => {
    const shaft = shaftHz(SIGNATURES.ssn, 10);
    const top = rankClasses({ shaftHz: shaft, bladeHz: shaft * 7, tonalHz: 25 })[0];
    expect(top?.sig.key).toBe('ssn');
  });

  it('counts blades from marks and is empty without marks', () => {
    expect(bladeCount({ shaftHz: 1.5, bladeHz: 7.6 })).toMatchObject({ blades: 5, rpm: 90 });
    expect(rankClasses({})).toEqual([]);
  });

  it('a torpedo shaft rate points to the torpedo class', () => {
    expect(rankClasses({ shaftHz: shaftHz(SIGNATURES.torpedo, 40) })[0]?.sig.key).toBe('torpedo');
  });
});

describe('sonar truth boundary', () => {
  it('sonar detections never carry a class name', () => {
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 60 });
    const m = createShip({ id: 'm1', cls: 'merchant', name: 'M1', pos: { x: 2000, y: 3000 }, heading: 270, speedKn: 10 });
    const dets = runSensors({ ships: [sub, m], env: { layerDepth: 120, layerLoss: 12, seaState: 3 }, time: 100, rng: new Rng(4) });
    const sonar = dets.filter((d) => d.sensor === 'hull' || d.sensor === 'towed');
    expect(sonar.length).toBeGreaterThan(0);
    for (const d of sonar) {
      expect(d.classified).toBeUndefined();
      expect(d.evidence).toBeDefined();
    }
  });

  it('a running torpedo becomes a sonar contact for the target', () => {
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 60 });
    const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 6000 }, heading: 90, speedKn: 10 });
    const w = createWorld([sub, ffg], 5);
    installWeapons(w);
    fireTorpedo(w, sub, { heading: 0 });
    for (let i = 0; i < 30; i++) stepWorld(w);
    const torpTrack = w.books.get('f1')?.entries().find(([id]) => id.startsWith('T'));
    expect(torpTrack).toBeDefined();
    expect(torpTrack![1].evidence?.tonals).toHaveLength(0);
    expect(w.books.get('u1')?.entries().some(([id]) => id.startsWith('T'))).toBe(false);
  });
});
