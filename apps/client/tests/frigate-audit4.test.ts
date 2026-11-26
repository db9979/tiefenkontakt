import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@tk/shared';

/**
 * Frigate audit 4 (client logic): one rocket/torpedo envelope for OPZ and Waffen (F18), the towed
 * array's endfire cones on the waterfall (F22), the bridge tape in the picture's perspective and
 * the sightings list (F15/F16), and the "next step" hints (F34, S37).
 */

let reach: typeof import('../src/widgets/weapon-reach.js');
let wf: typeof import('../src/widgets/waterfall.js');
let assistant: typeof import('../src/widgets/assistant.js');
let store: typeof import('../src/store.js')['store'];
let bridge: typeof import('../src/stations/frigate/bridge.js');

beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('location', { port: '', protocol: 'http:', host: 'localhost' });
  vi.stubGlobal('navigator', { language: 'de-DE' });
  reach = await import('../src/widgets/weapon-reach.js');
  wf = await import('../src/widgets/waterfall.js');
  assistant = await import('../src/widgets/assistant.js');
  store = (await import('../src/store.js')).store;
  bridge = await import('../src/stations/frigate/bridge.js');
});

describe('bridge (F15, F16)', () => {
  it('the bearing tape uses the picture\'s perspective: a mark 20° off sits where the 3D view puts it', () => {
    const w = 800, f = 75;
    expect(bridge.tapeX(0, f, w)).toBe(400);
    expect(bridge.tapeX(f / 2, f, w)).toBeCloseTo(800);
    // Linear would put 20° at 613 px; the perspective view draws it at 590 px
    expect(bridge.tapeX(20, f, w)).toBeCloseTo(400 + (Math.tan((20 * Math.PI) / 180) / Math.tan((37.5 * Math.PI) / 180)) * 400);
    expect(Math.abs(bridge.tapeX(20, f, w) - 613.3)).toBeGreaterThan(15);
  });

  it('the sightings list takes explosions, sinkings, torpedoes and launches besides lookout reports', () => {
    expect(bridge.sightWhat({ kind: 'sighting', what: 'snorkel', text: '' })).toBe('SCHNORCHEL');
    expect(bridge.sightWhat({ kind: 'hit', text: 'EXPLOSION PEILUNG 187' })).toBe('EXPLOSION');
    expect(bridge.sightWhat({ kind: 'hit', sink: true, text: 'SINKGERÄUSCHE PEILUNG 187' })).toBe('SINKT');
    expect(bridge.sightWhat({ kind: 'torpedo', text: 'TORPEDO PEILUNG 246' })).toBe('TORPEDO');
    expect(bridge.sightWhat({ kind: 'boat', text: 'AUSGUCK · RAKETENSTART PEILUNG 090 · FLUGABWEHR' })).toBe('RAKETENSTART');
    expect(bridge.sightWhat({ kind: 'esm', text: 'ESM PEILUNG 253' })).toBeUndefined();
    expect(bridge.sightWhat({ kind: 'transient', text: 'TRANSIENT · PEILUNG 251' })).toBeUndefined();
  });
});

