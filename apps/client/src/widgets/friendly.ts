import { KN, angleDiff, bearing, type ClassChoice, type ClassId, type ContactTrack, type Snapshot } from '@tk/shared';
import type { Affiliation } from './symbols.js';

export const CHOICE_OF_CLASS: Record<ClassId, ClassChoice> = { merchant: 'merchant', ffg: 'warship', kor: 'warship', ssn: 'submarine', ssk: 'submarine', ssc: 'submarine', ssa: 'submarine', ssw: 'submarine', ffv: 'warship', ffk: 'warship', fischer: 'merchant', tanker: 'merchant', container: 'merchant', faehre: 'merchant', schlepper: 'merchant', yacht: 'merchant' };

/** A correlated contact stays own until it is this far off every friendly (deg) ... */
const LOOSE_DEG = 5;
/** ... for this long (s): no flicker EIGEN ↔ ? on a noisy bearing or an old report (F6). */
const HOLD_S = 30;
/** A track not heard for this long (s) gives way to fresh ones on the same friendly. */
const STALE_S = 60;
/** Datalink position error assumed (m): close in, it is a wide angle. The link's gridlock error
 * (150–400 m per unit, apps/server/src/datalink.ts) is in it; a mate's track compares two units' frames. */
const POS_ERR_M = 330;
const POS_ERR_LINK_M = 700;
/** A warship this close to a datalink track's origin is the unit that reported it (m). */
const REPORTER_M = 1000;

type Cand = Pick<ContactTrack, 'bearing' | 'range' | 'classified' | 'sensors'> & Partial<Pick<ContactTrack, 'originX' | 'originY'>> & { assigned?: ClassChoice; label?: string; via?: 'own' | 'datalink' };

/** Last time each contact lined up with a friendly (per label; cleared when the clock runs backwards). */
const held = new Map<string, number>();
/** The friendly (picture:index) each held contact was last tagged to. */
const heldSlot = new Map<string, string>();
let heldTime = -1;

/** Bearing tolerance to one friendly: 2° far off, more close in and the older the report. */
function tolerance(s: Snapshot, f: Snapshot['friendlies'][number], o: { x: number; y: number }, link: boolean): number {
  const d = Math.max(1, Math.hypot(f.x - o.x, f.y - o.y));
  const drift = (link ? POS_ERR_LINK_M : POS_ERR_M) + f.speedKn * KN * Math.max(0, s.time - f.reportedAt);
  return 2 + (Math.atan(drift / d) * 180) / Math.PI;
}

/** How well the contact lines up with each friendly (error over tolerance, below 1 = inside it). */
function lineUps(c: Cand, s: Snapshot, extra: number): { i: number; score: number }[] {
  // N2: a sonobuoy bearing is measured from the buoy, not from the own ship
  const o = c.originX !== undefined && c.originY !== undefined ? { x: c.originX, y: c.originY } : s.own;
  const out: { i: number; score: number }[] = [];
  s.friendlies.forEach((f, i) => {
    if (!f.alive || s.time - f.reportedAt > 30) return;
    if (c.classified && c.classified !== f.cls) return;
    if (c.assigned && c.assigned !== 'unknown' && c.assigned !== CHOICE_OF_CLASS[f.cls]) return;
    // A mate's track never is the mate itself: the reporting warship sits at the track's origin
    // (within its gridlock error), where any bearing lined up with it ("EIGEN" on every mate track)
    if (c.via === 'datalink' && CHOICE_OF_CLASS[f.cls] === 'warship' && Math.hypot(f.x - o.x, f.y - o.y) < REPORTER_M) return;
    const tol = Math.max(tolerance(s, f, o, c.via === 'datalink'), extra);
    const err = Math.abs(angleDiff(bearing(o, f), c.bearing));
    if (err > tol) return;
    if (c.range !== undefined && Math.abs(c.range - Math.hypot(f.x - o.x, f.y - o.y)) > 800 + (tol - 2) * 40) return;
    out.push({ i, score: err / tol });
  });
  return out;
}

const eligible = (c: Cand, s: Snapshot) => c.assigned !== 'torpedo' && s.friendlies.length > 0 && !c.sensors.includes('esm');

