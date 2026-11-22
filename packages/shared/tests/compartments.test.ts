import { describe, expect, it } from 'vitest';
import {
  CLASSES, Rng, applyHitDamage, compartmentLayout, compsOf, createShip, createWorld, emergencyBlow, floodWeight, igniteCompartment,
  installBoats, setSealed, stepDamage, stepWorld, type ClassId,
} from '../src/index.js';

const ship = (cls: ClassId, depth?: number) => createShip({ id: 'x', cls, name: 'X', pos: { x: 0, y: 0 }, heading: 0, depth });

function run(s: ReturnType<typeof ship>, seconds: number, seed = 1) {
  const w = createWorld([s], seed);
  for (let i = 0; i < seconds * 10 && s.alive; i++) stepWorld(w);
  return w;
}

describe('compartments: flooding', () => {
  it('a hole floods its compartment, faster the deeper the boat is', () => {
    const shallow = ship('ssn', 20);
    const deep = ship('ssn', 250);
    for (const s of [shallow, deep]) {
      compsOf(s)[1]!.leak = 0.4;
      compsOf(s)[1]!.manual = true;
      s.order.depth = s.depth;
      s.dcComp = 4; // crew busy elsewhere
      for (let t = 0; t < 100; t++) stepDamage(s, 0.1);
    }
    expect(compsOf(shallow)[1]!.flood).toBeGreaterThan(0.02);
    expect(compsOf(deep)[1]!.flood).toBeGreaterThan(compsOf(shallow)[1]!.flood * 2.2);
  });

  it('water runs through open bulkheads; a closed bulkhead stops it', () => {
    const open = ship('ffg');
    const shut = ship('ffg');
    for (const s of [open, shut]) {
      compsOf(s)[2]!.leak = 1;
      compsOf(s)[2]!.manual = true;
    }
    setSealed(shut, 2, true);
    for (let t = 0; t < 600; t++) {
      stepDamage(open, 0.1);
      stepDamage(shut, 0.1);
    }
    expect(compsOf(open)[1]!.flood + compsOf(open)[3]!.flood).toBeGreaterThan(0.1);
    expect(compsOf(shut)[1]!.flood + compsOf(shut)[3]!.flood).toBe(0);
    // Sealing costs the systems in there
    expect(shut.damage!.sonar).toBeGreaterThanOrEqual(0.5);
  });

  it('the crew closes a compartment that is all but full', () => {
    const s = ship('merchant');
    compsOf(s)[1]!.leak = 1;
    const w = run(s, 200);
    expect(compsOf(s)[1]!.sealed).toBe(true);
    expect(w.events.some((e) => e.kind === 'boat' && e.text === 'SCHOTT GESCHLOSSEN · LADERAUM 1')).toBe(true);
  });

  it('a small leak is patched and pumped dry', () => {
    const s = ship('ssk', 100);
    s.order.depth = 100;
    applyHitDamage(s, 15, new Rng(3), { u: 0.5, fireChance: 0 });
    expect(floodWeight(s)).toBe(0);
    run(s, 900);
    expect(s.alive).toBe(true);
    expect(compsOf(s).every((c) => c.leak === 0)).toBe(true);
    expect(floodWeight(s)).toBeLessThan(0.01);
  });
});

describe('compartments: fire', () => {
  it('an unfought fire spreads to its neighbours; sealed it burns out', () => {
    let spread = 0;
    let starved = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const a = ship('ffg');
      igniteCompartment(a, 2, 0.8);
      a.dcComp = 0; // the party is busy in the bow
      compsOf(a)[0]!.dmg = 1;
      const w = createWorld([a], seed);
      for (let i = 0; i < 3000; i++) stepWorld(w);
      if (compsOf(a)[1]!.fire > 0 || compsOf(a)[3]!.fire > 0 || w.events.some((e) => e.kind === 'boat' && e.what === 'fire_spread')) spread++;
      const b = ship('ffg');
      igniteCompartment(b, 2, 0.8);
      setSealed(b, 2, true);
      const w2 = createWorld([b], seed);
      for (let i = 0; i < 2000; i++) stepWorld(w2);
      if (compsOf(b)[2]!.fire === 0 && compsOf(b)[1]!.fire === 0 && compsOf(b)[3]!.fire === 0) starved++;
    }
    expect(spread).toBeGreaterThanOrEqual(4);
    expect(starved).toBe(6);
  });

  it('a fought fire goes out', () => {
    const s = ship('kor');
    igniteCompartment(s, 1, 0.5);
    const w = run(s, 120);
    expect(compsOf(s)[1]!.fire).toBe(0);
    expect(w.events.some((e) => e.kind === 'boat' && e.text === 'FEUER GELÖSCHT IN DER OPZ')).toBe(true);
  });
});

