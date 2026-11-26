import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RECOG, type Snapshot } from '@tk/shared';

/** The stadimeter range the player calls from the periscope to the plot (Profi Auto-TMA anchor). */

let store: typeof import('../src/store.js')['store'];
let rm: typeof import('../src/widgets/range-mark.js');

beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('location', { port: '', protocol: 'http:', host: 'localhost' });
  vi.stubGlobal('navigator', { language: 'de-DE' });
  store = (await import('../src/store.js')).store;
  rm = await import('../src/widgets/range-mark.js');
});

type Contact = Snapshot['contacts'][number];
/** Seen through the periscope at t = 118 (a hull bearing after it at 119). */
const look = [{ t: 110, b: 40, sensor: 'hull' }, { t: 118, b: 40, sensor: 'periscope' }, { t: 119, b: 40, sensor: 'hull' }];
const contact = (over: Partial<Contact>): Contact => ({ label: 'S3', bearing: 40, sensors: ['periscope'], history: look, lastSeen: 119, ...over } as unknown as Contact);

describe('stadimeter range mark', () => {
  it('takes the reading with the assigned class (its error included), timed', () => {
    store.reset();
    store.realism = 'profi';
    // A freighter 4 km off, wrongly assigned as a tanker (taller mast): the range comes out long
    const c = contact({ subtense: (RECOG.merchant.mast / 4000) * 1000, assignedCls: 'tanker' });
    const m = rm.takeStadimeter(c, 120)!;
    // Timed at the periscope look the angle comes from
    expect(m).toMatchObject({ t: 118, source: 'stadimeter', cls: 'tanker' });
    expect(m.r).toBeCloseTo((RECOG.tanker.mast / RECOG.merchant.mast) * 4000, 3);
    expect(store.rangeMarks.get('S3')).toBe(m);
    expect(rm.measuredRangeFor('S3')).toEqual({ t: 118, r: m.r });
    expect(rm.rangeMarkAge(m, 168)).toEqual({ age: 50, fresh: true });
    expect(rm.rangeMarkAge(m, 190).fresh).toBe(false);
  });

  it('no new range from an old angle: the target must be in the optic now (mast down)', () => {
    store.reset();
    store.realism = 'profi';
    const c = contact({ subtense: 5, assignedCls: 'merchant' });
    expect(rm.takeStadimeter(c, 130)).toBeUndefined();
    expect(store.rangeMarks.size).toBe(0);
    expect(rm.periscopeLookAt(c, 122)).toBe(118);
  });

  it('Profi without an assigned class: no reading, nothing taken', () => {
    store.reset();
    store.realism = 'profi';
    expect(rm.takeStadimeter(contact({ subtense: 5, classified: 'merchant' }), 120)).toBeUndefined();
    expect(store.rangeMarks.size).toBe(0);
  });

  it('Einsteiger: Auto-TMA gets no player mark (the server range anchors as before)', () => {
    store.reset();
    store.realism = 'einsteiger';
    rm.takeStadimeter(contact({ subtense: 5, classified: 'merchant' }), 120);
    expect(store.rangeMarks.has('S3')).toBe(true);
    expect(rm.measuredRangeFor('S3')).toBeUndefined();
  });
});
