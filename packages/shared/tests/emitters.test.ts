import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  ContactBook,
  DEFAULT_ENV,
  EMITTERS,
  NM,
  Rng,
  aircraftEmitter,
  createShip,
  createWorld,
  emitterCandidates,
  emitterText,
  esmDangerText,
  esmIntercept,
  esmLevel,
  esmTrend,
  installAirspace,
  isAmbiguous,
  isDangerEmitter,
  planesFor,
  runSensors,
  shipEmitter,
  type ClassId,
  type Ship,
} from '../src/index.js';

const ctx = (ships: Ship[], env = DEFAULT_ENV) => ({ ships, env, time: 1000, rng: new Rng(3) });

describe('emitter library', () => {
  it('gives every radar-carrying surface class a search radar, submarines none', () => {
    const expected: Partial<Record<ClassId, string>> = {
      ffg: 'SEEFALKE-2', ffv: 'SEEFALKE-2', kor: 'KORMORAN-1', ffk: 'TAIFUN-11',
      merchant: 'LOTSE-9', tanker: 'LOTSE-9', container: 'LOTSE-9', faehre: 'LOTSE-9',
      fischer: 'MÖWE-M', schlepper: 'MÖWE-M', yacht: 'MÖWE-M',
    };
    for (const id of Object.keys(CLASSES) as ClassId[]) {
      if (CLASSES[id].submarine) expect(shipEmitter(id)).toBeUndefined();
      else expect(shipEmitter(id), id).toBe(expected[id]);
    }
    // Every entry points back to its carriers
    for (const [cls, em] of Object.entries(expected)) expect(emitterCandidates(em!)).toContain(cls);
  });

  it('has fire-control sets for the warships and radars for the patrol aircraft', () => {
    expect(shipEmitter('ffg', true)).toBe('ZIELSPINNE-4');
    expect(shipEmitter('kor', true)).toBe('BLITZAUGE-2');
    expect(shipEmitter('ffk', true)).toBe('SKORPION-F');
    expect(shipEmitter('merchant', true)).toBe('LOTSE-9');
    expect(aircraftEmitter('mpa')).toBe('ALBATROS-7');
    expect(aircraftEmitter('helo')).toBe('LIBELLE-5');
    expect(aircraftEmitter('recon')).toBe('NORDLICHT-3');
    expect(aircraftEmitter('airliner')).toBeUndefined();
    for (const e of Object.values(EMITTERS)) expect(e.carriers.length).toBeGreaterThan(0);
  });

  it('maps shared emitters to a likely class with a question mark', () => {
    expect(isAmbiguous('SEEFALKE-2')).toBe(true);
    expect(emitterCandidates('SEEFALKE-2')).toEqual(['ffg', 'ffv']);
    expect(emitterText('SEEFALKE-2')).toBe('SEEFALKE-2 · FREGATTE? (OBERFLÄCHENSUCHE)');
    expect(isAmbiguous('KORMORAN-1')).toBe(false);
    expect(emitterText('KORMORAN-1')).toBe('KORMORAN-1 · KORVETTE (OBERFLÄCHENSUCHE)');
    expect(isAmbiguous('LOTSE-9')).toBe(true);
  });

  it('flags aircraft and fire-control radars as danger', () => {
    expect(isDangerEmitter('ALBATROS-7')).toBe(true);
    expect(isDangerEmitter('ZIELSPINNE-4')).toBe(true);
    expect(isDangerEmitter('SEEFALKE-2')).toBe(false);
    expect(esmDangerText('ALBATROS-7', true)).toBe('FLUGZEUGRADAR – TAUCHEN');
    expect(esmDangerText('LOTSE-9', true)).toBeUndefined();
  });

  it('grades strength by range and trend by closing geometry', () => {
    expect(esmLevel(5 * NM, 40 * NM)).toBe(2);
    expect(esmLevel(15 * NM, 40 * NM)).toBe(1);
    expect(esmLevel(35 * NM, 40 * NM)).toBe(0);
    // Emitter north of the observer heading south at 20 kn: closing
    expect(esmTrend({ x: 0, y: 0 }, 0, 0, { x: 0, y: 20_000 }, 180, 10)).toBe(1);
    expect(esmTrend({ x: 0, y: 0 }, 0, 0, { x: 0, y: 20_000 }, 0, 10)).toBe(-1);
    expect(esmTrend({ x: 0, y: 0 }, 0, 0, { x: 0, y: 20_000 }, 90, 10)).toBe(0);
    expect(esmIntercept('SEEFALKE-2', 2, 1)).toBe('SEEFALKE-2 · FREGATTE? (OBERFLÄCHENSUCHE) · STARK, STEIGEND');
  });
});

describe('ESM intercepts carry the emitter', () => {
  it('a raised mast hears the frigate radar as SEEFALKE-2 and the contact keeps it', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 8 * NM }, heading: 180, speedKn: 15 });
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 14 });
    sub.mastUp = true;
    sub.mastExt = 1;
    ffg.radarOn = true;
    const d = runSensors(ctx([ffg, sub])).find((x) => x.observerId === 'u' && x.sensor === 'esm');
    expect(d?.emitter).toBe('SEEFALKE-2');
    expect(d?.esmLvl).toBe(2);
    expect(d?.esmTrend).toBe(1);
    const book = new ContactBook();
    const tr = book.ingest(d!);
    expect(tr.emitter).toBe('SEEFALKE-2');
    expect(tr.esmTrend).toBe(1);
  });

  it('a ship guiding a missile radiates its fire-control set', () => {
    const kor = createShip({ id: 'k', cls: 'kor', name: 'K', pos: { x: 0, y: 5 * NM }, heading: 90, speedKn: 12 });
    const ffk = createShip({ id: 'w', cls: 'ffk', name: 'W', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    kor.radarOn = true;
    const env = { ...DEFAULT_ENV, airdef: { sams: [{ id: 'S1', ownerId: 'k', cls: 'kor' as const, team: 'west' as const, targetId: 'x', pos: { x: 0, y: 0 }, alt: 100, from: { x: 0, y: 0 }, launchedAt: 990, maxFlight: 30 }], nextId: 2, reconLosses: 0, fighter: {}, lastShot: {} } };
    const d = runSensors(ctx([kor, ffk], env)).find((x) => x.observerId === 'w' && x.sensor === 'esm');
    expect(d?.emitter).toBe('BLITZAUGE-2');
  });

  it('aircraft heard on ESM carry their radar', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 14 });
    sub.mastUp = true;
    sub.mastExt = 1;
    const w = createWorld([sub], 9, { layerDepth: 120, layerLoss: 12, seaState: 2, light: 1 });
    installAirspace(w);
    w.env.airspace!.planes = [{ id: 'P1', kind: 'mpa', team: 'west', pos: { x: 0, y: 100_000 }, alt: 300, heading: 180, speedKn: 300, radar: true }];
    const p = planesFor(w, sub).find((x) => x.id === 'P1');
    expect(p?.via).toContain('esm');
    expect(p?.emitter).toBe('ALBATROS-7');
    expect(p?.esmTrend).toBe(1);
  });
});
