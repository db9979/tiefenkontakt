import { describe, expect, it } from 'vitest';
import { distance, fireTorpedo, interceptHeading, stepWorld } from '@tk/shared';
import { buildFirstPatrol, FIRST_PATROL_TARGET } from '../src/first-patrol.js';

/**
 * "Erste Feindfahrt" can miss: with the range of the solution too long, the seeker distance
 * („Lösung übernehmen“: 70 % of the range) lies behind the target. The tutorial's advice for
 * the second shot (seeker on at half that distance) must then hit.
 */
function shot(rangeFactor: number, seekerFactor: number): 'hit' | 'miss' {
  const w = buildFirstPatrol({ playerId: 'p1', callsign: 'x', team: 'east', cls: 'ssk', ready: true }, 3);
  const own = w.ships.find((s) => s.playerId === 'p1')!;
  const tgt = w.ships.find((s) => s.id === FIRST_PATROL_TARGET)!;
  Object.assign(own.order, { depth: 15, speedKn: 4, heading: 210 });
  own.depth = 15;
  while (w.time < 400) stepWorld(w);
  own.pos = { x: -600, y: 300 };
  const b = Math.atan2(tgt.pos.x - own.pos.x, tgt.pos.y - own.pos.y);
  const r = distance(own.pos, tgt.pos) * rangeFactor;
  const sol = { t0: w.time, x0: own.pos.x + Math.sin(b) * r, y0: own.pos.y + Math.cos(b) * r, course: tgt.heading, speedKn: 10 };
  const heading = interceptHeading(own.pos, 40, sol, w.time)!;
  const t = fireTorpedo(w, own, { heading, enableAfter: Math.max(500, r * 0.7 * seekerFactor), mode: 'passive', searchDepth: 15, speedKn: 40 });
  if (typeof t === 'string') throw new Error(t);
  for (const until = w.time + 1300; w.time < until; ) {
    stepWorld(w);
    if (tgt.hp < 70 || !tgt.alive) return 'hit';
    if (!w.weapons!.torpedoes.some((x) => x.id === t.id)) return 'miss';
  }
  return 'miss';
}

describe('Erste Feindfahrt: a missed torpedo and the second shot', () => {
  it('hits with a good solution, misses with the range 25 % too long, hits again with the seeker on earlier', () => {
    expect(shot(1, 1)).toBe('hit');
    expect(shot(1.25, 1)).toBe('miss');
    expect(shot(1.25, 0.5)).toBe('hit');
  });
});
