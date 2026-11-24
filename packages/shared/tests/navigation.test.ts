import { describe, expect, it } from 'vitest';
import { REGIONS, createShip, createWorld, depthAt, regionToGeo, shoalAhead, stepWorld } from '../src/index.js';

const env = { layerDepth: 80, layerLoss: 12, seaState: 2 };

describe('keeping off the rocks', () => {
  it('finds the shoal ahead and an auto-piloted ship turns away from the coast', () => {
    // Fjord (procedural): land beyond the channel to the east
    const ship = createShip({ id: 'n1', cls: 'tanker', name: 'T', pos: { x: 0, y: 10_000 }, heading: 90, speedKn: 12 });
    const w = createWorld([ship], 1, { ...env, seabed: { kind: 'fjord', seed: 3 } });
    expect(shoalAhead(w, ship.pos, 90, 20, 15_000)).toBeLessThan(15_000);
    expect(shoalAhead(w, ship.pos, 0, 20, 3000)).toBe(Infinity);
    ship.autoNav = true;
    let grounded = false;
    for (let i = 0; i < 3000; i++) {
      stepWorld(w);
      grounded ||= w.events.some((e) => e.kind === 'grounded');
    }
    expect(grounded).toBe(false);
    expect(depthAt(w.env.seabed, ship.pos.x, ship.pos.y)).toBeGreaterThan(20);
  });

  it('a player is warned instead, and a submarine runs aground rather than sailing over land', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 7000, y: 10_000 }, heading: 90, speedKn: 8, depth: 0 });
    sub.playerId = 'p1';
    const w = createWorld([sub], 1, { ...env, seabed: { kind: 'fjord', seed: 3 } });
    const kinds = new Set<string>();
    for (let i = 0; i < 9000; i++) {
      stepWorld(w);
      for (const e of w.events) kinds.add(e.kind === 'boat' ? `boat:${e.what}` : e.kind);
    }
    expect(kinds.has('boat:shoal')).toBe(true);
    expect(kinds.has('grounded')).toBe(true);
    expect(depthAt(w.env.seabed, sub.pos.x, sub.pos.y)).toBeGreaterThan(-200);
  });

  it('places the game map on the real sea', () => {
    const g = regionToGeo(REGIONS.gibraltar, 0, 10_000);
    expect(g.lat).toBeCloseTo(35.94, 1);
    expect(g.lon).toBeGreaterThan(REGIONS.gibraltar.lon);
  });
});
