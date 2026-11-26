import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  KN,
  PERISCOPE_DEPTH,
  batteryChargePctH,
  bioluminescence,
  broachChanceS,
  chargeAcceptPctH,
  chargeTimeS,
  compsOf,
  createShip,
  createWorld,
  crushDepth,
  depthLimit,
  depthLimitOf,
  exposedMast,
  glowStrength,
  headSeaFactor,
  headValveChanceS,
  installBoats,
  isBroaching,
  lookoutRanges,
  periscopeSwellM,
  seesTorpedoTrack,
  sightingRange,
  snorkelSeaFactor,
  stepShip,
  stepWorld,
  type Environment,
  type Ship,
} from '../src/index.js';

const pctOf = (s: Ship) => (100 * s.battery!) / CLASSES.ssk.battery!.capacityKnH;

describe('F23 battery charge tapers above 70 %', () => {
  it('40 %/h in bulk, falling linearly to 12 %/h at full', () => {
    expect(chargeAcceptPctH(30)).toBe(40);
    expect(chargeAcceptPctH(70)).toBe(40);
    expect(chargeAcceptPctH(85)).toBeCloseTo(26);
    expect(chargeAcceptPctH(100)).toBeCloseTo(12);
    // The default (no state of charge given) is the bulk rate
    expect(batteryChargePctH(4)).toBeCloseTo(40 - 1 - 64 / 70);
  });

  it('the last 30 % take longer than the first 70 % from empty', () => {
    const bulk = chargeTimeS(0, 70, 4);
    const top = chargeTimeS(70, 100, 4);
    expect(bulk / 3600).toBeGreaterThan(1.7);
    expect(bulk / 3600).toBeLessThan(1.9);
    expect(top).toBeGreaterThan(bulk * 0.6);
    expect(chargeTimeS(70, 100, 12)).toBe(Infinity);
  });

  it('a snorkelling boat at 90 % gains much less in an hour than at 30 %', () => {
    const gain = (start: number) => {
      const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: PERISCOPE_DEPTH });
      s.battery = (CLASSES.ssk.battery!.capacityKnH * start) / 100;
      s.snorkel = true;
      s.snorkelExt = 1;
      s.order = { heading: 0, speedKn: 4, depth: PERISCOPE_DEPTH };
      for (let t = 0; t < 1800; t++) stepShip(s, 1, t);
      return pctOf(s) - start;
    };
    expect(gain(30)).toBeGreaterThan(18);
    expect(gain(88)).toBeLessThan(10);
  });
});

describe('F24 hull damage reduces the test depth', () => {
  it('limit = test depth × (1 − 0,4 × worst compartment damage); crush falls with it', () => {
    const u = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 50, team: 'east' });
    expect(depthLimit(u)).toBe(CLASSES.ssk.maxDepth);
    const comps = compsOf(u);
    comps[2]!.dmg = 0.5;
    expect(depthLimit(u)).toBe(Math.round(CLASSES.ssk.maxDepth * 0.8));
    expect(crushDepth(u)).toBeLessThan(CLASSES.ssk.maxDepth * 1.475 * 0.81);
    expect(depthLimitOf('ssk', [{ dmg: 1 }])).toBe(Math.round(CLASSES.ssk.maxDepth * 0.6));
  });

  it('the captain is told the new limit, and a boat below it risks the hull', () => {
    const deep = CLASSES.ssk.maxDepth * 0.9;
    const u = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: deep, team: 'east' });
    u.order.depth = deep;
    const w = createWorld([u], 3, { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 });
    installBoats(w);
    compsOf(u).forEach((c) => (c.dmg = 0.6));
    const hp0 = u.hp;
    for (let i = 0; i < 600 * 10; i++) stepWorld(w);
    const said = w.events.filter((e) => e.kind === 'boat' && 'what' in e && e.what === 'depthlimit');
    expect(said.length).toBe(1);
    expect(w.events.some((e) => e.kind === 'boat' && 'text' in e && String(e.text).includes('UNTER TESTTIEFE'))).toBe(true);
    expect(u.hp).toBeLessThan(hp0);
  });
});

