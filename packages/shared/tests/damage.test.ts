import { describe, expect, it } from 'vitest';
import { KN, Rng, applyHitDamage, createShip, createWorld, stepDamage, stepShip, stepWorld } from '../src/index.js';

describe('damage control', () => {
  it('a hit damages systems and floods; propulsion damage cuts speed', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 100 });
    applyHitDamage(s, 60, new Rng(1));
    expect(s.damage!.leck).toBeGreaterThan(0.3);
    s.damage!.antrieb = 0.75;
    s.order.speedKn = 18;
    for (let t = 0; t < 600; t++) stepShip(s, 1, t);
    expect(s.speed / KN).toBeLessThan(18 * 0.5);
  });

  it('the priority system is repaired faster; flooding costs hull and depth', () => {
    const a = createShip({ id: 'a', cls: 'ssk', name: 'A', pos: { x: 0, y: 0 }, heading: 0, depth: 200 });
    a.damage = { antrieb: 0.8, sonar: 0.8, waffen: 0, leck: 0.5 };
    a.repair = 'sonar';
    a.order.depth = 280;
    const hp0 = a.hp;
    for (let t = 0; t < 60; t++) stepDamage(a, 1);
    expect(a.damage.sonar).toBeLessThan(a.damage.antrieb - 0.15);
    expect(a.hp).toBeLessThan(hp0);
    expect(a.order.depth).toBeLessThan(280);
  });

  it('uncontrolled flooding sinks the ship', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 60 });
    s.hp = 3;
    s.damage = { antrieb: 0, sonar: 0, waffen: 0, leck: 1 };
    const w = createWorld([s], 1);
    for (let i = 0; i < 400 && s.alive; i++) stepWorld(w);
    expect(s.alive).toBe(false);
    expect(w.events.some((e) => e.kind === 'sunk' && e.shipId === 'u')).toBe(true);
  });
});
