import { describe, expect, it } from 'vitest';
import {
  AREA_ACOUSTICS,
  PERISCOPE_DEPTH,
  ambientNoise,
  cavitationSpeedAt,
  closingSpeedMps,
  createShip,
  deepPaths,
  dopplerLabel,
  isCavitating,
  measureEvidence,
  passiveSignalExcess,
  Rng,
  transmissionLoss,
  type ClassId,
  type Environment,
  type Ship,
} from '../src/index.js';

const lofoten: Environment = { layerDepth: 80, layerLoss: 12, seaState: 3, seabed: { kind: 'tief', seed: 1, region: 'lofotenbasin' } };
const open: Environment = { layerDepth: 80, layerLoss: 12, seaState: 3 };

function mk(cls: ClassId, kn: number, depth?: number, extra: Partial<Ship> = {}): Ship {
  return Object.assign(createShip({ id: cls, cls, name: cls, pos: { x: 0, y: 0 }, heading: 0, speedKn: kn, depth }), extra);
}

/** Ranges (km) where f > 0, as [from, to] bands, sampled every 200 m out to 130 km. */
function bands(f: (r: number) => number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let r = 200; r <= 130_000; r += 200) {
    const on = f(r) > 0;
    if (on && start < 0) start = r;
    if (!on && start >= 0) {
      out.push([start / 1000, (r - 200) / 1000]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start / 1000, 130]);
  return out;
}

describe('cavitation inception grows with √pressure (F22)', () => {
  it('an SSK cavitates at about 6,5 kn at periscope depth and stays quiet to about 18 kn at 150 m', () => {
    expect(cavitationSpeedAt('ssk', PERISCOPE_DEPTH)).toBeGreaterThan(5.5);
    expect(cavitationSpeedAt('ssk', PERISCOPE_DEPTH)).toBeLessThan(7);
    expect(cavitationSpeedAt('ssk', 150)).toBeGreaterThan(17);
    expect(cavitationSpeedAt('ssk', 150)).toBeLessThan(19);
    expect(isCavitating(mk('ssk', 16, 150))).toBe(false);
    expect(isCavitating(mk('ssk', 8, PERISCOPE_DEPTH))).toBe(true);
  });

  it('follows √(10 m + tip depth): four times the head, twice the speed', () => {
    const a = cavitationSpeedAt('ssn', 7 + 10);
    const b = cavitationSpeedAt('ssn', 7 + 70);
    expect(b / a).toBeCloseTo(2, 5);
    // A nuclear boat at 300 m sprints at about 30 kn before it cavitates
    expect(cavitationSpeedAt('ssn', 300)).toBeGreaterThan(28);
    expect(cavitationSpeedAt('ffg', 0)).toBe(Infinity);
  });
});

describe('deep-water propagation (shadow zone, convergence zones, bottom bounce)', () => {
  it('a sub below the layer hears a merchant out to the direct path, loses it in the shadow and regains it in the CZ', () => {
    const merchant = mk('merchant', 10);
    const sub = mk('ssk', 4, 150);
    const b = bands((r) => passiveSignalExcess(merchant, Object.assign(sub, { pos: { x: r, y: 0 } }), r, 'hull', lofoten, 150, 3200));
    // Direct path ends in the teens of km; then nothing until the Lofoten basin's first CZ (about 40–44 km)
    expect(b[0]![0]).toBeLessThan(1);
    expect(b[0]![1]).toBeGreaterThan(8);
    expect(b[0]![1]).toBeLessThan(20);
    const cz = b[1]!;
    expect(cz[0]).toBeGreaterThan(38);
    expect(cz[1]).toBeLessThan(46);
    // No more continuous hearing out to 80+ km (the old flat model)
    expect(b.some(([a, z]) => a < 60 && z > 60)).toBe(false);
  });

  it('the CZ lies per area: the Lofoten basin closer than the procedural North Atlantic', () => {
    expect(deepPaths(60, 6, lofoten, 3200).cz[0]!.at).toBe(AREA_ACOUSTICS.lofotenbasin.czKm! * 1000);
    expect(deepPaths(60, 6, open, 3000).cz[0]!.at).toBe(55_000);
    // A second, weaker ring at twice the range
    const [cz1, cz2] = deepPaths(60, 6, open, 3000).cz;
    expect(cz2!.at).toBe(2 * cz1!.at);
    expect(cz2!.db).toBeLessThan(cz1!.db);
    // TL is lowest in the annulus, highest in the shadow before it
    expect(transmissionLoss(55_000, 60, 6, open, undefined, 3000)).toBeLessThan(transmissionLoss(40_000, 60, 6, open, undefined, 3000) - 15);
  });

  it('no CZ without depth excess, in the Arctic half-channel, or in shallow-water areas', () => {
    expect(deepPaths(60, 6, lofoten, 1200).cz).toEqual([]);
    const fram: Environment = { ...lofoten, layerDepth: 0, seabed: { kind: 'tief', seed: 1, region: 'framstr' } };
    expect(deepPaths(60, 6, fram, 3000).cz).toEqual([]);
    // Half-channel: surface-reflected paths, a gentle loss instead of a shadow
    const p = deepPaths(60, 6, fram, 3000);
    expect(p.excessAt(p.rdp + 5000)).toBeLessThan(4);
    // Gibraltar (narrows), 700 m deep: the shallow-water model stays as it was
    const strait: Environment = { ...open, seabed: { kind: 'fjord', seed: 1, region: 'gibraltar' } };
    const plain: Environment = { ...open, seabed: { kind: 'fjord', seed: 1, region: 'vestfjord' } };
    expect(transmissionLoss(30_000, 60, 6, strait, undefined, 700)).toBeCloseTo(transmissionLoss(30_000, 60, 6, plain, undefined, 700), 6);
  });

  it('the shadow is full over CZ-deep water, partly filled by bottom bounce over mid-depth water', () => {
    const deep = deepPaths(150, 6, open, 3000);
    const mid = deepPaths(150, 6, open, 700);
    expect(deep.excessAt(deep.rdp - 1)).toBe(0);
    expect(deep.excessAt(deep.rdp + 30_000)).toBe(18);
    expect(mid.excessAt(mid.rdp + 30_000)).toBeGreaterThan(6);
    expect(mid.excessAt(mid.rdp + 30_000)).toBeLessThan(12);
  });

  it('the direct path reaches farther the deeper the ends are, and a duct leaks instead of shadowing', () => {
    expect(deepPaths(300, 200, open, 3000).rdp).toBeGreaterThan(deepPaths(18, 6, open, 3000).rdp + 5000);
    const ducted = deepPaths(40, 6, { ...open, layerDepth: 120 }, 3000);
    expect(ducted.ducted).toBe(true);
    expect(ducted.excessAt(ducted.rdp + 5000)).toBeLessThan(deepPaths(150, 6, open, 3000).excessAt(ducted.rdp + 5000));
  });
});

