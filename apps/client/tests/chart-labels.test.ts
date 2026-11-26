import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@tk/shared';

let L: typeof import('../src/widgets/plot-labels.js');
let met: typeof import('../src/widgets/met-overlay.js');
let fr: typeof import('../src/widgets/friendly.js');
let marks: typeof import('../src/widgets/plot-marks.js');
let air: typeof import('../src/widgets/air-symbols.js');
beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('location', { port: '' });
  vi.stubGlobal('navigator', { language: 'de' });
  L = await import('../src/widgets/plot-labels.js');
  met = await import('../src/widgets/met-overlay.js');
  fr = await import('../src/widgets/friendly.js');
  marks = await import('../src/widgets/plot-marks.js');
  air = await import('../src/widgets/air-symbols.js');
});

const bounds = { x: 0, y: 0, w: 400, h: 300 };
const box = (x: number, y: number, w = 60, h = 14) => ({ x, y, w, h });

describe('chart label pass (S19, F4)', () => {
  it('keeps a free label where it was asked for', () => {
    expect(L.placeLabels([{ box: box(100, 100), prio: 50, seq: 0 }], bounds, [])).toEqual([{ dx: 0, dy: 0 }]);
  });

  it('moves the less important of two overlapping labels, the important one stays', () => {
    const at = L.placeLabels([{ box: box(100, 100), prio: L.PRIO.met, seq: 0 }, { box: box(110, 104), prio: L.PRIO.contact, seq: 1 }], bounds, []);
    expect(at[1]).toEqual({ dx: 0, dy: 0 });
    expect(at[0]).toBeDefined();
    const moved = { ...box(100, 100), x: 100 + at[0]!.dx, y: 100 + at[0]!.dy };
    const hit = moved.x < 170 && 110 < moved.x + 60 && moved.y < 118 && 104 < moved.y + 14;
    expect(hit).toBe(false);
  });

  it('clamps labels into the canvas (no text cut at the edges)', () => {
    const at = L.placeLabels([{ box: box(-20, 290), prio: L.PRIO.contact, seq: 0 }], bounds, []);
    expect(-20 + at[0]!.dx).toBeGreaterThanOrEqual(0);
    expect(290 + at[0]!.dy + 14).toBeLessThanOrEqual(300);
  });

  it('names nothing that is off the chart', () => {
    expect(L.placeLabels([{ box: box(500, 100), prio: L.PRIO.contact, seq: 0 }], bounds, [])).toEqual([undefined]);
  });

  it('keeps clear of obstacles (tool buttons, legend, symbols)', () => {
    const tools = { x: 360, y: 0, w: 40, h: 200 };
    const at = L.placeLabels([{ box: box(330, 50), prio: L.PRIO.contact, seq: 0 }], bounds, [tools]);
    expect(330 + at[0]!.dx + 60).toBeLessThanOrEqual(360);
  });

  it('an aircraft label under the route bar steps out below it (phone OPZ)', () => {
    // Route bar across the top 2/3 of a 390 px chart, two rows of buttons high
    const bar = { x: 4, y: 4, w: 260, h: 64 };
    const wide = { x: 0, y: 0, w: 390, h: 500 };
    const at = L.placeLabels([
      { box: box(60, 20, 90, 14), prio: L.PRIO.air, seq: 0 },
    ], wide, [bar]);
    const y = 20 + at[0]!.dy;
    const x = 60 + at[0]!.dx;
    const clear = y >= bar.y + bar.h || y + 14 <= bar.y || x >= bar.x + bar.w || x + 90 <= bar.x;
    expect(clear).toBe(true);
  });

  it('leaves a minor label out when nothing is free, but always draws a contact', () => {
    const wall = [{ x: 0, y: 0, w: 400, h: 300 }];
    const at = L.placeLabels([{ box: box(100, 100), prio: L.PRIO.depth, seq: 0 }, { box: box(200, 200), prio: L.PRIO.contact, seq: 1 }], bounds, wall);
    expect(at[0]).toBeUndefined();
    expect(at[1]).toBeDefined();
  });

  it('merges met labels of cells on top of each other', () => {
    const out = met.mergeMetLabels([{ x: 100, y: 50, text: 'EIS 4/10', color: 'a' }, { x: 120, y: 54, text: 'NEBEL', color: 'b' }, { x: 300, y: 50, text: 'SCHAUER', color: 'c' }]);
    expect(out.map((l) => l.text)).toEqual(['EIS 4/10 · NEBEL', 'SCHAUER']);
  });
});