describe('compartments: trim, list and sinking', () => {
  it('water forward trims by the bow, aft by the stern; a holed ship lists', () => {
    const bow = ship('ffg');
    const aft = ship('ffg');
    compsOf(bow)[0]!.flood = 1;
    compsOf(aft)[4]!.flood = 1;
    bow.heelSide = 1;
    stepDamage(bow, 0.1);
    stepDamage(aft, 0.1);
    expect(bow.trimDeg!).toBeGreaterThan(2);
    expect(aft.trimDeg!).toBeLessThan(-2);
    expect(bow.listDeg!).toBeGreaterThan(0.5);
  });

  it('a flooded boat is dragged down; way on or a blow holds her', () => {
    const still = ship('ssn', 100);
    const blown = ship('ssn', 100);
    for (const s of [still, blown]) {
      s.order.depth = 100;
      compsOf(s)[2]!.flood = 0.9;
      compsOf(s)[2]!.sealed = true;
    }
    const w = createWorld([still, blown], 1);
    installBoats(w);
    emergencyBlow(w, blown);
    for (let i = 0; i < 300; i++) stepWorld(w);
    expect(still.depth).toBeGreaterThan(115);
    expect(blown.depth).toBeLessThan(60);
  });

  it('a submarine sinks when too much of her is flooded', () => {
    const s = ship('ssn', 80);
    for (const i of [0, 1, 2]) compsOf(s)[i]!.flood = 1;
    s.lastHitBy = 'f1';
    const w = run(s, 5);
    expect(s.alive).toBe(false);
    expect(w.events.some((e) => e.kind === 'sunk' && e.byId === 'f1')).toBe(true);
  });
});

describe('compartments: balance', () => {
  /** Heavyweight hit, then 15 (or more) minutes with only the crew's own damage control. */
  function heavyHit(cls: ClassId, seed: number, depth?: number, seconds = 900) {
    const s = ship(cls, depth);
    if (depth) s.order.depth = depth;
    const w = createWorld([s], seed);
    installBoats(w);
    s.hp -= 80;
    if (s.hp > 0) applyHitDamage(s, 80, w.rng, { at: { x: 30, y: 0 }, byId: 'enemy', w });
    for (let i = 0; i < seconds * 10 && s.alive && s.hp > 0; i++) stepWorld(w);
    return s;
  }

  it('one heavy torpedo usually sinks a submarine', () => {
    let sunk = 0;
    // The double-hulled SSN survives the blast, but stopped and heavy she goes down within half an hour
    for (let seed = 1; seed <= 10; seed++) if (heavyHit('ssn', seed, 150, 1800).hp <= 0) sunk++;
    expect(sunk).toBeGreaterThanOrEqual(6);
    expect(heavyHit('ssk', 1, 100).hp).toBeLessThanOrEqual(0);
  });

  it('one heavy torpedo cripples a frigate but rarely sinks her outright', () => {
    let afloat = 0;
    let crippled = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s = heavyHit('ffg', seed);
      if (s.alive) afloat++;
      if (s.hp < CLASSES.ffg.hp * 0.4) crippled++;
    }
    expect(afloat).toBeGreaterThanOrEqual(8);
    expect(crippled).toBe(10);
  });

  it('every class has a layout whose volumes add up', () => {
    for (const cls of Object.keys(CLASSES) as ClassId[]) {
      const v = compartmentLayout(cls).reduce((a, c) => a + c.vol, 0);
      expect(Math.abs(v - 1)).toBeLessThan(1e-6);
    }
  });
});
