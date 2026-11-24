import { describe, expect, it } from 'vitest';
import { PerfReporter, deviceClass, dprBucket, frameStats, type PerfSampleMsg } from '../src/widgets/perf-report.js';

const env = () => ({ quality: 'mittel' as const, setting: 'auto' as const, steppedDown: false, device: 'phone' as const, dpr: '2' as const });

describe('graphics performance report', () => {
  it('classifies devices and pixel ratios coarsely', () => {
    expect(deviceClass(false, 390, 844)).toBe('desktop');
    expect(deviceClass(true, 390, 844)).toBe('phone');
    expect(deviceClass(true, 820, 1180)).toBe('tablet');
    expect([1, 1.3, 2, 2.6, 3].map(dprBucket)).toEqual(['1', '1.5', '2', '3', '3']);
  });

  it('computes average and 95th percentile', () => {
    const dts = [...Array(95).fill(20), ...Array(5).fill(100)];
    expect(frameStats(dts)).toEqual({ avgMs: 24, p95Ms: 100 });
  });

  it('sends once after a minute in 3D, once at the end, and ignores 2D time and long gaps', () => {
    const sent: PerfSampleMsg[] = [];
    const r = new PerfReporter((s) => sent.push(s), env, 60_000, 10_000);
    let t = 0;
    const run = (ms: number, in3d: boolean, step = 33) => {
      for (const end = t + ms; t < end; t += step) r.frame(t, in3d);
    };
    run(120_000, false); // 2D station: nothing
    expect(sent).toHaveLength(0);
    run(30_000, true);
    t += 5000; // tab hidden
    run(31_000, true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ phase: 'mid', avgMs: 33, p95Ms: 33, device: 'phone' });
    run(20_000, true, 50);
    r.end();
    r.end();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ phase: 'end', p95Ms: 50 });
  });

  it('skips the end sample when too little 3D time followed', () => {
    const sent: PerfSampleMsg[] = [];
    const r = new PerfReporter((s) => sent.push(s), env, 60_000, 10_000);
    for (let t = 0; t < 5000; t += 16) r.frame(t, true);
    r.end();
    expect(sent).toHaveLength(0);
  });
});
