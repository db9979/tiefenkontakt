import { describe, expect, it } from 'vitest';
import { AI_LEVEL_LABEL, createShip, createWorld, installWeapons, type ServerMsg } from '@tk/shared';
import { BotCrew, type BotSkill } from '../src/bots/index.js';
import { SKILL, vary } from '../src/bots/common.js';
import { PACE } from '../src/bots/pacing.js';
import { parseClientMsg } from '../src/input.js';
import { Lobby } from '../src/lobby.js';
import { Match, type Conn } from '../src/match.js';

Match.ffBudgetMs = Infinity;

function fakeConn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m) };
}

/** One AI boat and one AI frigate far apart; a torpedo alert on the boat at t = 100 s. */
function setup(skill: BotSkill, roles = {}) {
  const u = createShip({ id: 'p_bot-e1', cls: 'ssk', name: 'E1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 60, team: 'east' });
  const f = createShip({ id: 'p_bot-w1', cls: 'ffg', name: 'W1', pos: { x: 0, y: 40_000 }, heading: 180, speedKn: 12, team: 'west' });
  const w = createWorld([u, f], 7, { layerDepth: 90, layerLoss: 8, seaState: 2, light: 1 });
  installWeapons(w);
  const crew = new BotCrew(skill, roles);
  crew.add(u.id);
  crew.add(f.id);
  w.time = 100;
  crew.step(w);
  w.events.push({ kind: 'torpedo_alert', time: w.time, shipId: u.id, bearing: 90 });
  return { w, u, f, crew, decoys: () => w.weapons!.loadouts.get(u.id)!.noisemakers };
}

describe('AI levels (KI-STUFE)', () => {
  it('NORMAL keeps the values the bots had before the levels', () => {
    expect(PACE.normal).toEqual({ classifyS: 90, legs: 2, legS: 90, settleS: 30, prosecuteS: 120, fixes: 2 });
    const k = SKILL.normal;
    expect([k.tmaQuality, k.salvo, k.aimErr, k.fireRate, k.pingDuty, k.think, k.subThink]).toEqual([52, 2, 150, 1.3, 120, 2, 2]);
    expect([k.torpReactS, k.evadeS, k.decoys, k.crossLayer, k.silentS, k.pingSe, k.wakeSide, k.vary]).toEqual([0, 90, 1, true, 300, 25, true, 0]);
    expect([k.learnPing, k.learnRadarS, k.learnLayer, k.learnSlow]).toEqual([0.5, 200, 30, 0.8]);
    expect([k.straitKn, k.straitUnder, k.harbourKn, k.harbourDeep, k.harbourFan]).toEqual([[4, 7], 30, [4, 7], 120, 2]);
  });

  it('the gates order the levels: LEICHT takes longest, VETERAN shortest', () => {
    for (const key of ['classifyS', 'legS', 'settleS', 'prosecuteS'] as const) {
      expect(PACE.leicht[key]).toBeGreaterThan(PACE.normal[key]);
      expect(PACE.schwer[key]).toBeLessThan(PACE.normal[key]);
    }
    expect(SKILL.leicht.wakeSide).toBe(false);
    expect(AI_LEVEL_LABEL.schwer).toBe('VETERAN');
  });

  it('only a VETERAN varies its legs, the same way for the same ship, seed and leg', () => {
    expect(vary('normal', 'p_bot-e1', 5, 3)).toBe(0);
    expect(vary('leicht', 'p_bot-e1', 5, 3)).toBe(0);
    const draws = Array.from({ length: 50 }, (_, n) => vary('schwer', 'p_bot-e1', 5, n));
    expect(draws.every((d) => Math.abs(d) <= SKILL.schwer.vary)).toBe(true);
    expect(new Set(draws.map((d) => d.toFixed(3))).size).toBeGreaterThan(20);
    expect(vary('schwer', 'p_bot-e1', 5, 7)).toBe(draws[7]);
  });

  it('NORMAL: decoy and evasion at once, under the layer', () => {
    const { w, u, crew, decoys } = setup('normal');
    const before = decoys();
    w.time = 101;
    crew.step(w);
    expect(decoys()).toBe(before - 1);
    expect(u.order.depth).toBeGreaterThan(90);
    expect(crew.toJSON().bots[0]!.evadeUntil).toBe(101 + SKILL.normal.evadeS);
  });

  it('LEICHT: the crew reacts late and does not think of the layer', () => {
    const { w, u, crew, decoys } = setup('leicht');
    const before = decoys();
    w.time = 101;
    crew.step(w);
    expect(decoys()).toBe(before);
    w.time = 101 + SKILL.leicht.torpReactS;
    crew.step(w);
    expect(decoys()).toBe(before - 1);
    expect(u.order.depth).toBeLessThan(90);
  });

  it('VETERAN: a second decoy as the torpedo comes through the first', () => {
    const { w, crew, decoys } = setup('schwer');
    const before = decoys();
    w.time = 101;
    crew.step(w);
    expect(decoys()).toBe(before - 1);
    w.time = 130;
    crew.step(w);
    expect(decoys()).toBe(before - 2);
  });

  it('a role can play at its own level (arena: one level against NORMAL), and it is saved', () => {
    const { u, f, crew } = setup('normal', { sub: 'leicht' });
    expect(crew.skillOf(u)).toBe('leicht');
    expect(crew.skillOf(f)).toBe('normal');
    const again = new BotCrew();
    again.restore(crew.toJSON());
    expect(again.skillOf(u)).toBe('leicht');
    expect(new BotCrew('normal').toJSON()).not.toHaveProperty('roles');
  });

  it('quick play carries the level into the match and its debrief; the weekly situation stays NORMAL', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'solo', team: 'east', botSkill: 'schwer' }))).toEqual({ t: 'solo', team: 'east', botSkill: 'schwer' });
    expect(parseClientMsg(JSON.stringify({ t: 'solo', team: 'east', botSkill: 'brutal' }))).toBeUndefined();
    const lobby = new Lobby();
    const p = fakeConn('p');
    lobby.connect(p);
    lobby.resume(p);
    lobby.handle(p, { t: 'solo', team: 'west', botSkill: 'leicht' });
    const m = lobby.matchOf('p')!;
    m.stop();
    expect(m.settings.botSkill).toBe('leicht');
    m.world!.time = 1e7;
    m.tick();
    const d = p.inbox.find((x) => x.t === 'debrief');
    expect(d?.t === 'debrief' ? d.d.aiLevel : undefined).toBe('leicht');
    const q = fakeConn('q');
    lobby.connect(q);
    lobby.resume(q);
    lobby.handle(q, { t: 'solo', team: 'east', weekly: true, botSkill: 'schwer' });
    const wk = lobby.matchOf('q')!;
    wk.stop();
    expect(wk.settings.botSkill).toBe('normal');
  });
});
