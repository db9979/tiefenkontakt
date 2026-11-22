import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Debrief, PlayerStats } from '@tk/shared';
import { Ratings } from '../src/rating.js';

const st = (playerId: string, team: 'west' | 'east', won: boolean): PlayerStats => ({
  playerId, callsign: playerId, team, cls: team === 'west' ? 'ffg' : 'ssk', survived: true, shots: 0, rockets: 0, buoys: 0, kills: 0, tonnageSunk: 0, distanceNm: 0, won,
});
const match = (stats: PlayerStats[]): Debrief => ({ ships: [], frames: [], torpedoes: [], events: [], stats, winner: stats.find((s) => s.won)?.team ?? 'west', reason: '', duration: 0 });

describe('rating', () => {
  it('the winner gains what the loser loses between equals; guests are not rated', () => {
    const r = new Ratings(new DatabaseSync(':memory:'));
    const d = r.update(match([st('u-1', 'west', true), st('u-2', 'east', false), st('g-abc', 'east', false)]));
    expect(d['u-1']).toBe(20);
    expect(d['u-2']).toBe(-20);
    expect(d['g-abc']).toBeUndefined();
    expect(r.get(1)).toBe(1020);
    expect(r.get(2)).toBe(980);
  });

  it('beating a stronger team pays more than beating a weaker one', () => {
    const r = new Ratings(new DatabaseSync(':memory:'));
    for (let i = 0; i < 10; i++) r.update(match([st('u-1', 'west', true), st('u-2', 'east', false)]));
    const upset = r.update(match([st('u-2', 'east', true), st('u-1', 'west', false)]));
    const expected = r.update(match([st('u-1', 'west', true), st('u-2', 'east', false)]));
    expect(upset['u-2']!).toBeGreaterThan(expected['u-1']!);
  });
});