describe('F25 periscope depth and snorkel in a heavy sea', () => {
  it('swell lifts the boat only from SS5, less with way on, never deeper', () => {
    expect(periscopeSwellM(4, 2, 3)).toBe(0);
    let max = 0, min = 99;
    for (let t = 0; t < 20; t += 0.25) {
      max = Math.max(max, periscopeSwellM(6, 2, t, 'u'));
      min = Math.min(min, periscopeSwellM(6, 2, t, 'u'));
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeCloseTo(4, 0);
    expect(periscopeSwellM(6, 6, 2.5, 'u')).toBeLessThanOrEqual(2.0001);
  });

  it('a slow boat at periscope depth rides up and down in SS6 but keeps her mast up', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 2, depth: PERISCOPE_DEPTH });
    s.order = { heading: 0, speedKn: 2, depth: PERISCOPE_DEPTH };
    s.mastUp = true;
    s.mastExt = 1;
    let lo = 99, hi = 0;
    for (let i = 0; i < 600; i++) {
      stepShip(s, 0.1, i / 10, { seaState: 6 });
      lo = Math.min(lo, s.depth);
      hi = Math.max(hi, s.depth);
    }
    expect(hi - lo).toBeGreaterThan(1);
    expect(hi).toBeLessThanOrEqual(PERISCOPE_DEPTH + 0.5);
    expect(s.mastUp).toBe(true);
  });

  it('a broach throws the boat up: radar sees the hull, lookouts see the conning tower', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 2, depth: PERISCOPE_DEPTH });
    s.order = { heading: 0, speedKn: 2, depth: PERISCOPE_DEPTH };
    s.broachUntil = 30;
    for (let i = 0; i < 200; i++) stepShip(s, 0.1, i / 10, { seaState: 6 });
    expect(s.depth).toBeLessThan(12);
    expect(isBroaching(s, 20)).toBe(true);
    expect(exposedMast(s, 20)).toBe('hull');
    const env: Environment = { layerDepth: 0, layerLoss: 0, seaState: 6, light: 1 };
    expect(sightingRange(s, env, 20)?.what).toBe('surfaced');
    expect(isBroaching(s, 40)).toBe(false);
  });

  it('chances: broach from SS5 when slow, head valve from SS4; snorkel charge falls with the sea', () => {
    expect(broachChanceS(4, 2)).toBe(0);
    expect(broachChanceS(6, 2) * 60).toBeCloseTo(0.06);
    expect(broachChanceS(6, 6)).toBeLessThan(broachChanceS(6, 2));
    expect(headValveChanceS(3)).toBe(0);
    expect(headValveChanceS(5) * 60).toBeCloseTo(0.3);
    expect(snorkelSeaFactor(3)).toBe(1);
    expect(snorkelSeaFactor(6)).toBeCloseTo(0.64);
  });

  it('a shut head valve stops the charge', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: PERISCOPE_DEPTH });
    s.battery = CLASSES.ssk.battery!.capacityKnH * 0.3;
    s.snorkel = true;
    s.snorkelExt = 1;
    s.order = { heading: 0, speedKn: 4, depth: PERISCOPE_DEPTH };
    s.headValveUntil = 100;
    const before = pctOf(s);
    for (let t = 0; t < 90; t++) stepShip(s, 1, t, { seaState: 5 });
    expect(pctOf(s)).toBeLessThan(before);
  });

  it('in a world at SS6 a snorkelling boat logs head-valve trouble and charges more slowly than at SS2', () => {
    const charge = (ss: number) => {
      const u = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 5, depth: PERISCOPE_DEPTH });
      u.battery = CLASSES.ssk.battery!.capacityKnH * 0.3;
      u.snorkel = true;
      u.snorkelExt = 1;
      u.order = { heading: 0, speedKn: 5, depth: PERISCOPE_DEPTH };
      const w = createWorld([u], 11, { layerDepth: 0, layerLoss: 0, seaState: ss, light: 1 });
      installBoats(w);
      for (let i = 0; i < 1200 * 10; i++) stepWorld(w);
      return { gain: pctOf(u) - 30, valve: w.events.some((e) => e.kind === 'boat' && 'what' in e && e.what === 'headvalve') };
    };
    const calm = charge(2), rough = charge(6);
    expect(rough.valve).toBe(true);
    expect(calm.valve).toBe(false);
    expect(rough.gain).toBeLessThan(calm.gain * 0.75);
  });
});

