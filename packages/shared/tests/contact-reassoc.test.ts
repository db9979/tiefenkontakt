import { describe, expect, it } from 'vitest';
import { ContactBook } from '../src/contacts.js';
import type { Detection } from '../src/sensors.js';

const det = (targetId: string, time: number, bearing: number, tonals?: number[]): Detection => ({
  observerId: 'me', targetId, sensor: 'hull', time, bearing, se: 6,
  ...(tonals ? { evidence: { tonals: tonals.map((hz) => ({ hz, snr: 5 })) } } : {}),
} as Detection);

describe('track re-association (S6, F7)', () => {
  it('a dropped track that reappears on the same bearing keeps its label', () => {
    const b = new ContactBook();
    expect(b.ingest(det('a', 0, 100)).label).toBe('S1');
    b.expire(200);
    expect(b.tracks()).toHaveLength(0);
    const again = b.ingest(det('a', 260, 102));
    expect(again.label).toBe('S1');
    expect(again.firstSeen).toBe(0);
    // The next new contact still counts on
    expect(b.ingest(det('y', 261, 200)).label).toBe('S2');
  });

  it('not when the bearing is off, the lines differ or it was too long ago', () => {
    const b = new ContactBook();
    b.ingest(det('a', 0, 100, [50]));
    b.expire(200);
    expect(b.ingest(det('a', 260, 106)).label).toBe('S2');
    const c = new ContactBook();
    c.ingest(det('a', 0, 100, [50]));
    c.expire(200);
    expect(c.ingest(det('a', 261, 100, [73])).label).toBe('S2');
    const e = new ContactBook();
    e.ingest(det('a', 0, 100));
    e.expire(200);
    expect(e.ingest(det('a', 2000, 100)).label).toBe('S2');
  });

  it('survives a save and restore', () => {
    const b = new ContactBook();
    b.ingest(det('a', 0, 100));
    b.expire(200);
    const r = ContactBook.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    expect(r.ingest(det('a', 300, 101)).label).toBe('S1');
  });

  it('carries the bearing over the gap at the rate the track had', () => {
    const b = new ContactBook();
    for (let t = 0; t <= 60; t += 5) b.ingest(det('a', t, 100 + t * 0.05));
    b.expire(250);
    // 0.05°/s for ~240 s: about 12° on from the last bearing (103°)
    expect(b.ingest(det('a', 300, 115)).label).toBe('S1');
  });
});

describe('re-association in a convoy (N1)', () => {
  /** Eight merchants a degree or two apart, all on the same 50/100 Hz lines. */
  const MERCH = [50, 100, 150];
  const column = (b: ContactBook, t: number, skip: string[] = [], shift = 0) => {
    for (let i = 0; i < 8; i++) {
      const id = `m${i}`;
      if (!skip.includes(id)) b.ingest(det(id, t, 90 + i * 1.6 + shift, MERCH));
    }
  };
  const labelOf = (b: ContactBook, id: string) => b.entries().find(([x]) => x === id)?.[1].label;

  it('a neighbour never takes over a dropped merchant\'s label', () => {
    const b = new ContactBook();
    // m0..m6 tracked; m7 not yet heard
    for (let t = 0; t <= 60; t += 10) column(b, t, ['m7']);
    const s2 = labelOf(b, 'm1');
    expect(s2).toBe('S2');
    // m1 fades out for longer than the expiry; the others are still held
    for (let t = 70; t <= 300; t += 10) {
      column(b, t, ['m1', 'm7']);
      b.expire(t);
    }
    expect(labelOf(b, 'm1')).toBeUndefined();
    // A new merchant turns up right on m1's old bearing: it gets a new label, not S2
    b.ingest(det('m7', 310, 90 + 1.6, MERCH));
    expect(labelOf(b, 'm7')).not.toBe('S2');
    // m1 itself comes back, but next to live tracks: still no guess, a new label
    b.ingest(det('m1', 320, 90 + 1.6 + 0.2, MERCH));
    expect(labelOf(b, 'm1')).not.toBe('S2');
    // No two tracks share a label
    const labels = b.tracks().map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('two dropped merchants in the gate: no reclaim (ambiguous)', () => {
    const b = new ContactBook();
    b.ingest(det('a', 0, 100, MERCH));
    b.ingest(det('c', 0, 101.5, MERCH));
    b.expire(200);
    expect(b.ingest(det('a', 260, 100.7, MERCH)).label).toBe('S3');
  });

  it('a lone merchant that is re-acquired clear of the others keeps its label', () => {
    const b = new ContactBook();
    b.ingest(det('a', 0, 100, MERCH));
    b.ingest(det('far', 0, 160, MERCH));
    for (let t = 10; t <= 250; t += 10) {
      b.ingest(det('far', t, 160, MERCH));
      b.expire(t);
    }
    expect(b.ingest(det('a', 260, 101, MERCH)).label).toBe('S1');
  });

  it('a sonobuoy bearing never reclaims an own-ship track', () => {
    const b = new ContactBook();
    b.ingest(det('a', 0, 100));
    b.expire(200);
    expect(b.ingest({ ...det('a', 260, 100), sensor: 'buoy', originX: 1000, originY: 0 } as Detection).label).toBe('S2');
  });
});
