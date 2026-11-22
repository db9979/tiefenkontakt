import { describe, expect, it } from 'vitest';
import { bearing, distance, type ServerMsg, type Snapshot } from '@tk/shared';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';
import { parseClientMsg } from '../src/input.js';
import { buildLesson, lessonResult, lessonSlot } from '../src/lessons.js';
import { EVADE_DEPTH, FIRST_PATROL_TARGET } from '../src/first-patrol.js';

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

describe('Erste Feindfahrt (guided first patrol)', () => {
  it('builds a calm duel against one freighter crossing ahead of the boat', () => {
    const slot = lessonSlot('feindfahrt', 'p1', 'Neuling');
    expect(slot).toMatchObject({ team: 'east', cls: 'ssk' });
    const { world, passiveBots } = buildLesson('feindfahrt', slot, 42);
    expect(passiveBots).toEqual([]);
    const boat = world.ships.find((s) => s.playerId === 'p1')!;
    const others = world.ships.filter((s) => s !== boat);
    // Only the target: no escorts, no other submarines
    expect(others.map((s) => s.id)).toEqual([FIRST_PATROL_TARGET]);
    const target = others[0]!;
    expect(target.cls).toBe('merchant');
    expect(target.order.speedKn).toBeLessThanOrEqual(12);
    // Starts shallow and fast so the first steps (depth, speed) have something to do
    expect(boat.depth).toBeLessThan(50);
    expect(boat.order.speedKn).toBeGreaterThan(5);
    // Target 8–14 km off, forward of the beam, crossing the bow (its track passes ahead of the boat)
    const r = distance(boat.pos, target.pos);
    expect(r).toBeGreaterThan(8000);
    expect(r).toBeLessThan(14_000);
    const b = bearing(boat.pos, target.pos);
    expect(b > 270 || b < 90).toBe(true);
    expect(target.pos.y).toBeGreaterThan(boat.pos.y);
    expect(world.env.seaState).toBeLessThanOrEqual(2);
    // One heavyweight (80) is enough: the lesson plans a single shot
    expect(target.hp).toBeLessThanOrEqual(80);
  });

  it('succeeds only once the target is sunk and the boat has gone deep', () => {
    const slot = lessonSlot('feindfahrt', 'p1', 'Neuling');
    const { world } = buildLesson('feindfahrt', slot, 7);
    const boat = world.ships.find((s) => s.playerId === 'p1')!;
    const limit = 5400;
    expect(lessonResult(world, 'feindfahrt', limit)).toBeUndefined();
    world.ships.find((s) => s.id === FIRST_PATROL_TARGET)!.alive = false;
    boat.depth = 18;
    expect(lessonResult(world, 'feindfahrt', limit)).toBeUndefined();
    boat.depth = EVADE_DEPTH + 5;
    expect(lessonResult(world, 'feindfahrt', limit)?.reason).toContain('geschafft');
  });

  it('starts from the lobby as a private single-player lesson; the target is heard on sonar', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'training', lesson: 'feindfahrt' }))).toEqual({ t: 'training', lesson: 'feindfahrt' });
    const lobby = new Lobby();
    const p = fakeConn('n1');
    const other = fakeConn('o1');
    for (const c of [p, other]) {
      lobby.connect(c);
      lobby.resume(c);
    }
    lobby.handle(p, { t: 'training', lesson: 'feindfahrt' });
    const m = lobby.matchOf('n1')!;
    m.stop();
    expect(m.state).toBe('running');
    expect(m.slots).toHaveLength(1);
    expect(other.inbox.filter((x) => x.t === 'lobby').every((x) => x.t === 'lobby' && x.matches.length === 0)).toBe(true);
    for (let i = 0; i < 400 && !lastSnap(p)?.contacts.length; i++) m.tick();
    const s = lastSnap(p)!;
    expect(s.lesson).toBe('feindfahrt');
    expect(s.own.cls).toBe('ssk');
    expect(s.contacts.length).toBeGreaterThan(0);
  });
});
