import { describe, expect, it } from 'vitest';
import {
  ContactBook,
  Rng,
  angleDiff,
  createShip,
  createWorld,
  dropXbt,
  fading,
  fireTorpedo,
  installWeapons,
  runSensors,
  stepWorld,
  type Ship,
} from '../src/index.js';

const env = { layerDepth: 120, layerLoss: 12, seaState: 3 };

describe('fading', () => {
  it('stays within ±3 dB and differs per contact', () => {
    for (let t = 0; t < 300; t += 7) expect(Math.abs(fading('a|b|h', t))).toBeLessThanOrEqual(3);
    expect(fading('a|b|h', 100)).not.toBeCloseTo(fading('a|c|h', 100), 3);
  });
});

describe('towed array sides', () => {
  it('reports starboard first and the port mirror consistently', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 8 });
    ffg.towedLength = 400;
    const ssn = createShip({ id: 'u', cls: 'ssn', name: 'U', pos: { x: -3000, y: 100 }, heading: 0, speedKn: 12, depth: 60 });
    for (let seed = 1; seed < 6; seed++) {
      const d = runSensors({ ships: [ffg, ssn], env, time: 1000, rng: new Rng(seed) }).find((x) => x.sensor === 'towed')!;
      expect(Math.abs(angleDiff(d.bearing, 88))).toBeLessThan(4);
      expect(Math.abs(angleDiff(d.bearingAlt!, 272))).toBeLessThan(4);
    }
  });

  it('a hull bearing resolves the side; a mismatch flags a ghost', () => {
    const book = new ContactBook();
    book.ingest({ observerId: 'f', targetId: 'u', sensor: 'towed', time: 10, bearing: 88, bearingAlt: 272, se: 5 });
    let tr = book.ingest({ observerId: 'f', targetId: 'u', sensor: 'hull', time: 12, bearing: 270, se: 3 });
    expect(tr.tas?.resolved).toBe('port');
    tr = book.ingest({ observerId: 'f', targetId: 'u', sensor: 'towed', time: 14, bearing: 89, bearingAlt: 271, se: 5 });
    expect(tr.bearing).toBe(271);
    expect(tr.bearingAlt).toBeUndefined();
    const ghost = new ContactBook();
    ghost.ingest({ observerId: 'f', targetId: 'x', sensor: 'towed', time: 10, bearing: 40, bearingAlt: 320, se: 5 });
    expect(ghost.ingest({ observerId: 'f', targetId: 'x', sensor: 'hull', time: 11, bearing: 180, se: 3 }).tas?.ghost).toBe(true);
  });
});

describe('active pulses', () => {
  function pingOnce(pulse: 'cw' | 'lfm', targetKn: number, seed: number) {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    ffg.activeSonar = true;
    ffg.pulse = pulse;
    const sub: Ship = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 3000 }, heading: 180, speedKn: targetKn, depth: 60 });
    return runSensors({ ships: [ffg, sub], env, time: 1000, rng: new Rng(seed) }).find((d) => d.sensor === 'active');
  }

  it('CW measures Doppler, LFM measures range precisely', () => {
    const cw = pingOnce('cw', 6, 1)!;
    const lfm = pingOnce('lfm', 6, 1)!;
    expect(cw.dopplerKn!).toBeGreaterThan(4);
    expect(lfm.dopplerKn).toBeUndefined();
    expect(Math.abs(lfm.range! - 3000)).toBeLessThan(30);
  });

  it('CW struggles against a slow target in shallow-water reverberation', () => {
    const shallow = { ...env, seabed: { kind: 'schelf' as const, seed: 3 } };
    let cwHits = 0;
    let lfmHits = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const far = (p: 'cw' | 'lfm') => {
        const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
        ffg.activeSonar = true;
        ffg.pulse = p;
        const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 7500 }, heading: 90, speedKn: 1, depth: 60 });
        return runSensors({ ships: [ffg, sub], env: shallow, time: 1000, rng: new Rng(seed) }).some((d) => d.sensor === 'active');
      };
      if (far('cw')) cwHits++;
      if (far('lfm')) lfmHits++;
    }
    expect(lfmHits).toBeGreaterThan(cwHits);
  });
});

