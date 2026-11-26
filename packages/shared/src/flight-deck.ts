import type { Ship } from './entities.js';
import { KN, angleDiff, wrap360 } from './math.js';
import { trueDeg3 } from './regions.js';
import type { World } from './world.js';

/**
 * Flying course for the ship's helicopter (F14). A frigate launches and recovers her helicopter
 * only with the relative wind inside the ship-helicopter operating limits: about 30° either side
 * of the bow for a Lynx/Sea King class aircraft on a frigate's deck (the "green deck" envelope),
 * wind over the deck not above about 45 kn, the ship steady on course (no turn under way), and
 * the sea state inside the deck-motion limits: a harpoon deck lock holds a Lynx to about SS5–6,
 * so above SS5 there is no launch and a recovery takes twice as long.
 * The officer of the watch is given a course: the nearest one to the present heading that puts
 * the wind inside the envelope with a margin.
 */

/** Relative wind limit either side of the bow (deg). */
export const FLYCO_REL_DEG = 30;
/** Wind over the deck limit (kn). */
export const FLYCO_WOD_KN = 45;
/** Highest sea state a launch is allowed in. */
export const FLYCO_MAX_SS = 5;
/** Steady on course: rate of turn at most this (deg/s). */
const STEADY_YAW = 0.3;
/** Course the bridge is given: inside the envelope with this margin (deg). */
const COURSE_MARGIN_DEG = 8;
/** Prevailing westerly when the match has no weather cells (game frame, deg the wind comes from). */
const DEFAULT_WIND_FROM = 250;
/** Ship speed assumed for the course the bridge is given when she makes less (kn): steerage way, 10 kn typical. */
const COURSE_SPEED_KN = 10;

/** True wind speed by sea state (kn, Beaufort scale for a fully developed sea). */
export function windKnFor(seaState: number): number {
  return [4, 5, 9, 13, 18, 24, 30, 37][Math.max(0, Math.min(7, Math.round(seaState)))]!;
}

/**
 * Where the true wind comes from (game frame, deg) and how strong it is (kn). A world without
 * weather cells (lessons, tests) has light and variable airs: the ship's own way makes the deck wind.
 */
export function trueWind(w: World): { from: number; kn: number } {
  const v = w.env.met?.wind;
  if (!w.env.met) return { from: DEFAULT_WIND_FROM, kn: 0 };
  const from = v && (v.x !== 0 || v.y !== 0) ? wrap360((Math.atan2(-v.x, -v.y) * 180) / Math.PI) : DEFAULT_WIND_FROM;
  return { from, kn: windKnFor(w.env.seaState) };
}

/** Relative wind for a ship on `heading` at `speedKn`: off the bow (deg, + starboard) and over the deck (kn). */
export function relativeWind(wind: { from: number; kn: number }, heading: number, speedKn: number): { rel: number; kn: number } {
  // Vectors the wind blows toward; the ship's own way adds a head wind
  const a = ((wind.from + 180) * Math.PI) / 180;
  const h = (heading * Math.PI) / 180;
  const x = Math.sin(a) * wind.kn - Math.sin(h) * speedKn;
  const y = Math.cos(a) * wind.kn - Math.cos(h) * speedKn;
  const kn = Math.hypot(x, y);
  if (kn < 0.5) return { rel: 0, kn };
  const from = wrap360((Math.atan2(-x, -y) * 180) / Math.PI);
  return { rel: angleDiff(heading, from), kn };
}

export type FlycoBlock = 'wind' | 'turn' | 'sea';

export interface FlyingCourse {
  /** Launch or recovery may go ahead now. */
  ok: boolean;
  /** Why not: relative wind outside the envelope, turning, or the sea too high (launch only). */
  block?: FlycoBlock;
  windFrom: number;
  windKn: number;
  rel: number;
  wodKn: number;
  /** Course for the bridge (game frame, deg): the present heading if it already serves. */
  course: number;
  /** A recovery takes this many times as long (heavy sea). */
  slow: number;
}

/** Is the wind inside the envelope on this heading at this speed? */
function inside(wind: { from: number; kn: number }, heading: number, speedKn: number, margin: number): boolean {
  const r = relativeWind(wind, heading, speedKn);
  return Math.abs(r.rel) <= FLYCO_REL_DEG - margin && r.kn <= FLYCO_WOD_KN;
}

