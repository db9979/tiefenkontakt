/** Units: meters, seconds, degrees (compass: 0 = north, clockwise). x = east, y = north. */

export const KN = 0.514444; // m/s per knot
export const NM = 1852; // meters per nautical mile

export interface Vec2 {
  x: number;
  y: number;
}

export const DEG = Math.PI / 180;

/** Normalize angle to [0, 360). */
export function wrap360(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed smallest difference b - a in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = wrap360(b - a);
  if (d > 180) d -= 360;
  return d;
}

/** Compass bearing from a to b in degrees. */
export function bearing(a: Vec2, b: Vec2): number {
  return wrap360(Math.atan2(b.x - a.x, b.y - a.y) / DEG);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Unit vector for a compass heading. */
export function headingVec(deg: number): Vec2 {
  return { x: Math.sin(deg * DEG), y: Math.cos(deg * DEG) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Move a value toward a target by at most maxStep. */
export function approach(v: number, target: number, maxStep: number): number {
  if (Math.abs(target - v) <= maxStep) return target;
  return v + Math.sign(target - v) * maxStep;
}

/** dB power sum: 10*log10(sum 10^(x/10)). */
export function dbSum(...levels: number[]): number {
  let s = 0;
  for (const l of levels) s += Math.pow(10, l / 10);
  return 10 * Math.log10(s);
}
