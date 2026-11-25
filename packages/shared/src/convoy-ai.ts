import type { Ship } from './entities.js';
import { steerClear } from './mines.js';
import { KN, angleDiff, bearing, clamp, distance, headingVec, wrap360, type Vec2 } from './math.js';

export interface ConvoyState {
  waypoints: Vec2[];
  wpIndex: number;
  baseSpeedKn: number;
  guide: Vec2; // virtual formation center
  guideHeading: number;
  zigzag: boolean;
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
}

const ZIG_PERIOD = 480; // s per leg
/** Most a crippled straggler makes (kn, damage.ts caps the ship to the same). */
const STRAGGLER_KN = 4;
const ZIG_ANGLE = 25; // deg

export function createConvoy(merchants: Ship[], waypoints: Vec2[], baseSpeedKn: number, spacing = 900): ConvoyState {
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
    zigzag: true, stations, scatterUntil: -1, arrived: [], arriveRadius: 3000,
  };
}

function centroid(ps: Vec2[]): Vec2 {
  const s = ps.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / ps.length, y: s.y / ps.length };
}

function stationPoint(c: ConvoyState, off: Vec2): Vec2 {
  const fwd = headingVec(c.guideHeading);
  const stb = headingVec(c.guideHeading + 90);
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
    const zig = c.zigzag ? (Math.floor(now / ZIG_PERIOD) % 2 === 0 ? ZIG_ANGLE : -ZIG_ANGLE) : 0;
    c.guideHeading = wrap360(leg + zig);
    const v = headingVec(c.guideHeading);
    const step = c.baseSpeedKn * KN * dt;
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
    m.order.speedKn = clamp(c.baseSpeedKn + along / 300 + offCourse, 4, 14);
  }
}
