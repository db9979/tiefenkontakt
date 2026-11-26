/**
 * Wake-homing torpedo (F18, realism round 5): the Soviet 53-65K / 65-76 type of the east SSN.
 *
 * It does not listen or ping for the hull: an upward-looking sensor finds the bubble trail a
 * surface ship leaves behind. The torpedo runs straight until it crosses a wake, turns up it and
 * weaves along it towards the ship, then closes on the stern. Noisemakers and the towed Nixie
 * mean nothing to it. What does fool it: a hard turn (the knuckle leaves a wide patch of
 * disturbed water where the trail is lost) and a crossing wake of another ship (it may take the
 * wrong trail).
 *
 * Wakes are kept as crumbs of each surface ship's track, sampled every WAKE_SAMPLE_S and aged
 * out after WAKE_LIFE_S (≈3 km of track at 15 kn, the length a 1970s wake sensor still holds).
 */
import { CLASSES } from './classes.js';
import type { Ship } from './entities.js';
import { KN, angleDiff, bearing, distance, type Vec2 } from './math.js';
import type { Rng } from './rng.js';

export interface WakePt {
  x: number;
  y: number;
  t: number;
  /** The ship's heading when it passed here. */
  hdg: number;
}

export const WAKE_SAMPLE_S = 10;
export const WAKE_LIFE_S = 360;
/** Slower than this a ship leaves no trail the sensor can follow. */
const WAKE_MIN_KN = 4;
/** The sensor finds the wake within this distance either side of the track (m). */
export const WAKE_HALF_WIDTH = 60;
/** A course change this sharp within KNUCKLE_WINDOW_S along the trail (deg) is a knuckle; the torpedo loses the trail with KNUCKLE_LOSS. */
export const KNUCKLE_DEG = 50;
export const KNUCKLE_LOSS = 0.6;
const KNUCKLE_WINDOW_S = 60;
/** Crossing another ship's wake while following: it takes the new trail with this chance. */
export const CROSS_SWITCH = 0.35;
/** Within this of the ship the torpedo leaves the trail and closes on the stern (m). */
const TERMINAL_M = 300;
/** A crumb counts as reached this close (m). */
const CRUMB_REACHED_M = 120;
/** After losing a trail the torpedo ignores that wake for this run (m). */
const REACQUIRE_AFTER_M = 600;
/** Weave across the wake: ± this many degrees about the trail, period 2π·WEAVE_S seconds. */
const WEAVE_DEG = 15;
const WEAVE_S = 4;

export interface WakeLock {
  shipId: string;
  /** Time stamp of the crumb the torpedo runs towards (crumbs shift as old ones age out). */
  toT: number;
  /** A knuckle already tested: crumbs up to this time belong to it (one test per turn). */
  testedUntil: number;
  /** Other ships' wakes already crossed while on this trail. */
  crossed: string[];
}

export interface WakeSeeker {
  pos: Vec2;
  heading: number;
  ownerId: string;
  run: number;
  homingOn?: string;
  wakeLock?: WakeLock;
  /** Ship whose trail was lost, and the run (m) until it may be taken again. */
  wakeIgnore?: { shipId: string; untilRun: number };
}

function leavesWake(s: Ship): boolean {
  return s.alive && (!CLASSES[s.cls].submarine || s.depth < 3);
}

