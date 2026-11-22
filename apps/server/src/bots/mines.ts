import { KN, MINE_LAY_MAX_KN, MINE_MAX_WATER, MINE_MIN_WATER, angleDiff, depthAt, headingVec, layMine, minesLeft, targetPosAt, wrap360, bearing as bearingTo, type ContactTrack, type Ship, type World } from '@tk/shared';
import { STRAIT_GUARD_Y } from '../scenario.js';
import { solveFor, type BotMemory } from './common.js';

const MINE_EVERY_S = 240;
/** Barrage across the convoy track: mines about every 200 m (80 s at 5 kn) within this of the track (the convoy drifts sideways by its zigzag). */
const BARRAGE_KN = 5;
const BARRAGE_GAP_S = 80;
const BARRAGE_HALF_M = 520;
/** Hafen: the escorts patrol the bay's entrance about here. */
const HARBOUR_GATE = { x: 0, y: 6500 };

/**
 * Submarine AI laying mines where ships must pass: the escorts' guard line in the strait,
 * the harbour entrance, and ahead of the convoy on its reported track (or when a merchant's
 * bearing stands still: it is coming straight at the boat). Shallow water only, never when hunted.
 */
/**
 * Convoy track from the boat's own TMA on a merchant (in addition to air recon reports):
 * a good solution gives position, course and speed now.
 */
function learnLine(w: World, m: BotMemory, me: Ship, target?: ContactTrack): void {
  const sol = target && solveFor(m, target, w.time, 'merchant');
  if (sol && sol.q >= 40 && sol.sol.speedKn >= 3) {
    const p = targetPosAt(sol.sol, w.time);
    m.convoyLine = { x: p.x, y: p.y, course: sol.sol.course, speedKn: sol.sol.speedKn, t: w.time };
    return;
  }
  // No good solution yet: fleet command passes the convoy's route (its base leg, without the
  // zigzag) and where its nearest column runs. Refreshed every ten minutes
  const c = w.convoy;
  if (!c || (m.convoyLine && w.time - m.convoyLine.t < 600)) return;
  const wp = c.waypoints[c.wpIndex];
  if (!wp) return;
  const course = bearingTo(c.guide, wp);
  const v = headingVec(course);
  const team = w.ships.filter((x) => x.alive && x.cls === 'merchant');
  if (!team.length) return;
  const near = team.reduce((a, b) => (Math.hypot(b.pos.x - me.pos.x, b.pos.y - me.pos.y) < Math.hypot(a.pos.x - me.pos.x, a.pos.y - me.pos.y) ? b : a));
  // Project the column onto the leg through the guide: same lateral offset, guide's along-track position
  const col = (near.pos.x - c.guide.x) * v.y - (near.pos.y - c.guide.y) * v.x;
  m.convoyLine = { x: c.guide.x + v.y * col, y: c.guide.y - v.x * col, course, speedKn: c.baseSpeedKn, t: w.time };
}

/**
 * Mine barrage across the convoy's track: a boat ahead of the convoy (2.5–9 km) and within
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
  const fit = along > 2500 && along < 9000 && Math.abs(across) < 3000 && water < MINE_MAX_WATER - 10 && water > MINE_MIN_WATER + 5;
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

export function considerMine(w: World, m: BotMemory, s: Ship, threatNear: boolean, target?: ContactTrack): boolean {
  const now = w.time;
  if (!m.passive && w.env.mission !== 'meerenge' && w.env.mission !== 'hafen') {
    learnLine(w, m, s, target);
    if (barrage(w, m, s)) return true;
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
