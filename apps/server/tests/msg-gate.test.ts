import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMsg } from '@tk/shared';
import { MsgGate } from '../src/msg-gate.js';

describe('message flood limit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function gate(max = 5) {
    const applied: ClientMsg[] = [];
    let refused = 0;
    const g = new MsgGate(max, (m) => applied.push(m), () => refused++);
    return { g, applied, refused: () => refused };
  }

  it('keeps the last helm order of a compass drag above the limit and applies it when the window reopens', () => {
    const { g, applied } = gate();
    for (let h = 0; h < 40; h++) g.offer({ t: 'order', heading: h });
    expect(applied).toHaveLength(5);
    vi.advanceTimersByTime(1000);
    expect(applied).toHaveLength(6);
    expect(applied.at(-1)).toEqual({ t: 'order', heading: 39 });
  });

  it('merges coalesced orders field by field (a speed change is not lost behind a course drag)', () => {
    const { g, applied } = gate(1);
    g.offer({ t: 'leave' });
    g.offer({ t: 'order', speedKn: 12 });
    g.offer({ t: 'order', heading: 200 });
    g.offer({ t: 'order', heading: 210 });
    vi.advanceTimersByTime(1000);
    expect(applied.at(-1)).toEqual({ t: 'order', speedKn: 12, heading: 210 });
  });

  it('a pending order is folded into the next order that gets through', () => {
    const { g, applied } = gate(1);
    g.offer({ t: 'order', depth: 50 });
    g.offer({ t: 'order', heading: 90 }); // over the limit: pending
    vi.advanceTimersByTime(1000); // window reopens and flushes it
    expect(applied.at(-1)).toEqual({ t: 'order', heading: 90 });
    g.offer({ t: 'order', speedKn: 5 }); // over the limit again
    vi.advanceTimersByTime(500);
    expect(applied).toHaveLength(2);
    vi.advanceTimersByTime(600);
    expect(applied.at(-1)).toEqual({ t: 'order', speedKn: 5 });
  });

  it('refuses other messages above the limit with one notice per second', () => {
    const { g, applied, refused } = gate(2);
    for (let i = 0; i < 10; i++) g.offer({ t: 'leave' });
    expect(applied).toHaveLength(2);
    expect(refused()).toBe(1);
    vi.advanceTimersByTime(1000);
    g.offer({ t: 'leave' });
    expect(applied).toHaveLength(3);
  });

  it('applies nothing after the connection closed', () => {
    const { g, applied } = gate(1);
    g.offer({ t: 'order', heading: 1 });
    g.offer({ t: 'order', heading: 2 });
    g.close();
    vi.advanceTimersByTime(2000);
    expect(applied).toHaveLength(1);
  });
});
