import { CLASSES, KN, MINE_LAY_MAX_KN, MINE_MAX_WATER, MINE_MIN_WATER, angleDiff, depthAt, headingVec, layMine, minesLeft, targetPosAt, wrap360, bearing as bearingTo, type ContactTrack, type Ship, type World } from '@tk/shared';
import { STRAIT_GUARD_Y } from '../scenario.js';
import { solveFor, type BotMemory } from './common.js';

const MINE_EVERY_S = 240;
/** Barrage across the convoy track: mines about every 115 m (45 s at 5 kn) within this of the track (the convoy drifts sideways by its zigzag). */
const BARRAGE_KN = 5;
const BARRAGE_GAP_S = 45;
const BARRAGE_HALF_M = 300;
/** Hafen: the escorts patrol the bay's entrance about here. */
const HARBOUR_GATE = { x: 0, y: 6500 };

/**
 * Submarine AI laying mines where ships must pass: the escorts' guard line in the strait,
 * the harbour entrance, and ahead of the convoy on its reported track (or when a merchant's
 * bearing stands still: it is coming straight at the boat). Shallow water only, never when hunted.
 */
/**
 * Where the convoy runs. Fleet command passes its route (the base leg without the zigzag)
 * and where the column nearest to the boat runs; refreshed every five minutes, but not
 * while a barrage is being laid (the line must stay put). The boat's own TMA on a merchant
 * is too rough for a barrage (a few degrees of course error put the line hundreds of
 * metres off), so it is only used when there is no convoy route to go by.
 */
function learnLine(w: World, m: BotMemory, me: Ship, target?: ContactTrack): void {
  if (m.mineRun) return;
  const c = w.convoy;
  if (!c) {
    const sol = target && solveFor(m, target, w.time, 'merchant');
    if (sol && sol.q >= 60 && sol.sol.speedKn >= 3) {
      const p = targetPosAt(sol.sol, w.time);
      m.convoyLine = { x: p.x, y: p.y, course: sol.sol.course, speedKn: sol.sol.speedKn, t: w.time };
    }
    return;
  }
  if (m.convoyLine && w.time - m.convoyLine.t < 300) return;
  const wp = c.waypoints[c.wpIndex];
  if (!wp) return;
  // A turn ahead (closer than the barrage would lie): put the line on the next leg, starting
  // from a virtual convoy position behind the turn so the timing still works out
  const rest = Math.hypot(wp.x - c.guide.x, wp.y - c.guide.y);
  const next = c.waypoints[c.wpIndex + 1];
  const turn = next && rest < TURN_AHEAD_M;
  const course = turn ? bearingTo(wp, next) : bearingTo(c.guide, wp);
  const v = headingVec(course);
  const origin = turn ? { x: wp.x - v.x * rest, y: wp.y - v.y * rest } : c.guide;
  const team = w.ships.filter((x) => x.alive && x.cls === 'merchant');
  if (!team.length) return;
  const near = team.reduce((a, b) => (Math.hypot(b.pos.x - me.pos.x, b.pos.y - me.pos.y) < Math.hypot(a.pos.x - me.pos.x, a.pos.y - me.pos.y) ? b : a));
  // Project the column onto the leg through the guide: same lateral offset, guide's along-track position
  const lead = headingVec(c.guideHeading);
  const col = (near.pos.x - c.guide.x) * lead.y - (near.pos.y - c.guide.y) * lead.x;
  m.convoyLine = { x: origin.x + v.y * col, y: origin.y - v.x * col, course, speedKn: c.baseSpeedKn, t: w.time };
}

/**
 * Mine barrage across the convoy's track: a boat ahead of the convoy (2.5–7 km) and within
 * 3 km of its track turns square onto it at 5 kn and lays its mines one after another while
 * crossing, so the columns have to pass through the line. Returns true while it steers.
 */