describe('F26 escorts slow down in a heavy head sea', () => {
  // Wind blowing toward the south (y−): the sea comes from the north
  const sea = { seaState: 6, wind: { x: 0, y: -12 } };
  it('frigate: 24 % off dead into an SS6 sea, nothing running before it or across; corvette more', () => {
    expect(headSeaFactor('ffg', 0, sea)).toBeCloseTo(0.76);
    expect(headSeaFactor('ffg', 180, sea)).toBe(1);
    expect(headSeaFactor('ffg', 90, sea)).toBeCloseTo(1);
    expect(headSeaFactor('kor', 0, sea)).toBeCloseTo(0.64);
    expect(headSeaFactor('ffg', 0, { seaState: 3, wind: sea.wind })).toBe(1);
    expect(headSeaFactor('merchant', 0, sea)).toBe(1);
    expect(headSeaFactor('ffg', 0, { seaState: 6 })).toBe(1);
  });

  it('a frigate ordered to flank speed into the sea makes about 23 kn', () => {
    const f = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 0 });
    f.order.speedKn = 40;
    for (let i = 0; i < 3000; i++) stepShip(f, 0.1, i / 10, sea);
    expect(f.speed / KN).toBeCloseTo(CLASSES.ffg.maxSpeedKn * 0.76, 0);
  });
});

describe('F11 bioluminescence', () => {
  const night = (month: number, lat: number, moon = 0, seaState = 3): Environment => ({ layerDepth: 0, layerLoss: 0, seaState, light: 0.12, moon, month, lat, seed: 7 });
  it('strong in a temperate summer, weak in the Arctic winter', () => {
    expect(bioluminescence(night(7, 45))).toBeGreaterThan(0.4);
    expect(bioluminescence(night(1, 74))).toBeLessThan(0.15);
    expect(bioluminescence({})).toBe(0);
  });

  it('only in the dark: a bright moon or daylight drowns it, whitecaps wash it out', () => {
    expect(glowStrength(night(7, 45, 0))).toBeGreaterThan(0.3);
    expect(glowStrength(night(7, 45, 1))).toBeLessThan(0.05);
    expect(glowStrength({ ...night(7, 45), light: 1 })).toBe(0);
    expect(glowStrength(night(7, 45, 0, 6))).toBeLessThan(glowStrength(night(7, 45, 0, 3)) * 0.4);
  });

  it('a boat moving at periscope depth on a dark bloom night glows; a torpedo track is seen', () => {
    const env = night(7, 45);
    const u = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 7, depth: PERISCOPE_DEPTH });
    const s = sightingRange(u, env, 0);
    expect(s?.what).toBe('glow');
    expect(s!.range).toBeGreaterThan(300);
    // Creeping, or a winter night up north: nothing
    u.speed = 2 * KN;
    expect(sightingRange(u, env, 0)).toBeUndefined();
    u.speed = 7 * KN;
    expect(sightingRange(u, night(1, 74), 0)).toBeUndefined();
    const f = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0 });
    expect(seesTorpedoTrack(f, 600, env)).toBe(true);
    expect(seesTorpedoTrack(f, 600, night(1, 74))).toBe(false);
    expect(lookoutRanges(env).glow).toBeGreaterThan(0);
  });
});
