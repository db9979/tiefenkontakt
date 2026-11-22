import { describe, expect, it } from 'vitest';
import { createShip, lookoutSweep, Rng, runSensors, seesTorpedoTrack, sightingRange, type Environment } from '../src/index.js';

const day: Environment = { layerDepth: 100, layerLoss: 12, seaState: 3, light: 1 };
const night: Environment = { ...day, light: 0 };

function sub(opts: { depth: number; kn: number; mast?: boolean; snorkel?: boolean; y?: number }) {
  const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: opts.y ?? 1500 }, heading: 90, speedKn: opts.kn, depth: opts.depth, team: 'east' });
  s.mastUp = !!opts.mast;
  s.snorkel = !!opts.snorkel;
  return s;
}
const frigate = () => createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12, team: 'west' });

describe('bridge lookouts', () => {
  it('see nothing of a boat below periscope depth or with masts down', () => {
    expect(sightingRange(sub({ depth: 60, kn: 4, mast: true }), day)).toBeUndefined();
    expect(sightingRange(sub({ depth: 18, kn: 4 }), day)).toBeUndefined();
  });

  it('see a periscope feather farther the faster the boat runs', () => {
    const slow = sightingRange(sub({ depth: 18, kn: 2, mast: true }), day)!;
    const fast = sightingRange(sub({ depth: 18, kn: 8, mast: true }), day)!;
    expect(slow.what).toBe('mast');
    expect(fast.range).toBeGreaterThan(slow.range * 1.5);
    expect(fast.range).toBeLessThan(4_500);
  });

  it('see a snorkel farther than a periscope, and a surfaced boat farthest', () => {
    const mast = sightingRange(sub({ depth: 18, kn: 5, mast: true }), day)!.range;
    const snort = sightingRange(sub({ depth: 18, kn: 5, snorkel: true }), day)!.range;
    const surf = sightingRange(sub({ depth: 0, kn: 5 }), day)!.range;
    expect(snort).toBeGreaterThan(mast);
    expect(surf).toBeGreaterThan(snort);
  });

  it('are nearly blind at night and in heavy seas', () => {
    const b = sub({ depth: 18, kn: 6, mast: true });
    const d = sightingRange(b, day)!.range;
    expect(sightingRange(b, night)!.range).toBeLessThan(d * 0.25);
    expect(sightingRange(b, { ...day, seaState: 6 })!.range).toBeLessThan(d * 0.4);
  });

  it('report a close periscope within a few sweeps, with a rough range', () => {
    const rng = new Rng(3);
    const f = frigate();
    const u = sub({ depth: 18, kn: 6, mast: true, y: 800 });
    let hit;
    for (let i = 0; i < 10 && !hit; i++) hit = lookoutSweep(f, [f, u], day, rng)[0];
    expect(hit?.sighting).toBe('mast');
    expect(hit!.range).toBeGreaterThan(300);
    expect(hit!.range).toBeLessThan(1_400);
  });

  it('never report own-team boats and run as part of the sensor cycle', () => {
    const f = frigate();
    const own = createShip({ id: 'w', cls: 'ssn', name: 'W', pos: { x: 0, y: 500 }, heading: 0, speedKn: 6, depth: 18, team: 'west' });
    own.mastUp = true;
    const u = sub({ depth: 18, kn: 6, mast: true, y: 600 });
    const rng = new Rng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      for (const d of runSensors({ ships: [f, own, u], env: day, time: i, rng })) if (d.sensor === 'visual') seen.add(d.targetId);
    }
    expect([...seen]).toEqual(['u']);
  });

  it('spot torpedo tracks only close by and in daylight', () => {
    const f = frigate();
    expect(seesTorpedoTrack(f, 900, day)).toBe(true);
    expect(seesTorpedoTrack(f, 900, night)).toBe(false);
    expect(seesTorpedoTrack(f, 3_000, day)).toBe(false);
  });
});
