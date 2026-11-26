/**
 * The real moon over the sea area. A low-precision lunar ephemeris (Meeus, Astronomical
 * Algorithms ch. 47, the main terms: about 0.1° in longitude) and the sun's longitude (ch. 25)
 * give the moon's age, phase and place for the match's date.
 *
 * Time base: the game's sun and stars stand where they do in the middle of the match's month at
 * the ship's clock read as local solar time (climate.ts sunPosition, the client's astro.ts). The
 * moon keeps its real angle to the sun on the match's own day (so its phase, its terminator and
 * its rising against sunset are right) and is placed on that same sky: it rises, stands and sets
 * with the game's sun and stars.
 *
 * Gameplay: moonlight lifts the night's light for the eye. A dark night (new moon, the moon down or
 * behind the clouds) hides a periscope feather better than the constant night assumed before; a
 * bright full moon high in a clear sky helps the escort's lookouts and anyone watching for aircraft.
 */

import type { Environment } from './acoustics.js';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const sind = (d: number) => Math.sin(rad(d));
const cosd = (d: number) => Math.cos(rad(d));

/** Obliquity of the ecliptic (degrees), as the game's sky takes it. */
const EPS = 23.44;
/** Day of the year in the middle of each month (the game's sun stands there all month). */
const MID_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const midMonthDoy = (month: number) => MID_DOY[(((Math.round(month) - 1) % 12) + 12) % 12]!;
/** The year the matches are set in (the date only picks the moon's age; any year would do). */
export const MATCH_YEAR = 1987;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The game sun's ecliptic longitude (degrees) in the middle of a month (sunPosition's orbit). */
export function gameSunLon(month: number): number {
  // sunPosition takes the declination as -23.44° · cos(2π (doy + 10) / 365): longitude θ - 90°
  return wrap360((360 / 365) * (midMonthDoy(month) + 10) - 90);
}

/** The game sun's right ascension (degrees) in the middle of a month. */
export function sunRa(month: number): number {
  const lam = rad(gameSunLon(month));
  return wrap360(deg(Math.atan2(Math.cos(rad(EPS)) * Math.sin(lam), Math.cos(lam))));
}

/** Local sidereal time (degrees): the right ascension on the meridian at the local solar hour. */
export function siderealDeg(month: number, hour: number): number {
  return wrap360(sunRa(month) + 15 * (hour - 12));
}

/** Julian day of a calendar date (Gregorian) and a UT hour; days past the month's end roll on. */
export function julianDay(year: number, month: number, day: number, hourUt = 0): number {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + hourUt / 24 + b - 1524.5;
}

/** The sun's apparent ecliptic longitude (degrees) on a Julian day (Meeus ch. 25, low precision). */
export function sunLon(jd: number): number {
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T;
  const M = 357.52911 + 35999.05029 * T;
  const C = (1.914602 - 0.004817 * T) * sind(M) + (0.019993 - 0.000101 * T) * sind(2 * M) + 0.000289 * sind(3 * M);
  return wrap360(L0 + C - 0.00569);
}

// Periodic terms: [D, M, M', F, coefficient]; longitude and latitude in 1e-6°, distance in metres
const LON: readonly (readonly number[])[] = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116],
  [0, 0, 0, 2, -114332], [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758],
  [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720], [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034], [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888],
  [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163],
];
const DIST: readonly (readonly number[])[] = [
  [0, 0, 1, 0, -20905355], [2, 0, -1, 0, -3699111], [2, 0, 0, 0, -2955968], [0, 0, 2, 0, -569925], [0, 1, 0, 0, 48888],
  [0, 0, 0, 2, -3149], [2, 0, -2, 0, 246158], [2, -1, -1, 0, -152138], [2, 0, 1, 0, -170733], [2, -1, 0, 0, -204586],
  [0, 1, -1, 0, -129620], [1, 0, 0, 0, 108743], [0, 1, 1, 0, 104755],
];
const LAT: readonly (readonly number[])[] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822],
];

