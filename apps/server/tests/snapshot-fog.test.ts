import { describe, expect, it } from 'vitest';
import { ContactBook, PERISCOPE_DEPTH, bookFor, compsOf, createShip, createWorld, mineStateOf, type Detection, type World } from '@tk/shared';
import { buildSnapshot, type PlayerExtras } from '../src/snapshot.js';

const SCORE = { sunkTons: 0, arrivedTons: 0, totalTons: 1, timeLeftS: 1 };
const extras = (): PlayerExtras => ({ alerts: [], radio: [], reports: new Map() });

function det(w: World, observerId: string, targetId: string, sensor: Detection['sensor']): Detection {
  return { observerId, targetId, sensor, time: w.time, bearing: 90, se: 10, range: sensor === 'periscope' ? 3000 : undefined };
}

describe('snapshot fog of war', () => {
  it('shows a target\'s damage only while it is in the periscope (not forever after one look)', () => {
    const sub = createShip({ id: 'p_e1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, depth: 15 });
    const target = createShip({ id: 'm1', cls: 'merchant', name: 'M', team: 'west', pos: { x: 3000, y: 0 }, heading: 0 });
    const w = createWorld([sub, target]);
    compsOf(target)[0]!.fire = 0.5; // burning: the periscope would show it
    w.time = 100;
    bookFor(w, sub.id).ingest(det(w, sub.id, target.id, 'periscope'));
    const x = extras();
    expect(buildSnapshot(w, sub, x, SCORE).contacts[0]!.wreck).toBeDefined();
    // Periscope down, only sonar for a while: no more damage picture
    for (let t = 101; t <= 120; t++) {
      w.time = t;
      bookFor(w, sub.id).ingest(det(w, sub.id, target.id, 'hull'));
    }
    const c = buildSnapshot(w, sub, x, SCORE).contacts[0]!;
    expect(c.sensors).toContain('periscope'); // the track still remembers the sensor ...
    expect(c.wreck).toBeUndefined(); // ... but the eye no longer sees her
  });

  it('gives a surface ship no friendly submarine positions over the datalink, only radio reports', () => {
    const ffg = createShip({ id: 'p_w1', cls: 'ffg', name: 'F1', team: 'west', pos: { x: 0, y: 0 }, heading: 0 });
    const ffg2 = createShip({ id: 'p_w2', cls: 'ffg', name: 'F2', team: 'west', pos: { x: 5000, y: 0 }, heading: 0 });
    const sub = createShip({ id: 'p_w3', cls: 'ssk', name: 'U-West', team: 'west', pos: { x: 9000, y: 9000 }, heading: 0 });
    const w = createWorld([ffg, ffg2, sub]);
    const x = extras();
    const snap = buildSnapshot(w, ffg, x, SCORE);
    expect(snap.friendlies.map((f) => f.id)).toEqual(['p_w2']);
    expect(JSON.stringify(snap)).not.toContain('9000');
    // After a radio report the sub appears where it reported from
    x.reports.set(sub.id, { id: sub.id, name: sub.name, cls: sub.cls, x: 8000, y: 8000, heading: 0, speedKn: 4, reportedAt: 0, alive: true });
    const after = buildSnapshot(w, ffg, x, SCORE).friendlies.find((f) => f.id === sub.id)!;
    expect([after.x, after.y]).toEqual([8000, 8000]);
  });

  it('forgets delta bookkeeping of vanished labels so a returning contact gets its full history', () => {
    const sub = createShip({ id: 'p_e1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0 });
    const target = createShip({ id: 'm1', cls: 'merchant', name: 'M', team: 'west', pos: { x: 3000, y: 0 }, heading: 0 });
    const w = createWorld([sub, target]);
    const book = bookFor(w, sub.id);
    for (let t = 1; t <= 5; t++) {
      w.time = t;
      book.ingest(det(w, sub.id, target.id, 'hull'));
    }
    const x = extras();
    const label = buildSnapshot(w, sub, x, SCORE).contacts[0]!.label;
    expect(x.histSent?.[label]).toBe(5);
    // Contact lost: its entry is dropped (no unbounded growth, no stale cursor)
    const saved = book.toJSON();
    book.expire(1e9, 0);
    buildSnapshot(w, sub, x, SCORE);
    expect(x.histSent).toEqual({});
    expect(x.evSent).toEqual({});
    // Back again (client dropped its history meanwhile): the whole history is resent
    w.books.set(sub.id, ContactBook.fromJSON(saved));
    expect(buildSnapshot(w, sub, x, SCORE).contacts[0]!.history).toHaveLength(5);
  });

  it('plots a boat\'s own mines and aircraft from its dead-reckoned position', () => {
    const sub = createShip({ id: 'p_e1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, depth: PERISCOPE_DEPTH });
    sub.mastUp = true;
    sub.drErr = { x: 1200, y: -700 };
    const w = createWorld([sub]);
    mineStateOf(w).mines.push({ id: 'M1', ownerId: sub.id, team: 'east', pos: { x: 500, y: 500 }, depth: 30, bottom: true, laidAt: 0, armedAt: 0, known: ['east'] });
    w.env.airspace = { planes: [{ id: 'A1', kind: 'mpa', team: 'east', pos: { x: 2000, y: 2000 }, alt: 300, heading: 0, speedKn: 200, radar: false }], nextCivil: 1e9, nextRecon: 1e9, nextId: 2 };
    const snap = buildSnapshot(w, sub, extras(), SCORE);
    expect([snap.own.x, snap.own.y]).toEqual([1200, -700]);
    expect([snap.mines![0]!.x, snap.mines![0]!.y]).toEqual([1700, -200]);
    const plane = snap.planes!.find((p) => p.id === 'A1')!;
    expect([plane.x, plane.y]).toEqual([3200, 1300]);
  });
});