describe('APP-6 affiliation (F5)', () => {
  it('comes from the assigned class', () => {
    expect(fr.affiliationOf({ assigned: 'merchant' }, false)).toBe('neutral');
    expect(fr.affiliationOf({ assigned: 'submarine' }, false)).toBe('hostile');
    expect(fr.affiliationOf({ assigned: 'torpedo' }, false)).toBe('hostile');
    expect(fr.affiliationOf({ assigned: 'warship' }, false)).toBe('hostile');
    expect(fr.affiliationOf({ assigned: 'bio' }, false)).toBe('unknown');
    expect(fr.affiliationOf({}, false)).toBe('unknown');
    expect(fr.affiliationOf({ classified: 'tanker' }, false)).toBe('neutral');
    expect(fr.affiliationOf({ assigned: 'merchant' }, true)).toBe('friend');
    expect(marks.AFF_COL.hostile).not.toBe(marks.AFF_COL.neutral);
  });
});

describe('datalink correlation holds (F6)', () => {
  const snap = (time: number, friendX: number): Snapshot => ({
    time, own: { x: 0, y: 0 },
    friendlies: [{ id: 'm1', cls: 'merchant', alive: true, x: friendX, y: 10_000, reportedAt: time, speedKn: 0, heading: 0 }],
  }) as unknown as Snapshot;
  const c = { label: 'S7', bearing: 0, sensors: ['hull' as const] };

  it('keeps EIGEN through a short bearing excursion and drops it after 30 s off', () => {
    expect(fr.isFriendlyContact(c, snap(1000, 0))).toBe(true);
    // Friend now 4° off (outside the 2° gate, inside the 5° hold): still own
    expect(fr.isFriendlyContact(c, snap(1001, 700))).toBe(true);
    // 10° off: held for 30 s, then gone
    expect(fr.isFriendlyContact(c, snap(1010, 1800))).toBe(true);
    expect(fr.isFriendlyContact(c, snap(1040, 1800))).toBe(false);
    // Without a label (no memory) the strict gate applies
    expect(fr.isFriendlyContact({ bearing: 0, sensors: ['hull'] }, snap(1041, 700))).toBe(false);
  });

  it('one friendly is one contact (F7: no more EIGEN rows than merchants)', () => {
    const base = snap(3000, 0);
    const contacts = [
      { label: 'S20', bearing: 0.3, sensors: ['hull'], via: 'own' },
      { label: 'S21', bearing: 1.1, sensors: ['hull'], via: 'own' },
      { label: 'S22', bearing: -0.8, sensors: ['hull'], via: 'own' },
      // A datalink mate's track of the same merchant is its own picture
      { label: 'L1-S4', bearing: 0.5, sensors: ['hull'], via: 'datalink' },
    ];
    const s = { ...base, contacts } as unknown as Snapshot;
    const own = contacts.filter((c) => fr.isFriendlyContact(c as never, s)).map((c) => c.label);
    expect(own).toEqual(['S20', 'L1-S4']);
    // Next snapshot: the held one keeps it even when another lines up a little better
    const s2 = { ...snap(3001, 0), contacts: contacts.map((c) => (c.label === 'S21' ? { ...c, bearing: 0.1 } : c)) } as unknown as Snapshot;
    expect(contacts.map((c) => c.label).filter((l) => fr.isFriendlyContact({ ...contacts.find((c) => c.label === l)!, bearing: l === 'S21' ? 0.1 : contacts.find((c) => c.label === l)!.bearing } as never, s2))).toEqual(['S20', 'L1-S4']);
  });

  it('a mate track is never the reporting mate itself (it sits at the track origin)', () => {
    // Mate corvette 300 m off its own reported origin (gridlock): any bearing used to line up with it
    const s = {
      time: 4000, own: { x: -11_000, y: 0 }, contacts: [],
      friendlies: [{ id: 'k1', cls: 'kor', alive: true, x: 200, y: 220, reportedAt: 4000, speedKn: 12, heading: 0 }],
    } as unknown as Snapshot;
    const mate = { label: 'L9-S9', bearing: 30, sensors: ['hull' as const, 'towed' as const], via: 'datalink' as const, originX: 0, originY: 0 };
    expect(fr.isFriendlyContact(mate, s)).toBe(false);
    // The own ship's track of that corvette still is EIGEN
    expect(fr.isFriendlyContact({ label: 'S30', bearing: 89, sensors: ['hull'], via: 'own' }, s)).toBe(true);
  });

  it('measures a sonobuoy bearing from the buoy (N2)', () => {
    // Friend 10 km north of a buoy that lies 10 km east: 000° from the buoy, 045° from the own ship
    const s = snap(2000, 10_000);
    const buoy = { bearing: 0, sensors: ['buoy' as const], originX: 10_000, originY: 0 };
    expect(fr.isFriendlyContact(buoy, s)).toBe(true);
    expect(fr.isFriendlyContact({ bearing: 0, sensors: ['buoy'] }, s)).toBe(false);
    expect(fr.isFriendlyContact({ bearing: 45, sensors: ['hull'] }, s)).toBe(true);
  });

  it('a hull track and a buoy track of one merchant both stay EIGEN, no swap (one per sensor origin)', () => {
    // Merchant 10 km north of the own ship; the buoy lies 10 km east: 000° from the ship, 315° from the buoy.
    // Both line up at first, then they wobble in turn: one of them 8° off (outside the 5° hold gate).
    const rows: Record<'S5' | 'S9', boolean[]> = { S5: [], S9: [] };
    for (let k = 0; k < 40; k++) {
      const even = k % 2 === 0;
      const contacts = [
        { label: 'S5', bearing: even || k === 1 ? 0 : 8, sensors: ['hull', 'towed'], via: 'own', lastSeen: 5000 + k },
        { label: 'S9', bearing: even && k > 0 ? 323 : 315, sensors: ['buoy'], originX: 10_000, originY: 0, via: 'own', lastSeen: 5000 + k },
      ];
      const s = { ...snap(5000 + k, 0), contacts } as unknown as Snapshot;
      for (const c of contacts) rows[c.label as 'S5' | 'S9'].push(fr.isFriendlyContact(c as never, s));
    }
    expect(rows.S5.every(Boolean)).toBe(true);
    expect(rows.S9.every(Boolean)).toBe(true);
    // Two own-ship tracks of one merchant still share one tag (F7)
    const two = [
      { label: 'S5', bearing: 0.2, sensors: ['hull'], via: 'own', lastSeen: 6000 },
      { label: 'S6', bearing: 0.4, sensors: ['towed'], via: 'own', lastSeen: 6000 },
    ];
    const s2 = { ...snap(6000, 0), contacts: two } as unknown as Snapshot;
    expect(two.filter((c) => fr.isFriendlyContact(c as never, s2)).length).toBe(1);
  });
});

describe('units on the chart', () => {
  it('writes the position error in one unit (S20)', () => {
    expect(marks.navErrorText(298)).toBe('±300 M');
    expect(marks.navErrorText(1234)).toBe('±1,2 KM');
  });
  it('writes aircraft height as a height, not a range (F19)', () => {
    expect(air.altText(10_312)).toBe('10.300 M');
    expect(air.altText(118)).toBe('120 M');
  });
});
