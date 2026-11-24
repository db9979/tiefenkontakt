import { describe, expect, it } from 'vitest';
import { SEA_TIME_FACTOR } from '@tk/shared';
import { DEFAULT_SETTINGS, routeLength, simTimeLimit } from '../src/scenario.js';

describe('time compression', () => {
  it('keeps the battle the same at sea for every scale: only the real duration changes', () => {
    const at = (timeScale: number) => ({ ...DEFAULT_SETTINGS, timeScale });
    for (const n of [1, 2, 3]) {
      expect(simTimeLimit(at(n))).toBe(DEFAULT_SETTINGS.timeLimitMin * 60 * SEA_TIME_FACTOR);
      expect(routeLength(at(n))).toBe(routeLength(DEFAULT_SETTINGS));
    }
  });
});