function barrage(w: World, m: BotMemory, s: Ship): boolean {
  const line = m.convoyLine;
  const now = w.time;
  // Laying at 5 kn is quiet: escorts nearby don't stop the barrage (a torpedo alert makes the boat evade first)
  if (!line || now - line.t > 1800 || minesLeft(w, s) <= 0) return (m.mineRun = undefined), false;
  const v = headingVec(line.course);
  const cx = line.x + v.x * (now - line.t) * line.speedKn * KN;
  const cy = line.y + v.y * (now - line.t) * line.speedKn * KN;
  const rx = s.pos.x - cx;
  const ry = s.pos.y - cy;
  const along = rx * v.x + ry * v.y;
  // Signed distance to the track (+ = starboard of the convoy's course)
  const across = rx * v.y - ry * v.x;
  const water = depthAt(w.env.seabed, s.pos.x, s.pos.y);
  // Close ahead only: the convoy's zigzag carries it sideways over longer runs
  const fit = along > 2500 && along < 7000 && Math.abs(across) < 3000 && water < MINE_MAX_WATER - 10 && water > MINE_MIN_WATER + 5;
  if (!fit) return (m.mineRun = undefined), false;
  // Square onto the track from our side, keep going until past it on the other side
  m.mineRun ??= { side: Math.sign(across) || 1 };
  const side = m.mineRun.side;
  if (side * across < -BARRAGE_HALF_M - 100) return (m.mineRun = undefined), (m.mineAt = now), false;
  s.order.heading = wrap360(line.course + (side > 0 ? -90 : 90));
  s.order.speedKn = BARRAGE_KN;
  if (Math.abs(across) <= BARRAGE_HALF_M && now - (m.mineAt ?? -1e9) >= BARRAGE_GAP_S && s.speed / KN <= MINE_LAY_MAX_KN) {
    if (layMine(w, s) === true) m.mineAt = now;
  }
  return true;
}

/** Approach to the barrage start: speed below the layer, and how far ahead of the convoy and off its track to arrive. */
const APPROACH_KN = 8;
/** A route turn closer than this: the barrage goes on the next leg. */
const TURN_AHEAD_M = 12_000;
/** With escorts close: creep at this speed instead (quiet, still faster than giving up). */
const APPROACH_QUIET_KN = 4;
const APPROACH_AHEAD_M = 4500;
const APPROACH_OFF_M = 800;
const APPROACH_MAX_S = 3600;

/**
 * Run ahead to the barrage: with the convoy's track known and mines aboard, the boat heads
 * for a point about 4.5 km ahead of the convoy and 800 m off its track (on its own side),
 * timed so that both arrive together. From there barrage() takes over. With escorts close
 * it creeps at 4 kn instead; not when a merchant is already within torpedo range (the attack comes first), nor when
 * the convoy can no longer be headed off.
 */
