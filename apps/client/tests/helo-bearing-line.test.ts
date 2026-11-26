import { beforeAll, describe, expect, it, vi } from 'vitest';

let hp: typeof import('../src/widgets/helo-panel.js');

beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('location', { port: '' });
  vi.stubGlobal('navigator', { language: 'de' });
  hp = await import('../src/widgets/helo-panel.js');
});

describe('buoy line along a bearing-only contact', () => {
  it('runs from the own ship for an own bearing', () => {
    expect(hp.bearingLineCentre({ x: 0, y: 0 }, { bearing: 30 })).toEqual({ bearing: 30, range: hp.BEARING_LINE_RANGE });
  });
  it('runs from the reporting mate for a datalink bearing', () => {
    // Mate 8 km east of us reports a contact due north of it: the line centre is 8 km north of the mate
    const r = hp.bearingLineCentre({ x: 0, y: 0 }, { bearing: 0, origin: { x: 8000, y: 0 } });
    expect(r.bearing).toBeCloseTo(45, 5);
    expect(r.range).toBeCloseTo(8000 * Math.SQRT2, 3);
  });
});
