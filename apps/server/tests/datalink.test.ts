import { describe, expect, it } from 'vitest';
import { bearing, bookFor, createShip, createWorld, distance, type Detection, type World } from '@tk/shared';
import { GRIDLOCK_MAX_M, GRIDLOCK_MIN_M, LINK_CYCLE_S, LINK_DELAY_S, correlate, gateScore, gridlock, linkReportTime } from '../src/datalink.js';
import { buildSnapshot, type PlayerExtras } from '../src/snapshot.js';

const SCORE = { sunkTons: 0, arrivedTons: 0, totalTons: 1, timeLeftS: 1 };
const extras = (): PlayerExtras => ({ alerts: [], radio: [], reports: new Map() });

/** A detection of target `t` by `o` as the sensor really measures it (true bearing, optional range). */
function det(w: World, o: string, t: string, sensor: Detection['sensor'], ranged = false): Detection {
  const a = w.ships.find((s) => s.id === o)!.pos;
  const b = w.ships.find((s) => s.id === t)!.pos;
  return { observerId: o, targetId: t, sensor, time: w.time, bearing: bearing(a, b), se: 12, range: ranged ? distance(a, b) : undefined };
}

function setup(mateAt = { x: 12_000, y: 0 }) {
  const a = createShip({ id: 'p_w1', cls: 'ffg', name: 'F1', team: 'west', pos: { x: 0, y: 0 }, heading: 0 });
  const b = createShip({ id: 'p_w2', cls: 'ffg', name: 'F2', team: 'west', pos: mateAt, heading: 0 });
  const u = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 6000, y: 9000 }, heading: 0, depth: 60 });
  const w = createWorld([a, b, u]);
  return { w, a, b, u };
}

/** Both frigates hold the boat for a minute. */
function hold(w: World, a: string, b: string, sensorA: Detection['sensor'], sensorB: Detection['sensor'], rangedA = false, rangedB = false) {
  for (let t = 100; t <= 160; t += 5) {
    w.time = t;
    bookFor(w, a).ingest(det(w, a, 'u', sensorA, rangedA));
    bookFor(w, b).ingest(det(w, b, 'u', sensorB, rangedB));
  }
}

