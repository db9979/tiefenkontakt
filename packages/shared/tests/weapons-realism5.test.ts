import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  DC_SINK_RATE,
  KN,
  Rng,
  UNDER_KEEL_FACTOR,
  WIRE_MAX_TURN,
  createLoadout,
  createShip,
  createWorld,
  dropDepthCharge,
  fireSalvo,
  fireTorpedo,
  heavyPreset,
  heavyRange,
  installWeapons,
  launchAswRocket,
  recordWakes,
  rocketFlightS,
  rocketScatterM,
  runTimeLeft,
  setTowedDecoy,
  steerTorpedo,
  steerWake,
  stepWorld,
  torpedoDamage,
  twoSpeedMeanKn,
  twoSpeedRange,
  wireChannels,
  wireWarning,
  type Torpedo,
  type WakePt,
} from '../src/index.js';

function boat(cls: 'ssk' | 'ssn' = 'ssk') {
  const u = createShip({ id: 'u1', cls, name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 60 });
  const f = createShip({ id: 'f1', cls: 'ffg', name: 'F1', team: 'west', pos: { x: 30_000, y: 30_000 }, heading: 90, speedKn: 0 });
  const w = createWorld([u, f], 5);
  installWeapons(w);
  u.order = { heading: 0, speedKn: 4, depth: 60 };
  return { w, u, f };
}

const run = (w: ReturnType<typeof boat>['w'], s: number) => {
  for (let i = 0; i < s * 10; i++) stepWorld(w);
};

describe('F16 wire guidance', () => {
  it('a steady boat keeps the wire', () => {
    const { w, u } = boat();
    const t = fireTorpedo(w, u, { heading: 0, speedKn: 30, enableAfter: 20_000 }) as Torpedo;
    run(w, 120);
    expect(t.wire).toBe(true);
    expect(t.wireWarn).toBeUndefined();
  });

  it('a hard turn breaks the wire and logs DRAHT GERISSEN with the reason', () => {
    const { w, u } = boat();
    u.order = { heading: 0, speedKn: 10, depth: 60 };
    run(w, 120);
    const t = fireTorpedo(w, u, { heading: 0, speedKn: 30, enableAfter: 20_000 }) as Torpedo;
    run(w, 30);
    u.order = { heading: 90, speedKn: 10, depth: 60 };
    stepWorld(w);
    // Ordered, not yet turned: the warning before the break (at 10 kn the boat turns ~59°/min)
    expect(t.wireWarn).toBe('BEFOHLENER KURS 90° WEG BRICHT DRAHT · MAX. 30°/MIN');
    run(w, 90);
    expect(t.wire).toBe(false);
    expect(t.wireLost?.why).toMatch(/KURSWECHSEL ZU SCHARF/);
    const ev = w.events.find((e) => e.kind === 'boat' && e.what === 'wire');
    expect(ev && 'text' in ev && ev.text).toMatch(/^DRAHT GERISSEN · T\d+ · KURSWECHSEL ZU SCHARF/);
    // Steering no longer works
    expect(steerTorpedo(w, u, t.id, 20)).toBe(false);
  });

  it('a small course change at 10 kn, or a slow boat turning gently, keeps the wire', () => {
    const { w, u } = boat();
    u.order = { heading: 0, speedKn: 10, depth: 60 };
    run(w, 120);
    const t = fireTorpedo(w, u, { heading: 0, speedKn: 30, enableAfter: 20_000 }) as Torpedo;
    run(w, 30);
    u.order = { heading: 20, speedKn: 10, depth: 60 };
    stepWorld(w);
    expect(t.wireWarn).toBeUndefined();
    run(w, 120);
    expect(t.wire).toBe(true);
    // At 4 kn the boat turns only ~23°/min: a 60° turn is slow enough
    const slow = boat();
    const t2 = fireTorpedo(slow.w, slow.u, { heading: 0, speedKn: 30, enableAfter: 20_000 }) as Torpedo;
    run(slow.w, 30);
    slow.u.order = { heading: 60, speedKn: 4, depth: 60 };
    run(slow.w, 240);
    expect(t2.wire).toBe(true);
  });

  it('own speed over 12 kn breaks the wire', () => {
    const { w, u } = boat();
    const t = fireTorpedo(w, u, { heading: 0, speedKn: 30, enableAfter: 20_000 }) as Torpedo;
    u.order = { heading: 0, speedKn: 16, depth: 60 };
    run(w, 200);
    expect(t.wire).toBe(false);
    expect(t.wireLost?.why).toBe('EIGENE FAHRT ÜBER 12 KN');
  });

  it('warns at the limits before they break', () => {
    const own = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 11, depth: 60 });
    own.order = { heading: 0, speedKn: 11, depth: 60 };
    expect(wireWarning(own, 0, 0)).toBe('FAHRT 11 KN · DRAHT: MAX. 12 KN');
    expect(wireWarning(own, 25, 0)).toBe(`KURSWECHSEL 25°/MIN · DRAHT: MAX. ${WIRE_MAX_TURN}°/MIN`);
    own.order.speedKn = 14;
    expect(wireWarning(own, 0, 0)).toBe('BEFOHLENE FAHRT 14 KN · DRAHT: MAX. 12 KN');
  });

  it('the console guides 2 (Kilo) or 4 (SSN) wires; further torpedoes leave without one', () => {
    expect(wireChannels('ssk')).toBe(2);
    expect(wireChannels('ssn')).toBe(4);
    expect(wireChannels('ffg')).toBe(0);
    const { w, u } = boat();
    const shot = fireSalvo(w, u, { heading: 0, speedKn: 40 }, 4, 3) as Torpedo[];
    expect(shot.map((t) => t.wire)).toEqual([true, true, false, false]);
    expect(shot[2]!.wireLost?.why).toBe('OHNE DRAHT · FEUERLEITUNG FÜHRT NUR 2');
  });
});

