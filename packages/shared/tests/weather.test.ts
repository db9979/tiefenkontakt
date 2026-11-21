import { describe, expect, it } from 'vitest';
import { Rng, ambientNoise, daylight, initWeather, stepWeather, type Environment } from '../src/index.js';

describe('changing weather', () => {
  it('daylight follows the clock', () => {
    expect(daylight(12)).toBe(1);
    expect(daylight(1)).toBeLessThan(0.2);
    expect(daylight(19)).toBeGreaterThan(0.2);
    expect(daylight(19)).toBeLessThan(1);
  });

  it('over hours the sea changes, rain comes, the layer moves and dusk falls', () => {
    const env: Environment = { layerDepth: 120, layerLoss: 12, seaState: 3 };
    env.weather = initWeather(env, 16, true);
    const rng = new Rng(9);
    const seas = new Set<number>();
    const layers = new Set<number>();
    let rained = false;
    for (let t = 1; t <= 6 * 3600; t++) {
      stepWeather(env, t, 1, rng);
      seas.add(env.seaState);
      layers.add(env.layerDepth);
      if (env.rain) rained = true;
    }
    expect(seas.size).toBeGreaterThan(1);
    expect(layers.size).toBeGreaterThan(1);
    expect(rained).toBe(true);
    expect(env.light).toBeLessThan(0.2); // 16:00 + 6 h = 22:00
  });

  it('rain raises the ambient noise; stable weather stays put', () => {
    const env: Environment = { layerDepth: 120, layerLoss: 12, seaState: 3 };
    const dry = ambientNoise(env);
    expect(ambientNoise({ ...env, rain: true })).toBe(dry + 6);
    env.weather = initWeather(env, 10, false);
    for (let t = 1; t <= 7200; t++) stepWeather(env, t, 1, new Rng(1));
    expect(env.seaState).toBe(3);
  });
});
