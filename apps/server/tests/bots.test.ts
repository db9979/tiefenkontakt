import { describe, expect, it } from 'vitest';
import { stepWorld, type PlayerSlot } from '@tk/shared';
import { BotCrew } from '../src/bots/index.js';
import { crossFix } from '../src/bots/frigate.js';
import { evaluate } from '../src/rules.js';
import { DEFAULT_SETTINGS, buildScenario, simTimeLimit } from '../src/scenario.js';

describe('AI captains', () => {
  it('cross-fix intersects two bearing lines and rejects poor geometry', () => {
    const fix = crossFix({ x: 0, y: 0 }, 45, { x: 10_000, y: 0 }, 315)!;
    expect(fix.x).toBeCloseTo(5000, 0);
    expect(fix.y).toBeCloseTo(5000, 0);
    expect(crossFix({ x: 0, y: 0 }, 0, { x: 100, y: 0 }, 2)).toBeUndefined();
  });

  it('a bot-vs-bot match: subs report and shoot, escorts never fire near own ships', () => {
    const slots: PlayerSlot[] = [
      { playerId: 'bot-w1', callsign: 'W1', team: 'west', cls: 'ffg', ready: true, bot: true },
      { playerId: 'bot-e1', callsign: 'E1', team: 'east', cls: 'ssk', ready: true, bot: true },
      { playerId: 'bot-e2', callsign: 'E2', team: 'east', cls: 'ssn', ready: true, bot: true },
    ];
    const settings = { ...DEFAULT_SETTINGS, timeLimitMin: 15 };
    const w = buildScenario(slots, settings, 1001);
    const crew = new BotCrew('normal');
    for (const s of slots) crew.add(`p_${s.playerId}`);
    let rocketsNearFriends = 0;
    const seen = new Set<object>();
    while (!evaluate(w, simTimeLimit(settings))) {
      stepWorld(w);
      crew.step(w);
      for (const p of w.weapons!.pending) {
        if (p.kind !== 'rocket' || seen.has(p)) continue;
        seen.add(p);
        if (w.ships.some((s) => s.team === 'west' && s.alive && Math.hypot(s.pos.x - p.pos.x, s.pos.y - p.pos.y) < 2500)) rocketsNearFriends++;
      }
    }
    expect(w.events.some((e) => e.kind === 'transmission')).toBe(true);
    expect(w.events.some((e) => e.kind === 'weapon' && e.what === 'torpedo')).toBe(true);
    expect(rocketsNearFriends).toBe(0);
  });
});