/** The moon's geocentric ecliptic longitude, latitude (degrees) and distance (km) on a Julian day (Meeus ch. 47, main terms). */
export function moonEcliptic(jd: number): { lon: number; lat: number; distKm: number } {
  const T = (jd - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = 297.8501921 + 445267.1114034 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T;
  const F = 93.272095 + 483202.0175233 * T;
  const E = 1 - 0.002516 * T;
  const sum = (terms: readonly (readonly number[])[], f: (x: number) => number) => {
    let s = 0;
    for (const [d, m, mp, ff, c] of terms) s += c! * f(d! * D + m! * M + mp! * Mp + ff! * F) * (m === 0 ? 1 : E);
    return s;
  };
  return {
    lon: wrap360(Lp + sum(LON, sind) / 1e6),
    lat: sum(LAT, sind) / 1e6,
    distKm: 385000.56 + sum(DIST, cosd) / 1000,
  };
}

/** The moon's phase on a Julian day: illuminated fraction, phase angle (0 = full, 180 = new), elongation east of the sun, age in days. */
export function moonPhase(jd: number): { frac: number; phaseAngle: number; elong: number; waxing: boolean; age: number } {
  const m = moonEcliptic(jd);
  const elong = wrap360(m.lon - sunLon(jd));
  // Angular distance moon-sun, then the angle sun-moon-earth
  const psi = Math.acos(cosd(m.lat) * cosd(elong));
  const R = 149_597_870;
  const i = Math.atan2(R * Math.sin(psi), m.distKm - R * Math.cos(psi));
  return { frac: (1 + Math.cos(i)) / 2, phaseAngle: deg(i), elong, waxing: elong < 180, age: (elong / 360) * 29.530589 };
}

/** The moon over the sea area for the game: where it stands, how much of it is lit. */
export interface MoonSky {
  /** Topocentric elevation (degrees, no refraction) and true azimuth. */
  el: number; az: number;
  /** Lit fraction of the disc (0..1), phase angle (degrees, 0 = full), waxing or waning, age (days). */
  frac: number; phaseAngle: number; waxing: boolean; age: number;
  /** Right ascension and declination on the game's sky (degrees): the client places the disc from them. */
  ra: number; dec: number;
}

/** Where, when: latitude, longitude (degrees east), month and day of the match. */
export interface MoonPlace { lat: number; lon?: number; month: number; day: number }

/** The match's day of the month, drawn from the seed: the moon's phase differs from match to match, the same seed gives the same night. */
export function matchDay(month: number, seed: number): number {
  const n = DAYS_IN_MONTH[(((Math.round(month) - 1) % 12) + 12) % 12]!;
  const h = Math.imul((seed >>> 0) ^ 0x5bd1e995, 2654435761) >>> 0;
  return 1 + ((h >>> 7) % n);
}

/** The moon at a local solar hour (the ship's clock) on the game's sky. Days past the month's end roll on. */
export function moonSky(at: MoonPlace, hour: number): MoonSky {
  const jd = julianDay(MATCH_YEAR, at.month, at.day, hour - (at.lon ?? 0) / 15);
  const m = moonEcliptic(jd);
  const ph = moonPhase(jd);
  // The real angle to the sun, laid off from the game's sun
  const lam = rad(gameSunLon(at.month) + ph.elong), bet = rad(m.lat), e = rad(EPS);
  const ra = wrap360(deg(Math.atan2(Math.sin(lam) * Math.cos(e) - Math.tan(bet) * Math.sin(e), Math.cos(lam))));
  const dec = deg(Math.asin(Math.sin(bet) * Math.cos(e) + Math.cos(bet) * Math.sin(e) * Math.sin(lam)));
  const H = rad(siderealDeg(at.month, hour) - ra), phi = rad(at.lat), d = rad(dec);
  const elG = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi));
  // Parallax: seen from the surface the moon stands up to a degree lower than from the earth's centre
  const par = Math.asin(6378.14 / m.distKm);
  return { el: deg(elG - par * Math.cos(elG)), az: wrap360(deg(az) + 180), frac: ph.frac, phaseAngle: ph.phaseAngle, waxing: ph.waxing, age: ph.age, ra, dec };
}

/** Elevation of the moon's centre at rising and setting: upper limb on the horizon, refraction lifts it 34'. */
export const MOONRISE_EL = 0.26 - 0.57;

/** Moonrise and moonset (local solar hours) within the 24 hours from `from`; undefined when there is none. */
export function moonRiseSet(at: MoonPlace, from: number): { rise?: number; set?: number } {
  const out: { rise?: number; set?: number } = {};
  const STEP = 0.25;
  let prev = moonSky(at, from).el - MOONRISE_EL;
  for (let h = from + STEP; h <= from + 24 + 1e-9; h += STEP) {
    const cur = moonSky(at, h).el - MOONRISE_EL;
    if ((prev < 0) !== (cur < 0)) {
      const t = h - STEP + (STEP * prev) / (prev - cur);
      if (cur > 0) out.rise ??= t;
      else out.set ??= t;
      if (out.rise !== undefined && out.set !== undefined) break;
    }
    prev = cur;
  }
  return out;
}

/** The moon's light relative to a full moon (the phase law: a half moon gives about a tenth). */
export function phaseBrightness(phaseAngle: number): number {
  const i = Math.abs(phaseAngle);
  return 10 ** (-0.4 * (0.026 * i + 4e-9 * i ** 4));
}

/**
 * Moonlight at the sea (0..1): 1 = a full moon high (above about 33°) in a clear sky. Low down
 * the light falls on the sea at a glancing angle through much air; clouds take most of it.
 */
