import { CLASSES } from './classes.js';
import type { Ship } from './entities.js';
import { angleDiff, bearing, distance, type Vec2 } from './math.js';

/** A plotted waypoint (game frame, m) with an optional speed and, for boats, depth for the leg leading to it. */
export interface Waypoint {
  x: number;
  y: number;
  speedKn?: number;
  depth?: number;
}

/**
 * A plotted route on the player's own chart. `idx` is the waypoint steered for next; the leg
 * orders (speed, depth) are given once when a leg begins, so the player can still change them
 * by hand without leaving the route. Any helm order by hand ends "Route fahren".
 */
export interface ShipRoute {
  wps: Waypoint[];
  idx: number;
  active: boolean;
  /** Index of the leg whose speed and depth were last ordered (internal). */
  leg?: number;
}

export const ROUTE_MAX_WPS = 20;
/** Inside this distance a waypoint counts as reached. */
export const ROUTE_ARRIVE_M = 500;
/** A waypoint left behind the beam this close counts as passed (no circling round it). */
const PASSED_M = 1500;

/** Where the ship believes it is: submerged boats steer by their dead reckoning, like the chart shows. */
export function believedPos(s: Ship): Vec2 {
  return { x: s.pos.x + (s.drErr?.x ?? 0), y: s.pos.y + (s.drErr?.y ?? 0) };
}

function reached(s: Ship, me: Vec2, wp: Waypoint): boolean {
  const d = distance(me, wp);
  if (d < ROUTE_ARRIVE_M) return true;
  return d < PASSED_M && Math.abs(angleDiff(s.heading, bearing(me, wp))) > 100;
}

/**
 * Autopilot along the plotted route: steer for the next waypoint (game frame), switch to the
 * following one on arrival, order the leg's speed and depth as it begins, and stop at the end.
 */
export function followRoute(s: Ship): void {
  const r = s.route;
  if (!r?.active) return;
  if (!s.alive) return void (r.active = false);
  const me = believedPos(s);
  while (r.idx < r.wps.length && reached(s, me, r.wps[r.idx]!)) r.idx++;
  const wp = r.wps[r.idx];
  if (!wp) {
    r.active = false;
    r.leg = undefined;
    return;
  }
  s.order.heading = bearing(me, wp);
  if (r.leg !== r.idx) {
    r.leg = r.idx;
    const spec = CLASSES[s.cls];
    if (wp.speedKn !== undefined) s.order.speedKn = Math.min(wp.speedKn, spec.maxSpeedKn);
    if (wp.depth !== undefined && spec.submarine && !s.snorkel) s.order.depth = Math.min(wp.depth, spec.maxDepth);
  }
}

/** A helm order by hand takes the ship off the route. */
export function disengageRoute(s: Ship): void {
  if (s.route?.active) {
    s.route.active = false;
    s.route.leg = undefined;
  }
}

/**
 * The player's route message: replace the waypoints (and where along them to steer for),
 * and/or switch "Route fahren" on or off. Returns an error text or undefined.
 */
export function setRoute(s: Ship, m: { wps?: Waypoint[]; idx?: number; active?: boolean }): string | undefined {
  const r = (s.route ??= { wps: [], idx: 0, active: false });
  if (m.wps) {
    r.wps = m.wps.slice(0, ROUTE_MAX_WPS).map((w) => ({ x: w.x, y: w.y, speedKn: w.speedKn, depth: CLASSES[s.cls].submarine ? w.depth : undefined }));
    r.idx = Math.max(0, Math.min(m.idx ?? r.idx, r.wps.length));
    r.leg = undefined;
  } else if (m.idx !== undefined) {
    r.idx = Math.max(0, Math.min(m.idx, r.wps.length));
    r.leg = undefined;
  }
  if (m.active === true) {
    if (!r.wps.length) return 'Keine Wegpunkte geplottet';
    // A route already run through starts again from the first point
    if (r.idx >= r.wps.length) r.idx = 0;
    r.active = true;
    r.leg = undefined;
  } else if (m.active === false || !r.wps.length) {
    disengageRoute(s);
  }
  return undefined;
}
