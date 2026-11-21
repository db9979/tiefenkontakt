import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENV,
  activeSignalExcess,
  createShip,
  isCavitating,
  passiveSignalExcess,
  sourceLevel,
  towedArrayDepth,
  transmissionLoss,
  type ClassId,
  type Ship,
} from '../src/index.js';

const env = DEFAULT_ENV;

function mk(cls: ClassId, kn: number, depth?: number, extra: Partial<Ship> = {}): Ship {
  return Object.assign(createShip({ id: cls, cls, name: cls, pos: { x: 0, y: 0 }, heading: 0, speedKn: kn, depth }), extra);
}

/** Largest range (m) at which f(range) stays positive, by bisection. */
function maxRange(f: (r: number) => number): number {
  let lo = 10;
  let hi = 400_000;
  if (f(lo) < 0) return 0;
  if (f(hi) > 0) return hi;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) lo = m;
    else hi = m;
  }
  return lo;
}

describe('source level', () => {
  it('grows with speed and jumps when cavitating', () => {
    const slow = mk('ssn', 5, 100);
    const fast = mk('ssn', 15, 100);
    expect(sourceLevel(fast)).toBeGreaterThan(sourceLevel(slow) + 20);
    const shallowFast = mk('ssn', 12, 20);
    const deepFast = mk('ssn', 12, 300);
    expect(isCavitating(shallowFast)).toBe(true);
    expect(isCavitating(deepFast)).toBe(false);
  });

  it('snorkeling makes a diesel boat loud', () => {
    const quiet = mk('ssk', 6, 18);
    const snort = mk('ssk', 6, 18, { snorkel: true });
    expect(sourceLevel(snort) - sourceLevel(quiet)).toBeGreaterThan(20);
  });
});

describe('transmission loss', () => {
  it('adds the layer penalty only when crossing it', () => {
    const same = transmissionLoss(5000, 50, 60, env);
    const cross = transmissionLoss(5000, 50, 200, env);
    expect(cross - same).toBeCloseTo(env.layerLoss, 5);
  });
});

describe('detection ranges', () => {
  it('a slow diesel boat is nearly inaudible to a frigate hull sonar', () => {
    const r = maxRange((x) => passiveSignalExcess(mk('ssk', 4, 60), mk('ffg', 15), x, 'hull', env));
    expect(r).toBeLessThan(1000);
  });

  it('a submarine hears the convoy from tens of kilometres', () => {
    const r = maxRange((x) => passiveSignalExcess(mk('merchant', 10), mk('ssk', 4, 60), x, 'hull', env));
    expect(r).toBeGreaterThan(30_000);
  });

  it('a fast nuclear boat gives itself away on a towed array', () => {
    const ffg = mk('ffg', 12, undefined, { towedLength: 400 });
    const slow = maxRange((x) => passiveSignalExcess(mk('ssn', 5, 60), ffg, x, 'towed', env, towedArrayDepth(ffg)));
    const fast = maxRange((x) => passiveSignalExcess(mk('ssn', 20, 60), ffg, x, 'towed', env, towedArrayDepth(ffg)));
    expect(slow).toBeGreaterThan(3000);
    expect(fast).toBeGreaterThan(slow * 5);
  });

  it('hiding below the layer shortens active sonar range', () => {
    const shallow = maxRange((x) => activeSignalExcess(mk('ssk', 4, 60), mk('ffg', 15), x, env));
    const deep = maxRange((x) => activeSignalExcess(mk('ssk', 4, 150), mk('ffg', 15), x, env));
    expect(shallow).toBeGreaterThan(5000);
    expect(deep).toBeLessThan(shallow * 0.6);
  });
});
