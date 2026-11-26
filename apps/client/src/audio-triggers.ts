import type { ClassId } from '@tk/shared';

/**
 * When the on-board sounds play: pure functions of what the own ship really knows (the
 * snapshot), no WebAudio here, so the rules are unit-tested (tests/audio-triggers.test.ts).
 */

/** Trim pumps run while the boat is out of trim by more than 0,2 t (boat.ts stepWorkNoise). */
export const TRIM_PUMP_T = 0.2;
export function trimPumpsRunning(trim: number | undefined): boolean {
  return Math.abs(trim ?? 0) > TRIM_PUMP_T;
}

/**
 * Strain on the pressure hull, 0 near the surface … 1 at the test depth (more beyond it):
 * depth against the present test depth (lower after hull damage), more while going deeper
 * fast (rateMps > 0 = deeper), a damaged hull works harder.
 */
export function hullStrain(depth: number, limit: number, rateMps: number, hullDmg: number): number {
  if (limit <= 0 || depth < 15) return 0;
  const frac = depth / limit;
  const base = Math.max(0, (frac - 0.15) / 0.85);
  // The frames take the load while the pressure changes: going down is heard, coming up less so
  const change = Math.max(0, rateMps) * 0.35 + Math.max(0, -rateMps) * 0.1;
  return (base + change * Math.min(1, frac * 3)) * (1 + hullDmg);
}

/** Creaks per minute at this strain (none when the hull is not working). */
export function creaksPerMin(strain: number): number {
  return strain < 0.05 ? 0 : Math.min(20, 1 + 9 * strain);
}

/** Deep groans of the whole hull per minute: from 80 % of the test depth on, many below it. */
export function groansPerMin(depth: number, limit: number, hullDmg: number): number {
  if (limit <= 0) return 0;
  const frac = depth / limit;
  return frac < 0.8 ? 0 : Math.min(12, (frac - 0.8) * 20 * (1 + hullDmg));
}

/** Seconds to the next event at `perMin` (random 0,5…1,5 × the mean); Infinity for none. */
export function nextGapS(perMin: number, r = Math.random()): number {
  return perMin <= 0 ? Infinity : (60 / perMin) * (0.5 + r);
}

/** Shortest head-valve closure (boat.ts VALVE_MIN_S) and the longest (min + spread). */
export const VALVE_MIN_S = 20;
export const VALVE_MAX_S = 40;
/** The snorkel head valve slammed shut: the crew's report. */
export function isHeadValveSlam(text: string): boolean {
  return /KOPFVENTIL SCHLÄGT ZU/.test(text);
}

/**
 * The snorkel diesel runs: head up, and not while a wave holds the head valve shut. The valve
 * opens after 20–40 s (not in the snapshot): the diesel is heard again once the battery
 * charges again, at the latest after 40 s.
 */
export function dieselRunning(snorkelUp: boolean, sinceSlamS: number, charging: boolean): boolean {
  if (!snorkelUp) return false;
  if (sinceSlamS < VALVE_MIN_S) return false;
  return sinceSlamS >= VALVE_MAX_S || charging;
}

/**
 * Gas turbines of a surface ship (0 = none heard, 1 = full power) and the whine's pitch.
 * Frigates F-12 and Projekt 11 run on turbines alone, the corvette cuts its turbine in above
 * 18 kn (diesel below), the steam frigate F-30 has a softer, lower turbine.
 */
const TURBINE: Partial<Record<ClassId, { from: number; max: number; hz: number; k: number }>> = {
  ffg: { from: 0, max: 29, hz: 1100, k: 1 },
  ffk: { from: 0, max: 28, hz: 1000, k: 1 },
  kor: { from: 18, max: 30, hz: 1250, k: 1 },
  ffv: { from: 0, max: 28, hz: 520, k: 0.45 },
};
export function turbine(cls: ClassId, kn: number, alive = true): { level: number; hz: number } {
  const t = TURBINE[cls];
  if (!t || !alive || kn < t.from - 0.5) return { level: 0, hz: t?.hz ?? 1000 };
  const share = Math.max(0, Math.min(1, (Math.abs(kn) - t.from) / (t.max - t.from)));
  // Turbines idle loud enough to be heard on deck; the whine climbs with the load
  return { level: t.k * (0.25 + 0.75 * share), hz: t.hz * (0.8 + 0.6 * share) };
}

/** Rotors on deck turn this many seconds before lift-off (engine start, rotor engaged). */
export const ROTOR_SPINUP_S = 60;
/** Beyond this distance (m) the own helicopter is not heard aboard. */
export const ROTOR_HEARD_M = 1500;
/** Rotors turning at idle on deck while the launch waits for a flying course or a calmer sea. */
export const ROTOR_IDLE = 0.45;
/**
 * Rotor noise of the own helicopter as heard on the ship (0..1): spinning up on deck in the
 * last minute before lift-off, then fading as it flies off; coming home, it swells again.
 */
export function rotorLevel(
  h: { state: 'deck' | 'air'; x: number; y: number; launchInS?: number; deck?: { need: 'launch' | 'recover'; ok: boolean } } | undefined,
  own: { x: number; y: number },
): number {
  if (!h) return 0;
  if (h.state === 'deck') {
    if (h.launchInS === undefined || h.launchInS > ROTOR_SPINUP_S) return 0;
    // Ready but the deck is not clear to launch (no flying course, too much sea): rotors idle
    const held = h.launchInS <= 0 && h.deck?.need === 'launch' && !h.deck.ok;
    return held ? ROTOR_IDLE : 0.35 + 0.65 * (1 - h.launchInS / ROTOR_SPINUP_S);
  }
  const d = Math.hypot(h.x - own.x, h.y - own.y);
  return d >= ROTOR_HEARD_M ? 0 : (1 - d / ROTOR_HEARD_M) ** 2;
}

