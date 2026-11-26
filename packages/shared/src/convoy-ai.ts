import type { Ship } from './entities.js';
import { steerClear } from './mines.js';
import { KN, angleDiff, bearing, clamp, distance, headingVec, wrap360, type Vec2 } from './math.js';
import { ZIG_PLANS, defaultZigPlan, zigAdvance, zigOffset, zigPlanLegs, type ZigLeg } from './zigzag.js';

export interface ConvoyState {
  waypoints: Vec2[];
  wpIndex: number;
  baseSpeedKn: number;
  guide: Vec2; // virtual formation center
  guideHeading: number;
  /** Base course (route leg or ordered course, without the zigzag): the formation keeps its bearings on it. */
  baseHeading?: number;
  zigzag: boolean;
  /** Zigzag plan 1–6 (zigzag.ts); absent = the match's default plan. */
  zigPlan?: number;
  /** Match seed the plans' legs are drawn from. */
  zigSeed?: number;
  /** When the current plan was started (sim time, s): the legs run from here. */
  zigFrom?: number;
  /** Station offsets relative to guide (x = starboard, y = ahead), per ship id. */
  stations: Record<string, Vec2>;
  scatterUntil: number;
  scatterFrom?: Vec2;
  arrived: string[];
  arriveRadius: number;
  /** Known mines: the merchants steer clear of them (mines.ts). */
  hazards?: Vec2[];
  /** Detour ordered by the escort: the track is shifted sideways by this much (m, + = starboard of the leg). */
  offset?: number;
  /** Where the first leg starts (the detour's parallel track is measured from the leg line). */
  origin?: Vec2;
  /** Emergency turn ordered by the escort commander: the convoy holds this course until then, then resumes the route. */
  turn?: { course: number; until: number; side: -1 | 1 };
  /** Speed ordered by the escort commander relative to the route speed (kn, ±CONVOY_SPEED_ADJ_MAX). */
  speedAdj?: number;
  /** Course ordered by the escort commander (game frame, deg): held (with zigzag about it) until he sends it back to the route. */
  course?: number;
}

/** Emergency turn: how far (deg) and how long it is held before the convoy resumes its route (s). */
export const EMERGENCY_TURN_DEG = 45;
export const EMERGENCY_TURN_S = 600;
/** Most the escort commander may change the convoy's speed from the route speed (kn). */
export const CONVOY_SPEED_ADJ_MAX = 2;

/** Speed the convoy guide makes now: route speed plus the commander's change. */
export function convoySpeedKn(c: ConvoyState): number {
  return Math.max(3, c.baseSpeedKn + (c.speedAdj ?? 0));
}

/**
 * Emergency turn 45° to port (−1) or starboard (+1) from the convoy's mean course (zigzag left out):
 * held for ten minutes, then the convoy resumes its route. side 0 cancels a turn under way.
 */
export function emergencyTurn(c: ConvoyState, side: -1 | 0 | 1, now: number): void {
  if (side === 0) {
    c.turn = undefined;
    return;
  }
  const wp = c.waypoints[c.wpIndex];
  const base = wp ? bearing(c.guide, legTarget(c, wp, c.waypoints[c.wpIndex - 1] ?? c.origin ?? c.guide)) : c.guideHeading;
  c.turn = { course: wrap360(base + EMERGENCY_TURN_DEG * side), until: now + EMERGENCY_TURN_S, side };
}

/** Course ordered by the escort commander; undefined sends the convoy back onto its route. Ends an emergency turn. */
export function setConvoyCourse(c: ConvoyState, course: number | undefined): void {
  c.course = course === undefined ? undefined : wrap360(Math.round(course));
  c.turn = undefined;
}

/** Convoy speed change ordered by the escort commander, bounded to ±2 kn of the route speed. */
export function setConvoySpeedAdj(c: ConvoyState, adj: number): void {
  c.speedAdj = clamp(Math.round(adj), -CONVOY_SPEED_ADJ_MAX, CONVOY_SPEED_ADJ_MAX) || undefined;
}

/** Most a crippled straggler makes (kn, damage.ts caps the ship to the same). */
const STRAGGLER_KN = 4;

const legCache = new Map<string, ZigLeg[]>();

