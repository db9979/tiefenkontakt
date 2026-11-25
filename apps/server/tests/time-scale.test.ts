import { describe, expect, it } from 'vitest';
import { SEA_TIME_FACTOR } from '@tk/shared';
import { DEFAULT_SETTINGS, buildScenario, fixSeaTime, geometryScale, routeLength, simTimeLimit, startGeometry } from '../src/scenario.js';
import { Match } from '../src/match.js';

describe('time compression', () => {
  it('reads the lobby limit as real minutes: the sea time is limit × scale', () => {
    const at = (timeScale: number) => ({ ...DEFAULT_SETTINGS, timeScale });
    expect(DEFAULT_SETTINGS.timeScale).toBe(1);
    for (const n of [1, 2, 3]) {
      expect(simTimeLimit(at(n))).toBe(DEFAULT_SETTINGS.timeLimitMin * 60 * n);
      expect(routeLength(at(n))).toBeCloseTo(routeLength(at(1)) * n);
    }
  });

  it('keeps the sea time fixed once the match runs (fast-forward, sandbox speed)', () => {
    const s = fixSeaTime({ ...DEFAULT_SETTINGS, timeScale: 2 });
    expect(simTimeLimit({ ...s, timeScale: 6 })).toBe(40 * 60 * 2);
  });

  it('keeps the designed missions at 3× and shrinks the approach at 1×', () => {
    expect(geometryScale({ ...DEFAULT_SETTINGS, timeScale: 3 })).toBe(1);
    expect(geometryScale(DEFAULT_SETTINGS)).toBeCloseTo(1 / 3);
    const long = startGeometry('hafen', 1);
    const short = startGeometry('hafen', 1 / 3);
    expect(long.harbourSubY).toBe(21_000);
    expect(short.harbourSubY).toBeLessThan(long.harbourSubY);
    expect(startGeometry('meerenge', 1).straitExitY).toBe(16_500);
    expect(startGeometry('meerenge', 1 / 3).straitExitY).toBeLessThan(16_500);
  });

  it('puts the wolfpack within reach of the convoy at 1×', () => {
    const slots = [
      { playerId: 'w', callsign: 'W', team: 'west' as const, cls: 'ffg' as const, ready: true },
      { playerId: 'e', callsign: 'E', team: 'east' as const, cls: 'ssk' as const, ready: true },
    ];
    const w = buildScenario(slots, fixSeaTime({ ...DEFAULT_SETTINGS, variation: 'aus' }), 3);
    const sub = w.ships.find((s) => s.id === 'p_e')!;
    // The convoy (from the origin at 9 kn) is within about 10 km of the boat from the start
    expect(Math.hypot(sub.pos.x, sub.pos.y)).toBeLessThan(10_000);
  });

  it('loads matches saved under the old rule with their old sea time', () => {
    const m = new Match('a', 'b', 1);
    m.slots = [{ playerId: 'e', callsign: 'E', team: 'east', cls: 'ssk', ready: true }];
    m.settings = { ...DEFAULT_SETTINGS, fillBots: false };
    m.start();
    const saved = m.save()!;
    m.stop();
    const { seaMin: _s, ...old } = saved.settings;
    const r = Match.restore({ ...saved, settings: old });
    r.stop();
    expect(simTimeLimit(r.settings)).toBe(40 * 60 * SEA_TIME_FACTOR);
    expect(simTimeLimit(m.settings)).toBe(40 * 60);
  });
});
