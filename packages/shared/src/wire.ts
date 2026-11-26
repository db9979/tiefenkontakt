/**
 * Wire guidance of heavyweight torpedoes (F16, realism round 5).
 *
 * The wire pays out from a dispenser in the torpedo and one at the boat's tube. It breaks when
 * the boat manoeuvres hard while guiding: a fast turn (the wire is dragged across the hull and
 * fouls the screw), a course that puts the torpedo astern (the wire runs along the hull into the
 * propeller), or high own speed (the drag snaps it). The fire-control console guides only a few
 * weapons at once; any further torpedo leaves the tube without a wire.
 *
 * Sources: Kilo's MVU-110EM and Type-206's SLW-83 guide two wire weapons at once; LA-class Mk 117
 * and the Soviet Omnibus console on Victor III/Akula four. Wire-guidance doctrine: steady course,
 * no course change over ~30° per minute, modest speed (Tigerfish, SET-65, Mk 48 handling notes).
 */
import { CLASSES, type ClassId } from './classes.js';
import type { Ship } from './entities.js';
import { KN, angleDiff, bearing, distance } from './math.js';

/** Wire-guided weapons the fire-control console guides at once (subs not listed: 2). */
export const WIRE_CHANNELS: Partial<Record<ClassId, number>> = { ssk: 2, ssa: 2, ssc: 2, ssn: 4, ssw: 4 };
/** Longest wire (m). */
export const WIRE_MAX_RANGE = 18_000;
/** Own speed above this snaps the wire; a warning from WIRE_WARN_KN. */
export const WIRE_MAX_OWNER_KN = 12;
const WIRE_WARN_KN = 10;
/** Own course change within about one minute (deg/min, decaying window) that breaks the wire. */
export const WIRE_MAX_TURN = 30;
const WIRE_WARN_TURN = 20;
/** Time constant of the turn window (s): a steady r°/s turn reads 60·r °/min. */
const TURN_WINDOW_S = 60;
/** The torpedo this far off the own bow (deg) means the wire runs along the hull into the screw. */
export const WIRE_MAX_LEAD = 135;
const WIRE_WARN_LEAD = 110;
/** The lead check needs the torpedo clear of the boat (m). */
const LEAD_MIN_RANGE = 400;
/** A broken wire stays on the wire panel this long (s), at the point where it broke. */
export const WIRE_LOST_SHOW_S = 90;

export function wireChannels(cls: ClassId): number {
  if (!CLASSES[cls].submarine) return 0;
  return WIRE_CHANNELS[cls] ?? 2;
}

/** The wire-guidance fields a torpedo carries. */
export interface WireState {
  wire: boolean;
  /** Own heading at the last tick, and the decaying course-change window (deg/min). */
  wireHdg?: number;
  wireTurn?: number;
  /** Shown on the wire panel before a manoeuvre would break the wire. */
  wireWarn?: string;
  /** Why and where the wire was lost (or why the torpedo left without one). */
  wireLost?: { at: number; why: string; x: number; y: number };
}

function n0(x: number): string {
  return String(Math.round(x));
}

/**
 * One tick of wire guidance: returns the reason when the wire breaks now, sets the warning
 * otherwise. `pos` is the torpedo's position.
 */
export function stepWire(t: WireState, owner: Ship | undefined, pos: { x: number; y: number }, dt: number): string | undefined {
  if (!t.wire) return undefined;
  if (!owner?.alive) return 'BOOT VERLOREN';
  const r = distance(owner.pos, pos);
  if (r > WIRE_MAX_RANGE) return 'DRAHTLÄNGE ERSCHÖPFT';
  const kn = owner.speed / KN;
  if (kn > WIRE_MAX_OWNER_KN + 0.05) return `EIGENE FAHRT ÜBER ${WIRE_MAX_OWNER_KN} KN`;
  const prev = t.wireHdg ?? owner.heading;
  const decay = Math.exp(-dt / TURN_WINDOW_S);
  t.wireTurn = (t.wireTurn ?? 0) * decay + Math.abs(angleDiff(prev, owner.heading));
  t.wireHdg = owner.heading;
  if (t.wireTurn > WIRE_MAX_TURN) return `KURSWECHSEL ZU SCHARF (ÜBER ${WIRE_MAX_TURN}°/MIN)`;
  const lead = r > LEAD_MIN_RANGE ? Math.abs(angleDiff(owner.heading, bearing(owner.pos, pos))) : 0;
  if (lead > WIRE_MAX_LEAD) return 'TORPEDO ACHTERAUS · DRAHT IN DER SCHRAUBE';
  t.wireWarn = wireWarning(owner, t.wireTurn, lead);
  return undefined;
}

/**
 * The warning before the wire breaks: the ordered course or speed would break it, or the boat
 * is already close to a limit. Undefined = the wire is safe.
 */
export function wireWarning(owner: Ship, turnDegMin: number, leadDeg: number): string | undefined {
  const ordered = owner.order?.heading;
  const swing = ordered !== undefined ? Math.abs(angleDiff(owner.heading, ordered)) : 0;
  const orderedKn = owner.order?.speedKn ?? 0;
  if (swing > 1 && predictedTurn(owner, swing, turnDegMin) > WIRE_MAX_TURN) return `BEFOHLENER KURS ${n0(swing)}° WEG BRICHT DRAHT · MAX. ${WIRE_MAX_TURN}°/MIN`;
  if (orderedKn > WIRE_MAX_OWNER_KN) return `BEFOHLENE FAHRT ${n0(orderedKn)} KN · DRAHT: MAX. ${WIRE_MAX_OWNER_KN} KN`;
  if (turnDegMin > WIRE_WARN_TURN) return `KURSWECHSEL ${n0(turnDegMin)}°/MIN · DRAHT: MAX. ${WIRE_MAX_TURN}°/MIN`;
  if (owner.speed / KN > WIRE_WARN_KN) return `FAHRT ${n0(owner.speed / KN)} KN · DRAHT: MAX. ${WIRE_MAX_OWNER_KN} KN`;
  if (leadDeg > WIRE_WARN_LEAD) return `TORPEDO ${n0(leadDeg)}° AB BUG · DRAHT: MAX. ${WIRE_MAX_LEAD}°`;
  return undefined;
}

/**
 * The turn window (deg/min) at the end of a turn of `swing` degrees at the boat's present speed:
 * it turns at min(class rate, speed / turn radius), so a slow boat can turn a long way gently.
 */
export function predictedTurn(owner: Ship, swing: number, turnDegMin: number): number {
  const spec = CLASSES[owner.cls];
  const rate = Math.min(spec.turnRateDeg, ((owner.speed / spec.turnRadius) * 180) / Math.PI);
  if (rate < 0.01) return turnDegMin;
  const T = swing / rate;
  const keep = Math.exp(-T / TURN_WINDOW_S);
  return turnDegMin * keep + rate * TURN_WINDOW_S * (1 - keep);
}

/** Whether a torpedo without its wire is still shown on the wire panel (recently broken). */
export function wireLostRecently(t: Pick<WireState, 'wire' | 'wireLost'>, now: number): boolean {
  return !t.wire && !!t.wireLost && now - t.wireLost.at < WIRE_LOST_SHOW_S;
}
