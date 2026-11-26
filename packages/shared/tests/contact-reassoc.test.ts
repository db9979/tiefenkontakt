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
    const again = b.ingest(det('x', 260, 102));
    expect(again.label).toBe('S1');
    expect(again.firstSeen).toBe(0);
    // The next new contact still counts on
    expect(b.ingest(det('y', 261, 200)).label).toBe('S2');
  });

  it('not when the bearing is off, the lines differ or it was too long ago', () => {
    const b = new ContactBook();
    b.ingest(det('a', 0, 100, [50]));
    b.expire(200);
    expect(b.ingest(det('x', 260, 106)).label).toBe('S2');
    expect(b.ingest(det('y', 261, 100, [73])).label).toBe('S3');
    const c = new ContactBook();
    c.ingest(det('a', 0, 100));
    c.expire(200);
    expect(c.ingest(det('z', 2000, 100)).label).toBe('S2');
  });

  it('survives a save and restore', () => {
    const b = new ContactBook();
    b.ingest(det('a', 0, 100));
    b.expire(200);
    const r = ContactBook.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    expect(r.ingest(det('x', 300, 101)).label).toBe('S1');
  });
});
