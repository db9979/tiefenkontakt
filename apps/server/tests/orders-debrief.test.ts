import { describe, expect, it } from 'vitest';
import { stepWorld, type PlayerSlot } from '@tk/shared';
import { Recorder } from '../src/recorder.js';
import { pointsFor } from '../src/stats.js';
import { DEFAULT_SETTINGS, buildScenario } from '../src/scenario.js';

describe('FLASH orders in the debrief', () => {
  it('lists the orders and gives each side its points (also in the service points)', () => {
    const slots: PlayerSlot[] = [
      { playerId: 'u-1', callsign: 'A', team: 'west', cls: 'ffg', ready: true },
      { playerId: 'u-2', callsign: 'B', team: 'east', cls: 'ssk', ready: true },
    ];
    const w = buildScenario(slots, { ...DEFAULT_SETTINGS, timeLimitMin: 10 }, 77);
    expect(w.env.orders!.plan.length).toBeGreaterThanOrEqual(2);
    // One fixed escort order: radio silence, kept (nobody transmits)
    w.env.orders!.plan = [{ at: 5, team: 'west', kind: 'silence', dur: 60 }];
    const rec = new Recorder();
    for (let i = 0; i < 700; i++) {
      stepWorld(w);
      rec.step(w);
    }
    const d = rec.debrief(w, slots, { winner: 'east', reason: 'test' });
    expect(d.orders).toEqual([expect.objectContaining({ team: 'west', status: 'done', text: expect.stringContaining('FUNKSTILLE') })]);
    const west = d.stats.find((s) => s.team === 'west')!;
    const east = d.stats.find((s) => s.team === 'east')!;
    expect(west.orderPoints).toBe(10);
    expect(east.orderPoints).toBeUndefined();
    // Orders never decide the match: the loser still loses, with the bonus on top
    expect(west.won).toBe(false);
    expect(pointsFor(west)).toBe(pointsFor({ ...west, orderPoints: undefined }) + 10);
  });
});
