import { describe, expect, it } from 'vitest';
import { distance, fireTorpedo } from '@tk/shared';
import { ArenaGame, DEFAULT_ARENA } from '../src/arena.js';
import { buildSnapshot } from '../src/snapshot.js';

describe('own torpedoes on the chart', () => {
  it('leave from the dead-reckoned own position, carrying the same reckoning error', () => {
    const game = new ArenaGame({ ...DEFAULT_ARENA, mission: 'groenland' }, 7);
    const w = game.world;
    const boat = w.ships.find((s) => s.cls === 'ssk')!;
    boat.drErr = { x: 2500, y: -1800 };
    const t = fireTorpedo(w, boat, { heading: 90, enableAfter: 1000, mode: 'passive', searchDepth: 30, speedKn: 40 });
    expect(typeof t).not.toBe('string');
    const snap = buildSnapshot(w, boat, { alerts: [], radio: [], reports: new Map() }, { sunkTons: 0, arrivedTons: 0, totalTons: 1, timeLeftS: 1 });
    const torp = snap.torpedoes[0]!;
    // Right beside the boat as the chart shows it, not offset by the reckoning error
    expect(distance(snap.own, torp)).toBeLessThan(100);
    expect(distance(boat.pos, torp)).toBeGreaterThan(2500);
  });
});
