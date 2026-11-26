import { isConvoyShip, setZigPlan, zigPlanOf, type World } from '@tk/shared';
import { isEscortCommander } from '../escort-command.js';

/**
 * The AI escort commander's zigzag (F28): with no human escort captain on the side, the senior
 * AI escort orders the convoy's zigzag plan like a commodore. Quiet: one of the moderate plans
 * 1–3, changed every PLAN_CHANGE_S so a shadowing boat cannot learn the rhythm. A submarine
 * datum or a heard torpedo: the irregular plan 3 at once (legs of 3–12 min, 10–40°), which
 * spoils a settled TMA solution at little cost in speed of advance.
 * A convoy whose zigzag was switched off (lessons, the first escort) is left alone.
 */

/** A new plan this often in quiet waters (s): real commodores changed the diagram every watch or so. */
export const PLAN_CHANGE_S = 35 * 60;
/** A threat this recent (s) keeps the irregular plan. */
const THREAT_S = 900;
const THREAT_PLAN = 3;

export function aiZigzag(w: World, team: string, threatAt: number | undefined): void {
  const c = w.convoy;
  if (!c?.zigzag) return;
  if (!w.ships.some((x) => x.alive && x.team === team && isConvoyShip(x))) return;
  if (w.ships.some((s) => s.team === team && isEscortCommander(s))) return;
  const now = w.time;
  const cur = zigPlanOf(c);
  const threat = threatAt !== undefined && now - threatAt < THREAT_S;
  if (threat) {
    if (cur !== THREAT_PLAN) setZigPlan(c, THREAT_PLAN, now);
    return;
  }
  if (now - (c.zigFrom ?? 0) < PLAN_CHANGE_S) return;
  // Next quiet plan: one of 1–3 other than the current, from the seed and the change count
  const k = Math.floor(now / PLAN_CHANGE_S) + (c.zigSeed ?? 1);
  const options = [1, 2, 3].filter((n) => n !== cur);
  setZigPlan(c, options[k % options.length]!, now);
}