describe('F17 heavyweight transit and attack speed', () => {
  it('range follows the fuel burnt at each speed', () => {
    expect(heavyRange(25)).toBeGreaterThan(34_000);
    // Slow transit to 10 km, then the sprint: further than a 40 kn run, shorter than a 30 kn run
    const r = twoSpeedRange(30, 40, 10_000);
    expect(r).toBeGreaterThan(heavyRange(40));
    expect(r).toBeLessThan(heavyRange(30));
    // 10 km at 30 kn uses 40 % of the fuel; the rest at 40 kn's burn
    expect(r).toBeCloseTo(10_000 + 15_000 * 0.6, -1);
    expect(twoSpeedMeanKn(30, 40, 4000, 8000)).toBeCloseTo(8000 / (4000 / 30 + 4000 / 40), 6);
  });

  it('transits slow, sprints when the seeker opens and runs out at the planned reach', () => {
    const { w, u } = boat();
    const t = fireTorpedo(w, u, { heading: 0, speedKn: 40, transitKn: 25, enableAfter: 6000 }) as Torpedo;
    expect(t.speedKn).toBe(25);
    expect(t.attackKn).toBe(40);
    const planned = t.maxRun;
    expect(planned).toBeCloseTo(twoSpeedRange(25, 40, 6000), 3);
    expect(runTimeLeft(t)).toBeCloseTo(6000 / (25 * KN) + (planned - 6000) / (40 * KN), 0);
    let lastRun = 0;
    while (w.weapons!.torpedoes.includes(t)) {
      lastRun = t.run;
      stepWorld(w);
      if (t.run > 6100) expect(t.speedKn).toBe(40);
    }
    expect(Math.abs(lastRun - planned)).toBeLessThan(50);
  });

  it('the AI transits at 30 and sprints at 40 on long active shots; passive shots keep one speed', () => {
    expect(heavyPreset(6000, 'active')).toEqual({ transitKn: 30, speedKn: 40 });
    expect(heavyPreset(2000, 'active')).toEqual({ transitKn: 40, speedKn: 40 });
    expect(heavyPreset(6000, 'passive')).toEqual({ transitKn: 30, speedKn: 30 });
    expect(heavyPreset(3000, 'passive')).toEqual({ transitKn: 40, speedKn: 40 });
  });
});