describe('transients and layer', () => {
  it('a heavyweight launch emits flooding and launch transients', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 60 });
    const w = createWorld([sub], 1, env);
    installWeapons(w);
    fireTorpedo(w, sub, { heading: 0 });
    const kinds = w.events.filter((e) => e.kind === 'transient').map((e) => (e.kind === 'transient' ? e.what : ''));
    expect(kinds).toEqual(['flood', 'launch']);
  });

  it('a submarine learns the layer by crossing it; a frigate by XBT', () => {
    // Under way: depth changes on the planes need speed (a stopped boat only trims slowly)
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 80, speedKn: 5 });
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 5000, y: 0 }, heading: 0 });
    const w = createWorld([sub, ffg], 2, env);
    installWeapons(w);
    for (let i = 0; i < 10; i++) stepWorld(w);
    expect(sub.btLayer).toBeUndefined();
    sub.order.depth = 200;
    for (let i = 0; i < 600; i++) stepWorld(w);
    expect(Math.abs(sub.btLayer! - 120)).toBeLessThan(12);
    expect(ffg.btLayer).toBeUndefined();
    expect(dropXbt(w, ffg)).toBe(true);
    expect(Math.abs(ffg.btLayer! - 120)).toBeLessThan(16);
  });
});

describe('masking', () => {
  it('a loud merchant on the same bearing hides a quiet boat; off the bearing it is heard', () => {
    const quietEnv = { layerDepth: 0, layerLoss: 0, seaState: 1 };
    const heard = (subX: number) => {
      let n = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const ear = createShip({ id: 'e', cls: 'ssn', name: 'E', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 100, team: 'east' });
        const merchant = createShip({ id: 'm', cls: 'merchant', name: 'M', pos: { x: 0, y: 9000 }, heading: 90, speedKn: 12, team: 'west' });
        const sub = createShip({ id: 'u', cls: 'ssn', name: 'U', pos: { x: subX, y: 8000 }, heading: 90, speedKn: 12, depth: 100, team: 'west' });
        const dets = runSensors({ ships: [ear, merchant, sub], env: quietEnv, time: 100 + seed, rng: new Rng(seed) });
        if (dets.some((d) => d.observerId === 'e' && d.targetId === 'u' && d.sensor === 'hull')) n++;
      }
      return n;
    };
    expect(heard(0)).toBeLessThan(heard(5000));
  });
});

import { belowHull } from '../src/index.js';
describe('hull blind cone', () => {
  it('a boat steeply below the hull is in the blind cone', () => {
    const f = { depth: 0 } as Parameters<typeof belowHull>[0];
    expect(belowHull(f, { depth: 200 } as typeof f, 300)).toBe(true);
    expect(belowHull(f, { depth: 200 } as typeof f, 2000)).toBe(false);
  });
});

import { CLASSES as CL, DEFAULT_ENV, createShip as mk, stepShip as stepS, passiveSignalExcess } from '../src/index.js';
describe('new classes', () => {
  it('a VDS below the layer hears a deep boat far better than the hull set', () => {
    const env = { ...DEFAULT_ENV, layerDepth: 80, layerLoss: 14 };
    const f = mk({ id: 'f', cls: 'ffv', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    const u = mk({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 8000 }, heading: 90, speedKn: 4, depth: 150 });
    const hullSe = passiveSignalExcess(u, f, 8000, 'hull', env, 6, 3000);
    const vdsSe = passiveSignalExcess(u, f, 8000, 'hull', env, 120, 3000);
    expect(vdsSe).toBeGreaterThan(hullSe + 8);
    f.vdsOrder = 120;
    for (let i = 0; i < 700; i++) stepS(f, 0.1, 0);
    expect(f.vdsDepth).toBeGreaterThan(100);
    f.speed = 25 * 0.5144;
    stepS(f, 0.1, 70);
    expect(f.vdsOrder).toBe(0);
  });
  it('an AIP boat creeps without draining the battery', () => {
    const s = mk({ id: 'a', cls: 'ssa', name: 'A', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 80 });
    s.speed = 4 * 0.5144;
    const b0 = s.battery!;
    for (let i = 0; i < 3600; i++) stepS(s, 1, i);
    expect(s.battery).toBe(b0);
    expect(CL.ssa.aipKn).toBe(5);
  });
});
