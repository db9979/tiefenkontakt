import { CLASSES, KN, bearing, depthAt, distance, headingVec, type ContactTrack, type Ship, type Vec2, type World } from '@tk/shared';
import { isFriendly, votedPeek, type BotMemory, type BotSkill } from './common.js';

/**
 * VETERAN escorts (KI-STUFE VETERAN, key 'schwer'): what an experienced ASW team does beyond the
 * drill. Everything here reads only the side's own contact books, own navigation, the briefing
 * (route, charted anchorage) and the datalink; NORMAL and LEICHT never call into it.
 */

export const isVeteran = (skill: BotSkill | undefined): boolean => skill === 'schwer';

/** A hard turn at speed leaves a knuckle (a false echo) behind for about this long (s). */
const KNUCKLE_MEMORY_S = 300;
/** An echo this close to where an own escort turned hard is taken for her knuckle (m). */
const KNUCKLE_NEAR_M = 400;

/** Where the side's escorts turned hard lately (their own navigation: the officer of the watch knows). */
const turnSpots = new WeakMap<World, { team: string; x: number; y: number; t: number }[]>();

/** Note an escort's hard turn at speed (call every step for the side's surface escorts). */
export function noteTurn(w: World, s: Ship): void {
  if (s.speed / KN < 10) return;
  const spec = CLASSES[s.cls];
  const maxRate = Math.min(spec.turnRateDeg, ((s.speed / spec.turnRadius) * 180) / Math.PI);
  if (Math.abs(s.yawRate ?? 0) < 0.5 * maxRate) return;
  let l = turnSpots.get(w);
  if (!l) turnSpots.set(w, (l = []));
  const last = [...l].reverse().find((x) => x.team === s.team);
  if (last && w.time - last.t < 5 && distance(last, s.pos) < 100) return;
  l.push({ team: s.team, x: s.pos.x, y: s.pos.y, t: w.time });
  while (l.length && w.time - l[0]!.t > KNUCKLE_MEMORY_S) l.shift();
}

/** The latest active echo on a track (within maxAge s), as a point from where the ping went out. */
export function echoPoint(t: ContactTrack, m: BotMemory | undefined, s: Ship, now: number, maxAge: number): Vec2 | undefined {
  const echo = [...t.history].reverse().find((h) => h.sensor === 'active' && h.r !== undefined && now - h.t < maxAge);
  if (!echo) return undefined;
  const at = echo.ox !== undefined ? { x: echo.ox, y: echo.oy! } : (m ? [...m.track].reverse() : []).find((f) => f.t <= echo.t + 3) ?? s.pos;
  const v = headingVec(echo.b);
  return { x: at.x + v.x * echo.r!, y: at.y + v.y * echo.r! };
}

/**
 * A quiet echo: the active sonar returns a hull the passive sonar does not hear at all (no
 * tonal line on the track), that is no own ship and not the knuckle of an own escort's turn.
 * Surface ships are loud long before they echo, so the operator calls it a probable submarine.
 */
export function quietEcho(w: World, s: Ship, t: ContactTrack, m?: BotMemory): boolean {
  const now = w.time;
  if ((t.evidence?.tonals.length ?? 0) > 0) return false;
  const c = m ? votedPeek(m, t) : undefined;
  if (c !== undefined && c !== 'submarine') return false;
  const p = echoPoint(t, m, s, now, 120);
  if (!p || isFriendly(w, s, t, m)) return false;
  // Two echoes at least (a single return may be anything)
  if (t.history.filter((h) => h.sensor === 'active' && h.r !== undefined && now - h.t < 180).length < 2) return false;
  return !(turnSpots.get(w) ?? []).some((k) => k.team === s.team && now - k.t < KNUCKLE_MEMORY_S && distance(k, p) < KNUCKLE_NEAR_M);
}

/**
 * Harbour (merchants at the charted anchorage, no convoy under way): the barrier stands this far
 * out from the berths on the seaward approach, beyond a boat's torpedo reach of the anchorage (m).
 */
export const BARRIER_R = 6000;
/** Least water for a barrier station (m). */
const BARRIER_DEPTH_M = 60;
const seawardCache = new WeakMap<World, number>();

/** Harbour attack: the entrance the escorts guard (briefing: the bay opens to the north of the berths). */
const HARBOUR_ENTRANCE = { x: 0, y: 6500 };

/**
 * The seaward approach from the anchorage: toward the briefed harbour entrance, else off the
 * chart (the bearing with the most open water out to 9 km).
 */
export function seawardAxis(w: World, center: Vec2): number {
  if (w.env.mission === 'hafen') return bearing(center, HARBOUR_ENTRANCE);
  const hit = seawardCache.get(w);
  if (hit !== undefined) return hit;
  let best = 0;
  let bestN = -1;
  for (let b = 0; b < 360; b += 10) {
    const v = headingVec(b);
    let n = 0;
    for (let r = 1000; r <= 9000; r += 500) if (depthAt(w.env.seabed, center.x + v.x * r, center.y + v.y * r) >= BARRIER_DEPTH_M) n++;
    if (n > bestN) [best, bestN] = [b, n];
  }
  seawardCache.set(w, best);
  return best;
}

/** Barrier stations across the seaward approach (spread across the channel, each in deep water). */
export function barrierStations(w: World, center: Vec2, ships: Ship[]): Map<string, Vec2> {
  const out = new Map<string, Vec2>();
  if (!ships.length) return out;
  const axis = seawardAxis(w, center);
  const fwd = headingVec(axis);
  const side = headingVec(axis + 90);
  const n = Math.min(ships.length, 3);
  const offs = n === 1 ? [0] : n === 2 ? [-1500, 1500] : [-2500, 0, 2500];
  const pts = offs.map((o) => {
    // Slide toward the channel's middle (and then seaward) until the water is deep enough
    for (let k = 0; k <= 12; k++) {
      const off = Math.abs(o) > k * 250 ? o - Math.sign(o) * k * 250 : 0;
      const r = BARRIER_R + Math.max(0, k * 250 - Math.abs(o));
      const p = { x: center.x + fwd.x * r + side.x * off, y: center.y + fwd.y * r + side.y * off };
      if (depthAt(w.env.seabed, p.x, p.y) >= BARRIER_DEPTH_M) return p;
    }
    return { x: center.x + fwd.x * BARRIER_R, y: center.y + fwd.y * BARRIER_R };
  });
  const free = [...pts];
  for (const s of [...ships].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!free.length) break;
    const i = free.reduce((bi, p, j) => (distance(s.pos, p) < distance(s.pos, free[bi]!) ? j : bi), 0);
    out.set(s.id, free.splice(i, 1)[0]!);
  }
  return out;
}
