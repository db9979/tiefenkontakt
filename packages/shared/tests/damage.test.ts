import { describe, expect, it } from 'vitest';
import { KN, Rng, applyHitDamage, compsOf, createShip, createWorld, stepDamage, stepShip, stepWorld } from '../src/index.js';

describe('damage control', () => {
  it('a hit holes and wrecks a compartment; propulsion damage cuts speed', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 100 });
    applyHitDamage(s, 60, new Rng(1), { u: 0.75 });
    const c = compsOf(s)[4]!; // Maschinenraum
    expect(c.leak).toBeGreaterThan(0.5);
    expect(s.damage!.antrieb).toBeGreaterThan(0.5);
    s.order.speedKn = 18;
    for (let t = 0; t < 600; t++) stepShip(s, 1, t);
    expect(s.speed / KN).toBeLessThan(18 * 0.6);
  });

  it('the priority compartment is repaired faster', () => {
    const a = createShip({ id: 'a', cls: 'ffg', name: 'A', pos: { x: 0, y: 0 }, heading: 0 });
    const comps = compsOf(a);
    comps[0]!.dmg = 0.8;
    comps[3]!.dmg = 0.8;
    a.dcComp = 0;
    for (let t = 0; t < 60; t++) stepDamage(a, 1);
    expect(comps[0]!.dmg).toBeLessThan(comps[3]!.dmg - 0.15);
    expect(a.damage!.sonar).toBeLessThan(a.damage!.antrieb);
  });

  it('uncontrolled flooding sinks the ship and credits the last hit', () => {
    const s = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0 });
    for (const c of compsOf(s).slice(0, 3)) {
      c.leak = 1;
      c.manual = true; // nobody closes the bulkheads
    }
    s.lastHitBy = 'u9';
    const w = createWorld([s], 1);
    for (let i = 0; i < 3000 && s.alive; i++) stepWorld(w);
    expect(s.alive).toBe(false);
    expect(w.events.some((e) => e.kind === 'sunk' && e.shipId === 'f' && e.byId === 'u9')).toBe(true);
  });
});
