import { describe, expect, it } from 'vitest';
import {
  BTN, COURSE_INTERVAL_MS, CourseStick, DEAD_ZONE, Edge, PadMapper, RateLimiter, REPEAT_DELAY_MS, REPEAT_EVERY_MS, deadZone,
  type PadState,
} from '../src/gamepad-map.js';

const pad = (axes: number[] = [0, 0, 0, 0], down: number[] = [], analog: Record<number, number> = {}): PadState => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: analog[i] ?? (down.includes(i) ? 1 : 0) })),
});

describe('deadZone', () => {
  it('drops small deflections', () => {
    expect(deadZone(0)).toBe(0);
    expect(deadZone(DEAD_ZONE)).toBe(0);
    expect(deadZone(-0.1)).toBe(0);
    expect(deadZone(Number.NaN)).toBe(0);
  });
  it('rescales the rest to 0…±1', () => {
    expect(deadZone(1)).toBeCloseTo(1);
    expect(deadZone(-1)).toBeCloseTo(-1);
    expect(deadZone(1.2)).toBeCloseTo(1);
    expect(deadZone(0.6)).toBeCloseTo(0.5);
  });
});

describe('Edge', () => {
  it('fires once per press without repeat', () => {
    const e = new Edge();
    expect(e.update(true, 0)).toBe(true);
    expect(e.update(true, 16)).toBe(false);
    expect(e.update(true, 5000)).toBe(false);
    expect(e.update(false, 5016)).toBe(false);
    expect(e.update(true, 5032)).toBe(true);
  });
  it('repeats while held after the delay', () => {
    const e = new Edge(true);
    expect(e.update(true, 0)).toBe(true);
    expect(e.update(true, REPEAT_DELAY_MS - 1)).toBe(false);
    expect(e.update(true, REPEAT_DELAY_MS)).toBe(true);
    expect(e.update(true, REPEAT_DELAY_MS + REPEAT_EVERY_MS - 1)).toBe(false);
    expect(e.update(true, REPEAT_DELAY_MS + REPEAT_EVERY_MS)).toBe(true);
  });
});

describe('RateLimiter', () => {
  it('lets one event through per interval', () => {
    const r = new RateLimiter(250);
    expect(r.ready(1000)).toBe(true);
    expect(r.ready(1100)).toBe(false);
    expect(r.ready(1249)).toBe(false);
    expect(r.ready(1250)).toBe(true);
  });
});

describe('CourseStick', () => {
  it('does nothing inside the dead zone', () => {
    const c = new CourseStick();
    for (let t = 0; t < 2000; t += 16) expect(c.update(0.1, t, 90)).toBeUndefined();
  });
  it('turns right at full deflection and sends at most every interval', () => {
    const c = new CourseStick();
    const sent: [number, number][] = [];
    for (let t = 0; t <= 2000; t += 16) {
      const h = c.update(1, t, 90);
      if (h !== undefined) sent.push([t, h]);
    }
    expect(sent.length).toBeGreaterThan(3);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(2000 / COURSE_INTERVAL_MS) + 1);
    for (let i = 1; i < sent.length; i++) expect(sent[i]![0] - sent[i - 1]![0]).toBeGreaterThanOrEqual(COURSE_INTERVAL_MS);
    // 2 s at ~30 °/s from 090
    const last = sent.at(-1)![1];
    expect(last).toBeGreaterThan(130);
    expect(last).toBeLessThanOrEqual(150);
  });
  it('wraps through north when turning left', () => {
    const c = new CourseStick();
    let last: number | undefined;
    for (let t = 0; t <= 1000; t += 16) last = c.update(-1, t, 10) ?? last;
    expect(last).toBeGreaterThan(330);
  });
  it('sends the final heading on release', () => {
    const c = new CourseStick();
    let lastSent: number | undefined;
    let t = 0;
    for (; t <= 600; t += 16) lastSent = c.update(1, t, 0) ?? lastSent;
    const flush = c.update(0, t, 0);
    expect(flush ?? lastSent).toBeGreaterThan(lastSent ?? 0);
    expect(c.update(0, t + 16, 0)).toBeUndefined();
  });
  it('sends nothing for a flick that does not move the course', () => {
    const c = new CourseStick();
    expect(c.update(0.3, 0, 45)).toBeUndefined();
    expect(c.update(0.3, 16, 45)).toBeUndefined();
    expect(c.update(0, 32, 45)).toBeUndefined();
  });
  it('needs a known ordered heading', () => {
    const c = new CourseStick();
    for (let t = 0; t < 1000; t += 16) expect(c.update(1, t, undefined)).toBeUndefined();
  });
});