function approach(w: World, m: BotMemory, s: Ship, threatNear: boolean, target?: ContactTrack): boolean {
  const line = m.convoyLine;
  const now = w.time;
  if (!line || now - line.t > 1800 || minesLeft(w, s) <= 0) return false;
  // A diesel boat low on battery charges first (the run costs about a fifth of a full battery per hour)
  const cap = CLASSES[s.cls].battery?.capacityKnH;
  if (cap && s.battery !== undefined && s.battery < cap * 0.4) return false;
  if (target?.range !== undefined && target.rangeAt !== undefined && now - target.rangeAt < 120 && target.range < 7000) return false;
  const v = headingVec(line.course);
  const u = line.speedKn * KN;
  const c0 = { x: line.x + v.x * (now - line.t) * u, y: line.y + v.y * (now - line.t) * u };
  const across0 = (s.pos.x - c0.x) * v.y - (s.pos.y - c0.y) * v.x;
  const side = Math.sign(across0) || 1;
  // Meeting point: the offset point rides along with the convoy (D + V t); the boat needs
  // |D + V t| = vb t. Smallest positive root of (u² − vb²) t² + 2 (D·V) t + |D|² = 0
  const vb = (threatNear ? APPROACH_QUIET_KN : APPROACH_KN) * KN;
  const dx = c0.x + v.x * APPROACH_AHEAD_M + v.y * side * APPROACH_OFF_M - s.pos.x;
  const dy = c0.y + v.y * APPROACH_AHEAD_M - v.x * side * APPROACH_OFF_M - s.pos.y;
  const qa = u * u - vb * vb;
  const qb = 2 * u * (dx * v.x + dy * v.y);
  const qc = dx * dx + dy * dy;
  // Already there (within 400 m): barrage() takes over once the convoy is close enough
  if (qc < 400 * 400) return false;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return false;
  const roots = Math.abs(qa) < 1e-9 ? [-qc / qb] : [(-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa)];
  const t = Math.min(...roots.filter((r) => r > 0));
  if (!Number.isFinite(t) || t > APPROACH_MAX_S) return false;
  const p = { x: s.pos.x + dx + v.x * u * t, y: s.pos.y + dy + v.y * u * t };
  // Mines only go into water between 25 and 300 m: no run to a point the boat can't mine
  const water = depthAt(w.env.seabed, p.x, p.y);
  if (water > MINE_MAX_WATER - 10 || water < MINE_MIN_WATER + 5) return false;
  s.order.heading = wrap360((Math.atan2(p.x - s.pos.x, p.y - s.pos.y) * 180) / Math.PI);
  s.order.speedKn = threatNear ? APPROACH_QUIET_KN : APPROACH_KN;
  const here = depthAt(w.env.seabed, s.pos.x, s.pos.y);
  s.order.depth = Math.max(25, Math.min(s.btLayer !== undefined ? s.btLayer + 30 : 80, here - 30));
  return true;
}

export function considerMine(w: World, m: BotMemory, s: Ship, threatNear: boolean, target?: ContactTrack): boolean {
  const now = w.time;
  if (!m.passive && w.env.mission !== 'meerenge' && w.env.mission !== 'hafen') {
    learnLine(w, m, s, target);
    if (barrage(w, m, s) || approach(w, m, s, threatNear, target)) return true;
  }
  // At the harbour gate and the strait's guard line the escorts are always near: lay anyway
  const gate = w.env.mission === 'hafen' || w.env.mission === 'meerenge';
  if (m.passive || (threatNear && !gate) || minesLeft(w, s) <= 0 || now - (m.mineAt ?? -1e9) < MINE_EVERY_S) return false;
  if (s.speed / KN > MINE_LAY_MAX_KN) return false;
  const water = depthAt(w.env.seabed, s.pos.x, s.pos.y);
  if (water > MINE_MAX_WATER - 10 || water < MINE_MIN_WATER + 5) return false;
  let want = false;
  // Strait: the channel south of the guard line, where the escorts come down to hunt; harbour: the approaches
  if (w.env.mission === 'meerenge') want = s.pos.y > STRAIT_GUARD_Y - 6000 && s.pos.y < STRAIT_GUARD_Y + 1500;
  else if (w.env.mission === 'hafen') want = s.pos.y > HARBOUR_GATE.y - 2500 && s.pos.y < HARBOUR_GATE.y + 6000 && Math.abs(s.pos.x - HARBOUR_GATE.x) < 6000;
  else {
    const line = m.convoyLine;
    if (line && now - line.t < 2400) {
      // Ahead of the convoy, close to its reported track (the guide has moved on meanwhile)
      const v = headingVec(line.course);
      const rx = s.pos.x - line.x;
      const ry = s.pos.y - line.y;
      const along = rx * v.x + ry * v.y - (now - line.t) * line.speedKn * KN;
      const across = Math.abs(rx * v.y - ry * v.x);
      want = along > 2000 && along < 15_000 && across < 1500;
    }
    // Single mines only without a convoy (barrages above cover the convoy track)
    if (!want && !w.convoy && target && target.se > 8) {
      // Constant bearing over two minutes: the target is closing on the boat
      const old = target.history.find((h) => h.alt === undefined && now - h.t > 100 && now - h.t < 160);
      want = !!old && Math.abs(angleDiff(old.b, target.bearing)) < 3;
    }
  }
  if (want && layMine(w, s) === true) m.mineAt = now;
  return false;
}
