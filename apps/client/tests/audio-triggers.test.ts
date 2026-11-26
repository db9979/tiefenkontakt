import { describe, expect, it } from 'vitest';
import {
  contactLevel, creaksPerMin, dieselRunning, dopplerFromRangeRate, fired, groansPerMin, hullStrain, isHeadValveSlam,
  loudestTorpedo, nextGapS, ownTorpedoLevel, rotorLevel, slamGapS, torpedoPitch, trimPumpsRunning, turbine,
} from '../src/audio-triggers.js';

describe('boat sounds', () => {
  it('trim pumps run exactly when the server pumps (|trim| > 0,2 t)', () => {
    expect(trimPumpsRunning(undefined)).toBe(false);
    expect(trimPumpsRunning(0.2)).toBe(false);
    expect(trimPumpsRunning(-0.25)).toBe(true);
    expect(trimPumpsRunning(1.5)).toBe(true);
  });

  it('hull strain: none near the surface, grows with depth against the test depth, damage and diving', () => {
    expect(hullStrain(10, 300, 1.2, 0)).toBe(0);
    expect(creaksPerMin(hullStrain(40, 300, 0, 0))).toBe(0);
    const mid = hullStrain(150, 300, 0, 0);
    const deep = hullStrain(290, 300, 0, 0);
    expect(deep).toBeGreaterThan(mid);
    expect(hullStrain(150, 300, 1.2, 0)).toBeGreaterThan(mid);
    expect(hullStrain(150, 300, -1.2, 0)).toBeLessThan(hullStrain(150, 300, 1.2, 0));
    // A damaged boat at the same depth: lower limit and a weaker hull
    expect(hullStrain(150, 180, 0, 0.5)).toBeGreaterThan(mid);
    expect(creaksPerMin(deep)).toBeGreaterThan(creaksPerMin(mid));
    expect(creaksPerMin(100)).toBe(20);
  });

  it('groans only from 80 % of the test depth, more beyond it', () => {
    expect(groansPerMin(200, 300, 0)).toBe(0);
    expect(groansPerMin(270, 300, 0)).toBeGreaterThan(0);
    expect(groansPerMin(330, 300, 0)).toBeGreaterThan(groansPerMin(270, 300, 0));
    expect(groansPerMin(270, 300, 1)).toBeGreaterThan(groansPerMin(270, 300, 0));
    expect(groansPerMin(10, 0, 0)).toBe(0);
  });

  it('gaps: none at rate 0, around the mean otherwise', () => {
    expect(nextGapS(0)).toBe(Infinity);
    expect(nextGapS(6, 0)).toBeCloseTo(5);
    expect(nextGapS(6, 1)).toBeCloseTo(15);
  });

  it('head valve: the report slams it, the diesel is silent 20 s and back once the battery charges', () => {
    expect(isHeadValveSlam('KOPFVENTIL SCHLÄGT ZU · DIESEL AUS · LADUNG UNTERBROCHEN')).toBe(true);
    expect(isHeadValveSlam('SCHNORCHELKOPFVENTIL KLEMMT · SCHNORCHEL BLEIBT 45 S OBEN')).toBe(false);
    expect(dieselRunning(false, 1e9, true)).toBe(false);
    expect(dieselRunning(true, 1e9, false)).toBe(true);
    expect(dieselRunning(true, 5, true)).toBe(false);
    expect(dieselRunning(true, 25, false)).toBe(false);
    expect(dieselRunning(true, 25, true)).toBe(true);
    expect(dieselRunning(true, 40, false)).toBe(true);
  });
});

describe('surface ship sounds', () => {
  it('turbines: gas-turbine frigates always, the corvette only above 18 kn, none on a boat', () => {
    expect(turbine('ffg', 0).level).toBeGreaterThan(0);
    expect(turbine('ffg', 28).level).toBeGreaterThan(turbine('ffg', 10).level);
    expect(turbine('ffg', 28).hz).toBeGreaterThan(turbine('ffg', 10).hz);
    expect(turbine('kor', 12).level).toBe(0);
    expect(turbine('kor', 24).level).toBeGreaterThan(0);
    expect(turbine('ssk', 10).level).toBe(0);
    expect(turbine('ffg', 20, false).level).toBe(0);
    expect(turbine('ffv', 20).level).toBeLessThan(turbine('ffg', 20).level);
  });

  it('rotor: spinning up in the last minute on deck, fading with distance in the air', () => {
    const own = { x: 0, y: 0 };
    expect(rotorLevel(undefined, own)).toBe(0);
    expect(rotorLevel({ state: 'deck', x: 0, y: 0 }, own)).toBe(0);
    expect(rotorLevel({ state: 'deck', x: 0, y: 0, launchInS: 100 }, own)).toBe(0);
    expect(rotorLevel({ state: 'deck', x: 0, y: 0, launchInS: 30 }, own)).toBeGreaterThan(rotorLevel({ state: 'deck', x: 0, y: 0, launchInS: 59 }, own));
    expect(rotorLevel({ state: 'deck', x: 0, y: 0, launchInS: 0 }, own)).toBeCloseTo(1);
    // Ready, but the deck is blocked (sea state, no flying course): idling, not at take-off power
    expect(rotorLevel({ state: 'deck', x: 0, y: 0, launchInS: 0, deck: { need: 'launch', ok: false } }, own)).toBeCloseTo(0.45);
    expect(rotorLevel({ state: 'deck', x: 0, y: 0, launchInS: 0, deck: { need: 'launch', ok: true } }, own)).toBeCloseTo(1);
    expect(rotorLevel({ state: 'air', x: 200, y: 0 }, own)).toBeGreaterThan(rotorLevel({ state: 'air', x: 1000, y: 0 }, own));
    expect(rotorLevel({ state: 'air', x: 3000, y: 0 }, own)).toBe(0);
  });

  it('bow slams: only surface ships, from sea state 5 and 8 kn, more often in heavier sea and faster', () => {
    expect(slamGapS(4, 25, false)).toBe(Infinity);
    expect(slamGapS(6, 5, false)).toBe(Infinity);
    expect(slamGapS(6, 20, true)).toBe(Infinity);
    expect(slamGapS(7, 20, false)).toBeLessThan(slamGapS(5, 20, false));
    expect(slamGapS(6, 28, false)).toBeLessThan(slamGapS(6, 10, false));
    expect(slamGapS(9, 30, false)).toBeGreaterThanOrEqual(4);
  });

  it('launches: rounds that left since the last snapshot, never on a reload or the first look', () => {
    expect(fired(undefined, 10)).toBe(0);
    expect(fired(10, 10)).toBe(0);
    expect(fired(10, 12)).toBe(0);
    expect(fired(10, 8)).toBe(2);
    expect(fired(40, 0)).toBe(6);
  });
});