describe('PadMapper', () => {
  it('maps buttons to actions on the press edge only', () => {
    const m = new PadMapper();
    expect(m.step(pad([0, 0], [BTN.RB, BTN.START]), 0, 0)).toEqual([{ kind: 'station', delta: 1 }, { kind: 'menu' }]);
    expect(m.step(pad([0, 0], [BTN.RB, BTN.START]), 16, 0)).toEqual([]);
    expect(m.step(pad(), 32, 0)).toEqual([]);
    expect(m.step(pad([0, 0], [BTN.LB, BTN.BACK]), 48, 0)).toEqual([{ kind: 'station', delta: -1 }, { kind: 'help' }]);
  });
  it('treats analog triggers past half travel as pressed and repeats them', () => {
    const m = new PadMapper();
    expect(m.step(pad([0, 0], [], { [BTN.RT]: 0.3 }), 0, 0)).toEqual([]);
    expect(m.step(pad([0, 0], [], { [BTN.RT]: 0.8 }), 16, 0)).toEqual([{ kind: 'speed', delta: 1 }]);
    expect(m.step(pad([0, 0], [], { [BTN.RT]: 0.8 }), 32, 0)).toEqual([]);
    expect(m.step(pad([0, 0], [], { [BTN.RT]: 0.8 }), 16 + REPEAT_DELAY_MS, 0)).toEqual([{ kind: 'speed', delta: 1 }]);
    expect(m.step(pad([0, 0], [BTN.LT]), 1000, 0)).toEqual([{ kind: 'speed', delta: -1 }]);
  });
  it('maps the D-pad to depth and fine course', () => {
    const m = new PadMapper();
    expect(m.step(pad([0, 0], [BTN.DOWN]), 0, 0)).toEqual([{ kind: 'depth', delta: 10 }]);
    expect(m.step(pad([0, 0], [BTN.UP, BTN.RIGHT]), 16, 0)).toEqual([{ kind: 'depth', delta: -10 }, { kind: 'turn', delta: 1 }]);
  });
  it('emits rate-limited course orders from the left stick', () => {
    const m = new PadMapper();
    let n = 0;
    for (let t = 0; t <= 1000; t += 16) n += m.step(pad([1, 0]), t, 180).filter((a) => a.kind === 'course').length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(5);
  });
});

describe('frame watch', () => {
  it('reports a device that cannot keep up, not one that can or a hidden tab', async () => {
    const { FrameWatch } = await import('../src/widgets/perf.js');
    const fast = new FrameWatch(() => 1000 / 30);
    let t = 0, slow = false;
    for (let i = 0; i < 400; i++) slow ||= fast.note((t += 34));
    expect(slow).toBe(false);
    const weak = new FrameWatch(() => 1000 / 30);
    t = 0;
    for (let i = 0; i < 200; i++) slow ||= weak.note((t += 70));
    expect(slow).toBe(true);
    const hidden = new FrameWatch(() => 1000 / 30);
    t = 0; slow = false;
    for (let i = 0; i < 50; i++) slow ||= hidden.note((t += i % 2 ? 34 : 2000));
    expect(slow).toBe(false);
  });
});
