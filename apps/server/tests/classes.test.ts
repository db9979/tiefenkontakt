import { describe, expect, it } from 'vitest';
import { bearing, bookFor, createShip, createWorld, distance, type Detection, type ServerMsg, type Snapshot, type World } from '@tk/shared';
import { markKey, restoreClasses, setMark, type ClassMarks } from '../src/classes.js';
import { Lobby } from '../src/lobby.js';
import { Match, type Conn } from '../src/match.js';
import { buildSnapshot, classGroupKey, type PlayerExtras } from '../src/snapshot.js';

const SCORE = { sunkTons: 0, arrivedTons: 0, totalTons: 1, timeLeftS: 1 };
const extras = (): PlayerExtras => ({ alerts: [], radio: [], reports: new Map() });

function det(w: World, o: string, t: string, sensor: Detection['sensor'], ranged = false): Detection {
  const a = w.ships.find((s) => s.id === o)!.pos;
  const b = w.ships.find((s) => s.id === t)!.pos;
  return { observerId: o, targetId: t, sensor, time: w.time, bearing: bearing(a, b), se: 12, range: ranged ? distance(a, b) : undefined };
}

/** Two frigates on the link holding one boat for a minute (hull: two bearing lines, a dual track; active ranged on the mate: merged). */
function linked(sensorB: Detection['sensor'], rangedB: boolean) {
  const a = createShip({ id: 'p_w1', cls: 'ffg', name: 'F1', team: 'west', pos: { x: 0, y: 0 }, heading: 0 });
  const b = createShip({ id: 'p_w2', cls: 'ffg', name: 'F2', team: 'west', pos: { x: 12_000, y: 0 }, heading: 0 });
  const u = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 6000, y: 9000 }, heading: 0, depth: 60 });
  const w = createWorld([a, b, u]);
  for (let t = 100; t <= 160; t += 5) {
    w.time = t;
    bookFor(w, 'p_w1').ingest(det(w, 'p_w1', 'u', 'hull'));
    bookFor(w, 'p_w2').ingest(det(w, 'p_w2', 'u', sensorB, rangedB));
  }
  const ownLabel = w.books.get('p_w1')!.tracks()[0]!.label;
  const mateLabel = w.books.get('p_w2')!.tracks()[0]!.label;
  return { w, a, b, ownLabel, mateLabel };
}

