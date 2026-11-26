import { describe, expect, it } from 'vitest';
import {
  BEARING_BIAS_DEG,
  DEFAULT_ENV,
  NM,
  Rng,
  aircraftRadarSweep,
  angleDiff,
  bearingBias,
  createShip,
  createWorld,
  domeDropoutP,
  domeQuenchDb,
  exposedMast,
  installAir,
  mastDetectP,
  periscopeClearP,
  radarClutter,
  runSensors,
  shipRadarRange,
  towedErrorFactor,
  type Ship,
} from '../src/index.js';

const env = (seaState = 3) => ({ ...DEFAULT_ENV, seaState });
const ctx = (ships: Ship[], time: number, seed = 1, seaState = 3) => ({ ships, env: env(seaState), time, rng: new Rng(seed) });

function surfaced(pos: { x: number; y: number }): Ship {
  const s = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos, heading: 90, speedKn: 6, depth: 0 });
  s.order.depth = 0;
  return s;
}

describe('F8 a surfaced boat with her masts down is a radar and periscope target', () => {
  it('exposedMast: hull on the surface, nothing at periscope depth with masts down', () => {
    const s = surfaced({ x: 0, y: 0 });
    expect(exposedMast(s)).toBe('hull');
    s.depth = 14;
    expect(exposedMast(s)).toBeUndefined();
  });

  it('a frigate radar paints her at 10 nm, not at 13 nm', () => {
    const rate = (y: number) => {
      const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0 });
      ffg.radarOn = true;
      const u = surfaced({ x: 0, y });
      let hits = 0;
      for (let t = 1; t <= 300; t++) if (runSensors(ctx([ffg, u], t, t)).some((d) => d.observerId === 'f' && d.sensor === 'radar' && d.targetId === 'u')) hits++;
      return hits;
    };
    expect(rate(10 * NM)).toBeGreaterThan(5);
    expect(rate(13 * NM)).toBe(0);
  });

  it('hull clutter stays high in a heavy sea; hull p ≫ snorkel p', () => {
    expect(radarClutter(6, 'hull')).toBeGreaterThanOrEqual(0.5);
    expect(mastDetectP('hull', 3 * NM, 5)).toBeGreaterThan(4 * mastDetectP('snorkel', 3 * NM, 5));
  });

  it('an enemy periscope sees the conning tower', () => {
    const own = createShip({ id: 'w', cls: 'ssn', name: 'W', team: 'west', pos: { x: 0, y: 0 }, heading: 0, depth: 14 });
    own.mastUp = true;
    own.mastExt = 1;
    own.scope = { bearing: 0, mag: 6 };
    const u = surfaced({ x: 0, y: 6000 });
    const seen = runSensors(ctx([own, u], 10)).find((d) => d.observerId === 'w' && d.sensor === 'periscope');
    expect(seen?.targetId).toBe('u');
    expect(seen?.classified).toBe('ssk');
    // Submerged at periscope depth she is not seen
    u.depth = 14;
    expect(runSensors(ctx([own, u], 10)).some((d) => d.observerId === 'w' && d.sensor === 'periscope')).toBe(false);
  });

  it('a patrol aircraft paints a surfaced boat 40 km off', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: -60_000 }, heading: 0 });
    const u = surfaced({ x: 40_000, y: 0 });
    const w = createWorld([ffg, u], 5, env(3));
    installAir(w);
    const at = { x: 0, y: 0 };
    w.air!.sorties.push({ kind: 'mpa', shipId: 'f', from: at, target: at, launchAt: 0, dropAt: 1e6, landAt: 2e6, readyAt: 2e6, deep: false, dropped: false });
    for (let t = 1; t <= 120; t++) {
      w.time = t;
      aircraftRadarSweep(w);
    }
    expect(w.books.get('f')?.tracks()[0]?.sensors).toContain('radar');
    expect(w.events.some((e) => e.kind === 'boat' && 'text' in e && String(e.text).includes('AUFGETAUCHT'))).toBe(true);
  });
});

describe('F9 radar clutter against periscopes in a heavy sea', () => {
  it('unchanged up to SS3, then a periscope fades fast and a snorkel slower', () => {
    expect(radarClutter(3)).toBeCloseTo(0.64);
    expect(radarClutter(5)).toBeCloseTo(0.3);
    expect(radarClutter(6)).toBeCloseTo(0.13);
    expect(radarClutter(5, 'snorkel')).toBeCloseTo(0.4);
    expect(radarClutter(6, 'snorkel')).toBeGreaterThanOrEqual(0.2);
  });
});

