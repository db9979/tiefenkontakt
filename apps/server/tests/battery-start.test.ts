import { describe, expect, it } from 'vitest';
import { CLASSES, type PlayerSlot } from '@tk/shared';
import { DEFAULT_SETTINGS, buildScenario } from '../src/scenario.js';
import { buildBriefing } from '../src/briefing.js';

const slots: PlayerSlot[] = [
  { playerId: 'w1', callsign: 'W1', team: 'west', cls: 'ffg', ready: true },
  { playerId: 'e1', callsign: 'E1', team: 'east', cls: 'ssk', ready: true },
  { playerId: 'e2', callsign: 'E2', team: 'east', cls: 'ssn', ready: true },
];

const pctOf = (b: number) => (100 * b) / CLASSES.ssk.battery!.capacityKnH;

describe('battery at the start of a match (C5)', () => {
  it('diesel boats start 40–70 % charged, drawn from the seed; the briefing names the charge', () => {
    const pcts = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => pctOf(buildScenario(slots, DEFAULT_SETTINGS, seed).ships.find((s) => s.id === 'p_e1')!.battery!));
    for (const p of pcts) {
      expect(p).toBeGreaterThanOrEqual(40);
      expect(p).toBeLessThanOrEqual(70);
    }
    expect(new Set(pcts.map(Math.round)).size).toBeGreaterThan(1);
    const w = buildScenario(slots, DEFAULT_SETTINGS, 1);
    const again = buildScenario(slots, DEFAULT_SETTINGS, 1);
    const u = w.ships.find((s) => s.id === 'p_e1')!;
    expect(again.ships.find((s) => s.id === 'p_e1')!.battery).toBe(u.battery);
    const b = buildBriefing(w, u, DEFAULT_SETTINGS, () => 0.5);
    expect(b.intel.some((l) => /^Batterie bei \d+ %/.test(l))).toBe(true);
    // The nuclear boat has no battery line
    const ssn = w.ships.find((s) => s.id === 'p_e2')!;
    expect(buildBriefing(w, ssn, DEFAULT_SETTINGS, () => 0.5).intel.some((l) => l.startsWith('Batterie'))).toBe(false);
  });

  it('easy matches start with at least 60 %', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = buildScenario(slots, { ...DEFAULT_SETTINGS, botSkill: 'leicht' }, seed);
      expect(pctOf(w.ships.find((s) => s.id === 'p_e1')!.battery!)).toBeGreaterThanOrEqual(60);
    }
  });
});
