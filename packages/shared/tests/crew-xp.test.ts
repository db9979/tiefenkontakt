import { describe, expect, it } from 'vitest';
import {
  XP_SONAR_DB, XP_WORK, createShip, createWorld, crewAvertsMishap, crewOf, crewSonarDb, crewWorkRate, installBoats, installIncidents, installWeapons, stepWorld,
} from '../src/index.js';

const boat = (xp?: number) => {
  const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, team: 'east' });
  const c = crewOf(s);
  if (xp !== undefined) c.xp = xp;
  return s;
};

describe('crew experience', () => {
  it('improves sonar, work rate and mishaps slightly, and is capped', () => {
    const green = boat();
    const vet = boat(1);
    expect(crewSonarDb(vet) - crewSonarDb(green)).toBeCloseTo(XP_SONAR_DB);
    expect(crewWorkRate(vet) / crewWorkRate(green)).toBeCloseTo(1 + XP_WORK);
    expect(crewAvertsMishap(green)).toBe(0);
    expect(crewAvertsMishap(vet)).toBe(0.5);
    // Out-of-range values are clamped
    expect(crewSonarDb(boat(5))).toBeCloseTo(crewSonarDb(vet));
    expect(crewAvertsMishap(boat(-1))).toBe(0);
  });

  it('a veteran crew catches some mechanical faults before they happen', () => {
    let averted = 0;
    let jams = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const u = boat(1);
      const w = createWorld([u], seed, { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 });
      installWeapons(w);
      installBoats(w);
      installIncidents(w);
      for (let k = 0; k < 6; k++) {
        w.env.incidents!.next = w.time;
        stepWorld(w);
      }
      averted += w.events.filter((e) => e.kind === 'boat' && e.what === 'averted').length;
      jams += w.events.filter((e) => e.kind === 'boat' && e.what === 'rudder').length;
    }
    expect(averted).toBeGreaterThan(0);
    expect(jams).toBeGreaterThan(0);
  });
});