/** The plan the convoy steams now (1–6), or 0 with the zigzag off. */
export function zigPlanOf(c: ConvoyState): number {
  if (!c.zigzag) return 0;
  return c.zigPlan ?? defaultZigPlan(c.zigSeed ?? 1);
}

/** The legs of a plan in this match. */
export function convoyZigLegs(c: ConvoyState, plan = zigPlanOf(c)): ZigLeg[] {
  if (!plan) return [];
  const key = `${c.zigSeed ?? 1}:${plan}`;
  let legs = legCache.get(key);
  if (!legs) {
    legs = zigPlanLegs(plan, c.zigSeed ?? 1);
    if (legCache.size > 200) legCache.clear();
    legCache.set(key, legs);
  }
  return legs;
}

/** Each plan's name, text and speed of advance (fraction) in this match. */
export function zigPlanList(c: ConvoyState): { n: number; name: string; text: string; advance: number }[] {
  return ZIG_PLANS.map((p, i) => ({ n: i + 1, name: p.name, text: p.text, advance: Math.round(zigAdvance(convoyZigLegs(c, i + 1)) * 100) / 100 }));
}

/**
 * Zigzag on a plan (1–6) or off (0), ordered by the escort commander: the new plan starts at once
 * with its first leg (a plan ordered again keeps its rhythm).
 */
export function setZigPlan(c: ConvoyState, plan: number, now: number): void {
  const n = clamp(Math.round(plan), 0, ZIG_PLANS.length);
  if (!n) {
    c.zigzag = false;
    return;
  }
  if (c.zigzag && zigPlanOf(c) === n) return;
  c.zigzag = true;
  c.zigPlan = n;
  c.zigFrom = now;
}

/** Course off the base course now (deg) and seconds to the next zig. */
export function zigNow(c: ConvoyState, now: number): { dc: number; leftS: number } {
  const legs = convoyZigLegs(c);
  return legs.length ? zigOffset(legs, now - (c.zigFrom ?? 0)) : { dc: 0, leftS: 0 };
}

export function createConvoy(merchants: Ship[], waypoints: Vec2[], baseSpeedKn: number, spacing = 900, seed?: number): ConvoyState {
  const stations: Record<string, Vec2> = {};
  const cols = Math.ceil(Math.sqrt(merchants.length));
  merchants.forEach((m, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    stations[m.id] = { x: (col - (cols - 1) / 2) * spacing, y: -row * spacing };
  });
  const start = merchants.length ? centroid(merchants.map((m) => m.pos)) : { x: 0, y: 0 };
  const first = waypoints[0] ?? start;
  return {
    waypoints, wpIndex: 0, baseSpeedKn, guide: start, origin: { ...start }, guideHeading: bearing(start, first),
    zigzag: true, stations, scatterUntil: -1, arrived: [], arriveRadius: 3000, ...(seed !== undefined ? { zigSeed: seed >>> 0 } : {}),
  };
}

function centroid(ps: Vec2[]): Vec2 {
  const s = ps.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / ps.length, y: s.y / ps.length };
}

/** Station on the formation: the formation keeps its bearings on the base course (ships turn together on a zig). */
function stationPoint(c: ConvoyState, off: Vec2): Vec2 {
  const base = c.turn ? c.guideHeading : c.baseHeading ?? c.guideHeading;
  const fwd = headingVec(base);
  const stb = headingVec(base + 90);
  return { x: c.guide.x + stb.x * off.x + fwd.x * off.y, y: c.guide.y + stb.y * off.x + fwd.y * off.y };
}

/** Largest sideways detour the commodore accepts (m). */
export const CONVOY_DETOUR_MAX = 4000;

/** Shift the convoy's track sideways (e.g. around a mined stretch); 0 returns to the route. */
export function setConvoyOffset(c: ConvoyState, offset: number): void {
  c.offset = clamp(Math.round(offset), -CONVOY_DETOUR_MAX, CONVOY_DETOUR_MAX) || undefined;
}

/**
 * Where the guide steers: the waypoint, or with a detour ordered a point on the parallel
 * track 3 km ahead (the convoy moves over to it within a few kilometres, then follows it).
 */
