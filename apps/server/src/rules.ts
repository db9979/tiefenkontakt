import { SHADOW_GOAL_S, SHADOW_RANGE_M } from './scenario.js';
import {
  CLASSES,
  isEscort,
  type World,
  isConvoyShip,
  distance,
} from '@tk/shared';

export interface Score {
  sunkTons: number;
  arrivedTons: number;
  totalTons: number;
  /** Tonnage that counts toward the Ostpakt's goal: merchants sunk by a surface ship count only in part. */
  countedTons: number;
}

/**
 * The convoy is the wolfpack's target: a merchant the patrol ship sinks with missiles
 * counts only this share toward the Ostpakt's tonnage goal (the boats must do the rest).
 */
export const SUPPORT_TONS_SHARE = 0.5;

export interface MatchResult {
  winner: 'west' | 'east';
  reason: string;
}

/**
 * Who sank what, read incrementally: computeScore runs every tick, and rescanning the whole
 * event log each time grew with the match. A cache only (rebuilt from the saved events after
 * a restart), so a WeakMap is fine here.
 */
const sinkers = new WeakMap<World, { n: number; by: Map<string, string | undefined> }>();

function sinkerMap(w: World): Map<string, string | undefined> {
  let c = sinkers.get(w);
  if (!c || c.n > w.events.length) sinkers.set(w, (c = { n: 0, by: new Map() }));
  for (; c.n < w.events.length; c.n++) {
    const e = w.events[c.n]!;
    if (e.kind === 'sunk') c.by.set(e.shipId, e.byId);
  }
  return c.by;
}

/** Events of the last `windowS` seconds, newest first (the log is in time order; a little slack for stragglers). */
function* recentEvents(w: World, windowS: number): Generator<World['events'][number]> {
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i]!;
    if (w.time - e.time > windowS + 60) return;
    yield e;
  }
}

export function computeScore(w: World): Score {
  const merchants = w.ships.filter(isConvoyShip);
  const tons = (ids: string[]) => ids.length * CLASSES.merchant.tonnage;
  const sunk = merchants.filter((m) => !m.alive).map((m) => m.id);
  // Who sank it: the ship of the last hit, as recorded on the sinking
  const sinker = sinkerMap(w);
  const bySurface = sunk.filter((id) => {
    const by = w.ships.find((s) => s.id === sinker.get(id));
    return !!by && by.team === 'east' && !CLASSES[by.cls].submarine;
  });
  return {
    countedTons: tons(sunk) - tons(bySurface) * (1 - SUPPORT_TONS_SHARE),
    sunkTons: tons(merchants.filter((m) => !m.alive).map((m) => m.id)),
    arrivedTons: tons(w.convoy?.arrived ?? []),
    totalTons: tons(merchants.map((m) => m.id)),
  };
}

/** Win conditions; undefined while the match continues. */
export function evaluate(w: World, timeLimitS: number, mission = 'groenland'): MatchResult | undefined {
  if (mission === 'duell') return duel(w, timeLimitS);
  if (mission === 'fuehlung' || mission === 'meerenge' || mission === 'aufklaerung') return special(w, timeLimitS, mission);
  const sc = computeScore(w);
  if (sc.totalTons > 0 && sc.countedTons >= sc.totalTons * 0.5) return { winner: 'east', reason: 'Die Hälfte der Konvoi-Tonnage versenkt' };
  if (sc.totalTons > 0 && sc.arrivedTons > sc.totalTons * 0.5) return { winner: 'west', reason: 'Der Konvoi hat sein Ziel erreicht' };
  // The wolfpack: the Ostpakt's boats (its patrol ship alone cannot sink the convoy)
  const subs = w.ships.filter((s) => s.team === 'east' && CLASSES[s.cls].submarine);
  if (subs.length > 0 && subs.every((s) => !s.alive)) return { winner: 'west', reason: 'Alle U-Boote versenkt' };
  if (w.time >= timeLimitS) {
    if (mission === 'hafen') {
      return sc.countedTons >= sc.totalTons * 0.3
        ? { winner: 'east', reason: 'Zeit abgelaufen, der Hafen ist getroffen' }
        : { winner: 'west', reason: 'Zeit abgelaufen, der Hafen hat gehalten' };
    }
    return sc.countedTons >= sc.totalTons * 0.3
      ? { winner: 'east', reason: 'Zeit abgelaufen, genug Tonnage versenkt' }
      : { winner: 'west', reason: 'Zeit abgelaufen, Konvoi weitgehend unversehrt' };
  }
  return undefined;
}

