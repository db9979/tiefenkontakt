import { describe, expect, it } from 'vitest';
import { depthAt, distance } from '@tk/shared';
import { newMemory, type BotMemory } from '../src/bots/common.js';
import { planSide, screenStations, seaStations } from '../src/bots/escort-team.js';
import { ArenaGame, DEFAULT_ARENA } from '../src/arena.js';
import { HARBOUR_ANCHORAGE } from '../src/scenario.js';

describe('screen stations lie in open water (every AI level)', () => {
  it('harbour: a close-screen station on land moves to deep water at the same distance', () => {
    const g = new ArenaGame({ ...DEFAULT_ARENA, mission: 'hafen' }, 1003);
    const w = g.world;
    const es = w.ships.filter((s) => s.team === 'west' && s.id.startsWith('p_'));
    // The plain layout puts a station on land around the anchorage
    const raw = screenStations(HARBOUR_ANCHORAGE, 0, es, false);
    expect([...raw.values()].some((p) => depthAt(w.env.seabed, p.x, p.y) < 40)).toBe(true);
    const st = seaStations(w, HARBOUR_ANCHORAGE, new Map(raw));
    for (const p of st.values()) {
      expect(depthAt(w.env.seabed, p.x, p.y)).toBeGreaterThanOrEqual(40);
      expect(distance(p, HARBOUR_ANCHORAGE)).toBeGreaterThan(2000);
    }
  });

  it('NORMAL escorts in the harbour get stations in water', () => {
    const g = new ArenaGame({ ...DEFAULT_ARENA, mission: 'hafen' }, 1003);
    const w = g.world;
    const es = w.ships.filter((s) => s.team === 'west' && s.id.startsWith('p_'));
    const mems = new Map<string, BotMemory>(es.map((s) => [s.id, newMemory(s.id)]));
    for (const t of planSide(w, 'west', mems, 'normal').values()) {
      if (t.station) expect(depthAt(w.env.seabed, t.station.x, t.station.y)).toBeGreaterThanOrEqual(40);
    }
  });
});
