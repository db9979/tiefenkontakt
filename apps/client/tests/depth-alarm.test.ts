import { describe, expect, it } from 'vitest';
import {
  activeAlarms, defaultAlarmCfg, initialAlarmState, loadAlarmCfg, sanitizeCfg, saveAlarmCfg, stepAlarms,
  type AlarmState, type DepthAlarmCfg,
} from '../src/widgets/depth-alarm';

const PD = 18;
const cfg: DepthAlarmCfg = { upperOn: true, upper: 12, lowerOn: true, lower: 270, groundOn: true, groundWarn: 50, groundDanger: 25 };

/** Runs a depth track (order fixed) and returns the state plus every raised alarm. */
function run(depths: number[], o: { order?: number; bottom?: number; c?: DepthAlarmCfg; s?: AlarmState } = {}) {
  let s = o.s ?? initialAlarmState();
  const raised: string[] = [];
  for (const depth of depths) {
    const r = stepAlarms(s, o.c ?? cfg, { depth, orderDepth: o.order ?? 100, bottom: o.bottom, periscopeDepth: PD });
    s = r.state;
    raised.push(...r.raised.map((x) => `${x.kind}${x.level}`));
  }
  return { s, raised };
}

describe('depth alarms', () => {
  it('defaults: lower limit at 90 % of test depth, ground 50 / 25 m', () => {
    expect(defaultAlarmCfg(300)).toMatchObject({ lower: 270, groundWarn: 50, groundDanger: 25 });
  });

  it('lower limit sounds once and re-arms only past the hysteresis', () => {
    const r = run([260, 271, 272, 269, 271, 266, 271]);
    // 269 is inside the hysteresis: no new alarm on 271; 266 leaves the band, 271 sounds again
    expect(r.raised).toEqual(['lower1', 'lower1']);
    expect(r.s.lower).toBe(1);
  });

  it('upper limit needs arming and stays silent when ordered to periscope depth', () => {
    // Diving from the surface: never deeper than the band yet, no alarm
    expect(run([5, 8, 11]).raised).toEqual([]);
    // Coming up unplanned (ordered 40 m) from depth: alarm
    expect(run([40, 20, 11]).raised).toEqual(['upper1']);
    // Ordered to periscope depth: no alarm even when passing the limit
    expect(run([40, 20, 11, 10], { order: PD }).raised).toEqual([]);
    // Ordering periscope depth while the alarm runs clears it
    const on = run([40, 11]);
    expect(on.s.upper).toBe(1);
    expect(run([10], { s: on.s, order: PD }).s.upper).toBe(0);
  });

  it('ground clearance: warning then danger, back down with hysteresis', () => {
    const r = run([100, 160, 180, 176, 170, 140], { bottom: 200 });
    // 40 m clear → warning, 20 m → danger, 24 m (inside hysteresis) stays danger, 30 m → warning, 60 m → clear
    expect(r.raised).toEqual(['ground1', 'ground2']);
    const steps = [100, 160, 180, 176, 170, 140].map((_, i, a) => run(a.slice(0, i + 1), { bottom: 200 }).s.ground);
    expect(steps).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it('jumping straight into danger raises danger only; unknown bottom is silent', () => {
    expect(run([190], { bottom: 200 }).raised).toEqual(['ground2']);
    expect(run([190]).raised).toEqual([]);
  });

  it('switched-off bands never sound and active ones list worst first', () => {
    const off = { ...cfg, lowerOn: false, groundOn: false };
    expect(run([290], { c: off, bottom: 300 }).raised).toEqual([]);
    const both = run([290], { bottom: 300 });
    expect(activeAlarms(both.s).map((a) => a.kind)).toEqual(['ground', 'lower']);
  });

  it('sanitizes settings and keeps them per class', () => {
    const c = sanitizeCfg({ groundWarn: 20, groundDanger: 40, upper: -5, lower: Number.NaN }, 300);
    expect(c.groundDanger).toBe(20);
    expect(c.upper).toBe(0);
    expect(c.lower).toBe(270);
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveAlarmCfg('typ209', { ...cfg, lower: 180 }, st);
    expect(loadAlarmCfg('typ209', 250, st).lower).toBe(180);
    expect(loadAlarmCfg('other', 250, st).lower).toBe(225);
  });

  it('keeps the upper limit at least 10 m above the lower one', () => {
    expect(sanitizeCfg({ upper: 200, lower: 120 }, 300)).toMatchObject({ upper: 110, lower: 120 });
  });
});
