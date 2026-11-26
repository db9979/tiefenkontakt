import {
  angleDiff,
  botSolve,
  logBearings,
  pruneLogs,
  type BearingLog,
  bearing,
  CHOICE_MAX_KN,
  distance,
  rankClasses,
  RECOG,
  SIGNATURES,
  type ClassChoice,
  type ClassId,
  type ContactTrack,
  type OwnFix,
  type Ship,
  type TmaSolution,
  type World,
} from '@tk/shared';


/**
 * Shared helpers for the AI captains. Fair play: they decide from their own contact
 * books, their own team's (datalink) positions and what they can hear — never enemy truth.
 */

export type BotSkill = 'leicht' | 'normal' | 'schwer';

export const SKILL = {
  // Submarines: TMA quality before a shot, salvo size, pack reports.
  // Escorts: aim error of rockets/helo torpedoes (m), use of dipping sonar and patrol aircraft, fire rate.
  leicht: { think: 4, subThink: 4, tmaQuality: 56, salvo: 2, pack: true, reactS: 40, aimErr: 500, air: true, fireRate: 0.67, pingDuty: 120 },
  normal: { think: 2, subThink: 2, tmaQuality: 52, salvo: 2, pack: true, reactS: 15, aimErr: 150, air: true, fireRate: 1.3, pingDuty: 120 },
  schwer: { think: 1, subThink: 2, tmaQuality: 52, salvo: 2, pack: true, reactS: 5, aimErr: 0, air: true, fireRate: 2, pingDuty: 240 },
} as const;

export interface BotMemory {
  /** Hunter-killer boat: shots fired (alternates salvo size). */
  guardShots?: number;
  shipId: string;
  passive?: boolean;
  nextThink: number;
  eventCursor: number;
  track: OwnFix[];
  /** Cached TMA solutions per contact label, with time and quality. */
  sols: Record<string, { sol: TmaSolution; at: number; q: number }>;
  lastShot: number;
  evadeUntil: number;
  alertUntil: number;
  legSign: number;
  legUntil: number;
  peekUntil: number;
  peekAgain: number;
  lastReport: number;
  /** Escorts: the last torpedo launch (tube flood) heard, as a bearing line from where it was heard. */
  launchHeard?: { x: number; y: number; b: number; t: number };
  /** Submarines: radar warner reaction (aircraft radar, ship radar closing): no mast or snorkel until then. */
  radarDownUntil?: number;
  /** Submarines: when the periscope came up on the current look. */
  peekUp?: number;
  /** A bearing heard from a transient / ESM / pack report to investigate. */
  lead?: { x: number; y: number; b: number; t: number };
  sprintUntil: number;
  snorkelUntil: number;
  /** Silent running after hearing a ping (no hammering, no loud work). */
  silentUntil?: number;
  xbtDone?: boolean;
  /** Submarines: when each of the latest TMA legs began (course change across the line of sight). */
  legStarts?: number[];
  /** Submarines: end of the current TMA leg. */
  tmaLegUntil?: number;
  /** Submarines: since when the TMA on each contact label has stayed above the firing threshold. */
  qualSince?: Record<string, number>;
  /** Submarines: the contact the attack is being worked on (kept while it is still heard), its last
   * bearing and time, and since when the attack has been on that ship (across a relabelled track). */
  attackLabel?: string;
  attackBrg?: number;
  attackSeen?: number;
  attackFirst?: number;
  /** Escorts: since when the ship has been prosecuting (unbroken). */
  huntSince?: number;
  huntSeen?: number;
  /** Classification votes per contact label (a single look can mislead). */
  votes?: Record<string, Partial<Record<ClassChoice, number>>>;
  /** Air defence: radar brought up for an air contact; interceptors asked for this aircraft. */
  airRadar?: boolean;
  fighterFor?: string;
  /** Mines: last laid, and the convoy's track from the air reconnaissance report. */
  mineAt?: number;
  convoyLine?: { x: number; y: number; course: number; speedKn: number; t: number };
  /** Mine barrage in progress: from which side of the convoy track the boat crosses. */
  mineRun?: { side: number };
  /** The captain's own bearing plot per contact label (10 s bins, 15 min), for the TMA. */
  blog?: Record<string, BearingLog>;
}