function legTarget(c: ConvoyState, wp: Vec2, prev: Vec2): Vec2 {
  if (!c.offset) return wp;
  const dir = headingVec(bearing(prev, wp));
  const stb = headingVec(bearing(prev, wp) + 90);
  const end = { x: wp.x + stb.x * c.offset, y: wp.y + stb.y * c.offset };
  const along = (c.guide.x - prev.x) * dir.x + (c.guide.y - prev.y) * dir.y;
  const legLen = (wp.x - prev.x) * dir.x + (wp.y - prev.y) * dir.y;
  const at = Math.min(legLen, along + 3000);
  return at >= legLen ? end : { x: prev.x + dir.x * at + stb.x * c.offset, y: prev.y + dir.y * at + stb.y * c.offset };
}

/** Order the convoy to scatter away from a threat position for `duration` seconds. */
export function scatterConvoy(c: ConvoyState, from: Vec2, now: number, duration = 600): void {
  c.scatterUntil = now + duration;
  c.scatterFrom = { ...from };
}

/** Advance the convoy guide and give orders to all merchants. */
export function stepConvoy(c: ConvoyState, merchants: Ship[], dt: number, now: number): void {
  const wp = c.waypoints[c.wpIndex];
  if (wp) {
    // The leg line runs from the previous waypoint (first leg: from the start, not from the
    // moving guide, or a detour would keep pushing the track sideways)
    const prev = c.waypoints[c.wpIndex - 1] ?? c.origin ?? c.guide;
    if (distance(c.guide, legTarget(c, wp, prev)) < 1500 && c.wpIndex < c.waypoints.length - 1) c.wpIndex++;
    const cur = c.waypoints[c.wpIndex] ?? wp;
    const leg = bearing(c.guide, legTarget(c, cur, c.waypoints[c.wpIndex - 1] ?? prev));
    const zig = zigNow(c, now).dc;
    // An emergency turn holds its course (no zigzag) until it runs out
    if (c.turn && now >= c.turn.until) c.turn = undefined;
    // An ordered course replaces the route's leg; zigzag still swings about it
    c.baseHeading = c.turn ? c.turn.course : wrap360(c.course ?? leg);
    c.guideHeading = c.turn ? c.turn.course : wrap360(c.baseHeading + zig);
    const v = headingVec(c.guideHeading);
    const step = convoySpeedKn(c) * KN * dt;
    c.guide = { x: c.guide.x + v.x * step, y: c.guide.y + v.y * step };
  }
  const final = c.waypoints[c.waypoints.length - 1];
  const scattering = now < c.scatterUntil && c.scatterFrom;

  for (const m of merchants) {
    if (!m.alive || c.arrived.includes(m.id)) continue;
    if (final && distance(m.pos, final) < c.arriveRadius) {
      c.arrived.push(m.id);
      m.order.speedKn = 0;
      continue;
    }
    // A crippled freighter can't keep station: she falls out of the formation as a straggler,
    // dragging along on the convoy's general course at what speed she still makes
    if (m.founderAt !== undefined) {
      m.order.heading = c.guideHeading;
      m.order.speedKn = Math.min(m.order.speedKn, STRAGGLER_KN);
      continue;
    }
    if (scattering && c.scatterFrom) {
      const away = bearing(c.scatterFrom, m.pos);
      m.order.heading = wrap360(away + (m.id.charCodeAt(m.id.length - 1) % 2 ? 30 : -30));
      m.order.speedKn = 14;
      continue;
    }
    const off = c.stations[m.id] ?? { x: 0, y: 0 };
    const sp = stationPoint(c, off);
    const lead = headingVec(c.guideHeading);
    const aim = { x: sp.x + lead.x * 1500, y: sp.y + lead.y * 1500 };
    m.order.heading = c.hazards?.length ? steerClear(m.pos, bearing(m.pos, aim), c.hazards) : bearing(m.pos, aim);
    // Along-track error: positive when the station is ahead of the ship
    const along = (sp.x - m.pos.x) * lead.x + (sp.y - m.pos.y) * lead.y;
    const offCourse = Math.abs(angleDiff(m.heading, m.order.heading)) > 60 ? -2 : 0;
    m.order.speedKn = clamp(convoySpeedKn(c) + along / 300 + offCourse, 4, 14);
  }
}
