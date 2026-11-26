import { KN, angleDiff, bearing, type ClassChoice, type ClassId, type ContactTrack, type Snapshot } from '@tk/shared';
import type { Affiliation } from './symbols.js';

export const CHOICE_OF_CLASS: Record<ClassId, ClassChoice> = { merchant: 'merchant', ffg: 'warship', kor: 'warship', ssn: 'submarine', ssk: 'submarine', ssc: 'submarine', ssa: 'submarine', ssw: 'submarine', ffv: 'warship', ffk: 'warship', fischer: 'merchant', tanker: 'merchant', container: 'merchant', faehre: 'merchant', schlepper: 'merchant', yacht: 'merchant' };

/** A correlated contact stays own until it is this far off every friendly (deg) ... */
const LOOSE_DEG = 5;
/** ... for this long (s): no flicker EIGEN ↔ ? on a noisy bearing or an old report (F6). */
const HOLD_S = 30;
/** Datalink position error assumed (m): close in, it is a wide angle. */
const POS_ERR_M = 300;

type Cand = Pick<ContactTrack, 'bearing' | 'range' | 'classified' | 'sensors'> & { assigned?: ClassChoice; label?: string };

/** Last time each contact lined up with a friendly (per label; cleared when the clock runs backwards). */
const held = new Map<string, number>();
let heldTime = -1;

/** Bearing tolerance to one friendly: 2° far off, more close in and the older the report. */
function tolerance(s: Snapshot, f: Snapshot['friendlies'][number]): number {
  const d = Math.max(1, Math.hypot(f.x - s.own.x, f.y - s.own.y));
  const drift = POS_ERR_M + f.speedKn * KN * Math.max(0, s.time - f.reportedAt);
  return 2 + (Math.atan(drift / d) * 180) / Math.PI;
}

/** The friendly the contact lines up with within the tolerance plus `extra` degrees. */
function lineUp(c: Cand, s: Snapshot, extra: number): boolean {
  for (const f of s.friendlies) {
    if (!f.alive || s.time - f.reportedAt > 30) continue;
    if (c.classified && c.classified !== f.cls) continue;
    if (c.assigned && c.assigned !== 'unknown' && c.assigned !== CHOICE_OF_CLASS[f.cls]) continue;
    const tol = Math.max(tolerance(s, f), extra);
    if (Math.abs(angleDiff(bearing(s.own, f), c.bearing)) > tol) continue;
    if (c.range !== undefined && Math.abs(c.range - Math.hypot(f.x - s.own.x, f.y - s.own.y)) > 800 + (tol - 2) * 40) continue;
    return true;
  }
  return false;
}

/**
 * Datalink correlation: a sonar contact that lines up with a known friendly ship
 * (convoy or escort) is tagged as own. Uses only information the player has. With a label the
 * tag holds (hysteresis): it goes only after the contact has been more than 5° off every
 * friendly for 30 s.
 */
export function isFriendlyContact(c: Cand, s: Snapshot): boolean {
  if (c.assigned === 'torpedo') return false;
  if (s.friendlies.length === 0 || c.sensors.includes('esm')) return false;
  if (s.time < heldTime) held.clear();
  heldTime = s.time;
  const key = c.label;
  const was = key !== undefined ? held.get(key) : undefined;
  if (lineUp(c, s, was !== undefined ? LOOSE_DEG : 0)) {
    if (key !== undefined) held.set(key, s.time);
    return true;
  }
  if (was !== undefined && s.time - was <= HOLD_S) return true;
  if (key !== undefined) held.delete(key);
  return false;
}

/**
 * APP-6 affiliation of a contact (F5) from what the crew assigned (or, in Einsteiger, what the
 * optics named): submarine, torpedo or warship hostile, merchant neutral, unknown or biological
 * unknown; correlated with a friendly on the datalink: friend.
 */
export function affiliationOf(c: { assigned?: ClassChoice; classified?: ClassId }, friendly: boolean): Affiliation {
  if (friendly) return 'friend';
  const choice = c.assigned ?? (c.classified ? CHOICE_OF_CLASS[c.classified] : undefined);
  if (choice === 'submarine' || choice === 'torpedo' || choice === 'warship') return 'hostile';
  if (choice === 'merchant') return 'neutral';
  return 'unknown';
}
