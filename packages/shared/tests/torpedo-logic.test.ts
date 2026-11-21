import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  DEFAULT_ENV,
  activeSignalExcess,
  createShip,
  createWorld,
  depthAt,
  dropLightweight,
  fireTorpedo,
  installWeapons,
  launchNoisemaker,
  leadBearing,
  seekerRange,
  passiveSignalExcess,
  runSensors,
  sourceLevelToward,
  stepWorld,
  targetStrengthToward,
  distance,
  type Torpedo,
} from '../src/index.js';

describe('radiation pattern', () => {
  const ssn = () => {
    const s = createShip({ id: 'n', cls: 'ssn', name: 'N', pos: { x: 0, y: 0 }, heading: 0, speedKn: 8, depth: 100 });
    s.speed = 8 * 0.5144;
    return s;
  };

  it('a submarine is quietest from ahead and loudest from astern', () => {
    const s = ssn();
    const bow = sourceLevelToward(s, { x: 0, y: 5000 });
    const beam = sourceLevelToward(s, { x: 5000, y: 0 });
    const stern = sourceLevelToward(s, { x: 0, y: -5000 });
    expect(bow).toBeLessThan(beam);
    expect(stern).toBeGreaterThan(beam);
    expect(stern - bow).toBeCloseTo(9, 0);
  });

  it('a hull echoes strongest broadside', () => {
    const s = ssn();
    const beam = targetStrengthToward(s, { x: 5000, y: 0 });
    expect(beam).toBeGreaterThan(targetStrengthToward(s, { x: 0, y: 5000 }));
    expect(beam).toBeGreaterThan(targetStrengthToward(s, { x: 0, y: -5000 }));
  });

  it('passive and active detection follow the target aspect', () => {
    const listenerAt = (x: number, y: number) => createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x, y }, heading: 180, speedKn: 5 });
    const s = ssn();
    const astern = passiveSignalExcess(s, listenerAt(0, -6000), 6000, 'hull', DEFAULT_ENV);
    const ahead = passiveSignalExcess(s, listenerAt(0, 6000), 6000, 'hull', DEFAULT_ENV);
    expect(astern - ahead).toBeGreaterThan(8);
    const broadside = activeSignalExcess(s, listenerAt(6000, 0), 6000, DEFAULT_ENV);
    const endOn = activeSignalExcess(s, listenerAt(0, 6000), 6000, DEFAULT_ENV);
    expect(broadside - endOn).toBeGreaterThan(7);
  });

  it('the hull active sonar gets no echo from its own baffles', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 5 });
    const behind = createShip({ id: 'u', cls: 'ssn', name: 'U', pos: { x: 0, y: -3000 }, heading: 90, speedKn: 8, depth: 60 });
    const w = createWorld([ffg, behind], 4);
    ffg.activeSonar = true;
    const echoes = runSensors({ ships: w.ships, env: w.env, time: 100, rng: w.rng }).filter((d) => d.sensor === 'active');
    expect(echoes).toHaveLength(0);
  });
});

describe('torpedo safety and limits', () => {
  it('an ASW lightweight never attacks the own frigate on the surface', () => {
    const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12, team: 'west' });
    const w = createWorld([ffg], 6);
    installWeapons(w);
    dropLightweight(w, 'f1', { x: 1000, y: 1000 });
    for (let i = 0; i < 3000; i++) stepWorld(w);
    expect(ffg.hp).toBe(CLASSES.ffg.hp);
  });

  it('a lightweight still finds a submarine at periscope depth', () => {
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 600, y: 0 }, heading: 90, speedKn: 3, depth: 18, team: 'east' });
    const w = createWorld([sub], 8);
    installWeapons(w);
    dropLightweight(w, 'f1', { x: 0, y: 0 });
    for (let i = 0; i < 3000 && sub.hp === CLASSES.ssk.hp; i++) stepWorld(w);
    expect(sub.hp).toBeLessThan(CLASSES.ssk.hp);
  });

  it('a heavyweight never homes on the boat that fired it', () => {
    const sub = createShip({ id: 'u1', cls: 'ssn', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12, depth: 60 });
    const w = createWorld([sub], 2);
    installWeapons(w);
    sub.order = { heading: 0, speedKn: 12, depth: 60 };
    // Fired ahead with the seeker on immediately: the boat follows its own torpedo
    fireTorpedo(w, sub, { heading: 0, enableAfter: 500, searchDepth: 60, mode: 'active' });
    for (let i = 0; i < 6000; i++) {
      stepWorld(w);
      expect(w.weapons!.torpedoes[0]?.homingOn).not.toBe('u1');
    }
    expect(sub.hp).toBe(CLASSES.ssn.hp);
  });

  it('a torpedo stays above the seabed in shallow water', () => {
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 50 });
    const w = createWorld([sub], 3);
    w.env.seabed = { kind: 'schelf', seed: 1 };
    installWeapons(w);
    fireTorpedo(w, sub, { heading: 0, enableAfter: 500, searchDepth: 300 });
    for (let i = 0; i < 3000; i++) {
      stepWorld(w);
      for (const t of w.weapons!.torpedoes) expect(t.depth).toBeLessThan(depthAt(w.env.seabed, t.pos.x, t.pos.y));
    }
  });
});

