import { KN, MINE_LAY_MAX_KN, MINE_MAX_WATER, MINE_MIN_WATER, angleDiff, depthAt, headingVec, layMine, minesLeft, type ContactTrack, type Ship, type World } from '@tk/shared';
import { STRAIT_GUARD_Y } from '../scenario.js';
import type { BotMemory } from './common.js';

const MINE_EVERY_S = 240;
/** Hafen: the escorts patrol the bay's entrance about here. */
const HARBOUR_GATE = { x: 0, y: 6500 };

/**
 * Submarine AI laying mines where ships must pass: the escorts' guard line in the strait,
 * the harbour entrance, and ahead of the convoy on its reported track (or when a merchant's
 * bearing stands still: it is coming straight at the boat). Shallow water only, never when hunted.
 */
export function considerMine(w: World, m: BotMemory, s: Ship, threatNear: boolean, target?: ContactTrack): void {
  const now = w.time;
  // At the harbour gate and the strait's guard line the escorts are always near: lay anyway
  const gate = w.env.mission === 'hafen' || w.env.mission === 'meerenge';
  if (m.passive || (threatNear && !gate) || minesLeft(w, s) <= 0 || now - (m.mineAt ?? -1e9) < MINE_EVERY_S) return;
  if (s.speed / KN > MINE_LAY_MAX_KN) return;
  const water = depthAt(w.env.seabed, s.pos.x, s.pos.y);
  if (water > MINE_MAX_WATER - 10 || water < MINE_MIN_WATER + 5) return;
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
    if (!want && target && target.se > 8) {
      // Constant bearing over two minutes: the target is closing on the boat
      const old = target.history.find((h) => h.alt === undefined && now - h.t > 100 && now - h.t < 160);
      want = !!old && Math.abs(angleDiff(old.b, target.bearing)) < 3;
    }
  }
  if (want && layMine(w, s) === true) m.mineAt = now;
}
