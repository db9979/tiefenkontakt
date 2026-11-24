import { describe, expect, it } from 'vitest';
import { lightFromSun, lightNote, seaLayer, startHourFor, sunPosition } from '../src/index.js';

describe('sun and season on the real areas', () => {
  it('polar night at the Bear Island in January, midnight sun in July', () => {
    expect(sunPosition(74.7, 1, 12).el).toBeLessThan(-6);
    expect(lightFromSun(sunPosition(74.7, 1, 12).el)).toBeLessThan(0.3);
    expect(sunPosition(74.7, 7, 0).el).toBeGreaterThan(0);
    expect(lightNote(74.7, 1)).toMatch(/Polarnacht/);
    expect(lightNote(74.7, 7)).toMatch(/Mitternachtssonne/);
  });

  it('Gibraltar has an ordinary day and the sun sets in the evening', () => {
    expect(sunPosition(36, 7, 12).el).toBeGreaterThan(60);
    const dusk = startHourFor(36, 7, 'daemmerung');
    expect(dusk).toBeGreaterThan(18);
    expect(dusk).toBeLessThan(21);
    expect(lightNote(36, 1)).toBeUndefined();
  });

  it('the Mediterranean summer layer is shallow and hard, the Arctic winter has none', () => {
    const med = seaLayer('gibraltar', 7, 0.5);
    expect(med.depth).toBeLessThan(60);
    expect(med.loss).toBeGreaterThan(12);
    expect(seaLayer('barents', 1, 0.5).depth).toBe(0);
    expect(seaLayer('gotland', 1, 0.5).depth).toBeGreaterThan(50);
  });
});
