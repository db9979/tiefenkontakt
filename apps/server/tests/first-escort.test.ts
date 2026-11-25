import { describe, expect, it } from 'vitest';
import { bearing, distance, stepWorld, type ServerMsg, type Snapshot, type World } from '@tk/shared';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';
import { applyCommand, parseClientMsg } from '../src/input.js';
import { buildLesson, lessonResult, lessonSlot } from '../src/lessons.js';
import { FIRST_ESCORT_SUB, FIRST_ESCORT_SUB_HP } from '../src/first-escort.js';

function fakeConn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m) };
}

function lastSnap(c: { inbox: ServerMsg[] }): Snapshot | undefined {
  for (let i = c.inbox.length - 1; i >= 0; i--) {
    const m = c.inbox[i]!;
    if (m.t === 'snap') return m.s;
  }
  return undefined;
}

const LIMIT = 5400;
const build = (seed: number) => {
  const { world, passiveBots } = buildLesson('geleitfahrt', lessonSlot('geleitfahrt', 'p1', 'Neuling'), seed);
  const frigate = world.ships.find((s) => s.playerId === 'p1')!;
  const sub = world.ships.find((s) => s.id === FIRST_ESCORT_SUB)!;
  return { world, passiveBots, frigate, sub };
};
/** The frigate's contact track on the boat, if heard in the last few seconds. */
const heard = (w: World, observer: string, target: string) => {
  const book = w.books.get(observer);
  return book?.tracks().find((t) => book.targetIdOf(t.label) === target && w.time - t.lastSeen < 10);
};

describe('Erste Geleitfahrt (guided first escort)', () => {
  it('builds a frigate ahead of a small convoy and one damaged diesel boat with no captain', () => {
    const slot = lessonSlot('geleitfahrt', 'p1', 'Neuling');
    expect(slot).toMatchObject({ team: 'west', cls: 'ffg' });
    const { world, passiveBots, frigate, sub } = build(42);
    // No AI at all: the boat can't shoot or dodge
    expect(passiveBots).toEqual([]);
    const merchants = world.ships.filter((s) => s.cls === 'merchant');
    expect(merchants).toHaveLength(3);
    expect(world.convoy).toBeDefined();
    expect(world.ships.filter((s) => s.team === 'east').map((s) => s.id)).toEqual([FIRST_ESCORT_SUB]);
    expect(sub.cls).toBe('ssk');
    // Merchants astern of the frigate, the boat ahead on the bow, 8–14 km off
    for (const m of merchants) expect(m.pos.x).toBeLessThan(frigate.pos.x);
    const r = distance(frigate.pos, sub.pos);
    expect(r).toBeGreaterThan(8000);
    expect(r).toBeLessThan(14_000);
    const b = bearing(frigate.pos, sub.pos);
    expect(b > 0 && b < 90).toBe(true);
    // Starts too fast for the towed array: the first step is to slow down
    expect(frigate.order.speedKn).toBeGreaterThan(14);
    expect(frigate.towedLength).toBe(0);
    // One lightweight torpedo (55) sinks it
    expect(sub.hp).toBeLessThanOrEqual(55);
    expect(world.env.seaState).toBeLessThanOrEqual(2);
  });

  it('succeeds once the boat is sunk or hit; otherwise ends at the time limit', () => {
    const { world, sub } = build(7);
    expect(lessonResult(world, 'geleitfahrt', LIMIT)).toBeUndefined();
    sub.hp = FIRST_ESCORT_SUB_HP - 15;
    expect(lessonResult(world, 'geleitfahrt', LIMIT)).toMatchObject({ winner: 'west', reason: expect.stringContaining('geschafft') });
    sub.hp = FIRST_ESCORT_SUB_HP;
    sub.alive = false;
    expect(lessonResult(world, 'geleitfahrt', LIMIT)?.reason).toBe('Lektion geschafft: U-Boot versenkt');
    const { world: w2 } = build(8);
    w2.time = LIMIT;
    expect(lessonResult(w2, 'geleitfahrt', LIMIT)?.reason).toBe('Lektion beendet');
  });

  it('is solvable as the steps teach it: towed array hears the boat, an LFM ping ranges it, one rocket sinks it', () => {
    for (const seed of [1, 2, 3]) {
      const { world: w, frigate, sub } = build(seed);
      applyCommand(w, frigate, { t: 'order', speedKn: 12 });
      applyCommand(w, frigate, { t: 'towed', length: 900 });
      let heardAt: number | undefined;
      let fix: { bearing: number; range: number } | undefined;
      let result: ReturnType<typeof lessonResult>;
      for (let i = 0; i < 10 * 60 * 30 && !result; i++) {
        stepWorld(w);
        if (w.time > 300 && (w.air?.buoys.length ?? 0) === 0 && !w.air?.helos?.[frigate.id]?.queue.length) {
          expect(applyCommand(w, frigate, { t: 'buoy', bearing: 90, range: 4000, deep: true })).toBeUndefined();
        }
        if (heardAt === undefined && heard(w, frigate.id, sub.id)?.sensors.includes('towed')) {
          heardAt = w.time;
          applyCommand(w, frigate, { t: 'pulse', pulse: 'lfm' });
          applyCommand(w, frigate, { t: 'toggle', what: 'active', on: true });
        }
        const echo = !fix && w.lastDetections.find((d) => d.observerId === frigate.id && d.targetId === sub.id && d.sensor === 'active' && d.range);
        if (echo) {
          fix = { bearing: echo.bearing, range: echo.range! };
          applyCommand(w, frigate, { t: 'toggle', what: 'active', on: false });
          expect(applyCommand(w, frigate, { t: 'rocket', ...fix })).toBeUndefined();
        }
        result = lessonResult(w, 'geleitfahrt', LIMIT);
      }
      // Heard on the towed array within ten minutes (array out after ~4), ranged and sunk within 20
      expect(heardAt).toBeDefined();
      expect(heardAt!).toBeLessThan(600);
      expect(fix).toBeDefined();
      expect(w.air?.buoys.length).toBeGreaterThan(0);
      expect(result?.reason).toBe('Lektion geschafft: U-Boot versenkt');
      expect(w.time).toBeLessThan(1200);
      // Nothing ever shot at the frigate or the merchants
      expect(w.events.some((e) => e.kind === 'weapon' && e.sourceId === sub.id)).toBe(false);
      expect(w.ships.filter((s) => s.team === 'west').every((s) => s.alive)).toBe(true);
    }
  });

  it('starts from the lobby as a private single-player lesson on a frigate', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'training', lesson: 'geleitfahrt' }))).toEqual({ t: 'training', lesson: 'geleitfahrt' });
    const lobby = new Lobby();
    const p = fakeConn('n1');
    lobby.connect(p);
    lobby.resume(p);
    lobby.handle(p, { t: 'training', lesson: 'geleitfahrt' });
    const m = lobby.matchOf('n1')!;
    m.stop();
    expect(m.state).toBe('running');
    expect(m.slots).toHaveLength(1);
    for (let i = 0; i < 50 && !lastSnap(p); i++) m.tick();
    const s = lastSnap(p)!;
    expect(s.lesson).toBe('geleitfahrt');
    expect(s.own.cls).toBe('ffg');
    expect(s.air?.stock).toBeGreaterThan(0);
  });
});
