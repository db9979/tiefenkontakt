import { describe, expect, it } from 'vitest';
import type { Debrief, PlayerStats } from '@tk/shared';
import { bandLabel, gradeOf, tmaQuality } from '../src/screens/debrief-grade.js';

const base: PlayerStats = {
  playerId: 'p', callsign: 'P', team: 'east', cls: 'ssk', survived: true, shots: 4, rockets: 0, buoys: 0, kills: 2,
  tonnageSunk: 10_000, distanceNm: 10, won: true, hits: 3, classified: 2, held: 1, undetectedS: 1200,
};

describe('debrief grade', () => {
  it('names the band from the own side', () => {
    expect(bandLabel(true, 'klar')).toBe('SIEG');
    expect(bandLabel(true, 'knapp')).toBe('KNAPPER SIEG');
    expect(bandLabel(false, 'knapp')).toBe('KNAPPE NIEDERLAGE');
    expect(bandLabel(false, 'remis')).toBe('UNENTSCHIEDEN');
    expect(bandLabel(false)).toBe('NIEDERLAGE');
  });

  it('grades a good submarine sortie well and an idle one poorly', () => {
    const good = gradeOf(base, 2400, 0.9);
    expect(good.score).toBeGreaterThanOrEqual(70);
    expect(good.lines.map((l) => l.label)).toContain('BESTE TMA-GÜTE');
    const idle = gradeOf({ ...base, shots: 0, hits: 0, kills: 0, classified: 0, survived: false, undetectedS: 60 }, 2400);
    expect(idle.score).toBeLessThan(40);
    expect(idle.label).toBe('MANGELHAFT');
  });

  it('grades an escort on contacts held, attacks and merchants protected', () => {
    const g = gradeOf({ ...base, team: 'west', cls: 'ffg', shots: 0, rockets: 3, hits: 1, held: 2, merchantsSafe: 0.75 }, 2400);
    expect(g.lines.map((l) => l.label)).toEqual(['KONTAKTE KLASSIFIZIERT', 'KONTAKTE GEHALTEN', 'ANGRIFFE / TREFFER', 'FRACHTER GESCHÜTZT', 'ÜBERLEBT']);
    expect(g.score).toBeGreaterThan(70);
  });

  it('measures TMA quality against the replay truth', () => {
    const d = {
      ships: [{ id: 'm1', name: 'M', cls: 'merchant', team: 'west', player: false }, { id: 'p_p', name: 'U', cls: 'ssk', team: 'east', player: true }],
      frames: [[600, [['m1', 1000, 5000, 90, 1], ['p_p', 0, 0, 0, 1]]]],
    } as unknown as Debrief;
    expect(tmaQuality(d, 'east', [{ t0: 610, x0: 1200, y0: 5000, course: 90, speedKn: 9 }])).toBe(1);
    expect(tmaQuality(d, 'east', [{ t0: 600, x0: 2650, y0: 5000, course: 90, speedKn: 9 }])).toBeCloseTo(0.5);
    expect(tmaQuality(d, 'east', [])).toBeUndefined();
  });
});
