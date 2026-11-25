import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FRIGATE_STATION_IDS, SUB_STATION_IDS, type Snapshot, type StationId } from '@tk/shared';

/**
 * Hints, tutorials, the event log and the help screen send the player to stations by id.
 * When stations move or merge, every reference must follow: a tutorial step on the frigate
 * must name a frigate station, the torpedo hint must go where the decoys are, and the label
 * "3 · Feuerleitung" must be the station that really has key 3.
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
const sideIds = (side: 'sub' | 'frigate'): readonly StationId[] => (side === 'sub' ? SUB_STATION_IDS : FRIGATE_STATION_IDS);

describe('station references', () => {
  it('four submarine and five frigate stations, titled in tab order', () => {
    expect(titles.SUB_STATIONS).toEqual(['Horchraum', 'Sehrohr', 'Feuerleitung', 'Zentrale']);
    expect(titles.FRIGATE_STATIONS).toEqual(['OPZ', 'Sonar', 'Waffen', 'Radar/ESM', 'Brücke']);
    expect(titles.stationLabel('feuerleitung')).toBe('3 · Feuerleitung');
    expect(titles.stationLabel('bruecke')).toBe('5 · Brücke');
  });

  it('every tutorial step names a station of its own side, one line to do and a target', () => {
    for (const [key, lesson] of Object.entries(tutorial.LESSON_STEPS)) {
      const side = LESSON_SIDE[key];
      expect(side, `lesson ${key} has no side in the test`).toBeDefined();
      for (const step of lesson.steps) {
        if (step.station) expect(sideIds(side!), `${key}: ${step.where}`).toContain(step.station);
        // One imperative line: the explanation belongs under "Warum?"
        expect(step.do.length, `${key}: "${step.do}" is too long for one line`).toBeLessThanOrEqual(120);
        if (step.station) expect(step.target, `${key}: ${step.where} points at nothing`).toBeTruthy();
      }
    }
  });

  it('the step label carries the station number', () => {
    const step = tutorial.LESSON_STEPS.feindfahrt!.steps.find((s) => s.station === 'feuerleitung')!;
    expect(tutorial.stepLabel(step)).toMatch(/^3 · Feuerleitung · /);
  });

  it('frigate steps about the active ping go to the sonar station and the single-ping button', () => {
    for (const [key, lesson] of Object.entries(tutorial.LESSON_STEPS)) {
      if (LESSON_SIDE[key] !== 'frigate') continue;
      for (const step of lesson.steps) {
        if (/LFM|Einzelping/.test(step.do)) {
          expect(step.station, `${key}: ${step.do}`).toBe('sonar');
          expect(step.target).toBe('#as-one');
        }
      }
    }
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
    expect(assistant.subHint(snap('ssk', { alerts: torp } as Partial<Snapshot>)).station).toBe('feuerleitung');
    expect(assistant.frigateHint(snap('ffg', { alerts: torp } as Partial<Snapshot>)).station).toBe('waffen');
  });

  it('the active ping hint goes to the sonar station', () => {
    const c = { label: 'S1', lastSeen: 95, via: 'own', assigned: 'submarine', sensors: ['towed'], history: [], bearing: 30 };
    const s = snap('ffg', { contacts: [c] } as unknown as Partial<Snapshot>);
    store.snap = s;
    store.selected = 'S1';
    expect(assistant.frigateHint(s).station).toBe('sonar');
  });
});
