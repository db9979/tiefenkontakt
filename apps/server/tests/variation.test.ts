import { describe, expect, it } from 'vitest';
import type { PlayerSlot, ServerMsg } from '@tk/shared';
import { parseClientMsg } from '../src/input.js';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';
import { DEFAULT_SETTINGS, buildScenario, type MissionId, type ScenarioSettings } from '../src/scenario.js';
import { resolveLobby } from '../src/variation.js';

const slots: PlayerSlot[] = [
  { playerId: 'w1', callsign: 'W1', team: 'west', cls: 'ffg', ready: true },
  { playerId: 'e1', callsign: 'E1', team: 'east', cls: 'ssk', ready: true },
  { playerId: 'e2', callsign: 'E2', team: 'east', cls: 'ssn', ready: true },
];

function layout(s: Partial<ScenarioSettings>, seed: number) {
  const w = buildScenario(slots, { ...DEFAULT_SETTINGS, ...s }, seed);
  return {
    ships: w.ships.filter((x) => !x.id.startsWith('n')).map((x) => [x.id, Math.round(x.pos.x), Math.round(x.pos.y), Math.round(x.speed * 100)]),
    route: w.convoy?.waypoints.map((p) => [Math.round(p.x), Math.round(p.y)]),
  };
}

describe('mission variation', () => {
  it('the same seed gives the same situation, another seed a different one', () => {
    expect(layout({}, 4711)).toEqual(layout({}, 4711));
    expect(layout({}, 4711)).not.toEqual(layout({}, 4712));
  });

  it('"aus" keeps the designed layout whatever the seed', () => {
    const a = layout({ variation: 'aus' }, 1);
    expect(layout({ variation: 'aus' }, 999)).toEqual(a);
    expect(a.route).toEqual([[0, a.route![0]![1]], [0, a.route![1]![1]]]);
  });

  it('bends the route only in open water and keeps the boats ahead of the convoy', () => {
    const bent = [1, 2, 3, 4, 5].some((seed) => layout({ variation: 'stark' }, seed).route!.some(([x]) => x !== 0));
    expect(bent).toBe(true);
    for (const mission of ['fjord', 'meerenge', 'duell'] as MissionId[]) {
      for (const seed of [1, 2, 3]) expect(layout({ mission, variation: 'stark' }, seed).route?.every(([x]) => x === 0) ?? true).toBe(true);
    }
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = buildScenario(slots, { ...DEFAULT_SETTINGS, variation: 'stark' }, seed);
      for (const sub of w.ships.filter((x) => x.team === 'east')) expect(sub.pos.y).toBeGreaterThan(5000);
    }
  });

  it('rolls "zufall" for time of day and weather once, the same for the same seed', () => {
    const s = { ...DEFAULT_SETTINGS, timeOfDay: 'zufall' as const, weather: 'zufall' as const };
    const seen = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const r = resolveLobby(s, seed);
      expect(r).toEqual(resolveLobby(s, seed));
      expect(['tag', 'daemmerung', 'nacht']).toContain(r.timeOfDay);
      expect(['wechselhaft', 'stabil']).toContain(r.weather);
      expect(Math.abs(r.seaState - s.seaState)).toBeLessThanOrEqual(1);
      expect(r.asSet?.timeOfDay).toBe('zufall');
      seen.add(r.timeOfDay as string);
    }
    expect(seen.size).toBe(3);
    expect(resolveLobby({ ...DEFAULT_SETTINGS, variation: 'aus' }, 7).seaState).toBe(DEFAULT_SETTINGS.seaState);
  });
});

function fakeConn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m) };
}

describe('rematch in the same situation', () => {
  it('accepts a setup in create_match and rejects a bad one', () => {
    const setup = { seed: 123, settings: { mission: 'schelf', timeOfDay: 'zufall', weather: 'stabil', seaState: 4, timeLimitMin: 30, merchants: 6, fillBots: true, botSkill: 'normal', variation: 'stark' } };
    expect(parseClientMsg(JSON.stringify({ t: 'create_match', name: 'X', setup }))).toBeTruthy();
    expect(parseClientMsg(JSON.stringify({ t: 'create_match', name: 'X', setup: { seed: -1, settings: setup.settings } }))).toBeFalsy();
  });

  it('rebuilds the same world from the debrief setup; changing a setting unfixes it', () => {
    const lobby = new Lobby();
    const a = fakeConn('a1');
    lobby.connect(a);
    lobby.resume(a);
    lobby.handle(a, { t: 'create_match', name: 'Erste' });
    const m1 = lobby.matchOf('a1')!;
    lobby.handle(a, { t: 'settings', variation: 'stark', timeOfDay: 'zufall' });
    lobby.handle(a, { t: 'ready', ready: true });
    m1.stop();
    const setup = (m1 as unknown as { setup(): ReturnType<typeof Object> }).setup() as import('@tk/shared').MatchSetup;
    expect(setup.settings.timeOfDay).toBe('zufall');
    const pos1 = m1.world!.ships.map((s) => [s.id.replace(/^p_/, ''), Math.round(s.pos.x), Math.round(s.pos.y)]);

    lobby.handle(a, { t: 'create_match', name: 'Revanche', setup });
    const m2 = lobby.matchOf('a1')!;
    expect(m2.id).not.toBe(m1.id);
    const lob = m2.lobby();
    expect(lob.settings.lage).toBe(setup.seed);
    expect(lob.settings.variation).toBe('stark');
    lobby.handle(a, { t: 'ready', ready: true });
    m2.stop();
    expect(m2.world!.ships.map((s) => [s.id.replace(/^p_/, ''), Math.round(s.pos.x), Math.round(s.pos.y)])).toEqual(pos1);
    expect(m2.settings.timeOfDay).toBe(m1.settings.timeOfDay);

    lobby.handle(a, { t: 'create_match', name: 'Revanche 2', setup });
    const m3 = lobby.matchOf('a1')!;
    lobby.handle(a, { t: 'settings', seaState: 2 });
    expect(m3.lobby().settings.lage).toBeUndefined();
  });
});
