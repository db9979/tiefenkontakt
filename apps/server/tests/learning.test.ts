import { describe, expect, it } from 'vitest';
import type { Habits, PlayerSlot } from '@tk/shared';
import { learnFrom } from '../src/learning.js';

const slot = (playerId: string, team: 'west' | 'east', bot = false): PlayerSlot => ({ playerId, callsign: playerId, team, cls: team === 'east' ? 'ssk' : 'ffg', ready: true, bot });
const h = (o: Partial<Habits>): Habits => ({ pd: 0, above: 0, fast: 0, ping: 0, ...o });

describe('the enemy learns', () => {
  it('adapts to a habit seen in 3 of the last 5 matches', () => {
    const recent = (uid: number) => (uid === 7 ? [h({ pd: 0.4 }), h({ pd: 0.5 }), h({}), h({ pd: 0.3 }), h({})] : []);
    const l = learnFrom([slot('u-7', 'east'), slot('bot-w1', 'west', true)], recent);
    expect(l.adapt.west?.pd).toBe(true);
    expect(l.notes[0]).toMatch(/Sehrohrtiefe/);
  });
  it('ignores guests, bots and occasional habits', () => {
    const recent = () => [h({ ping: 0.5 }), h({ ping: 0.5 }), h({}), h({}), h({})];
    expect(learnFrom([slot('g-123', 'west'), slot('u-3', 'west')], recent).adapt.east).toBeUndefined();
  });
});
