import { describe, expect, it } from 'vitest';
import { ESM_DANGER_REPEAT_S, ESM_REPEAT_S, EsmThrottle } from '../src/widgets/esm-throttle.js';

describe('ESM in the message log', () => {
  it('reports a radar once per bearing, then again after a quiet spell', () => {
    const t = new EsmThrottle();
    const a = (time: number, bearing = 100) => ({ time, bearing, emitter: 'SEEFALKE-2', esmLvl: 1, esmTrend: 0 });
    expect(t.report(a(0), false)).toBe(true);
    for (let s = 1; s < ESM_REPEAT_S; s += 1) expect(t.report(a(s, 100 + (s % 5)), false)).toBe(false);
    expect(t.report(a(ESM_REPEAT_S), false)).toBe(true);
    // Another bearing or another radar is news at once
    expect(t.report(a(ESM_REPEAT_S + 1, 220), false)).toBe(true);
    expect(t.report({ ...a(ESM_REPEAT_S + 1), emitter: 'TAIFUN-11' }, false)).toBe(true);
  });

  it('reports again when the signal gets stronger or starts closing', () => {
    const t = new EsmThrottle();
    expect(t.report({ time: 0, bearing: 40, emitter: 'KORMORAN-1', esmLvl: 0, esmTrend: 0 }, false)).toBe(true);
    expect(t.report({ time: 5, bearing: 40, emitter: 'KORMORAN-1', esmLvl: 1, esmTrend: 0 }, false)).toBe(true);
    expect(t.report({ time: 10, bearing: 40, emitter: 'KORMORAN-1', esmLvl: 1, esmTrend: 1 }, false)).toBe(true);
    expect(t.report({ time: 15, bearing: 40, emitter: 'KORMORAN-1', esmLvl: 1, esmTrend: 1 }, false)).toBe(false);
  });

  it('repeats aircraft and fire-control radars sooner', () => {
    const t = new EsmThrottle();
    const a = (time: number) => ({ time, bearing: 300, emitter: 'ALBATROS-7', esmLvl: 1, esmTrend: 0 });
    expect(t.report(a(0), true)).toBe(true);
    expect(t.report(a(ESM_DANGER_REPEAT_S - 1), true)).toBe(false);
    expect(t.report(a(ESM_DANGER_REPEAT_S), true)).toBe(true);
  });
});
