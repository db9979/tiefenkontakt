import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  createLoadout,
  createShip,
  createWorld,
  hasHelicopter,
  installAir,
  installWeapons,
  isEscort,
  sendDip,
  setTowedDecoy,
  sourceLevel,
} from '../src/index.js';

describe('corvette and coastal submarine', () => {
  it('the coastal boat is the quietest submarine, the corvette quieter than the frigate', () => {
    const at = (cls: 'ssk' | 'ssc' | 'ffg' | 'kor', kn: number) => {
      const s = createShip({ id: cls, cls, name: cls, pos: { x: 0, y: 0 }, heading: 0, speedKn: kn, depth: CLASSES[cls].submarine ? 60 : 0 });
      s.speed = kn * 0.5144;
      return sourceLevel(s);
    };
    expect(at('ssc', 4)).toBeLessThan(at('ssk', 4));
    expect(at('kor', 15)).toBeLessThan(at('ffg', 15));
  });

  it('the corvette escorts and streams a decoy but carries no helicopter', () => {
    expect(isEscort('kor')).toBe(true);
    expect(hasHelicopter('kor')).toBe(false);
    const kor = createShip({ id: 'k', cls: 'kor', name: 'K', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12, team: 'west' });
    const w = createWorld([kor], 1);
    installWeapons(w);
    installAir(w);
    expect(sendDip(w, kor, { x: 3000, y: 3000 }, false)).toBe('Kein Hubschrauber an Bord');
    setTowedDecoy(w, kor, true);
    expect(w.weapons!.decoys.some((d) => d.towedBy === 'k')).toBe(true);
  });

  it('loadouts: corvette fires lightweights, the coastal boat has eight loaded tubes and no reloads', () => {
    expect(createLoadout('kor').tubes.every((t) => t.loaded)).toBe(true);
    expect(createLoadout('kor').light).toBe(2);
    expect(createLoadout('ssc').tubes).toHaveLength(8);
    expect(createLoadout('ssc').tubes.every((t) => t.loaded)).toBe(true);
    expect(createLoadout('ssc').heavy).toBe(0);
  });
});

import { PERISCOPE_DEPTH, voiceQuality, voiceRange } from '../src/index.js';
describe('voice radio range', () => {
  it('rain and heavy seas cut the range; a boat mast suffers most in a sea', () => {
    const a = createShip({ id: 'a', cls: 'ffg', name: 'A', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    const b = createShip({ id: 'b', cls: 'ffg', name: 'B', pos: { x: 30_000, y: 0 }, heading: 0, speedKn: 10 });
    const u = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 20_000, y: 0 }, heading: 0, speedKn: 4, depth: PERISCOPE_DEPTH });
    u.mastUp = true;
    u.mastExt = 1;
    const calm = { seaState: 2, rain: false };
    const storm = { seaState: 6, rain: true };
    expect(voiceRange(a, b, storm)).toBeLessThan(voiceRange(a, b, calm) * 0.8);
    expect(voiceQuality(a, b, storm)).toBeLessThan(voiceQuality(a, b, calm));
    expect(voiceQuality(a, u, storm)).toBe(0);
    expect(voiceQuality(a, u, calm)).toBeGreaterThan(0);
  });
});
