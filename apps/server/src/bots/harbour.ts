import { PERISCOPE_DEPTH, KN, MAST_MAX_KN, distance, fireSalvo, headingVec, wrap360, type ContactTrack, type Ship, type World } from '@tk/shared';
import { HARBOUR_ANCHORAGE } from '../scenario.js';
import { SKILL, isNeutral, traceShot, voted, type BotMemory, type BotSkill } from './common.js';
import { SHOT_COOLDOWN } from './pacing.js';
import { PEEK_LOOK_S } from './sub.js';

/** Harbour attack (sub.ts): run in on the charted anchorage and fire a fan into it. */

/**
 * The anchorage (harbour attack): charted in the briefing; once the boat holds ships at anchor in
 * its own contact book (periscope, radar: with range), the centre of what it plotted. Never truth.
 */
function anchorageOf(w: World, m: BotMemory, s: Ship): { x: number; y: number } | undefined {
  if (!w.ships.some((x) => x.cls === 'merchant')) return undefined;
  const held = anchored(w, m, s, 1800);
  if (!held.length) return HARBOUR_ANCHORAGE;
  const ps = held.map((t) => plotted(m, s, t));
  return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
}

/** Merchants in the boat's own book with a range (periscope, radar), seen within maxAge s. */
function anchored(w: World, m: BotMemory, s: Ship, maxAge: number): ContactTrack[] {
  return (w.books.get(s.id)?.tracks() ?? []).filter((t) => w.time - t.lastSeen < maxAge && t.range !== undefined &&
    (t.classified === 'merchant' || voted(m, t) === 'merchant') && !isNeutral(w, s, t, m));
}

/** Where a contact with a range lies, from where the boat was when it measured it. */
function plotted(m: BotMemory, s: Ship, t: ContactTrack): { x: number; y: number } {
  const at = [...m.track].reverse().find((f) => f.t <= (t.rangeAt ?? t.lastSeen) + 3) ?? s.pos;
  const v = headingVec(t.bearing);
  return { x: at.x + v.x * t.range!, y: at.y + v.y * t.range! };
}

/** Firing range into the anchorage (m): close enough for a fan of slow passive torpedoes. */
const HARBOUR_FIRE_M = 4200;

/**
 * Harbour attack: the anchorage is charted and the ships lie still. Run in deep and steady
 * (slower when escorts are close), then come up to periscope depth, take a look and fire a fan
 * at the nearest ship at anchor; between salvos hold off quietly. Returns false without targets.
 */
export function harbourRun(w: World, m: BotMemory, s: Ship, threatNear: boolean, maxSafe: number, skill: BotSkill): boolean {
  const { salvo, harbourKn, harbourDeep, harbourFan } = SKILL[skill];
  const anch = anchorageOf(w, m, s);
  if (!anch) return false;
  const now = w.time;
  const d = distance(s.pos, anch);
  const toAnch = wrap360((Math.atan2(anch.x - s.pos.x, anch.y - s.pos.y) * 180) / Math.PI);
  s.snorkel = false;
  if (d > HARBOUR_FIRE_M) {
    s.order = { heading: toAnch, speedKn: threatNear ? harbourKn[0] : harbourKn[1], depth: Math.min(maxSafe, harbourDeep) };
    s.mastUp = false;
    return true;
  }
  if (now - m.lastShot < SHOT_COOLDOWN) {
    // Reloading: hold off, deep and slow, nose on the anchorage
    s.order = { heading: toAnch, speedKn: 2, depth: Math.min(maxSafe, 90) };
    s.mastUp = false;
    return true;
  }
  // A short look through the periscope (slow, at periscope depth), then the fan at the nearest
  // ship at anchor the look found (or into the anchorage when it found none)
  s.order = { heading: toAnch, speedKn: 3, depth: PERISCOPE_DEPTH };
  s.mastUp = s.depth <= PERISCOPE_DEPTH + 0.5 && s.speed / KN <= MAST_MAX_KN;
  if (!s.mastUp) {
    m.peekUp = undefined;
    return true;
  }
  m.peekUp ??= now;
  const seen = anchored(w, m, s, 30).sort((a, b) => a.range! - b.range!)[0];
  if (!seen && now - m.peekUp < PEEK_LOOK_S) return true;
  const r = seen?.range ?? d;
  const brg = seen?.bearing ?? toAnch;
  const shot = fireSalvo(w, s, { heading: brg, enableAfter: Math.max(600, r * 0.7), mode: 'passive', searchDepth: 8, speedKn: 30 }, Math.max(harbourFan, salvo), 4);
  if (typeof shot !== 'string' && shot.length) {
    traceShot({ t: now, shooter: s.id, team: s.team, weapon: 'torpedo', basis: 'harbour', mode: 'passive', range: r, held: seen ? now - seen.firstSeen : undefined });
    m.lastShot = now;
    m.peekUp = undefined;
    s.mastUp = false;
  }
  return true;
}
