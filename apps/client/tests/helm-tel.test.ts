import { describe, expect, it } from 'vitest';
import { orderedRudder, telegraphOf } from '../src/screens/helm-tel.js';

describe('helm', () => {
  it('lays hard rudder for a big turn and eases it at the end (S8)', () => {
    expect(orderedRudder(105, 1.5)).toBe(35);
    expect(orderedRudder(-105, 1.5)).toBe(-35);
    const late = orderedRudder(1, 1.5);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(35);
    expect(orderedRudder(0.2, 1.5)).toBe(0);
  });

  it('a surface ship has surface telegraph steps, short names unique (F30)', () => {
    const surf = telegraphOf('ffg');
    expect(surf.map((s) => s.kn)).toEqual(['astern', 'halfAstern', -3, 0, 6, 12, 16, 22, 'max']);
    expect(new Set(surf.map((s) => s.short)).size).toBe(surf.length);
    const sub = telegraphOf('ssk');
    expect(sub.some((s) => s.kn === 3)).toBe(true);
    expect(new Set(sub.map((s) => s.short)).size).toBe(sub.length);
  });
});
