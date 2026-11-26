import { describe, expect, it } from 'vitest';
import { seaClimate, type PlayerSlot } from '@tk/shared';
import { DEFAULT_SETTINGS, buildScenario } from '../src/scenario.js';
import { buildBriefing } from '../src/briefing.js';

/** Frigate audit 4: ice by the area's climate (F23), mission-aware escort briefings (F24, F20, F34). */

const slots: PlayerSlot[] = [
  { playerId: 'w1', callsign: 'W1', team: 'west', cls: 'ffg', ready: true },
  { playerId: 'e1', callsign: 'E1', team: 'east', cls: 'ssk', ready: true },
];

describe('frigate audit 4: scenario and briefing', () => {
  it('Grönland-Lücke (Färöer-Bank) has sea ice only when the area\'s climate has it (never at 60.7° N)', () => {
    for (const season of ['winter', 'herbst', 'sommer'] as const) {
      const w = buildScenario(slots, { ...DEFAULT_SETTINGS, mission: 'groenland', season }, 3);
      expect(seaClimate('faroebank', w.env.month!).ice).toBe(false);
      expect(w.env.met?.floes ?? []).toHaveLength(0);
      expect(w.env.met?.bergs ?? []).toHaveLength(0);
    }
  });

  it('the strait (no convoy): the escort briefing speaks of the strait, not of a convoy', () => {
    const s = { ...DEFAULT_SETTINGS, mission: 'meerenge' as const };
    const w = buildScenario(slots, s, 2);
    const f = w.ships.find((x) => x.id === 'p_w1')!;
    const b = buildBriefing(w, f, s, () => 0.5);
    const text = [b.goal, ...b.intel, ...b.steps].join(' | ');
    expect(text).not.toMatch(/Konvoi/);
    expect(b.intel.some((l) => /^Bedrohung: .*im Anlauf auf die Enge$/.test(l))).toBe(true);
    expect(b.steps[0]).toMatch(/Enge/);
    // Mine danger with both figures the sim uses: mine-avoidance sonar 1,6 km, active sonar 1 km
    expect(b.intel.find((l) => l.startsWith('Minengefahr'))).toMatch(/1,6 km.*1 km/);
  });

  it('convoy missions keep the convoy texts; bearings carry the degree sign', () => {
    const w = buildScenario(slots, DEFAULT_SETTINGS, 2);
    const f = w.ships.find((x) => x.id === 'p_w1')!;
    const b = buildBriefing(w, f, DEFAULT_SETTINGS, () => 0.5);
    expect(b.intel.some((l) => /^Konvoi: Peilung \d{3}°, \d+ km, \d+ Frachter$/.test(l))).toBe(true);
    expect(b.intel.some((l) => /vermutlich voraus des Konvois$/.test(l))).toBe(true);
    const u = w.ships.find((x) => x.id === 'p_e1')!;
    const bu = buildBriefing(w, u, DEFAULT_SETTINGS, () => 0.5);
    expect(bu.intel.some((l) => /etwa Peilung \d{3}°, /.test(l))).toBe(true);
    expect(bu.intel.some((l) => /Generalkurs \d{3}°$/.test(l))).toBe(true);
  });
});
