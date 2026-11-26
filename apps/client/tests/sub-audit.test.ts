import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AlertView, Snapshot } from '@tk/shared';

let dp: typeof import('../src/widgets/depth-profile.js');
let tp: typeof import('../src/widgets/threat-panel.js');
beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'de', setItem: () => undefined });
  vi.stubGlobal('location', { port: '', protocol: 'http:', host: 'localhost' });
  dp = await import('../src/widgets/depth-profile.js');
  tp = await import('../src/widgets/threat-panel.js');
});

/** The parts of a snapshot the helpers read. */
function snap(own: Partial<Snapshot['own']>, env: Partial<Snapshot['env']> = {}): Snapshot {
  return {
    own: { cls: 'ssk', depth: 60, heading: 0, speedKn: 4, order: { heading: 0, speedKn: 4, depth: 60 }, snorkel: false, ...own },
    env: { seaState: 2, ...env },
  } as unknown as Snapshot;
}

describe('battery tile', () => {
  it('gives the endurance at the ordered speed as hours and minutes, not a clock time', () => {
    const text = dp.enduranceText(21 * 3600 + 30 * 60 + 15, 4);
    expect(text).toBe('REST 21 H 30 · 86 SM BEI 4 KN');
  });

  it('after ALARMTAUCHEN uses the sprint ordered, not the creep still on the log', () => {
    const cap = 1000;
    const o = snap({ cls: 'ssk', battery: cap, speedKn: 4, order: { heading: 0, speedKn: 18, depth: 120 } }).own;
    const creep = dp.enduranceAt(o, 4)!;
    const sprint = dp.enduranceAt(o, 18)!;
    expect(sprint).toBeLessThan(creep / 10);
    const info = dp.batteryInfo(o)!;
    expect(info.range).toMatch(/BEI 18 KN$/);
  });
});

describe('trim', () => {
  it('shows one trim angle in degrees with a decimal comma', () => {
    // A torpedo gone: 1,5 t light, bow up
    expect(dp.trimText(dp.trimDeg(snap({ trim: 1.5 }).own))).toBe('1,5° HECK');
    expect(dp.trimText(dp.trimDeg(snap({ wreck: { trim: 2.25, list: 0 } } as never).own))).toBe('2,3° BUG');
    expect(dp.trimText(0)).toBe('0,0°');
  });
});

describe('evasion depth', () => {
  it('stays below the layer with a pinger above (no climb from 270 m to 70 m)', () => {
    expect(tp.evasionDepth(snap({ depth: 270 }, { layerDepth: 110, bottom: 2000 }))).toBe(270);
    expect(tp.evasionDepth(snap({ depth: 120 }, { layerDepth: 110, bottom: 2000 }))).toBe(140);
  });

  it('goes under the layer from above it, but never into the ground', () => {
    expect(tp.evasionDepth(snap({ depth: 40 }, { layerDepth: 110, bottom: 2000 }))).toBe(150);
    expect(tp.evasionDepth(snap({ depth: 40 }, { layerDepth: 110, bottom: 140 }))).toBe(120);
  });
});

describe('threat count', () => {
  const ping = (b: number, source: AlertView['source'] = 'hull'): AlertView => ({ time: 0, kind: 'ping', bearing: b, source, text: '' });

  it('counts pingers, not pings', () => {
    const pings = [ping(80), ping(81), ping(82), ping(79), ping(200), ping(201), ping(81, 'dip')];
    expect(tp.pingSources(pings)).toBe(3);
  });
});