/** Record the surface ships' tracks (every WAKE_SAMPLE_S) and age out old crumbs. */
export function recordWakes(wakes: Map<string, WakePt[]>, ships: Ship[], now: number): void {
  for (const s of ships) {
    if (!leavesWake(s)) {
      wakes.delete(s.id);
      continue;
    }
    let pts = wakes.get(s.id);
    if (!pts) wakes.set(s.id, (pts = []));
    const last = pts[pts.length - 1];
    if (s.speed / KN >= WAKE_MIN_KN && (!last || now - last.t >= WAKE_SAMPLE_S)) pts.push({ x: s.pos.x, y: s.pos.y, t: now, hdg: s.heading });
    while (pts.length && now - pts[0]!.t > WAKE_LIFE_S) pts.shift();
  }
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** The trail as a path: the crumbs, then the ship itself at the head. */
function trail(pts: WakePt[], ship: Ship): WakePt[] {
  return [...pts, { x: ship.pos.x, y: ship.pos.y, t: Number.MAX_SAFE_INTEGER, hdg: ship.heading }];
}

/** The newest-end crumb of the trail segment within the sensor band of `pos`; undefined = no wake here. */
export function wakeAt(pts: WakePt[], ship: Ship, pos: Vec2): WakePt | undefined {
  if (pts.length < 1) return undefined;
  const path = trail(pts, ship);
  let best: { d: number; to: WakePt } | undefined;
  for (let i = 0; i + 1 < path.length; i++) {
    const d = segDist(pos, path[i]!, path[i + 1]!);
    if (d < WAKE_HALF_WIDTH && (!best || d < best.d)) best = { d, to: path[i + 1]! };
  }
  return best?.to;
}

/**
 * One tick of the wake seeker. Returns the heading wanted and the ship it is closing on (only in
 * the last TERMINAL_M, when a hit can happen); `want` undefined = run straight on.
 */
export function steerWake(t: WakeSeeker, ships: Ship[], wakes: Map<string, WakePt[]>, now: number, rng: Rng): { want?: number; target?: Ship } {
  const shipOf = (id: string) => ships.find((s) => s.id === id);
  const lose = (shipId: string) => {
    t.wakeLock = undefined;
    t.homingOn = undefined;
    t.wakeIgnore = { shipId, untilRun: t.run + REACQUIRE_AFTER_M };
  };
  const candidates = (skip: string[]) => {
    const out: { ship: Ship; to: WakePt }[] = [];
    for (const [id, pts] of wakes) {
      if (id === t.ownerId || skip.includes(id)) continue;
      if (t.wakeIgnore?.shipId === id && t.run < t.wakeIgnore.untilRun) continue;
      const ship = shipOf(id);
      if (!ship || !leavesWake(ship)) continue;
      const to = wakeAt(pts, ship, t.pos);
      if (to) out.push({ ship, to });
    }
    return out;
  };
  const lockOn = (ship: Ship, to: WakePt) => {
    t.wakeLock = { shipId: ship.id, toT: to.t, testedUntil: to.t, crossed: [] };
    t.homingOn = ship.id;
  };

  let lock = t.wakeLock;
  if (!lock) {
    const found = candidates([]);
    if (!found.length) return {};
    // Several wakes at once: the sensor can't tell them apart
    const pick = found[Math.floor(rng.next() * found.length)]!;
    lockOn(pick.ship, pick.to);
    lock = t.wakeLock!;
  }
  const ship = shipOf(lock.shipId);
  const pts = wakes.get(lock.shipId);
  if (!ship?.alive || !pts) {
    lose(lock.shipId);
    return {};
  }
  if (distance(t.pos, ship.pos) < TERMINAL_M) return { want: bearing(t.pos, ship.pos), target: ship };
  const path = trail(pts, ship);
  let i = path.findIndex((p) => p.t >= lock!.toT);
  if (i < 0) i = path.length - 1;
  // Through each crumb reached: a knuckle there loses the trail (or the torpedo carries on through it)
  while (i < path.length - 1 && distance(t.pos, path[i]!) < CRUMB_REACHED_M) {
    const p = path[i]!;
    // The trail's heading a minute earlier: a turn sharper than KNUCKLE_DEG in between is a knuckle
    const before = path.find((q) => q.t >= p.t - KNUCKLE_WINDOW_S) ?? p;
    if (p.t > lock.testedUntil && Math.abs(angleDiff(before.hdg, p.hdg)) > KNUCKLE_DEG) {
      lock.testedUntil = p.t + KNUCKLE_WINDOW_S;
      if (rng.next() < KNUCKLE_LOSS) {
        lose(lock.shipId);
        return {};
      }
    }
    i += 1;
  }
  lock.toT = path[i]!.t;
  // Crossing another ship's trail: it may take that one instead
  for (const c of candidates([lock.shipId, ...lock.crossed])) {
    lock.crossed.push(c.ship.id);
    if (rng.next() < CROSS_SWITCH) {
      lockOn(c.ship, c.to);
      return { want: bearing(t.pos, c.to) };
    }
  }
  const weave = WEAVE_DEG * Math.sin(now / WEAVE_S);
  return { want: bearing(t.pos, path[i]!) + weave };
}
