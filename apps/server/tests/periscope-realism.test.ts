import { describe, expect, it } from 'vitest';
import { ContactBook, bearing, distance, type ServerMsg, type Snapshot } from '@tk/shared';
import { ArenaGame, DEFAULT_ARENA } from '../src/arena.js';
import { parseClientMsg } from '../src/input.js';
import { Lobby } from '../src/lobby.js';
import { Match, type Conn } from '../src/match.js';
import { buildSnapshot } from '../src/snapshot.js';

const score = { sunkTons: 0, arrivedTons: 0, totalTons: 1, timeLeftS: 1 };
const extras = () => ({ alerts: [], radio: [], reports: new Map() });

/** A boat whose periscope has held the nearest merchant in its 6× optic for `secs` seconds. */
function lookedAt(secs: number) {
  const game = new ArenaGame({ ...DEFAULT_ARENA, mission: 'groenland' }, 7);
  const w = game.world;
  const boat = w.ships.find((s) => s.cls === 'ssk')!;
  const tgt = w.ships.filter((s) => s.cls === 'merchant').sort((a, b) => distance(boat.pos, a.pos) - distance(boat.pos, b.pos))[0]!;
  const book = w.books.get(boat.id) ?? new ContactBook();
  w.books.set(boat.id, book);
  const r = distance(boat.pos, tgt.pos);
  let label = '';
  for (let t = 0; t <= secs; t++) {
    label = book.ingest({
      observerId: boat.id, targetId: tgt.id, sensor: 'periscope', time: w.time - secs + t, bearing: bearing(boat.pos, tgt.pos),
      range: r, se: 20, classified: tgt.cls, mag: 6, subtense: (27 / r) * 1000,
    }).label;
  }
  return { w, boat, tgt, label };
}

function contact(s: Snapshot, label: string) {
  return s.contacts.find((c) => c.label === label)!;
}

describe('periscope by realism mode', () => {
  it('Profi: no class and no periscope range reach the client, only the stadimeter angle and the hull to draw', () => {
    const { w, boat, label } = lookedAt(15);
    const s = buildSnapshot(w, boat, extras(), score, undefined, undefined, 'profi');
    const c = contact(s, label);
    expect(c.classified).toBeUndefined();
    expect(c.range).toBeUndefined();
    expect(c.rangeAt).toBeUndefined();
    expect(c.history.some((h) => h.r !== undefined)).toBe(false);
    expect(c.subtense).toBeGreaterThan(0);
    expect(c.look).toBe('merchant');
    // Nothing anywhere in the contact names the class
    expect(JSON.stringify({ ...c, look: undefined })).not.toContain('merchant');
  });

  it('Einsteiger: the range at once, the class after 10 s in the 6× optic', () => {
    const early = lookedAt(5);
    const c1 = contact(buildSnapshot(early.w, early.boat, extras(), score, undefined, undefined, 'einsteiger'), early.label);
    expect(c1.range).toBeGreaterThan(0);
    expect(c1.classified).toBeUndefined();
    const late = lookedAt(12);
    const c2 = contact(buildSnapshot(late.w, late.boat, extras(), score, undefined, undefined, 'einsteiger'), late.label);
    expect(c2.classified).toBe('merchant');
    expect(c2.history.some((h) => h.sensor === 'periscope' && h.r !== undefined)).toBe(true);
  });
});

function fakeConn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m) };
}

function setup() {
  const lobby = new Lobby();
  const west = fakeConn('w1');
  const east = fakeConn('e1');
  for (const c of [west, east]) {
    lobby.connect(c);
    lobby.resume(c);
  }
  // Out of any match: stored nowhere, and no error toast
  lobby.handle(east, { t: 'realism', realism: 'profi' });
  lobby.handle(west, { t: 'create_match', name: 'Test' });
  const m = lobby.matchOf('w1')!;
  lobby.handle(east, { t: 'join', matchId: m.id, team: 'east' });
  lobby.handle(east, { t: 'pick_class', cls: 'ssk' });
  lobby.handle(west, { t: 'ready', ready: true });
  lobby.handle(east, { t: 'ready', ready: true });
  m.stop();
  return { lobby, m, west, east };
}

describe('scope and realism messages', () => {
  it('validates the optic report', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'scope', bearing: 123.4, mag: 6 }))).toEqual({ t: 'scope', bearing: 123.4, mag: 6 });
    expect(parseClientMsg(JSON.stringify({ t: 'scope', bearing: 10, mag: 3 }))).toBeUndefined();
    expect(parseClientMsg(JSON.stringify({ t: 'scope', bearing: 400, mag: 6 }))).toBeUndefined();
    expect(parseClientMsg(JSON.stringify({ t: 'realism', realism: 'profi' }))).toEqual({ t: 'realism', realism: 'profi' });
    expect(parseClientMsg(JSON.stringify({ t: 'realism', realism: 'experte' }))).toBeUndefined();
  });

  it('stores the optic on the boat and the mode per player; the frigate has no periscope', () => {
    const { lobby, m, west, east } = setup();
    expect(east.inbox.some((x) => x.t === 'error')).toBe(false);
    lobby.handle(east, { t: 'scope', bearing: 42, mag: 12 });
    lobby.handle(west, { t: 'scope', bearing: 42, mag: 12 });
    expect(m.shipOf('e1')!.scope).toEqual({ bearing: 42, mag: 12 });
    expect(m.shipOf('w1')!.scope).toBeUndefined();
    lobby.handle(east, { t: 'realism', realism: 'profi' });
    expect(m.slots.find((s) => s.playerId === 'e1')!.realism).toBe('profi');
    expect(m.slots.find((s) => s.playerId === 'w1')!.realism).toBeUndefined();
    expect([...east.inbox, ...west.inbox].some((x) => x.t === 'error')).toBe(false);
  });

  it('an old save without optic and mode loads: not looking, Einsteiger, until the client reports', () => {
    const { m } = setup();
    for (let i = 0; i < 5; i++) m.tick();
    const saved = JSON.parse(JSON.stringify(m.save()!));
    for (const s of saved.world.ships) delete s.scope;
    for (const s of saved.slots) delete s.realism;
    const back = Match.restore(saved);
    back.stop();
    const east = fakeConn('e1');
    back.reattach(east);
    const boat = back.shipOf('e1')!;
    expect(boat.scope).toBeUndefined();
    for (let i = 0; i < 20; i++) back.tick();
    const snaps = east.inbox.filter((x) => x.t === 'snap');
    expect(snaps.length).toBeGreaterThan(0);
    back.command('e1', { t: 'scope', bearing: 90, mag: 1.5 });
    expect(boat.scope).toEqual({ bearing: 90, mag: 1.5 });
  });
});
