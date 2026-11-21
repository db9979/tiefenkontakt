import type { Ship } from './entities.js';
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
}

const ZIG_PERIOD = 480; // s per leg
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
    waypoints, wpIndex: 0, baseSpeedKn, guide: start, guideHeading: bearing(start, first),
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

/** Order the convoy to scatter away from a threat position for `duration` seconds. */
export function scatterConvoy(c: ConvoyState, from: Vec2, now: number, duration = 600): void {
  c.scatterUntil = now + duration;
  c.scatterFrom = { ...from };
}

/** Advance the convoy guide and give orders to all merchants. */
export function stepConvoy(c: ConvoyState, merchants: Ship[], dt: number, now: number): void {
  const wp = c.waypoints[c.wpIndex];
  if (wp) {
    if (distance(c.guide, wp) < 1500 && c.wpIndex < c.waypoints.length - 1) c.wpIndex++;
    const leg = bearing(c.guide, c.waypoints[c.wpIndex] ?? wp);
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
    m.order.heading = bearing(m.pos, aim);
    // Along-track error: positive when the station is ahead of the ship
    const along = (sp.x - m.pos.x) * lead.x + (sp.y - m.pos.y) * lead.y;
    const offCourse = Math.abs(angleDiff(m.heading, m.order.heading)) > 60 ? -2 : 0;
    m.order.speedKn = clamp(c.baseSpeedKn + along / 300 + offCourse, 4, 14);
  }
}