/**
 * Mean seconds between the bow slamming into the sea (surface ships): from sea state 5 at
 * 8 kn and more, more often the heavier the sea and the faster; Infinity for none.
 */
export function slamGapS(seaState: number, kn: number, submarine: boolean): number {
  if (submarine || seaState < 5 || kn < 8) return Infinity;
  return Math.max(4, 45 / ((seaState - 4) * (kn / 15)));
}

/** Rounds that left since the previous snapshot (a counter that fell), 0 when unknown or reloaded. */
export function fired(prev: number | undefined, now: number): number {
  return prev === undefined || now >= prev ? 0 : Math.min(6, prev - now);
}

/** A torpedo heard in the sonar headset: bearing relative to the bow, loudness 0..1, pitch factor, seeker. */
export interface HeardTorpedo {
  rel: number;
  level: number;
  pitch: number;
  homing: boolean;
  own: boolean;
}

/** Loudness of an own torpedo at range (m): loud close aboard, a faint whine far out. */
export function ownTorpedoLevel(rangeM: number): number {
  return Math.min(0.8, Math.sqrt(600 / (Math.max(0, rangeM) + 600)));
}

/** Doppler factor from the range rate (m/s, + = opening): lower when she runs away. */
export function dopplerFromRangeRate(rangeRateMps: number): number {
  return 1 - Math.max(-60, Math.min(60, rangeRateMps)) / 1500;
}

/**
 * Pitch of a detected (enemy) torpedo without a range: a steady bearing and a rising level mean
 * she comes straight at the own ship (pitch up, as far as 45 kn of closing raise it); a fast
 * bearing rate means she passes (pitch towards neutral); a falling level, she runs away.
 */
export function torpedoPitch(seRateDbS: number, bearingRateDegS: number): number {
  const trend = Math.max(-1, Math.min(1, seRateDbS / 0.5));
  const steady = Math.exp(-Math.abs(bearingRateDegS) / 1.5);
  return 1 + 0.015 * trend * steady;
}

/** Loudness of a contact's voice in the headset from its signal excess (dB), as SonarVoice scales it. */
export function contactLevel(se: number): number {
  return Math.min(1, 0.04 * Math.pow(10, Math.max(-10, Math.min(28, se + 4)) / 20));
}

/** Signed difference a − b of two bearings (degrees, −180…180). */
export function angleDiff(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

interface Prev { r: number; t: number }
/** Reused between calls (no allocation per snapshot). */
const seen = new Set<string>();
interface PrevContact { se: number; b: number; t: number }
interface TorpInput { id: string; x: number; y: number; homing: boolean }
interface ContactInput { label: string; via: string; bearing: number; se: number; evidence?: { voice?: string }; evidenceAt?: number }

/**
 * What the sonar operator hears of torpedoes in the water, the loudest one: own torpedoes
 * still on the wire (the boat knows where they are), and enemy torpedoes only as far as the
 * own sensors hold them (a contact whose fresh evidence the ear takes for a torpedo). A
 * torpedo no own sensor detects is not heard. `mem` keeps the previous ranges and levels.
 */
export function loudestTorpedo(
  own: { x: number; y: number; heading: number },
  time: number,
  torps: readonly TorpInput[],
  contacts: readonly ContactInput[],
  mem: { torps: Map<string, Prev>; contacts: Map<string, PrevContact> },
): HeardTorpedo | undefined {
  let best: HeardTorpedo | undefined;
  seen.clear();
  for (const t of torps) {
    const r = Math.hypot(t.x - own.x, t.y - own.y);
    const p = mem.torps.get(t.id);
    const dt = p ? time - p.t : 0;
    const pitch = p && dt > 0 ? dopplerFromRangeRate((r - p.r) / dt) : 1;
    if (!p || dt > 0) mem.torps.set(t.id, { r, t: time });
    seen.add(t.id);
    const level = ownTorpedoLevel(r) * 0.6;
    const b = (Math.atan2(t.x - own.x, t.y - own.y) * 180) / Math.PI;
    if (!best || level > best.level) best = { rel: angleDiff(b, own.heading), level, pitch, homing: t.homing, own: true };
  }
  for (const id of mem.torps.keys()) if (!seen.has(id)) mem.torps.delete(id);
  seen.clear();
  for (const c of contacts) {
    if (c.via !== 'own' || c.evidence?.voice !== 'torpedo' || c.evidenceAt === undefined || time - c.evidenceAt > 5) continue;
    const p = mem.contacts.get(c.label);
    const dt = p ? time - p.t : 0;
    const pitch = p && dt > 0 ? torpedoPitch((c.se - p.se) / dt, angleDiff(c.bearing, p.b) / dt) : 1;
    if (!p || dt > 0) mem.contacts.set(c.label, { se: c.se, b: c.bearing, t: time });
    seen.add(c.label);
    const level = contactLevel(c.se);
    if (!best || level > best.level) best = { rel: angleDiff(c.bearing, own.heading), level, pitch, homing: false, own: false };
  }
  for (const l of mem.contacts.keys()) if (!seen.has(l)) mem.contacts.delete(l);
  return best;
}
