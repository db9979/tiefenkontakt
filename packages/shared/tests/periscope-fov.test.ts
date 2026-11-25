import { describe, expect, it } from 'vitest';
import { AUTO_ID_S, ContactBook, RECOG, Rng, createShip, runSensors, scopeFov, type Detection, type Environment, type Ship } from '../src/index.js';

const day: Environment = { layerDepth: 100, layerLoss: 12, seaState: 2, light: 1 };

/** A boat at periscope depth with the mast up, at the origin heading north. */
function boat(): Ship {
  const p = createShip({ id: 'p', cls: 'ssk', name: 'P', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 15, team: 'east' });
  p.mastUp = true;
  return p;
}

/** Merchants 3 km off at these true bearings. */
function ships(bearings: number[]): Ship[] {
  return bearings.map((b, i) => createShip({
    id: `m${b}`, cls: i % 2 ? 'ffg' : 'merchant', name: `M${i}`, team: 'west', heading: 90, speedKn: 0,
    pos: { x: Math.sin((b * Math.PI) / 180) * 3000, y: Math.cos((b * Math.PI) / 180) * 3000 },
  }));
}

function seen(p: Ship, targets: Ship[]): string[] {
  return runSensors({ ships: [p, ...targets], env: day, time: 1, rng: new Rng(3) })
    .filter((d) => d.sensor === 'periscope').map((d) => d.targetId).sort();
}

describe('periscope field of view', () => {
  const targets = ships([0, 4.5, 12, 30, 180]);

  it('fields of view are 32°, 8° and 4° at 1.5×, 6× and 12×', () => {
    expect([scopeFov(1.5), scopeFov(6), scopeFov(12)]).toEqual([32, 8, 4]);
  });

  it('sees nothing while nobody looks through it', () => {
    expect(seen(boat(), targets)).toEqual([]);
  });

  it('sees only the ships inside the field of view of the power set', () => {
    const p = boat();
    p.scope = { bearing: 0, mag: 12 };
    expect(seen(p, targets)).toEqual(['m0']);
    p.scope = { bearing: 0, mag: 6 };
    expect(seen(p, targets)).toEqual(['m0', 'm4.5']);
    p.scope = { bearing: 0, mag: 1.5 };
    expect(seen(p, targets)).toEqual(['m0', 'm12', 'm4.5']);
    // Trained astern: only the ship astern
    p.scope = { bearing: 175, mag: 1.5 };
    expect(seen(p, targets)).toEqual(['m180']);
  });

  it('measures a stadimeter angle that gives the range with the right mast height', () => {
    const p = boat();
    p.scope = { bearing: 0, mag: 6 };
    const d = runSensors({ ships: [p, ...targets], env: day, time: 1, rng: new Rng(3) }).find((x) => x.sensor === 'periscope')!;
    expect(d.mag).toBe(6);
    const range = RECOG.merchant.mast / (d.subtense! / 1000);
    expect(range).toBeGreaterThan(3000 * 0.75);
    expect(range).toBeLessThan(3000 * 1.25);
  });
});

describe('Einsteiger auto-classification', () => {
  const look = (t: number, mag: number): Detection => ({
    observerId: 'p', targetId: 'm', sensor: 'periscope', time: t, bearing: 10, range: 3000, se: 20, classified: 'ffg', mag, subtense: 11,
  });

  it('names a ship held 10 s unbroken at 6× or more', () => {
    const b = new ContactBook();
    for (let t = 0; t < AUTO_ID_S; t++) b.ingest(look(t, 6));
    expect(b.tracks()[0]!.idAt).toBeUndefined();
    b.ingest(look(AUTO_ID_S, 12));
    expect(b.tracks()[0]!.idAt).toBe(AUTO_ID_S);
  });

  it('does not name her at low power or when the look is broken off', () => {
    const low = new ContactBook();
    for (let t = 0; t <= 20; t++) low.ingest(look(t, 1.5));
    expect(low.tracks()[0]!.idAt).toBeUndefined();
    const broken = new ContactBook();
    for (let t = 0; t < 8; t++) broken.ingest(look(t, 6));
    // Swung away for five seconds: the count starts again
    for (let t = 13; t < 13 + AUTO_ID_S; t++) broken.ingest(look(t, 6));
    expect(broken.tracks()[0]!.idAt).toBeUndefined();
    broken.ingest(look(13 + AUTO_ID_S, 6));
    expect(broken.tracks()[0]!.idAt).toBe(13 + AUTO_ID_S);
  });
});
