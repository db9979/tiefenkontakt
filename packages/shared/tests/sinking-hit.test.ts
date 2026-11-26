import { describe, expect, it } from 'vitest';
import { compsOf, createShip, createWorld, weaponHit } from '../src/index.js';

describe('a single sinking hit', () => {
  it('still opens the hull where it struck: the damage panel shows the state she went down with', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 60 });
    const w = createWorld([s], 3);
    weaponHit(w, s, s.hp + 40, 'enemy', { x: 0, y: 10 });
    expect(s.alive).toBe(false);
    const hit = compsOf(s).filter((c) => c.leak > 0.05 || c.dmg > 0.05);
    expect(hit.length).toBeGreaterThan(0);
    expect(Math.max(...Object.values(s.damage!))).toBeGreaterThan(0);
    // The crew of a sinking boat reports nothing more (no flooding or fire calls after the end)
    expect(w.events.filter((e) => e.kind === 'boat').length).toBe(0);
    expect(w.events.filter((e) => e.kind === 'sunk').length).toBe(1);
  });
});
