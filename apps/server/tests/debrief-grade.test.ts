import { describe, expect, it } from 'vitest';
import { isConvoyShip } from '@tk/shared';
import { DEFAULT_SETTINGS, buildScenario, fixSeaTime, simTimeLimit } from '../src/scenario.js';
import { evaluate } from '../src/rules.js';
import { ArenaGame, DEFAULT_ARENA } from '../src/arena.js';

const slots = [
  { playerId: 'w', callsign: 'W', team: 'west' as const, cls: 'ffg' as const, ready: true },
  { playerId: 'e', callsign: 'E', team: 'east' as const, cls: 'ssk' as const, ready: true },
];

function atTimeLimit(sunk: number) {
  const s = fixSeaTime({ ...DEFAULT_SETTINGS, variation: 'aus' });
  const w = buildScenario(slots, s, 5);
  const merchants = w.ships.filter(isConvoyShip);
  for (const m of merchants.slice(0, sunk)) m.alive = false;
  w.time = simTimeLimit(s);
  return evaluate(w, simTimeLimit(s), 'groenland');
}

describe('result band', () => {
  it('grades a time-out by the margin to the 30 % mark, without changing the winner', () => {
    // 8 merchants: the mark is 2.4 ships
    expect(atTimeLimit(0)).toMatchObject({ winner: 'west', band: 'klar' });
    expect(atTimeLimit(1)).toMatchObject({ winner: 'west', band: 'knapp' });
    expect(atTimeLimit(2)).toMatchObject({ winner: 'west', band: 'remis' });
    expect(atTimeLimit(3)).toMatchObject({ winner: 'east', band: 'remis' });
  });

  it('calls an early convoy win close when the pack got near its mark', () => {
    const s = fixSeaTime({ ...DEFAULT_SETTINGS, variation: 'aus' });
    const w = buildScenario(slots, s, 5);
    for (const sub of w.ships.filter((x) => x.team === 'east')) sub.alive = false;
    expect(evaluate(w, simTimeLimit(s), 'groenland')).toMatchObject({ winner: 'west', band: 'klar' });
    for (const m of w.ships.filter(isConvoyShip).slice(0, 3)) m.alive = false;
    expect(evaluate(w, simTimeLimit(s), 'groenland')).toMatchObject({ winner: 'west', band: 'knapp' });
  });
});

describe('grade figures', () => {
  it('records contacts held, time undetected and the band in the debrief', () => {
    const g = new ArenaGame({ ...DEFAULT_ARENA, timeLimitMin: 15 }, 11, true);
    while (!g.step(2000));
    const d = g.debrief()!;
    expect(['klar', 'knapp', 'remis']).toContain(d.band);
    const sub = d.stats.find((s) => s.team === 'east')!;
    const escort = d.stats.find((s) => s.team === 'west')!;
    expect(sub.undetectedS).toBeGreaterThanOrEqual(0);
    expect(sub.undetectedS).toBeLessThanOrEqual(d.duration);
    expect(escort.merchantsSafe).toBeGreaterThanOrEqual(0);
    expect(escort.merchantsSafe).toBeLessThanOrEqual(1);
    expect(d.stats.some((s) => (s.held ?? 0) > 0)).toBe(true);
  });
});
