import { describe, expect, it } from 'vitest';
import { createShip, createWorld, installWeapons, stepWorld, type ContactTrack } from '@tk/shared';
import { BotCrew } from '../src/bots/index.js';
import { newMemory, setShotTrace, type ShotTrace } from '../src/bots/common.js';
import { carryPlot } from '../src/bots/sub.js';
import { PACE, activeFixes, captainPace, escortMayFire, legsRun, plotFrom, subWaits, type SubShot } from '../src/bots/pacing.js';

const p = PACE.normal;
const ready: SubShot = { held: 900, seen: false, legs: 2, q: 70, qMin: 52, settled: 300, range: 6000, maxRange: 8000, measured: false };

describe('AI attack pacing', () => {
  it('counts the TMA legs the boat ran inside the plot window', () => {
    expect(legsRun([], 0, 600, 90)).toBe(0);
    expect(legsRun([0], 0, 600, 90)).toBe(1);
    expect(legsRun([0, 180, 360], 0, 540, 90)).toBe(3);
    // Too short a leg doesn't count; the current leg counts once it has run long enough
    expect(legsRun([0, 60, 120], 0, 150, 90)).toBe(0);
    expect(legsRun([0, 200], 0, 260, 90)).toBe(1);
    expect(legsRun([0, 200], 0, 300, 90)).toBe(2);
    // Only the part after the classification counts
    expect(legsRun([0, 180], 120, 300, 90)).toBe(1);
  });

  it('the boat holds fire until classified, two legs, a settled solution and in reach', () => {
    expect(subWaits(p, 1, ready)).toBeUndefined();
    expect(subWaits(p, 1, { ...ready, held: 60 })).toBe('classify');
    // A periscope look classifies at once, but the plot still needs its legs
    expect(subWaits(p, 1, { ...ready, held: 60, seen: true, legs: 1 })).toBe('legs');
    expect(subWaits(p, 1, { ...ready, legs: 1 })).toBe('legs');
    expect(subWaits(p, 1, { ...ready, q: 40 })).toBe('tma');
    expect(subWaits(p, 1, { ...ready, settled: 10 })).toBe('settle');
    expect(subWaits(p, 1, { ...ready, range: 12_000 })).toBe('range');
    expect(subWaits(p, 1, { ...ready, range: undefined })).toBe('range');
  });

  it('a measured range replaces the TMA quality, not the legs; a loud close boat needs one leg', () => {
    expect(subWaits(p, 1, { ...ready, q: 0, settled: 0, measured: true })).toBeUndefined();
    expect(subWaits(p, 1, { ...ready, q: 0, settled: 0, measured: true, legs: 1 })).toBe('legs');
    expect(subWaits(p, 1, { ...ready, q: 0, settled: 0, close: true, legs: 1 })).toBeUndefined();
  });

  it('the TMA legs count only after the classification', () => {
    expect(plotFrom(p, 1, 100, 500)).toBe(100 + p.classifyS);
    expect(plotFrom(p, 1.2, 100, 500)).toBe(100 + p.classifyS * 1.2);
    expect(plotFrom(p, 1, 0, 5000)).toBe(5000 - 900);
  });

  it('skill and captain set the tempo: weaker crews and cautious captains take longer', () => {
    expect(PACE.leicht.legS).toBeGreaterThan(PACE.normal.legS);
    expect(PACE.schwer.prosecuteS).toBeLessThan(PACE.normal.prosecuteS);
    const fs = Array.from({ length: 200 }, (_, i) => captainPace(`p_bot-e${i}`, 7));
    expect(Math.min(...fs)).toBeGreaterThanOrEqual(0.85);
    expect(Math.max(...fs)).toBeLessThanOrEqual(1.3);
    // A reckless commander hurries, but never below the floor
    expect(captainPace('p_bot-e1', 7, 'draufgaenger')).toBeGreaterThanOrEqual(0.85);
    expect(Math.max(...fs) - Math.min(...fs)).toBeGreaterThan(0.3);
    expect(captainPace('p_bot-e1', 7)).toBe(captainPace('p_bot-e1', 7));
    expect(captainPace('p_bot-e1', 7, 'vorsichtig')).toBeGreaterThan(captainPace('p_bot-e1', 7, 'draufgaenger'));
  });

  it('an escort localizes before firing: held long enough and repeated active fixes', () => {
    expect(escortMayFire(p, 1, 'echo', 30, 3)).toBe(false);
    expect(escortMayFire(p, 1, 'echo', 600, 1)).toBe(false);
    expect(escortMayFire(p, 1, 'echo', 600, 2)).toBe(true);
    // A bearing-only cross-fix needs the contact half as long again
    expect(escortMayFire(p, 1, 'buoy', p.prosecuteS, 0)).toBe(false);
    expect(escortMayFire(p, 1, 'buoy', p.prosecuteS * 1.5, 0)).toBe(true);
    expect(escortMayFire(p, 1, 'datum', p.prosecuteS, 0)).toBe(true);
    const t = { history: [
      { t: 10, b: 0, sensor: 'active', r: 3000 }, { t: 12, b: 0, sensor: 'active', r: 3000 }, { t: 40, b: 0, sensor: 'hull' },
      { t: 60, b: 0, sensor: 'active', r: 2900 }, { t: 70, b: 0, sensor: 'mad', r: 100 },
    ] } as unknown as ContactTrack;
    expect(activeFixes(t, 100)).toBe(3);
    expect(activeFixes(t, 250)).toBe(1);
  });

  it('a bot boat with a merchant 7 km off fires only after classifying and two TMA legs', () => {
    const sub = createShip({ id: 'p_e1', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 90, speedKn: 4, depth: 60 });
    const merchant = createShip({ id: 'm1', cls: 'merchant', name: 'Frachter', team: 'west', pos: { x: 5000, y: -5000 }, heading: 0, speedKn: 8 });
    const w = createWorld([sub, merchant], 7, { layerDepth: 150, layerLoss: 12, seaState: 2 });
    installWeapons(w);
    const crew = new BotCrew('normal');
    crew.add('p_e1');
    const shots: ShotTrace[] = [];
    setShotTrace((r) => shots.push(r));
    let contact: number | undefined;
    try {
      for (let i = 0; i < 30 * 60 * 10 && !shots.length; i++) {
        stepWorld(w);
        crew.step(w);
        contact ??= w.books.get('p_e1')?.tracks().length ? w.time : undefined;
      }
    } finally {
      setShotTrace(undefined);
    }
    expect(contact).toBeDefined();
    expect(shots.length).toBeGreaterThan(0);
    const s = shots[0]!;
    // Classification plus two legs of at least the minimum: never inside the first five minutes of contact
    expect(s.t - contact!).toBeGreaterThan(p.classifyS * 0.85 + 2 * p.legS * 0.85);
    expect(s.legs).toBeGreaterThanOrEqual(2);
    expect(s.range).toBeLessThanOrEqual(8000);
  });

  it('carries the plot over when a lost contact comes back under a new label', () => {
    const m = newMemory('p_x');
    const fix = (t: number) => ({ t, b: 10, ox: 0, oy: 0, n: 1 });
    m.blog = { S1: { fixes: [fix(0), fix(10), fix(20)], binEnd: 30, seen: 25 }, S2: { fixes: [fix(60)], binEnd: 70, seen: 65 } };
    m.qualSince = { S1: 15 };
    carryPlot(m, 'S1', 'S2');
    expect(m.blog.S2!.fixes.map((f) => f.t)).toEqual([0, 10, 20, 60]);
    expect(m.blog.S2!.binEnd).toBe(70);
    expect(m.qualSince.S2).toBe(15);
  });
});
