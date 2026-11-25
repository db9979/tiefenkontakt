import { describe, expect, it } from 'vitest';
import { FAST_FORWARD_SCALE, type ServerMsg, type Ship, type Snapshot, type World } from '@tk/shared';
import { FastForward } from '../src/fast-forward.js';
import { parseClientMsg } from '../src/input.js';
import { Lobby } from '../src/lobby.js';
import { Match, type Conn } from '../src/match.js';

// Steps are checked one for one: no wall-clock budget under a loaded test run
Match.ffBudgetMs = Infinity;

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

const errors = (c: { inbox: ServerMsg[] }) => c.inbox.filter((m) => m.t === 'error').map((m) => (m as { msg: string }).msg);

/** Two escorts against the AI pack: a multiplayer game on one side. */
function twoEscorts() {
  const lobby = new Lobby();
  const a = fakeConn('a');
  const b = fakeConn('b');
  for (const c of [a, b]) {
    lobby.connect(c);
    lobby.resume(c);
  }
  lobby.handle(a, { t: 'create_match', name: 'T' });
  const m = lobby.matchOf('a')!;
  lobby.handle(b, { t: 'join', matchId: m.id, team: 'west' });
  lobby.handle(a, { t: 'ready', ready: true });
  lobby.handle(b, { t: 'ready', ready: true });
  m.stop();
  return { lobby, m, a, b };
}

describe('Zeitraffer bis Ereignis', () => {
  it('validates the new messages', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'fastforward', on: true }))).toEqual({ t: 'fastforward', on: true });
    expect(parseClientMsg(JSON.stringify({ t: 'fastforward', on: 'yes' }))).toBeUndefined();
    expect(parseClientMsg(JSON.stringify({ t: 'debrief_now' }))).toEqual({ t: 'debrief_now' });
  });

  it('runs a solo game at 6× with one button and stops on a new contact', () => {
    const lobby = new Lobby();
    const p = fakeConn('p');
    lobby.connect(p);
    lobby.resume(p);
    lobby.handle(p, { t: 'solo', team: 'east' });
    const m = lobby.matchOf('p')!;
    m.stop();
    m.tick();
    lobby.handle(p, { t: 'fastforward', on: true });
    expect(m.ff.on).toBe(true);
    const t0 = m.world!.time;
    m.tick();
    expect(m.world!.time - t0).toBeCloseTo(FAST_FORWARD_SCALE * 0.1, 5);
    expect(lastSnap(p)?.timeScale).toBe(FAST_FORWARD_SCALE);
    expect(lastSnap(p)?.ff?.on).toBe(true);
    // Something new turns up sooner or later (convoy, escort, traffic): the sim drops back to 1×
    for (let i = 0; i < 3000 && m.ff.on; i++) m.tick();
    expect(m.ff.on).toBe(false);
    m.tick();
    expect(lastSnap(p)?.timeScale).toBe(1);
    expect(lastSnap(p)?.ff?.stopped).toBeTruthy();
  });

  it('needs every human afloat in multiplayer and stops on an alarm', () => {
    const { lobby, m, a, b } = twoEscorts();
    // Nobody holds a hostile contact from the last minute at the start
    m.tick();
    lobby.handle(a, { t: 'fastforward', on: true });
    expect(m.ff.on).toBe(false);
    expect(m.ff.view('a')).toMatchObject({ votes: 1, need: 2, mine: true });
    lobby.handle(b, { t: 'fastforward', on: true });
    expect(m.ff.on).toBe(true);
    m.ff.alert('b', 'torpedo', m.world!.time);
    expect(m.ff.on).toBe(false);
    expect(m.ff.view('a')).toMatchObject({ votes: 0, stopped: 'Torpedoalarm' });
    expect(errors(a)).toEqual([]);
  });

  it('refuses a multiplayer vote while someone holds a fresh hostile contact', () => {
    // A stand-in world: escort A holds the boat x, last heard 30 s ago; B has nothing
    const ships = [
      { id: 'p_a', name: 'Alpha', team: 'west', alive: true },
      { id: 'p_b', name: 'Bravo', team: 'west', alive: true },
      { id: 'x', name: 'U', team: 'east', alive: true },
    ] as unknown as Ship[];
    const book = (rows: [string, number][]) => ({ entries: () => rows.map(([id, lastSeen]) => [id, { lastSeen }]) });
    const w = { time: 100, ships, books: new Map([['p_a', book([['x', 70]])], ['p_b', book([])]]) } as unknown as World;
    const ff = new FastForward({ voters: () => ['a', 'b'], shipOf: (id) => ships.find((s) => s.id === `p_${id}`), world: () => w });
    expect(ff.request('b', true)).toMatch(/Alpha hat frischen Feindkontakt/);
    expect(ff.view('b').blocked).toMatch(/FEINDKONTAKT/);
    // A minute later the contact is stale: both votes start it
    w.time = 140;
    expect(ff.request('a', true)).toBeUndefined();
    expect(ff.request('b', true)).toBeUndefined();
    expect(ff.on).toBe(true);
    // A new contact on B's book stops it
    w.books.set('p_b', book([['x', 140]]) as never);
    ff.check();
    expect(ff.on).toBe(false);
    expect(ff.view('a').stopped).toBe('Neuer Kontakt');
  });

  it('stops when a tutorial step is done', () => {
    const lobby = new Lobby();
    const p = fakeConn('p');
    lobby.connect(p);
    lobby.resume(p);
    lobby.handle(p, { t: 'training', lesson: 'tma' });
    const m = lobby.matchOf('p')!;
    m.stop();
    m.tick();
    lobby.handle(p, { t: 'fastforward', on: true });
    expect(m.ff.on).toBe(true);
    lobby.handle(p, { t: 'lesson_step', step: 2 });
    expect(m.ff.on).toBe(false);
  });
});

describe('sunk player', () => {
  it('goes aboard a living teammate as crew and keeps the own record', () => {
    const { lobby, m, a, b } = twoEscorts();
    m.tick();
    lobby.handle(a, { t: 'crew', captainId: 'b' });
    expect(errors(a).at(-1)).toMatch(/Untergang/);
    const own = m.shipOf('a')!;
    own.alive = false;
    m.tick();
    expect(lastSnap(a)?.boardable).toEqual([{ captainId: 'b', callsign: 'b', ship: m.shipOf('b')!.name }]);
    lobby.handle(a, { t: 'crew', captainId: 'b' });
    expect(m.shipOf('a')?.id).toBe(m.shipOf('b')?.id);
    m.tick();
    expect(lastSnap(a)?.own.name).toBe(m.shipOf('b')!.name);
    expect(lastSnap(b)?.crew.sort()).toEqual(['a', 'b']);
    const d = m.recorder.debrief(m.world!, m.slots, { winner: 'east', reason: 'x' });
    expect(d.stats.find((s) => s.playerId === 'a')?.survived).toBe(false);
  });

  it('gets a provisional debrief, cut off like the spectators', () => {
    const { lobby, m, a } = twoEscorts();
    for (let i = 0; i < 50; i++) m.tick();
    lobby.handle(a, { t: 'debrief_now' });
    expect(errors(a).at(-1)).toMatch(/Untergang/);
    m.shipOf('a')!.alive = false;
    lobby.handle(a, { t: 'debrief_now' });
    const d = a.inbox.filter((x) => x.t === 'debrief').pop();
    expect(d && d.t === 'debrief' && d.d.provisional).toBe(true);
    expect(d && d.t === 'debrief' && d.d.stats.map((s) => s.playerId)).toEqual(['a']);
  });
});
