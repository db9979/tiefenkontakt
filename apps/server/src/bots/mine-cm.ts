import {
  CONVOY_DETOUR_MAX,
  MINE_AVOID_MAX_KN,
  MINE_MAX_WATER,
  MINE_MIN_WATER,
  activeOrders,
  bearing,
  depthAt,
  headingVec,
  knownMines,
  setConvoyOffset,
  type Ship,
  type Vec2,
  type World,
} from '@tk/shared';

/**
 * Escort mine countermeasures: the high-frequency mine-avoidance sonar in water where mines
 * can lie, and the convoy detour around a known barrage, ordered by the lead escort.
 */

/** Mine-avoidance sonar on: water shallow enough for mines, and slow enough for the sonar to hear. */
export function wantMineAvoid(w: World, s: Ship): boolean {
  const water = depthAt(w.env.seabed, s.pos.x, s.pos.y);
  return water >= MINE_MIN_WATER && water <= MINE_MAX_WATER && s.order.speedKn <= MINE_AVOID_MAX_KN;
}

/** The sweeping escort runs this far ahead of the convoy's centre, on its track (m). */
export const SWEEP_AHEAD_M = 3000;

/**
 * Station of the escort sweeping the convoy's track for mines: close ahead on the route leg
 * (barrages are laid across it a few km ahead of the columns), in water where mines can lie.
 */
export function sweepStation(w: World, center: Vec2): Vec2 | undefined {
  const c = w.convoy;
  const to = c?.waypoints[c.wpIndex];
  if (!c || !to) return undefined;
  const v = headingVec(bearing(c.waypoints[c.wpIndex - 1] ?? c.origin ?? c.guide, to));
  const p = { x: center.x + v.x * SWEEP_AHEAD_M, y: center.y + v.y * SWEEP_AHEAD_M };
  const water = depthAt(w.env.seabed, p.x, p.y);
  if (water < MINE_MIN_WATER || water > MINE_MAX_WATER) return undefined;
  return p;
}

/** Look this far ahead of the convoy guide for mines on the track (m). */
export const DETOUR_LOOK_M = 6000;
/** Mines this far behind the guide still matter: the rear rows trail it by up to ~2 km. */
export const DETOUR_PAST_M = 2500;
/**
 * Half width of the band the convoy sweeps around its track: the outer columns (900 m), the
 * zigzag's sideways swing (~500 m) and a margin for the triggers and station keeping.
 */
export const DETOUR_BAND_M = 1800;
/** A barrage: this many known mines in the band ahead before the convoy is turned off its route. */
export const DETOUR_MIN_MINES = 2;
/** Water the shifted track must keep under the keel of its outer columns (m). */
const DETOUR_MIN_WATER = 40;
const STEP_M = 100;

export interface DetourInput {
  /** Convoy guide (formation centre). */
  guide: Vec2;
  /** Start and end of the current leg of the route. */
  legFrom: Vec2;
  legTo: Vec2;
  /** Current detour (m, + = starboard of the leg). */
  offset: number;
  /** Known mines. */
  mines: Vec2[];
  /** Water depth (m) at a point; the detour stays out of the shallows. */
  depth?: (p: Vec2) => number;
}

/**
 * The detour the convoy should steer: a new offset (0 = back on the route) or undefined to
 * keep the current one. A barrage (several known mines) in the band the convoy sweeps on its
 * current track ahead turns it to the side with fewer known mines, just far enough to clear
 * them; once no known mine lies near the route any more, it returns to the route.
 */
export function detourDecision(inp: DetourInput): number | undefined {
  const legB = bearing(inp.legFrom, inp.legTo);
  const dir = headingVec(legB);
  const stb = headingVec(legB + 90);
  const rel = inp.mines
    .map((p) => ({
      along: (p.x - inp.guide.x) * dir.x + (p.y - inp.guide.y) * dir.y,
      across: (p.x - inp.legFrom.x) * stb.x + (p.y - inp.legFrom.y) * stb.y,
    }))
    .filter((m) => m.along > -DETOUR_PAST_M && m.along < DETOUR_LOOK_M);
  const inBand = (off: number) => rel.filter((m) => Math.abs(m.across - off) < DETOUR_BAND_M).length;
  const cur = inp.offset;
  const onRoute = inBand(0);
  if (cur !== 0) {
    // Past the barrage (or it was swept): back to the route
    if (onRoute === 0) return 0;
    if (inBand(cur) === 0) return undefined;
  } else if (onRoute < DETOUR_MIN_MINES) return undefined;
  // Track along the leg from the guide's position: deep enough for the outer columns?
  const guideAlong = (inp.guide.x - inp.legFrom.x) * dir.x + (inp.guide.y - inp.legFrom.y) * dir.y;
  const navigable = (off: number) => {
    if (!inp.depth) return true;
    for (let a = 0; a <= DETOUR_LOOK_M; a += 1500) {
      for (const col of [-900, 0, 900]) {
        const x = inp.legFrom.x + dir.x * (guideAlong + a) + stb.x * (off + col);
        const y = inp.legFrom.y + dir.y * (guideAlong + a) + stb.y * (off + col);
        if (inp.depth({ x, y }) < DETOUR_MIN_WATER) return false;
      }
    }
    return true;
  };
  // Nearest clear offset on each side of the current track
  const clearOn = (side: number): number | undefined => {
    for (let off = cur; Math.abs(off) <= CONVOY_DETOUR_MAX; off += side * STEP_M) {
      if (!navigable(off)) return undefined;
      if (inBand(off) === 0) return off;
    }
    return undefined;
  };
  const known = (side: number) => rel.filter((m) => side * (m.across - cur) > 0).length;
  const sides = [1, -1]
    .map((side) => ({ side, off: clearOn(side), mines: known(side) }))
    .filter((c): c is { side: number; off: number; mines: number } => c.off !== undefined)
    .sort((a, b) => a.mines - b.mines || Math.abs(a.off - cur) - Math.abs(b.off - cur));
  const best = sides[0];
  // No clear water within the commodore's limit: stay put (the merchants dodge single mines)
  if (!best || best.off === cur) return undefined;
  return best.off;
}

/** The lead escort (the first AI escort of the convoy's side) orders the detour. */
export function leadDetour(w: World, team: 'west' | 'east', ai: Ship[]): void {
  const c = w.convoy;
  const lead = [...ai].sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!c || !lead || !w.ships.some((s) => s.alive && s.cls === 'merchant' && s.team === team)) return;
  const legTo = c.waypoints[c.wpIndex];
  const legFrom = c.waypoints[c.wpIndex - 1] ?? c.origin ?? c.guide;
  if (!legTo) return;
  const next = detourDecision({
    guide: c.guide, legFrom, legTo, offset: c.offset ?? 0, mines: knownMines(w, team),
    depth: (p) => depthAt(w.env.seabed, p.x, p.y),
  });
  if (next === undefined || next === (c.offset ?? 0)) return;
  setConvoyOffset(c, next);
  const silent = activeOrders(w, lead).some((o) => o.kind === 'silence');
  if (!silent) {
    const text = next === 0
      ? 'AN KOMMODORE: MINENSPERRE PASSIERT · ZURÜCK AUF DIE ROUTE'
      : `AN KOMMODORE: MINENSPERRE VORAUS · AUSWEICHEN ${(Math.abs(next) / 1000).toFixed(1)} KM ${next > 0 ? 'STB' : 'BB'}`;
    w.events.push({ kind: 'teamradio', time: w.time, senderId: lead.id, text });
  }
}