describe('datalink (F13): latency, gridlock and correlation by gate', () => {
  it('a mate\'s report is 3–15 s old, each unit on its own phase of the net cycle', () => {
    for (let now = 100; now < 160; now += 1.3) {
      const age = now - linkReportTime('p_w2', now);
      expect(age).toBeGreaterThanOrEqual(LINK_DELAY_S);
      expect(age).toBeLessThan(LINK_DELAY_S + LINK_CYCLE_S);
    }
    const g = gridlock({ id: 'p_w2', team: 'west' });
    expect(Math.hypot(g.x, g.y)).toBeGreaterThanOrEqual(GRIDLOCK_MIN_M - 1);
    expect(Math.hypot(g.x, g.y)).toBeLessThanOrEqual(GRIDLOCK_MAX_M + 1);
  });

  it('two bearing lines of the same boat from ships far apart stay two tracks (crossing them is the operator\'s act)', () => {
    const { w, a } = setup();
    hold(w, 'p_w1', 'p_w2', 'hull', 'hull');
    const snap = buildSnapshot(w, a, extras(), SCORE);
    const labels = snap.contacts.map((c) => `${c.via}:${c.label}`);
    expect(labels.filter((l) => l.startsWith('own:'))).toHaveLength(1);
    expect(labels.filter((l) => l.startsWith('datalink:L1-'))).toHaveLength(1);
    // The mate's bearing comes with the mate as its origin (in the mate's frame: within the gridlock)
    const link = snap.contacts.find((c) => c.via === 'datalink')!;
    expect(distance({ x: link.originX!, y: link.originY! }, { x: 12_000, y: 0 })).toBeLessThan(GRIDLOCK_MAX_M + 1);
    expect(link.linkAgeS).toBeGreaterThanOrEqual(LINK_DELAY_S);
  });

  it('a mate\'s fix on the own bearing line merges into the own track; one well off it stays a dual track', () => {
    const { w, a } = setup();
    hold(w, 'p_w1', 'p_w2', 'hull', 'active', false, true);
    let snap = buildSnapshot(w, a, extras(), SCORE);
    expect(snap.contacts.filter((c) => c.via === 'datalink')).toHaveLength(0);
    // The same report, but the boat is somewhere else for the mate (another boat, or a bad fix): two tracks
    const w2 = setup().w;
    w2.ships.push(createShip({ id: 'u2', cls: 'ssk', name: 'U2', team: 'east', pos: { x: 14_000, y: 7000 }, heading: 0, depth: 60 }));
    for (let t = 100; t <= 160; t += 5) {
      w2.time = t;
      bookFor(w2, 'p_w1').ingest(det(w2, 'p_w1', 'u', 'hull'));
      bookFor(w2, 'p_w2').ingest(det(w2, 'p_w2', 'u2', 'active', true));
    }
    snap = buildSnapshot(w2, w2.ships[0]!, extras(), SCORE);
    expect(snap.contacts.filter((c) => c.via === 'datalink')).toHaveLength(1);
  });

  it('merging never looks at the target\'s identity: a different boat inside the gate merges too', () => {
    const { w, a } = setup();
    // The mate's fix is on a second boat 300 m from the first: one track on the picture (a real Link problem)
    w.ships.push(createShip({ id: 'u2', cls: 'ssk', name: 'U2', team: 'east', pos: { x: 6200, y: 9200 }, heading: 0, depth: 60 }));
    for (let t = 100; t <= 160; t += 5) {
      w.time = t;
      bookFor(w, 'p_w1').ingest(det(w, 'p_w1', 'u', 'active', true));
      bookFor(w, 'p_w2').ingest(det(w, 'p_w2', 'u2', 'active', true));
    }
    expect(buildSnapshot(w, a, extras(), SCORE).contacts.filter((c) => c.via === 'datalink')).toHaveLength(0);
  });

  it('a track the mate has just gained is not on the link before its next report', () => {
    const { w, a } = setup();
    w.time = 200;
    const report = linkReportTime('p_w2', 200);
    // First seen after the last report that has reached us
    w.time = report + 1;
    bookFor(w, 'p_w2').ingest(det(w, 'p_w2', 'u', 'hull'));
    w.time = Math.max(w.time, 200);
    const snap = buildSnapshot(w, a, extras(), SCORE);
    expect(snap.contacts.filter((c) => c.via === 'datalink')).toHaveLength(0);
    w.time = report + LINK_CYCLE_S + LINK_DELAY_S + 0.5;
    expect(buildSnapshot(w, a, extras(), SCORE).contacts.filter((c) => c.via === 'datalink')).toHaveLength(1);
  });

  it('gate: fixes within 1 km, bearing lines of one sensor class within 3° from close origins; hysteresis holds a merge', () => {
    const f = (x: number, y: number) => ({ label: 'x', fix: { x, y }, cls: 'acoustic' as const });
    expect(gateScore(f(0, 0), f(800, 0))).toBeLessThan(1);
    expect(gateScore(f(0, 0), f(1200, 0))).toBeGreaterThan(1);
    const line = (ox: number, b: number, cls: 'acoustic' | 'esm' = 'acoustic') => ({ label: `l${ox}${b}${cls}`, line: { o: { x: ox, y: 0 }, b }, cls });
    expect(gateScore(line(0, 10), line(500, 12))).toBeLessThan(1);
    expect(gateScore(line(0, 10), line(500, 12, 'esm'))).toBe(Infinity);
    expect(gateScore(line(0, 10), line(8000, 10))).toBe(Infinity);
    // 1.2 km apart: outside the gate, but held if it was merged into that track
    const p = { ...f(1200, 0), label: 'L1-S1' };
    expect(correlate(p, [{ ...f(0, 0), label: 'S1' }])).toBeUndefined();
    expect(correlate(p, [{ ...f(0, 0), label: 'S1' }], 'S1')).toBe('S1');
  });
});