export function newMemory(shipId: string, passive = false): BotMemory {
  return {
    shipId, passive, nextThink: 0, eventCursor: 0, track: [], sols: {}, lastShot: -1e9, evadeUntil: 0, alertUntil: 0,
    legSign: 1, legUntil: 0, peekUntil: 0, peekAgain: 0, lastReport: -1e9, sprintUntil: 0, snorkelUntil: 0,
  };
}

/** Record the bot's own track (its own navigation — fair), every 5 s, capped. */
export function recordTrack(m: BotMemory, s: Ship, t: number): void {
  const last = m.track[m.track.length - 1];
  if (last && t - last.t < 5) return;
  m.track.push({ t, x: s.pos.x, y: s.pos.y });
  if (m.track.length > 400) m.track.shift();
}

/** Classify like a player: marks from the evidence, graded by the class library. */
export function classify(t: ContactTrack): ClassChoice | undefined {
  const ev = t.evidence;
  if (!ev) return undefined;
  const strongest = [...ev.tonals].sort((a, b) => b.snr - a.snr)[0];
  return rankClasses({ tonalHz: strongest?.hz, shaftHz: ev.shaftHz, bladeHz: ev.bladeHz })[0]?.sig.choice;
}

/** Latest bearing with the point it was measured from (own ship or a sonobuoy). */
export function latestLine(t: ContactTrack, m: BotMemory, s: Ship): { origin: { x: number; y: number }; b: number; t: number } {
  const h = [...t.history].reverse().find((x) => x.alt === undefined) ?? t.history[t.history.length - 1];
  if (!h) return { origin: s.pos, b: t.bearing, t: t.lastSeen };
  if (h.ox !== undefined && h.oy !== undefined) return { origin: { x: h.ox, y: h.oy }, b: h.b, t: h.t };
  const at = [...m.track].reverse().find((f) => f.t <= h.t + 3) ?? s.pos;
  return { origin: { x: at.x, y: at.y }, b: h.b, t: h.t };
}

/** A contact lines up with an own-team ship as seen from where it was measured (datalink truth for friendlies only). */
export function isFriendly(w: World, s: Ship, t: ContactTrack, m?: BotMemory): boolean {
  const line = m ? latestLine(t, m, s) : { origin: s.pos, b: t.bearing };
  return w.ships.some((f) => f.team === s.team && f.id !== s.id && f.alive && distance(line.origin, f.pos) > 50 &&
    Math.abs(angleDiff(bearing(line.origin, f.pos), line.b)) < 3);
}

/** How long a contact must be held before its independent course gives a neutral away (s). */
export const NEUTRAL_RECOGNISE_S = 240;

/**
 * Is this contact neutral traffic the captain should leave alone (F30)? Recognised from the
 * contact itself, never from who it really is: a class seen by eye (periscope, lookout) tells the
 * group at once; otherwise the sonar's class library must name a neutral type (tanker, container
 * ship, ferry, trawler, tug, yacht) on the contact's own marks, confirmed by a real cue (radar,
 * sight, lights) or by holding it four minutes (its own steady course, not in station).
 */
export function isNeutral(w: World, _s: Ship, t: ContactTrack, _m?: BotMemory): boolean {
  if (t.classified) return RECOG[t.classified].group === 'neutral';
  const ev = t.evidence;
  if (!ev) return false;
  const key = lineSetClass(ev.tonals);
  const rec = key ? RECOG[key as ClassId] : undefined;
  if (rec?.group !== 'neutral') return false;
  const cue = t.sensors.some((k) => k === 'periscope' || k === 'radar' || k === 'visual') || t.lit !== undefined || t.sighting !== undefined;
  return cue || w.time - t.firstSeen >= NEUTRAL_RECOGNISE_S;
}

/** Tonal match tolerance for the line set (Hz). */
const LINE_MATCH_HZ = 1.5;

/**
 * The class whose tonal lines best explain the whole set of lines on the LOFAR gram (as the
 * operator reads it: every line accounted for, the strong lines of the class present), not only
 * the strongest one: a freighter's 37,5 Hz line or a tanker's 9 Hz firing rate tells them apart.
 */