describe('seeker and guidance', () => {
  it('a fast run deafens the seeker, a slow run hears further', () => {
    expect(seekerRange({ mode: 'passive', speedKn: 30 }, 140, 15)).toBeGreaterThan(seekerRange({ mode: 'passive', speedKn: 40 }, 140, 15));
    expect(seekerRange({ mode: 'active', speedKn: 30 }, 0, 15)).toBeGreaterThan(seekerRange({ mode: 'active', speedKn: 45 }, 0, 15));
  });

  it('leads a crossing target instead of chasing its tail', () => {
    // Target 2 km north moving east at 10 m/s: the intercept lies east of north
    const b = leadBearing({ x: 0, y: 0 }, 20, { x: 0, y: 2000 }, { x: 10, y: 0 });
    expect(b).toBeGreaterThan(20);
    expect(b).toBeLessThan(40);
    // A target that cannot be caught: aim straight at it
    expect(leadBearing({ x: 0, y: 0 }, 5, { x: 0, y: 2000 }, { x: 0, y: 30 })).toBeCloseTo(0, 5);
  });

  it('a torpedo runs through a noisemaker, rejects it and re-attacks a boat that did not evade', () => {
    const shooter = createShip({ id: 's', cls: 'ssn', name: 'S', pos: { x: 0, y: 0 }, heading: 0, speedKn: 5, depth: 60 });
    const tgt = createShip({ id: 'n', cls: 'ssn', name: 'N', pos: { x: 0, y: 5000 }, heading: 0, speedKn: 10, depth: 60 });
    tgt.speed = 10 * 0.5144;
    tgt.order = { heading: 0, speedKn: 10, depth: 60 };
    const w = createWorld([shooter, tgt], 3);
    installWeapons(w);
    fireTorpedo(w, shooter, { heading: 0, enableAfter: 2000, searchDepth: 60 });
    let dropped = false;
    let t: Torpedo | undefined;
    for (let i = 0; i < 9000 && tgt.hp === CLASSES.ssn.hp; i++) {
      stepWorld(w);
      t = w.weapons!.torpedoes[0] ?? t;
      if (!dropped && t && distance(t.pos, tgt.pos) < 1500) {
        dropped = true;
        launchNoisemaker(w, tgt);
      }
    }
    expect(t?.rejected?.length).toBe(1);
    expect(tgt.hp).toBeLessThan(CLASSES.ssn.hp);
  });

  it('a lightweight seduced by a noisemaker is spent on it', () => {
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 300 }, heading: 90, speedKn: 3, depth: 80 });
    const w = createWorld([sub], 5);
    installWeapons(w);
    launchNoisemaker(w, sub);
    sub.pos = { x: 4000, y: 4000 };
    dropLightweight(w, 'f1', { x: 0, y: 0 });
    for (let i = 0; i < 1500 && w.weapons!.torpedoes.length; i++) stepWorld(w);
    expect(w.weapons!.torpedoes).toHaveLength(0);
    expect(sub.hp).toBe(CLASSES.ssk.hp);
  });

  it('a torpedo in the baffles is noticed only when it is close', () => {
    const warnAt = (fromY: number) => {
      const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 60 });
      const shooter = createShip({ id: 's', cls: 'ssn', name: 'S', pos: { x: 0, y: fromY }, heading: 0, speedKn: 3, depth: 60 });
      const w = createWorld([sub, shooter], 1);
      installWeapons(w);
      fireTorpedo(w, shooter, { heading: fromY > 0 ? 180 : 0, enableAfter: 20_000, searchDepth: 60 });
      for (let i = 0; i < 6000; i++) {
        stepWorld(w);
        const tp = w.weapons!.torpedoes[0];
        if (tp && w.events.some((e) => e.kind === 'torpedo_alert' && e.shipId === 'u1')) return distance(tp.pos, sub.pos);
      }
      return 0;
    };
    expect(warnAt(9000)).toBeGreaterThan(5000);
    expect(warnAt(-9000)).toBeLessThanOrEqual(1000);
  });
});
