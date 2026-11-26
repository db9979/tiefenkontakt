import { siderealDeg } from '@tk/shared';
import { STAR_COUNT, STARS_B64 } from './star-catalog.js';

/**
 * Where the fixed stars stand over the sea area. Same time base as the sun (climate.ts sunPosition):
 * the middle of the match's month and the ship's clock as local solar time, so the sun and the stars
 * keep their real places to each other. Positions are J2000; precession (about 1° in 70 years) is left out.
 */

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
/** Where the sky is set up for: latitude, month (1..12) and how far the map's north is turned from true north (degrees); the moon also wants the day and the longitude. */
export interface SkyPlace { lat: number; month: number; turn: number; day?: number; lon?: number }

// The game's sun and its sidereal time live in the shared package (moon.ts), where the moon is placed on the same sky
export { siderealDeg, sunRa } from '@tk/shared';

/**
 * Rotation (row-major 3×3) from the equatorial unit vector (x to the vernal equinox, z to the
 * celestial pole) to the scene: x = map east, y = up, -z = map north.
 */
export function equToScene(lat: number, lst: number, turn: number): number[] {
  const L = rad(lst), p = rad(lat), b = rad(turn);
  const cL = Math.cos(L), sL = Math.sin(L), cp = Math.cos(p), sp = Math.sin(p), cb = Math.cos(b), sb = Math.sin(b);
  // Hour-angle frame u (x to the meridian, y to the east, z to the pole) = Rz(-lst) · e
  const U = [[cL, sL, 0], [-sL, cL, 0], [0, 0, 1]];
  // Local horizon: up, true north, true east
  const up = [cp * U[0]![0]! + sp * U[2]![0]!, cp * U[0]![1]! + sp * U[2]![1]!, cp * U[0]![2]! + sp * U[2]![2]!];
  const north = [-sp * U[0]![0]! + cp * U[2]![0]!, -sp * U[0]![1]! + cp * U[2]![1]!, -sp * U[0]![2]! + cp * U[2]![2]!];
  const east = U[1]!;
  // Map frame: the map's north lies `turn` degrees east of true north
  const mN = north.map((v, i) => v * cb + east[i]! * sb);
  const mE = east.map((v, i) => v * cb - north[i]! * sb);
  return [...mE, ...up, ...mN.map((v) => -v)];
}

/** Equatorial unit vector of a right ascension and declination (degrees). */
export function equVec(ra: number, dec: number): [number, number, number] {
  const a = rad(ra), d = rad(dec);
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

/** Elevation and map-frame azimuth (degrees) of a star seen from a place at a local solar hour. */
export function starPlace(ra: number, dec: number, at: SkyPlace, hour: number): { el: number; az: number } {
  const m = equToScene(at.lat, siderealDeg(at.month, hour), at.turn);
  const e = equVec(ra, dec);
  const x = m[0]! * e[0] + m[1]! * e[1] + m[2]! * e[2];
  const y = m[3]! * e[0] + m[4]! * e[1] + m[5]! * e[2];
  const z = m[6]! * e[0] + m[7]! * e[1] + m[8]! * e[2];
  return { el: deg(Math.asin(Math.max(-1, Math.min(1, y)))), az: wrap360(deg(Math.atan2(x, -z))) };
}

/** Galactic north pole and centre (J2000), for the Milky Way. */
export const GAL_POLE = equVec(192.8595, 27.1283);
export const GAL_CENTRE = equVec(266.405, -28.936);

/** The packed catalogue as arrays: equatorial unit vectors, V magnitude, B-V. */
export function starCatalog(): { pos: Float32Array; mag: Float32Array; bv: Float32Array } {
  const bin = atob(STARS_B64);
  const pos = new Float32Array(STAR_COUNT * 3), mag = new Float32Array(STAR_COUNT), bv = new Float32Array(STAR_COUNT);
  const u8 = (i: number) => bin.charCodeAt(i);
  for (let i = 0; i < STAR_COUNT; i++) {
    const o = i * 6;
    const ra = ((u8(o) | (u8(o + 1) << 8)) / 65535) * 360;
    const dec = ((u8(o + 2) | (u8(o + 3) << 8)) / 65535) * 180 - 90;
    pos.set(equVec(ra, dec), i * 3);
    mag[i] = u8(o + 4) / 40 - 1.5;
    bv[i] = u8(o + 5) / 80 - 0.4;
  }
  return { pos, mag, bv };
}

/**
 * The faint stars past the catalogue (V 4.6 to 8): not real ones, a seeded scatter with the real
 * count per magnitude (about three times as many each magnitude fainter) and crowding toward the
 * Milky Way. The naked eye hardly reaches them; binoculars and the periscope fill their field with them.
 */
export function faintStars(n = 24_000, seed = 7): { pos: Float32Array; mag: Float32Array; bv: Float32Array } {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), bv = new Float32Array(n);
  const lo = 10 ** (0.47 * 4.6), hi = 10 ** (0.47 * 8);
  for (let i = 0; i < n; ) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    const v: [number, number, number] = [r * Math.cos(a), r * Math.sin(a), z];
    const b = v[0] * GAL_POLE[0] + v[1] * GAL_POLE[1] + v[2] * GAL_POLE[2];
    if (rnd() > 0.3 + 0.7 * Math.exp(-(b * b) / 0.06)) continue;
    pos.set(v, i * 3);
    mag[i] = Math.log10(lo + rnd() * (hi - lo)) / 0.47;
    bv[i] = -0.1 + 1.5 * rnd() * rnd() + 0.3 * rnd();
    i++;
  }
  return { pos, mag, bv };
}