/** Nearest course to `heading` with the wind inside the envelope (with a margin). */
export function nearestFlyingCourse(wind: { from: number; kn: number }, heading: number, speedKn: number): number {
  const v = Math.max(speedKn, COURSE_SPEED_KN);
  for (let d = 0; d <= 180; d += 5) {
    for (const sgn of d ? [1, -1] : [1]) {
      const h = wrap360(Math.round(heading / 5) * 5 + sgn * d);
      if (inside(wind, h, v, COURSE_MARGIN_DEG)) return h;
    }
  }
  return wrap360(Math.round(wind.from));
}

/** The flying-course check for launch (true) or recovery (false). */
export function flyingCourse(w: World, s: Ship, launch: boolean): FlyingCourse {
  const wind = trueWind(w);
  const kn = s.speed / KN;
  const r = relativeWind(wind, s.heading, kn);
  const okWind = Math.abs(r.rel) <= FLYCO_REL_DEG && r.kn <= FLYCO_WOD_KN;
  const steady = Math.abs(s.yawRate ?? 0) <= STEADY_YAW;
  const ss = w.env.seaState;
  const sea = launch && ss > FLYCO_MAX_SS;
  // The course to hold: the present one if it serves, else the nearest that does (ordered heading first)
  const course = okWind && Math.abs(angleDiff(s.heading, s.order.heading)) < 5 ? wrap360(Math.round(s.heading))
    : inside(wind, s.order.heading, Math.max(kn, COURSE_SPEED_KN), 0) ? wrap360(Math.round(s.order.heading))
    : nearestFlyingCourse(wind, s.heading, kn);
  const block: FlycoBlock | undefined = sea ? 'sea' : !okWind ? 'wind' : !steady ? 'turn' : undefined;
  return {
    ok: !block, ...(block ? { block } : {}), windFrom: Math.round(wind.from), windKn: wind.kn, rel: Math.round(r.rel), wodKn: Math.round(r.kn),
    course, slow: ss > FLYCO_MAX_SS ? 2 : 1,
  };
}

/** Rotors running and lift-off on the flying course (s): engage, final checks, lift. */
export const LAUNCH_ON_COURSE_S = 60;
/** Recovery alongside (s): approach to the hover over the deck, landing, deck lock; twice that in a heavy sea. */
export const RECOVERY_S = 90;
/** Repeat a flight-deck message to the bridge after this long (s). */
const SAY_AGAIN_S = 120;

/** The helicopter state the flight deck works on (helo.ts). */
interface DeckHelo {
  deckSince?: number;
  deckSaid?: { what: string; t: number };
}

/** What the flight deck tells the bridge when it is not ready. */
export function deckMessage(w: World, f: FlyingCourse, launch: boolean): string {
  if (f.block === 'sea') return 'SEEGANG ZU HOCH · KEIN START';
  if (f.block === 'turn') return 'SCHIFF DREHT · FLUGDECK ROT';
  return `FLUGKURS NÖTIG · WIND ${trueDeg3(w, f.windFrom)}° · KURS ${trueDeg3(w, f.course)}°${launch ? '' : ' · LANDUNG WARTET'}`;
}

/**
 * One tick of the flight deck for a launch (rotors running) or a recovery: true once the ship has
 * held a flying course long enough. Off it, the clock starts again and the bridge is told why.
 */
export function deckReady(w: World, h: DeckHelo, ship: Ship, launch: boolean, tell: (text: string) => void): boolean {
  const f = flyingCourse(w, ship, launch);
  if (!f.ok) {
    h.deckSince = undefined;
    const what = deckMessage(w, f, launch);
    const said = h.deckSaid;
    // Said again when the reason changes, or every two minutes
    if (!said || said.what.split(' · KURS')[0] !== what.split(' · KURS')[0] || w.time - said.t >= SAY_AGAIN_S) {
      h.deckSaid = { what, t: w.time };
      tell(what);
    }
    return false;
  }
  if (h.deckSince === undefined) {
    h.deckSince = w.time;
    if (h.deckSaid) tell(launch ? 'FLUGKURS LIEGT AN · ROTOREN LAUFEN' : 'FLUGKURS LIEGT AN · LANDEANFLUG');
    h.deckSaid = undefined;
  }
  const need = (launch ? LAUNCH_ON_COURSE_S : RECOVERY_S) * f.slow;
  return w.time - h.deckSince >= need;
}