describe('torpedoes in the sonar headset', () => {
  const own = { x: 0, y: 0, heading: 0 };
  const mem = () => ({ torps: new Map(), contacts: new Map() });

  it('level and Doppler', () => {
    expect(ownTorpedoLevel(100)).toBeGreaterThan(ownTorpedoLevel(5000));
    expect(ownTorpedoLevel(0)).toBeLessThanOrEqual(0.8);
    expect(dopplerFromRangeRate(20)).toBeLessThan(1);
    expect(dopplerFromRangeRate(-20)).toBeGreaterThan(1);
    expect(torpedoPitch(1, 0)).toBeGreaterThan(1);
    expect(torpedoPitch(-1, 0)).toBeLessThan(1);
    expect(Math.abs(torpedoPitch(1, 10) - 1)).toBeLessThan(torpedoPitch(1, 0) - 1);
    expect(contactLevel(20)).toBeGreaterThan(contactLevel(0));
  });

  it('own torpedo on the wire: heard from its bearing, opening lowers the pitch, homing passed on', () => {
    const m = mem();
    const a = loudestTorpedo(own, 100, [{ id: 'T1', x: 1000, y: 0, homing: false }], [], m)!;
    expect(a.own).toBe(true);
    expect(a.rel).toBeCloseTo(90);
    expect(a.pitch).toBe(1);
    const b = loudestTorpedo(own, 101, [{ id: 'T1', x: 1023, y: 0, homing: true }], [], m)!;
    expect(b.pitch).toBeLessThan(1);
    expect(b.homing).toBe(true);
    // Gone from the snapshot (wire lost or run done): forgotten, nothing heard
    expect(loudestTorpedo(own, 102, [], [], m)).toBeUndefined();
    expect(m.torps.size).toBe(0);
  });

  it('an enemy torpedo is heard only as far as own sensors hold it as a torpedo', () => {
    const c = { label: 'S3', via: 'own', bearing: 270, se: 10, evidence: { voice: 'torpedo' }, evidenceAt: 100 };
    expect(loudestTorpedo(own, 101, [], [c], mem())?.rel).toBeCloseTo(-90);
    // Not taken for a torpedo, stale evidence, or only via datalink: silent
    expect(loudestTorpedo(own, 101, [], [{ ...c, evidence: { voice: 'puls' } }], mem())).toBeUndefined();
    expect(loudestTorpedo(own, 101, [], [{ ...c, evidence: undefined }], mem())).toBeUndefined();
    expect(loudestTorpedo(own, 110, [], [c], mem())).toBeUndefined();
    expect(loudestTorpedo(own, 101, [], [{ ...c, via: 'datalink' }], mem())).toBeUndefined();
  });

  it('closing on a steady bearing raises the pitch', () => {
    const m = mem();
    const c = { label: 'S3', via: 'own', bearing: 45, se: 5, evidence: { voice: 'torpedo' }, evidenceAt: 100 };
    loudestTorpedo(own, 100, [], [c], m);
    const h = loudestTorpedo(own, 101, [], [{ ...c, se: 6, evidenceAt: 101 }], m)!;
    expect(h.pitch).toBeGreaterThan(1);
    expect(h.own).toBe(false);
  });

  it('the louder of several wins', () => {
    const c = { label: 'S3', via: 'own', bearing: 45, se: -2, evidence: { voice: 'torpedo' }, evidenceAt: 100 };
    const h = loudestTorpedo(own, 100, [{ id: 'T1', x: 0, y: 300, homing: false }], [c], mem())!;
    expect(h.own).toBe(true);
  });
});