export function lineSetClass(tonals: readonly { hz: number; snr: number }[]): string | undefined {
  if (!tonals.length) return undefined;
  let best: { key: string; score: number } | undefined;
  for (const sig of Object.values(SIGNATURES)) {
    const lines = [...sig.tonals, ...(sig.snorkelTonals ?? [])];
    if (!lines.length) continue;
    let score = 0;
    for (const t of tonals) score += lines.some((l) => Math.abs(l.hz - t.hz) <= LINE_MATCH_HZ) ? 1 : -1;
    for (const l of sig.tonals) if (l.level >= 6 && !tonals.some((t) => Math.abs(l.hz - t.hz) <= LINE_MATCH_HZ)) score -= 0.5;
    if (!best || score > best.score) best = { key: sig.key, score };
  }
  return best && best.score > 0 ? best.key : undefined;
}

/** Majority vote over the contact's looks, so a slow merchant isn't taken for a submarine once. */
export function voted(m: BotMemory, t: ContactTrack): ClassChoice | undefined {
  const c = classify(t);
  const v = ((m.votes ??= {})[t.label] ??= {});
  if (c) v[c] = (v[c] ?? 0) + 1;
  let best: ClassChoice | undefined;
  let n = 0;
  for (const [k, cnt] of Object.entries(v) as [ClassChoice, number][]) if (cnt > n) [best, n] = [k, cnt];
  return best;
}

/** The captain's current majority without counting another look (for team planning). */
export function votedPeek(m: BotMemory, t: ContactTrack): ClassChoice | undefined {
  const v = m.votes?.[t.label];
  if (!v) return classify(t);
  let best: ClassChoice | undefined;
  let n = 0;
  for (const [k, cnt] of Object.entries(v) as [ClassChoice, number][]) if (cnt > n) [best, n] = [k, cnt];
  return best;
}

/**
 * The AI's TMA (shared tma-lsq.ts) on its own 15-minute bearing plot, refreshed every 30 s per
 * contact. Every call logs the contact's newest bearings, so call it on each think.
 */
export function solveFor(m: BotMemory, t: ContactTrack, now: number, choice?: ClassChoice): { sol: TmaSolution; q: number } | undefined {
  const logs = (m.blog ??= {});
  const log = logBearings(logs, t, m.track, now);
  const cached = m.sols[t.label];
  if (cached && now - cached.at < 30) return cached;
  pruneLogs(logs, now);
  const fit = botSolve(log.fixes, CHOICE_MAX_KN[choice ?? 'unknown'], choice);
  if (!fit) return cached;
  m.sols[t.label] = { sol: fit.sol, at: now, q: fit.q };
  return m.sols[t.label];
}

/** Log a contact's newest bearings on the captain's plot without solving (the plotter keeps every contact). */
export function plotBearings(m: BotMemory, t: ContactTrack, now: number): void {
  logBearings((m.blog ??= {}), t, m.track, now);
}

/** Bearing a bot can hear from a transient at a known spot (with operator error). */
export function heardBearing(w: World, s: Ship, x: number, y: number, rangeM: number): number | undefined {
  if (distance(s.pos, { x, y }) > rangeM) return undefined;
  return (bearing(s.pos, { x, y }) + w.rng.gauss(0, 3) + 360) % 360;
}

/** One AI weapon release, for the arena's pacing statistics (diagnostics only, no effect on play). */
export interface ShotTrace {
  t: number;
  shooter: string;
  team: string;
  weapon: 'torpedo' | 'rocket' | 'mortar' | 'helo' | 'ssm';
  /** What the shot was aimed on: TMA, measured range, echo, buoy cross-fix, team datum, dip fix, harbour. */
  basis: string;
  /** TMA quality at the shot and how long the solution had held above the threshold (s). */
  q?: number;
  settled?: number;
  /** Range to the aim point (m). */
  range?: number;
  /** How long the captain had held the target contact (s). */
  held?: number;
  /** Time span of the bearing plot behind the solution (s), and own legs on it. */
  span?: number;
  legs?: number;
}

let traceSink: ((r: ShotTrace) => void) | undefined;
/** Arena diagnostics: receive every AI weapon release (undefined switches it off). */
export function setShotTrace(f: ((r: ShotTrace) => void) | undefined): void {
  traceSink = f;
}
export function traceShot(r: ShotTrace): void {
  traceSink?.(r);
}