export function moonlight(m: Pick<MoonSky, 'el' | 'phaseAngle'>, cloud = 0): number {
  const alt = clamp01(Math.sin(rad(m.el + 0.8)) / 0.55);
  return phaseBrightness(m.phaseAngle) * alt * (1 - 0.85 * clamp01(cloud));
}

/** Cloud cover (0..1) as the sky shows it: fair-weather cumulus in a calm, more with the wind, overcast in rain. */
export function cloudCover(seaState: number, rain: boolean | number): number {
  const r = typeof rain === 'number' ? clamp01(rain) : rain ? 1 : 0;
  return Math.min(1, Math.max(0.12 + (seaState - 1) * 0.11, r * 0.95));
}

/** Moonlight for the sim: the environment's place, date and clock, its clouds. Undefined off the real charts or without a date. */
export function envMoonlight(env: Pick<Environment, 'lat' | 'month' | 'day' | 'lon' | 'weather' | 'seaState' | 'rain'>): number | undefined {
  if (env.lat === undefined || !env.month || env.day === undefined || !env.weather) return undefined;
  const m = moonSky({ lat: env.lat, lon: env.lon, month: env.month, day: env.day }, env.weather.clock);
  return Math.round(moonlight(m, cloudCover(env.seaState, !!env.rain)) * 1000) / 1000;
}

/** What moonlight adds to the eye's night light at full strength, and what a moonless night takes off the old constant night. */
export const MOON_GAIN = 0.15;
export const DARK_CUT = 0.013;

/**
 * The light the eye works with (0..1): daylight, and at night the moon. A moonless or overcast
 * night is a little darker than the plain night value, a bright moon high in a clear sky lifts it
 * to about that of late twilight. Without moon data (test worlds) the daylight alone.
 */
export function seeingLight(env: Pick<Environment, 'light' | 'moon'>): number {
  const L = env.light ?? 1;
  if (env.moon === undefined) return L;
  const night = clamp01((0.45 - L) / 0.33);
  return Math.max(0, L + night * (MOON_GAIN * env.moon - DARK_CUT));
}

/** "21:40" for a local hour. */
export function hhmm(hour: number): string {
  const m = Math.round((((hour % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const deg3 = (a: number) => `${String(Math.round(wrap360(a)) % 360).padStart(3, '0')}°`;

/**
 * The moon as the crew reports it: "MOND 72 % ZUN. · 214° 18° HOCH · UNTERGANG 04:10",
 * "MOND 40 % ABN. · UNTER · AUFGANG 23:35", "VOLLMOND …", "NEUMOND". `brg` writes a true azimuth
 * as the station shows bearings (default: three digits, true).
 */
export function moonReport(at: MoonPlace, hour: number, brg: (trueAz: number) => string = deg3): { text: string; up: boolean; frac: number; az?: number } {
  const m = moonSky(at, hour);
  const pct = Math.round(m.frac * 100);
  if (pct <= 2) return { text: 'NEUMOND', up: false, frac: m.frac };
  const rs = moonRiseSet(at, hour);
  const up = m.el > MOONRISE_EL;
  const shape = pct >= 98 ? 'VOLLMOND' : `MOND ${pct} % ${m.waxing ? 'ZUN.' : 'ABN.'}`;
  if (up) {
    return { text: `${shape} · ${brg(m.az)} ${Math.max(0, Math.round(m.el))}° HOCH${rs.set !== undefined ? ` · UNTERGANG ${hhmm(rs.set)}` : ''}`, up, frac: m.frac, az: m.az };
  }
  return { text: `${shape} · UNTER${rs.rise !== undefined ? ` · AUFGANG ${hhmm(rs.rise)}` : ''}`, up, frac: m.frac };
}

/** The moon for the briefing, in words: "Vollmond, steht bei Beginn 24° hoch, geht um 06:10 unter". */
export function moonNote(at: MoonPlace, hour: number): string {
  const m = moonSky(at, hour);
  const pct = Math.round(m.frac * 100);
  if (pct <= 2) return 'Neumond: mondlose, dunkle Nacht';
  const shape = pct >= 98 ? 'Vollmond' : `${m.waxing ? 'zunehmender' : 'abnehmender'} Mond, ${pct} % beleuchtet`;
  const rs = moonRiseSet(at, hour);
  if (m.el > MOONRISE_EL) return `${shape}, steht bei Beginn ${Math.max(0, Math.round(m.el))}° hoch${rs.set !== undefined ? `, geht um ${hhmm(rs.set)} unter` : ''}`;
  return `${shape}${rs.rise !== undefined ? `, geht um ${hhmm(rs.rise)} auf` : ', bleibt unter dem Horizont'}`;
}