describe('weapon envelopes (F18)', () => {
  it('rocket: refuses with no range, inside 1,8 km and beyond 18 km (as the server does)', () => {
    expect(reach.rocketCheck(undefined).block).toBe('KEINE ENTFERNUNG');
    expect(reach.rocketCheck(1500).block).toMatch(/^ZU NAH/);
    expect(reach.rocketCheck(18_500).block).toBe('ZU WEIT · ÜBER 18 KM');
    expect(reach.rocketCheck(9000)).toEqual({});
  });

  it('lightweight torpedo: 8 km of run; near the end a second press, beyond it refused', () => {
    expect(reach.LIGHT_TORP_RANGE).toBe(8000);
    expect(reach.torpedoCheck(3900)).toEqual({});
    expect(reach.torpedoCheck(7500).warn).toBe('REICHWEITE KNAPP');
    expect(reach.torpedoCheck(9000).block).toBe('ZU WEIT · ÜBER 8 KM');
    // Bearing only: the tube may still fire down the bearing
    expect(reach.torpedoCheck(undefined)).toEqual({});
  });

  it('card line: "8 KM · ZIEL 3,9 KM ✓", out of reach says why', () => {
    expect(reach.reachText(8000, 3900)).toEqual({ text: '8 KM · ZIEL 3,9 KM ✓', ok: true });
    expect(reach.reachText(8000, 9400)).toEqual({ text: '8 KM · ZIEL 9,4 KM ZU WEIT', ok: false });
    expect(reach.reachText(18_000, 1200, 1800).text).toBe('1,8–18 KM · ZIEL 1,2 KM ZU NAH');
    expect(reach.reachText(18_000, undefined, 1800).text).toBe('1,8–18 KM · ZIEL ?');
  });
});

describe('towed array endfire on the waterfall (F22)', () => {
  it('both cones, ±20° of bow and stern, as the sim takes 10 dB off', () => {
    expect(wf.isEndfire(0)).toBe(true);
    expect(wf.isEndfire(-19)).toBe(true);
    expect(wf.isEndfire(175)).toBe(true);
    expect(wf.isEndfire(-165)).toBe(true);
    expect(wf.isEndfire(25)).toBe(false);
    expect(wf.isEndfire(90)).toBe(false);
  });

  it('the trace widens toward endfire (1/sin), capped at 3×', () => {
    expect(wf.endfireSpread(90)).toBeCloseTo(1);
    expect(wf.endfireSpread(30)).toBeCloseTo(2);
    expect(wf.endfireSpread(0)).toBeCloseTo(3);
    expect(wf.endfireSpread(180)).toBeCloseTo(3);
  });
});

/** A snapshot with what the hints read. */
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    time: 600, alerts: [], torpedoes: [], friendlies: [], contacts: [],
    own: { cls: 'ffg', towedLength: 900, towedOrder: 900, x: 0, y: 0, heading: 0, alive: true, loadout: { tubes: [] } },
    env: {},
    ...over,
  } as unknown as Snapshot;
}
const contact = (label: string, extra: object = {}) => ({ label, bearing: 90, lastSeen: 600, via: 'own', sensors: ['hull'], history: [], ...extra });

describe('next-step hints (F34, S37)', () => {
  it('counts contacts in plain German: 1 Kontakt, 3 Kontakte', () => {
    store.selected = undefined;
    store.snap = snap({ contacts: [contact('S1')] as never });
    expect(assistant.frigateHint(store.snap).text).toMatch(/^1 Kontakt – /);
    store.snap = snap({ contacts: [contact('S1'), contact('S2'), contact('S3')] as never });
    expect(assistant.frigateHint(store.snap).text).toMatch(/^3 Kontakte – /);
  });

  it('a submarine setting up a shot (TMA solution) is not told to classify', () => {
    const s = snap({ own: { cls: 'ssk', x: 0, y: 0, heading: 0, alive: true, depth: 80, loadout: { tubes: [] } } as never, contacts: [contact('S3')] as never });
    store.snap = s;
    store.selected = 'S3';
    store.solutions.delete('S3');
    expect(assistant.subHint(s).text).toMatch(/klassifizieren/);
    store.solutions.set('S3', { t0: 600, x0: 0, y0: 5000, course: 90, speedKn: 8 } as never);
    expect(assistant.subHint(s).text).not.toMatch(/klassifizieren/);
    store.solutions.delete('S3');
    // A running torpedo (on the wire) takes over the hint
    const t = snap({ ...s, torpedoes: [{ id: 'T1', x: 0, y: 1000, depth: 60, heading: 0, wire: true, homing: false, run: 1000 }] as never });
    store.snap = t;
    expect(assistant.subHint(t).text).toMatch(/^Torpedo läuft/);
    store.selected = undefined;
  });
});