describe('F20 ASW mortar and rocket', () => {
  it('mortar charges sink at 12 m/s', () => {
    expect(DC_SINK_RATE).toBe(12);
    const f = createShip({ id: 'f1', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    const w = createWorld([f], 3);
    installWeapons(w);
    dropDepthCharge(w, f, 120);
    // 8 s flight, then 120 m at 12 m/s
    expect(w.weapons!.pending[0]!.at).toBeCloseTo(8 + 10, 6);
  });

  it('rocket flight time and scatter grow with range', () => {
    expect(rocketFlightS(2000)).toBeCloseTo(11.7, 1);
    expect(rocketFlightS(9000)).toBe(35);
    expect(rocketScatterM(2000)).toBe(76);
    expect(rocketScatterM(18_000)).toBe(204);
    const f = createShip({ id: 'f1', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    const w = createWorld([f], 3);
    installWeapons(w);
    launchAswRocket(w, f, { x: 0, y: 3000 });
    launchAswRocket(w, f, { x: 0, y: 15_000 });
    const [near, far] = w.weapons!.pending;
    expect(near!.at).toBeCloseTo(15, 6);
    expect(far!.at).toBeCloseTo(55, 6);
  });
});

describe('F18 wake-homing torpedo (east SSN)', () => {
  it('the SSN carries four wake homers; others none', () => {
    expect(createLoadout('ssn').wake).toBe(4);
    expect(createLoadout('ssk').wake).toBeUndefined();
    // The total load is unchanged: 16 weapons
    const l = createLoadout('ssn');
    expect(l.heavy + l.tubes.filter((t) => t.loaded).length + (l.wake ?? 0)).toBe(16);
  });

  it('only a boat with wake homers can fire one; it takes the tube and no wire', () => {
    const k = boat('ssk');
    expect(fireTorpedo(k.w, k.u, { heading: 0, mode: 'wake' })).toBe('Keine Kielwassertorpedos an Bord');
    const n = boat('ssn');
    const l = n.w.weapons!.loadouts.get('u1')!;
    const heavyBefore = l.heavy;
    const t = fireTorpedo(n.w, n.u, { heading: 0, mode: 'wake' }) as Torpedo;
    expect(t.mode).toBe('wake');
    expect(t.wire).toBe(false);
    expect(l.wake).toBe(3);
    expect(l.heavy).toBe(heavyBefore + 1);
  });

  function wakeScene(opts: { nixie?: boolean; turnAt?: number } = {}) {
    // Frigate steaming east at 15 kn along y = 6000; the SSN fires north across its track, astern of it
    const u = createShip({ id: 'u1', cls: 'ssn', name: 'U', pos: { x: 2600, y: 2000 }, heading: 0, speedKn: 4, depth: 60 });
    const f = createShip({ id: 'f1', cls: 'ffg', name: 'F', team: 'west', pos: { x: 0, y: 6000 }, heading: 90, speedKn: 15 });
    f.order = { heading: 90, speedKn: 15, depth: 0 };
    u.order = { heading: 0, speedKn: 4, depth: 60 };
    const w = createWorld([u, f], 9);
    installWeapons(w);
    if (opts.nixie) setTowedDecoy(w, f, true);
    run(w, 400); // the frigate lays 3 km of wake
    const t = fireTorpedo(w, u, { heading: 0, mode: 'wake', speedKn: 40, enableAfter: 2000 }) as Torpedo;
    let hit = false;
    let locked = false;
    for (let i = 0; i < 6000 && w.weapons!.torpedoes.includes(t); i++) {
      if (opts.turnAt !== undefined && t.wakeLock && !locked) {
        locked = true;
        f.order = { heading: 90 + opts.turnAt, speedKn: 15, depth: 0 };
      }
      locked ||= !!t.wakeLock;
      stepWorld(w);
    }
    hit = f.hp < CLASSES.ffg.hp;
    return { hit, t, f, locked };
  }

  it('crosses the wake, runs up it and hits the frigate, Nixie or not', () => {
    const plain = wakeScene();
    expect(plain.locked).toBe(true);
    expect(plain.hit).toBe(true);
    const decoyed = wakeScene({ nixie: true });
    expect(decoyed.hit).toBe(true);
  });

  it('a hard turn (knuckle) loses the trail with the knuckle chance', () => {
    let lost = 0;
    const N = 40;
    for (let seed = 0; seed < N; seed++) {
      // A trail with a 90° knuckle; the torpedo on it short of the knuckle
      const f = createShip({ id: 'f1', cls: 'ffg', name: 'F', team: 'west', pos: { x: 3000, y: 2000 }, heading: 0, speedKn: 15 });
      const pts: WakePt[] = [];
      for (let i = 0; i <= 30; i++) pts.push({ x: i * 100, y: 0, t: i * 10, hdg: 90 });
      for (let i = 1; i <= 20; i++) pts.push({ x: 3000, y: i * 100, t: 300 + i * 10, hdg: 0 });
      const wakes = new Map([['f1', pts]]);
      const t = { pos: { x: 0, y: 0 }, heading: 90, ownerId: 'u1', run: 5000 } as Torpedo;
      const rng = new Rng(seed);
      for (let k = 0; k < 400 && (k === 0 || t.wakeLock); k++) {
        const g = steerWake(t, [f], wakes, 500, rng);
        if (g.want === undefined || g.target) break;
        const v = { x: Math.sin((g.want * Math.PI) / 180), y: Math.cos((g.want * Math.PI) / 180) };
        t.pos = { x: t.pos.x + v.x * 20, y: t.pos.y + v.y * 20 };
        t.run += 20;
      }
      if (!t.wakeLock) lost += 1;
    }
    expect(lost / N).toBeGreaterThan(0.35);
    expect(lost / N).toBeLessThan(0.85);
  });

  it('a crossing wake may draw it off to the other ship', () => {
    let switched = 0;
    for (let seed = 0; seed < 60; seed++) {
      const a = createShip({ id: 'a', cls: 'ffg', name: 'A', team: 'west', pos: { x: 3000, y: 0 }, heading: 90, speedKn: 15 });
      const b = createShip({ id: 'b', cls: 'merchant', name: 'B', team: 'west', pos: { x: 1500, y: 2000 }, heading: 0, speedKn: 10 });
      const wakes = new Map<string, WakePt[]>();
      wakes.set('a', Array.from({ length: 31 }, (_, i) => ({ x: i * 100, y: 0, t: i * 10, hdg: 90 })));
      wakes.set('b', Array.from({ length: 41 }, (_, i) => ({ x: 1500, y: -2000 + i * 100, t: i * 10, hdg: 0 })));
      const t = { pos: { x: 0, y: 0 }, heading: 90, ownerId: 'u1', run: 5000 } as Torpedo;
      const rng = new Rng(seed);
      // First lock on a's trail away from the crossing, then run along it through b's wake
      t.wakeLock = { shipId: 'a', toT: 10, testedUntil: 0, crossed: [] };
      t.homingOn = 'a';
      for (let k = 0; k < 200; k++) {
        const g = steerWake(t, [a, b], wakes, 400, rng);
        if (g.want === undefined || g.target || t.wakeLock?.shipId === 'b') break;
        const v = { x: Math.sin((g.want * Math.PI) / 180), y: Math.cos((g.want * Math.PI) / 180) };
        t.pos = { x: t.pos.x + v.x * 20, y: t.pos.y + v.y * 20 };
      }
      if (t.wakeLock?.shipId === 'b') switched += 1;
    }
    expect(switched).toBeGreaterThan(8);
    expect(switched).toBeLessThan(40);
  });

  it('records wakes only of surface ships under way', () => {
    const f = createShip({ id: 'f1', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 15 });
    const s = createShip({ id: 's1', cls: 'ssk', name: 'S', pos: { x: 0, y: 0 }, heading: 0, speedKn: 6, depth: 60 });
    const m = createShip({ id: 'm1', cls: 'merchant', name: 'M', pos: { x: 0, y: 0 }, heading: 0, speedKn: 0 });
    const wakes = new Map<string, WakePt[]>();
    for (let t = 0; t <= 600; t += 1) recordWakes(wakes, [f, s, m], t);
    expect(wakes.get('f1')!.length).toBeGreaterThan(30);
    expect(wakes.get('f1')!.length).toBeLessThan(40);
    expect(wakes.has('s1')).toBe(false);
    expect(wakes.get('m1') ?? []).toHaveLength(0);
  });
});

describe('F19 under-keel hit', () => {
  it('under an escort keel: 1.5× (a frigate does not survive); on the side or a merchant: unchanged', () => {
    const ffg = { cls: 'ffg' as const, depth: CLASSES.ffg.draft };
    expect(torpedoDamage('heavy', ffg.depth + 6, ffg)).toEqual({ amount: 80 * UNDER_KEEL_FACTOR, underKeel: true });
    expect(torpedoDamage('heavy', ffg.depth, ffg)).toEqual({ amount: 80, underKeel: false });
    expect(torpedoDamage('heavy', ffg.depth + 40, ffg).underKeel).toBe(false);
    expect(torpedoDamage('heavy', 20, { cls: 'merchant', depth: 6 })).toEqual({ amount: 95, underKeel: false });
    expect(torpedoDamage('light', 20, ffg).amount).toBe(55);
    expect(torpedoDamage('heavy', 80, { cls: 'ssk', depth: 60 }).underKeel).toBe(false);
    expect(80 * UNDER_KEEL_FACTOR).toBeGreaterThanOrEqual(CLASSES.ffg.hp);
  });
});
