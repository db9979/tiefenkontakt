import { describe, expect, it } from 'vitest';
import { targetPosAt, type ContactTrack } from '@tk/shared';
import { astern, escortKn } from '../src/bots/wake-shot.js';

const track = (o: Partial<ContactTrack>): ContactTrack => ({ label: 'S1', firstSeen: 0, lastSeen: 100, bearing: 0, se: 20, sensors: ['hull'], ...o }) as ContactTrack;

describe('SSN wake homer against an escort', () => {
  it('reckons the escort speed by the turn count when the shaft line is fresh, else by the TMA', () => {
    const sol = { t0: 0, x0: 0, y0: 0, course: 90, speedKn: 9 };
    // 8 turns per knot: 2,8 Hz shaft = 168 rpm = 21 kn
    expect(escortKn(track({ evidence: { tonals: [], shaftHz: 2.8 }, evidenceAt: 90 }), sol, 100)).toBeCloseTo(21, 5);
    expect(escortKn(track({ evidence: { tonals: [], shaftHz: 2.8 }, evidenceAt: 0 }), sol, 100)).toBe(9);
    expect(escortKn(track({}), undefined, 100)).toBeUndefined();
  });

  it('aims astern of the escort: the same course and speed, her track some way behind her', () => {
    const sol = { t0: 0, x0: 1000, y0: 0, course: 90, speedKn: 20 };
    const a = astern(sol, 600);
    expect(targetPosAt(a, 30).x).toBeCloseTo(targetPosAt(sol, 30).x - 600, 5);
    expect(a.course).toBe(90);
    expect(a.speedKn).toBe(20);
  });
});
