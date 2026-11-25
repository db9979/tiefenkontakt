import { describe, expect, it } from 'vitest';
import {
  CLASSES, CONFUSION, RECOG, RECOG_ORDER, SIGNATURES, THREAT_HINT, acousticSheet, isEscort, lofarBars, recogDraught, threatSheet, type ClassId,
} from '../src/index.js';

const names = (cls: ClassId) => threatSheet(cls).map((l) => l.name);

describe('recognition book: threat sheet', () => {
  it('lists the frigate F-12 with helicopter, rockets, SAM, towed array and radar, ranges from the sim', () => {
    const t = threatSheet('ffg');
    expect(names('ffg')).toEqual(expect.arrayContaining(['Leichttorpedos', 'U-Jagd-Raketen', 'Wasserbomben', 'Flugabwehrraketen', 'Bordhubschrauber', 'Schleppsonar', 'Radar']));
    expect(t.find((l) => l.name === 'Bordhubschrauber')?.rangeM).toBe(30_000);
    expect(t.find((l) => l.name === 'U-Jagd-Raketen')?.rangeM).toBe(18_000);
    expect(t.find((l) => l.name === 'Leichttorpedos')?.count).toBe(6);
    expect(names('ffg')).not.toContain('Tiefensonar (VDS)');
  });

  it('gives the VDS frigate and the patrol ship their VDS, only the patrol ship anti-ship missiles', () => {
    expect(names('ffv')).toContain('Tiefensonar (VDS)');
    expect(names('ffk')).toContain('Tiefensonar (VDS)');
    expect(names('ffk')).toContain('Seezielflugkörper');
    expect(names('ffv')).not.toContain('Seezielflugkörper');
    expect(threatSheet('ffk').find((l) => l.name === 'Seezielflugkörper')?.rangeM).toBe(40_000);
    expect(names('ffv')).not.toContain('Bordhubschrauber');
  });

  it('arms submarines with heavy torpedoes (25 km run), mines where carried, no radar', () => {
    for (const c of ['ssn', 'ssk', 'ssc', 'ssa', 'ssw'] as ClassId[]) {
      const t = threatSheet(c);
      expect(t[0]!.name).toBe('Schwere Torpedos');
      expect(t[0]!.rangeM).toBe(25_000);
      expect(names(c)).not.toContain('Radar');
    }
    expect(threatSheet('ssk').find((l) => l.name === 'Schwere Torpedos')?.count).toBe(10);
    expect(names('ssk')).toContain('Minen');
    expect(names('ssn')).not.toContain('Minen');
    expect(names('ssn')).toContain('Schleppsonar');
  });

  it('leaves merchants and neutrals unarmed', () => {
    for (const c of ['merchant', 'tanker', 'container', 'faehre', 'fischer', 'schlepper', 'yacht'] as ClassId[]) expect(threatSheet(c)).toEqual([]);
  });

  it('has a hint and one or two lookalikes with a cue for every class, never itself', () => {
    for (const c of RECOG_ORDER) {
      expect(THREAT_HINT[c].length).toBeGreaterThan(10);
      expect(CONFUSION[c].length).toBeGreaterThanOrEqual(1);
      expect(CONFUSION[c].length).toBeLessThanOrEqual(2);
      for (const [o, cue] of CONFUSION[c]) {
        expect(o).not.toBe(c);
        expect(cue.length).toBeGreaterThan(10);
      }
      if (CLASSES[c].submarine || isEscort(c)) expect(threatSheet(c).length).toBeGreaterThan(1);
    }
  });
});

describe('recognition book: acoustic sheet', () => {
  it('comes straight from the signature table', () => {
    const a = acousticSheet('ffg')!;
    expect(a.blades).toEqual(SIGNATURES.ffg.blades);
    expect(a.tonals).toBe(SIGNATURES.ffg.tonals);
    expect(a.typicalKn).toBe(15);
    expect(a.shaftHz).toBeCloseTo((7 * 15) / 60, 2);
    expect(a.bladeHz).toBeCloseTo(((7 * 15) / 60) * 5, 2);
    expect(a.desc).toMatch(/Turbine/);
  });

  it('carries the snorkel lines of diesel boats and the cavitation speed', () => {
    const a = acousticSheet('ssk')!;
    expect(a.snorkel.map((t) => t.hz)).toEqual([24, 48, 72]);
    expect(a.cavKn).toBe(CLASSES.ssk.cavKn);
    expect(acousticSheet('ssa')!.aipKn).toBe(5);
    expect(acousticSheet('ffg')!.snorkel).toEqual([]);
  });

  it('places narrowband bars over 0–500 Hz, sorted, louder lines taller', () => {
    const bars = lofarBars(acousticSheet('ssk')!);
    expect(bars.map((b) => b.hz)).toEqual([24, 48, 50, 72]);
    expect(bars.find((b) => b.hz === 48)!.snorkel).toBe(true);
    expect(bars.find((b) => b.hz === 50)!.snorkel).toBe(false);
    expect(bars.find((b) => b.hz === 24)!.h).toBeGreaterThan(bars.find((b) => b.hz === 50)!.h);
    const ssa = lofarBars(acousticSheet('ssa')!);
    expect(ssa.at(-1)!.x).toBeCloseTo(0.8, 5);
    for (const b of [...bars, ...ssa]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(1);
      expect(b.h).toBeGreaterThan(0);
      expect(b.h).toBeLessThanOrEqual(1);
    }
  });
});

describe('recognition book: draught', () => {
  it('uses the class draught for ships and the model hull depth for surfaced boats', () => {
    expect(recogDraught('ffg')).toBe(CLASSES.ffg.draft);
    expect(recogDraught('tanker')).toBe(20);
    for (const c of RECOG_ORDER.filter((x) => RECOG[x].group === 'submarine')) {
      expect(recogDraught(c)).toBeGreaterThan(3);
      expect(recogDraught(c)).toBeLessThan(RECOG[c].mast);
    }
  });
});