describe('classification per track, not per hidden target (datalink leak)', () => {
  it('a dual datalink track of the same boat does not show the other track\'s mark', () => {
    const { w, a, ownLabel, mateLabel } = linked('hull', false);
    const marks: ClassMarks = new Map();
    setMark(marks, markKey('p_w1', ownLabel), 'submarine', 'ssk');
    const snap = buildSnapshot(w, a, extras(), SCORE, marks);
    const own = snap.contacts.find((c) => c.via === 'own')!;
    const dual = snap.contacts.find((c) => c.via === 'datalink')!;
    expect(dual.label).toBe(`L1-${mateLabel}`);
    expect(own.assigned).toBe('submarine');
    expect(own.assignedCls).toBe('ssk');
    expect(dual.assigned).toBeUndefined();
    expect(dual.assignedCls).toBeUndefined();
    // The mate's own mark on his track is shared over the link: on that track alone
    setMark(marks, markKey('p_w2', mateLabel), 'warship');
    const again = buildSnapshot(w, a, extras(), SCORE, marks);
    expect(again.contacts.find((c) => c.via === 'datalink')!.assigned).toBe('warship');
    expect(again.contacts.find((c) => c.via === 'own')!.assigned).toBe('submarine');
  });

  it('the mate\'s mark travels with his track when the gate merged it, unless the track is marked (or cleared) here', () => {
    const { w, a, ownLabel, mateLabel } = linked('active', true);
    const marks: ClassMarks = new Map();
    setMark(marks, markKey('p_w2', mateLabel), 'submarine', 'ssk');
    let snap = buildSnapshot(w, a, extras(), SCORE, marks);
    expect(snap.contacts.filter((c) => c.via === 'datalink')).toHaveLength(0);
    const own = snap.contacts.find((c) => c.label === ownLabel)!;
    expect(own.assigned).toBe('submarine');
    expect(own.assignedCls).toBe('ssk');
    // Marked here: the own mark wins
    setMark(marks, markKey('p_w1', ownLabel), 'merchant');
    snap = buildSnapshot(w, a, extras(), SCORE, marks);
    expect(snap.contacts.find((c) => c.label === ownLabel)!.assigned).toBe('merchant');
    // Cleared here on purpose: shows nothing, the merged mark does not come back
    setMark(marks, markKey('p_w1', ownLabel), 'unknown');
    snap = buildSnapshot(w, a, extras(), SCORE, marks);
    expect(snap.contacts.find((c) => c.label === ownLabel)!.assigned).toBeUndefined();
  });

  it('without a merge nothing travels: the mate\'s mark on a different boat stays off the own track', () => {
    const { w, a, ownLabel } = linked('hull', false);
    const marks: ClassMarks = new Map([[markKey('p_w2', 'S99'), { choice: 'submarine' as const }]]);
    const snap = buildSnapshot(w, a, extras(), SCORE, marks);
    expect(snap.contacts.find((c) => c.label === ownLabel)!.assigned).toBeUndefined();
  });

  it('an old save keyed by target id becomes marks on that target\'s tracks in the group\'s books', () => {
    const { w, ownLabel, mateLabel } = linked('hull', false);
    const groupOf = (id: string) => { const s = w.ships.find((x) => x.id === id); return s && classGroupKey(s); };
    const back = restoreClasses([['team:west', [['u', 'submarine']]]], w, groupOf, { 'team:west': { u: 'ssk' } });
    const m = back.get('team:west')!;
    expect(m.get(markKey('p_w1', ownLabel))).toEqual({ choice: 'submarine', cls: 'ssk' });
    expect(m.get(markKey('p_w2', mateLabel))).toEqual({ choice: 'submarine', cls: 'ssk' });
    expect([...m.keys()].some((k) => k === 'u')).toBe(false);
  });
});

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

describe('classification persists', () => {
  it('across a reconnect and a save/restore, with the recognition-book class', () => {
    const lobby = new Lobby();
    const west = fakeConn('w1');
    const east = fakeConn('e1');
    lobby.connect(west);
    lobby.resume(west);
    lobby.connect(east);
    lobby.resume(east);
    lobby.handle(west, { t: 'create_match', name: 'Test' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(east, { t: 'join', matchId: m.id, team: 'east' });
    lobby.handle(east, { t: 'pick_class', cls: 'ssn' });
    lobby.handle(west, { t: 'ready', ready: true });
    lobby.handle(east, { t: 'ready', ready: true });
    m.stop();
    let label: string | undefined;
    for (let i = 0; i < 400 && !label; i++) {
      m.tick();
      if (i >= 40) label = lastSnap(east)!.contacts.find((x) => x.via === 'own')?.label;
    }
    if (!label) throw new Error('no contact');
    lobby.handle(east, { t: 'classify', label, choice: 'warship', cls: 'ffg' });
    expect(east.inbox.some((x) => x.t === 'error')).toBe(false);
    // Reconnect
    const tab2 = fakeConn('e1');
    lobby.connect(tab2);
    lobby.resume(tab2);
    m.tick();
    m.tick();
    const c = lastSnap(tab2)!.contacts.find((x) => x.label === label)!;
    expect(c.assignedCls).toBe('ffg');
    // Save and restore (through JSON, like the store)
    const back = Match.restore(JSON.parse(JSON.stringify(m.save()!)));
    back.stop();
    const tab3 = fakeConn('e1');
    back.reattach(tab3);
    back.tick();
    back.tick();
    const r = lastSnap(tab3)!.contacts.find((x) => x.label === label)!;
    expect(r.assignedCls).toBe('ffg');
    expect(r.assigned).toBeDefined();
  });
});