describe('F10 ship radar range follows the radar horizon', () => {
  it('frigate on a merchant ≈ 19 nm, on a fishing boat less, never past 22 nm', () => {
    const m = createShip({ id: 'm', cls: 'merchant', name: 'M', pos: { x: 0, y: 0 }, heading: 0 });
    const f = createShip({ id: 'k', cls: 'fischer', name: 'K', pos: { x: 0, y: 0 }, heading: 0 });
    const r = shipRadarRange(20, m) / NM;
    expect(r).toBeGreaterThan(18);
    expect(r).toBeLessThan(20);
    expect(shipRadarRange(20, f)).toBeLessThan(shipRadarRange(20, m));
    expect(shipRadarRange(400, m)).toBe(22 * NM);
    // A boat's low mast radar sees the merchant at 12–14 nm
    expect(shipRadarRange(4, m) / NM).toBeGreaterThan(12);
    expect(shipRadarRange(4, m) / NM).toBeLessThan(14);
  });

  it('the radar paints a merchant at 18 nm but not at 20 nm', () => {
    const paint = (y: number) => {
      const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0 });
      ffg.radarOn = true;
      const m = createShip({ id: 'm', cls: 'merchant', name: 'M', team: 'neutral', pos: { x: 0, y }, heading: 0 });
      return runSensors(ctx([ffg, m], 5)).some((d) => d.observerId === 'f' && d.sensor === 'radar');
    };
    expect(paint(18 * NM)).toBe(true);
    expect(paint(20 * NM)).toBe(false);
  });
});

describe('F4 slow correlated bearing bias', () => {
  it('unit size, mean zero over many contacts, correlated over a minute, decorrelated over half an hour', () => {
    const keys = Array.from({ length: 400 }, (_, i) => `o|t${i}|hull`);
    const v0 = keys.map((k) => bearingBias(k, 1000));
    const v60 = keys.map((k) => bearingBias(k, 1060));
    const v1800 = keys.map((k) => bearingBias(k, 2800));
    const mean = v0.reduce((a, b) => a + b, 0) / v0.length;
    const sd = Math.sqrt(v0.reduce((a, b) => a + b * b, 0) / v0.length);
    expect(Math.abs(mean)).toBeLessThan(0.15);
    expect(sd).toBeGreaterThan(0.8);
    expect(sd).toBeLessThan(1.2);
    const corr = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0) / Math.sqrt(a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0));
    expect(corr(v0, v60)).toBeGreaterThan(0.8);
    expect(Math.abs(corr(v0, v1800))).toBeLessThan(0.2);
  });

  it('a hull-array bearing averaged over a minute keeps its bias (it does not average out)', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 5 });
    const tgt = createShip({ id: 'm', cls: 'merchant', name: 'M', team: 'neutral', pos: { x: 3000, y: 3000 }, heading: 0, speedKn: 0 });
    const errs: number[] = [];
    for (let t = 1; t <= 60; t++) {
      const d = runSensors(ctx([ffg, tgt], t, t)).find((x) => x.observerId === 'f' && x.sensor === 'hull');
      if (d) errs.push(angleDiff(45, d.bearing));
    }
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    expect(errs.length).toBeGreaterThan(50);
    // The minute's mean error is the slow bias at that time (a strong target: little fast noise)
    expect(mean).toBeCloseTo(BEARING_BIAS_DEG.hull * bearingBias('0|f|m|hull', 30), 0);
  });
});

describe('F5 towed-array error toward endfire', () => {
  it('1 at the beam, ≈3 at 20° off the axis, capped at 4', () => {
    expect(towedErrorFactor(90)).toBeCloseTo(1);
    expect(towedErrorFactor(-90)).toBeCloseTo(1);
    expect(towedErrorFactor(20)).toBeCloseTo(1 / Math.sin((20 * Math.PI) / 180));
    expect(towedErrorFactor(160)).toBeCloseTo(towedErrorFactor(20));
    expect(towedErrorFactor(3)).toBe(4);
  });
});

describe('F7 bow dome in heavy weather', () => {
  it('frigate hull sonar: 0 dB to SS4, 3 dB SS5, 8 dB SS6; VDS and boats untouched', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0 });
    expect(domeQuenchDb(ffg, 4)).toBe(0);
    expect(domeQuenchDb(ffg, 5)).toBe(3);
    expect(domeQuenchDb(ffg, 6)).toBe(8);
    expect(domeDropoutP(ffg, 6)).toBeCloseTo(0.14);
    const ffv = createShip({ id: 'v', cls: 'ffv', name: 'V', pos: { x: 0, y: 0 }, heading: 0 });
    ffv.vdsDepth = 120;
    expect(domeQuenchDb(ffv, 6)).toBe(0);
    const ssk = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 60 });
    expect(domeQuenchDb(ssk, 6)).toBe(0);
  });

  it('a frigate hears a merchant less often on the hull array at SS6 than at SS3', () => {
    const count = (ss: number) => {
      let n = 0;
      for (let t = 1; t <= 200; t++) {
        const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
        const m = createShip({ id: 'm', cls: 'merchant', name: 'M', team: 'neutral', pos: { x: 0, y: 14_000 }, heading: 90, speedKn: 10 });
        if (runSensors(ctx([ffg, m], t, t, ss)).some((d) => d.observerId === 'f' && d.sensor === 'hull')) n++;
      }
      return n;
    };
    expect(count(6)).toBeLessThan(count(3));
  });
});

describe('F25 periscope washed over', () => {
  it('clear looks: all up to SS3, 70 % at SS5, 55 % at SS6', () => {
    expect(periscopeClearP(3)).toBe(1);
    expect(periscopeClearP(5)).toBeCloseTo(0.7);
    expect(periscopeClearP(6)).toBeCloseTo(0.55);
  });
});