describe('regional shipping noise (F2)', () => {
  it('Gibraltar is loud, the open Norwegian Sea quiet; wind and rain still count', () => {
    const at = (region: 'gibraltar' | 'lofotenbasin', rain = false) => ambientNoise({ ...open, rain, seabed: { kind: 'tief', seed: 1, region } });
    expect(at('gibraltar') - at('lofotenbasin')).toBeGreaterThanOrEqual(6);
    expect(at('lofotenbasin', true)).toBeGreaterThan(at('lofotenbasin'));
    expect(ambientNoise({ ...open, seaState: 5 })).toBeGreaterThan(ambientNoise(open));
  });
});

describe('Doppler on narrowband tonals (F6)', () => {
  it('closing speed is the relative velocity along the line of sight', () => {
    const a = mk('ffg', 10, undefined, { heading: 0 });
    const b = mk('ssk', 0, 100, { pos: { x: 0, y: 10_000 } });
    expect(closingSpeedMps(a, b)).toBeCloseTo(10 * 0.514444, 3);
    expect(closingSpeedMps(Object.assign(mk('ffg', 10), { heading: 180 }), b)).toBeLessThan(0);
    // Crossing at right angles: no radial component
    expect(Math.abs(closingSpeedMps(Object.assign(mk('ffg', 10), { heading: 90 }), b))).toBeLessThan(1e-9);
  });

  it('shifts every line by f·v/c and reports the strongest line', () => {
    const v = 15 * 0.514444; // 15 kn closing
    let sum = 0;
    const n = 200;
    const rng = new Rng(7);
    for (let i = 0; i < n; i++) {
      const ev = measureEvidence('ffg', 15, 20, { closingMps: v }, rng);
      // The 60 Hz line sits +0,31 Hz high at 15 kn, the 120 Hz line +0,62 Hz
      sum += ev.tonals.find((t) => Math.abs(t.hz - 60) < 1)!.hz - 60;
      expect(ev.tonals.find((t) => Math.abs(t.hz - 120.6) < 0.3)).toBeDefined();
      // The readout is the strongest line's shift (mostly the 60 or 120 Hz line, at most the 233 Hz one: +1,2 Hz)
      expect(ev.dopplerHz).toBeGreaterThan(0.1);
      expect(ev.dopplerHz).toBeLessThan(1.4);
    }
    expect(sum / n).toBeCloseTo((60 * v) / 1500, 1);
    // Without a known closing speed (buoys, emitters) no Doppler readout
    expect(measureEvidence('ffg', 15, 20, {}, new Rng(1)).dopplerHz).toBeUndefined();
  });

  it('reads "+0,8 HZ · NÄHERT" / "−0,4 HZ · ENTFERNT SICH"', () => {
    expect(dopplerLabel(0.8)).toBe('+0,8 HZ · NÄHERT');
    expect(dopplerLabel(-0.44)).toBe('−0,4 HZ · ENTFERNT SICH');
    expect(dopplerLabel(-0.01)).toBe('±0,0 HZ · KEINE RADIALFAHRT');
  });
});