/** Sensors measured from the own ship (any of them puts a track on the ship's own picture). */
const SHIP_SENSORS = new Set(['hull', 'towed', 'active', 'intercept', 'periscope', 'radar', 'visual', 'mad']);

/**
 * Where a track's bearings come from: the sonobuoy field or the ship itself. A buoy track and a
 * hull or towed-array track of the same merchant are both genuinely that friendly, so each origin
 * gets its own share of the friendly (one EIGEN row per origin): competing for one tag they
 * swapped EIGEN back and forth with every bearing wobble. Keyed on the sensor set, which only
 * grows, not on the latest measurement's origin, so a track does not hop between the two.
 */
function sensorOrigin(c: Pick<ContactTrack, 'sensors'>): 'ship' | 'buoy' {
  return c.sensors.includes('buoy') && !c.sensors.some((k) => SHIP_SENSORS.has(k)) ? 'buoy' : 'ship';
}

/** Per snapshot: the labels tagged own (each friendly accounts for at most one contact). */
const owned = new WeakMap<Snapshot, Set<string>>();

/**
 * F6/F7: one friendly is one contact per picture and sensor origin. Every contact that lines up with a friendly bids for it;
 * contacts already held go first (hysteresis), then the closest bearing. A contact that lost
 * its friendly to a better one is no longer own (no "10 EIGEN rows for 8 merchants"); one that
 * lined up with nothing keeps the tag for HOLD_S (a short bearing excursion).
 */
function assignment(s: Snapshot): Set<string> {
  const got = owned.get(s);
  if (got) return got;
  if (s.time < heldTime) {
    held.clear();
    heldSlot.clear();
  }
  heldTime = s.time;
  // Each picture on its own: a datalink mate's track of the same merchant is no rival of ours
  const bids: { label: string; i: string; score: number }[] = [];
  const lined = new Set<string>();
  for (const c of s.contacts) {
    if (!eligible(c, s)) continue;
    const was = held.get(c.label);
    const ups = lineUps(c, s, was !== undefined ? LOOSE_DEG : 0);
    if (ups.length) lined.add(c.label);
    const pool = `${c.via === 'own' ? 'own' : c.label.split('-')[0]}/${sensorOrigin(c)}`;
    // A track not heard for a minute bids last: it must not keep a fresh one off its friendly
    const stale = s.time - c.lastSeen > STALE_S;
    for (const u of ups) bids.push({ label: c.label, i: `${pool}:${u.i}`, score: u.score + (stale ? 2 : was !== undefined ? -1 : 0) });
  }
  bids.sort((a, b) => a.score - b.score);
  const own = new Set<string>();
  const taken = new Set<string>();
  for (const b of bids) {
    if (own.has(b.label) || taken.has(b.i)) continue;
    own.add(b.label);
    taken.add(b.i);
    heldSlot.set(b.label, b.i);
  }
  for (const c of s.contacts) {
    if (own.has(c.label)) held.set(c.label, s.time);
    else {
      const was = held.get(c.label);
      const slot = heldSlot.get(c.label);
      // Off every friendly for a moment: still own, unless another contact now stands on its
      // friendly (then two rows would claim one ship); beaten to its friendly: not own
      if (was !== undefined && !lined.has(c.label) && eligible(c, s) && s.time - was <= HOLD_S && slot !== undefined && !taken.has(slot)) {
        own.add(c.label);
        taken.add(slot);
      } else {
        held.delete(c.label);
        heldSlot.delete(c.label);
      }
    }
  }
  owned.set(s, own);
  return own;
}

/**
 * Datalink correlation: a sonar contact that lines up with a known friendly ship
 * (convoy or escort) is tagged as own. Uses only information the player has. With a label the
 * tag holds (hysteresis): it goes only after the contact has been more than 5° off every
 * friendly for 30 s. A contact of the snapshot competes with the others for its friendly.
 */
export function isFriendlyContact(c: Cand, s: Snapshot): boolean {
  if (!eligible(c, s)) return false;
  const key = c.label;
  if (key !== undefined && s.contacts?.some((x) => x.label === key)) return assignment(s).has(key);
  // A contact not in the snapshot (tests, previews): on its own
  if (s.time < heldTime) held.clear();
  heldTime = s.time;
  const was = key !== undefined ? held.get(key) : undefined;
  if (lineUps(c, s, was !== undefined ? LOOSE_DEG : 0).length) {
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