/** Shadowing, strait breakthrough and reconnaissance: goals beyond sinking ships. */
function special(w: World, timeLimitS: number, mission: string): MatchResult | undefined {
  const subs = w.ships.filter((s) => s.team === 'east' && s.alive && CLASSES[s.cls].submarine);
  if (!subs.length) return { winner: 'west', reason: 'Alle U-Boote versenkt' };
  // On the world (saved with it), so a restarted match doesn't count the gap twice or lose it
  const prev = w.env.evalAt ?? w.time;
  w.env.evalAt = w.time;
  if (mission === 'fuehlung') {
    // Contact counts while a boat holds a fresh track on a convoy ship
    const convoy = w.ships.filter((s) => isConvoyShip(s) && s.alive);
    const ids = new Set(convoy.map((s) => s.id));
    // A shadower only counts while it keeps reporting: a radio report within the last 15 minutes (which the escorts can DF)
    const reported = new Set<string>();
    for (const e of recentEvents(w, 900)) if (e.kind === 'transmission' && w.time - e.time < 900) reported.add(e.senderId);
    const holding = subs.some((s) => reported.has(s.id) && convoy.some((c) => distance(s.pos, c.pos) < SHADOW_RANGE_M) &&
      w.books.get(s.id)?.entries().some(([id, tr]) => ids.has(id) && w.time - tr.lastSeen < 30));
    if (holding) w.env.shadowS = (w.env.shadowS ?? 0) + (w.time - prev);
    if ((w.env.shadowS ?? 0) >= SHADOW_GOAL_S) return { winner: 'east', reason: 'Fühlung 25 Minuten gehalten, der Konvoi ist gemeldet' };
    if (w.time >= timeLimitS) return { winner: 'west', reason: 'Zeit abgelaufen, die Fühlung ist abgerissen' };
    return undefined;
  }
  if (mission === 'meerenge') {
    if (subs.some((s) => s.pos.y >= (w.env.exitY ?? Infinity))) return { winner: 'east', reason: 'Durchbruch gelungen: ein U-Boot hat die Enge passiert' };
    if (w.time >= timeLimitS) return { winner: 'west', reason: 'Zeit abgelaufen, die Enge hat gehalten' };
    return undefined;
  }
  // Reconnaissance: a radio report from a boat that has an escort in its periscope (classified by sight)
  // Oldest first: the first qualifying report counts
  for (const e of [...recentEvents(w, w.time - prev)].reverse()) {
    if (e.kind !== 'transmission' || e.time <= prev - 1e-6 || e.time > w.time) continue;
    const sender = subs.find((s) => s.id === e.senderId);
    // Close enough to make out the type and its weapons: 4 km at most
    const seen = sender && w.books.get(sender.id)?.tracks().some((t) => t.classified !== undefined && isEscort(t.classified) && t.classified !== 'ffk' && e.time - t.lastSeen < 90 && (t.range ?? Infinity) < 4000);
    if (seen && w.env.reportAt === undefined) {
      w.env.reportAt = e.time;
      w.env.reportBy = sender.id;
    }
  }
  // The reporting boat then has to get away: 20 minutes with the escorts on its DF bearing
  if (w.env.reportAt !== undefined) {
    const reporter = w.ships.find((s) => s.id === w.env.reportBy);
    if (!reporter?.alive) {
      w.env.reportAt = undefined;
      w.env.reportBy = undefined;
    } else if (w.time - w.env.reportAt >= 1200) return { winner: 'east', reason: 'Feindmeldung abgesetzt und entkommen' };
  }
  if (w.time >= timeLimitS) return { winner: 'west', reason: 'Zeit abgelaufen, keine Feindmeldung' };
  return undefined;
}

/** Submarine duel: last team with boats afloat wins; at the time limit, the side with more hull left. */
function duel(w: World, timeLimitS: number): MatchResult | undefined {
  const alive = (team: string) => w.ships.filter((s) => s.team === team && s.alive);
  if (alive('west').length === 0) return { winner: 'east', reason: 'Alle Boote des Westbunds versenkt' };
  if (alive('east').length === 0) return { winner: 'west', reason: 'Alle Boote des Ostpakts versenkt' };
  if (w.time < timeLimitS) return undefined;
  const hull = (team: string) => alive(team).reduce((a, s) => a + s.hp / CLASSES[s.cls].hp, 0);
  return hull('west') >= hull('east')
    ? { winner: 'west', reason: 'Zeit abgelaufen, der Westbund hat mehr Boote heil' }
    : { winner: 'east', reason: 'Zeit abgelaufen, der Ostpakt hat mehr Boote heil' };
}
