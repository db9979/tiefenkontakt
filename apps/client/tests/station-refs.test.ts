import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@tk/shared';

/**
 * Hints, tutorials and the help screen send the player to stations by number and name.
 * When stations move or merge, every reference must follow: a "where" like "6 · Ortung"
 * must name the station that really has key 6 on that side.
 */

let titles: typeof import('../src/stations/titles.js');
let tutorial: typeof import('../src/widgets/tutorial.js');
let assistant: typeof import('../src/widgets/assistant.js');
let store: typeof import('../src/store.js')['store'];

beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('location', { port: '', protocol: 'http:', host: 'localhost' });
  vi.stubGlobal('navigator', { language: 'de-DE' });
  titles = await import('../src/stations/titles.js');
  tutorial = await import('../src/widgets/tutorial.js');
  assistant = await import('../src/widgets/assistant.js');
  store = (await import('../src/store.js')).store;
});

/** Which side plays each lesson. A new lesson must be added here (and so gets checked). */
const LESSON_SIDE: Record<string, 'sub' | 'frigate'> = {
  feindfahrt: 'sub', klassifizieren: 'sub', tma: 'sub', angriff: 'sub', geleitfahrt: 'frigate', ujagd: 'frigate',
};

describe('station references', () => {
  it('every numbered tutorial step names the station with that number on its side', () => {
    for (const [key, lesson] of Object.entries(tutorial.LESSON_STEPS)) {
      const side = LESSON_SIDE[key];
      expect(side, `lesson ${key} has no side in the test`).toBeDefined();
      const list: readonly string[] = side === 'sub' ? titles.SUB_STATIONS : titles.FRIGATE_STATIONS;
      for (const step of lesson.steps) {
        const m = /^(\d+) · ([^·]+?)(?: · |$)/.exec(step.where);
        if (!m) continue;
        expect(list[Number(m[1]) - 1], `${key}: "${step.where}"`).toBe(m[2]);
      }
    }
  });

  it('frigate steps about the active ping send the player to the Ortung station', () => {
    for (const [key, lesson] of Object.entries(tutorial.LESSON_STEPS)) {
      if (LESSON_SIDE[key] !== 'frigate') continue;
      for (const step of lesson.steps) {
        if (/LFM|Aktivsonar/.test(step.text)) expect(step.where, `${key}: ${step.text}`).toMatch(/^\d+ · Ortung\b/);
      }
    }
  });

  it('every station title has an index', () => {
    for (const t of titles.SUB_STATIONS) expect(titles.subStation(t)).toBeGreaterThanOrEqual(0);
    for (const t of titles.FRIGATE_STATIONS) expect(titles.frigateStation(t)).toBeGreaterThanOrEqual(0);
  });

  const snap = (cls: string, extra: Partial<Snapshot> = {}) => ({
    time: 100,
    own: { cls, alive: true, order: { speedKn: 5, depth: 50, heading: 0 }, towedLength: 900, towedOrder: 900, loadout: { rockets: 8 } },
    alerts: [],
    contacts: [],
    torpedoes: [],
    radio: [],
    ...extra,
  }) as unknown as Snapshot;

  it('the torpedo hint goes where the decoys are', () => {
    const torp = [{ kind: 'torpedo', time: 90, bearing: 10 }];
    const sub = assistant.subHint(snap('ssk', { alerts: torp } as Partial<Snapshot>));
    expect(titles.SUB_STATIONS[sub.station!]).toBe('Torpedoraum');
    const fr = assistant.frigateHint(snap('ffg', { alerts: torp } as Partial<Snapshot>));
    expect(titles.FRIGATE_STATIONS[fr.station!]).toBe('Waffen');
  });

  it('the active ping hint goes to the Ortung station', () => {
    const c = { label: 'S1', lastSeen: 95, via: 'own', assigned: 'submarine', sensors: ['towed'], history: [], bearing: 30 };
    const s = snap('ffg', { contacts: [c] } as unknown as Partial<Snapshot>);
    store.snap = s;
    store.selected = 'S1';
    const h = assistant.frigateHint(s);
    expect(titles.FRIGATE_STATIONS[h.station!]).toBe('Ortung');
  });
});
