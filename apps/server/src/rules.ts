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
  /** How clear the result was (shown as Sieg / Knapper Sieg / Unentschieden …; ratings use only the winner). */
  band?: ResultBand;
}

/** klar: a clear result; knapp: close; remis: the loser was within a hair (a draw in all but the rules). */
export type ResultBand = 'klar' | 'knapp' | 'remis';

export function computeScore(w: World): Score {
  const merchants = w.ships.filter(isConvoyShip);
  const tons = (ids: string[]) => ids.length * CLASSES.merchant.tonnage;
  const sunk = merchants.filter((m) => !m.alive).map((m) => m.id);
  // Who sank it: the ship of the last hit, as recorded on the sinking
  const sinker = new Map<string, string | undefined>();
  for (const e of w.events) if (e.kind === 'sunk') sinker.set(e.shipId, e.byId);
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

/** Win conditions; undefined while the match continues. A decided result carries its band. */
export function evaluate(w: World, timeLimitS: number, mission = 'groenland'): MatchResult | undefined {
  const r = decide(w, timeLimitS, mission);
  return r && { ...r, band: resultBand(w, timeLimitS, mission, r) };
}

/**
 * How close a result was, from the margin on the deciding measure: convoy tonnage against the
 * mark that decided it (in merchants), the boats' losses, the strait line, held contact, hull.
 */
export function resultBand(w: World, timeLimitS: number, mission: string, r: MatchResult): ResultBand {
  const subs = w.ships.filter((s) => s.team === 'east' && CLASSES[s.cls].submarine);
  const subsLost = subs.length ? subs.filter((s) => !s.alive).length / subs.length : 0;
  const timeUp = w.time >= timeLimitS;
  if (mission === 'duell') {
    if (!timeUp) return 'klar';
    const hull = (team: string) => w.ships.filter((s) => s.team === team && s.alive).reduce((a, s) => a + s.hp / CLASSES[s.cls].hp, 0);
    const d = Math.abs(hull('west') - hull('east'));
    return d < 0.25 ? 'remis' : d < 0.6 ? 'knapp' : 'klar';
  }
  if (mission === 'meerenge') {
    if (r.winner === 'east') return w.time > timeLimitS * 0.9 || subsLost >= 0.5 ? 'knapp' : 'klar';
    // The escorts held: how close did a boat come to the exit line?
    const exit = w.env.exitY ?? Infinity;
    const best = Math.max(...subs.map((s) => s.pos.y));
    return timeUp && exit - best < 1000 ? 'remis' : timeUp && exit - best < 3000 ? 'knapp' : 'klar';
  }
  if (mission === 'fuehlung') {
    const share = (w.env.shadowS ?? 0) / shadowGoalS(timeLimitS);
    return r.winner === 'east' ? (subsLost >= 0.5 ? 'knapp' : 'klar') : share >= 0.8 ? 'remis' : share >= 0.5 ? 'knapp' : 'klar';
  }
  if (mission === 'aufklaerung') {
    if (r.winner === 'east') return subsLost >= 0.5 ? 'knapp' : 'klar';
    return w.env.reportAt !== undefined ? 'knapp' : 'klar';
  }
  // Convoy and harbour: tonnage in merchants against the mark that decided
  const sc = computeScore(w);
  const n = Math.max(1, w.ships.filter(isConvoyShip).length);
  const counted = sc.totalTons > 0 ? (sc.countedTons / sc.totalTons) * n : 0;
  if (timeUp && !subs.every((s) => !s.alive)) {
    const d = Math.abs(counted - 0.3 * n);
    return d < 1 ? 'remis' : d < 2 ? 'knapp' : 'klar';
  }
  if (r.winner === 'east') return subsLost >= 0.5 ? 'knapp' : 'klar';
  // The escorts won early (convoy in port, or the pack sunk): close if the pack got near its mark
  return counted >= 0.3 * n ? 'knapp' : 'klar';
}

function decide(w: World, timeLimitS: number, mission: string): MatchResult | undefined {
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

/** Held contact the shadowing pack needs: 25 minutes, at most half the time at sea. */
export const shadowGoalS = (timeLimitS: number): number => Math.min(SHADOW_GOAL_S, timeLimitS * 0.5);
/** How long a reporting boat must stay alive after its report: 20 minutes, at most a quarter of the time at sea. */
export const escapeS = (timeLimitS: number): number => Math.min(1200, timeLimitS * 0.25);

const lastEval = new WeakMap<World, number>();

/** Shadowing, strait breakthrough and reconnaissance: goals beyond sinking ships. */
function special(w: World, timeLimitS: number, mission: string): MatchResult | undefined {
  const subs = w.ships.filter((s) => s.team === 'east' && s.alive && CLASSES[s.cls].submarine);
  if (!subs.length) return { winner: 'west', reason: 'Alle U-Boote versenkt' };
  const prev = lastEval.get(w) ?? w.time;
  lastEval.set(w, w.time);
  if (mission === 'fuehlung') {
    // Contact counts while a boat holds a fresh track on a convoy ship
    const convoy = w.ships.filter((s) => isConvoyShip(s) && s.alive);
    const ids = new Set(convoy.map((s) => s.id));
    // A shadower only counts while it keeps reporting: a radio report within the last 15 minutes (which the escorts can DF)
    const reported = new Set(w.events.filter((e) => e.kind === 'transmission' && w.time - e.time < 900).map((e) => (e as { senderId: string }).senderId));
    const holding = subs.some((s) => reported.has(s.id) && convoy.some((c) => distance(s.pos, c.pos) < SHADOW_RANGE_M) &&
      w.books.get(s.id)?.entries().some(([id, tr]) => ids.has(id) && w.time - tr.lastSeen < 30));
    if (holding) w.env.shadowS = (w.env.shadowS ?? 0) + (w.time - prev);
    // A short match at sea asks for less: at most half the time limit (25 minutes in the long one)
    const goal = shadowGoalS(timeLimitS);
    if ((w.env.shadowS ?? 0) >= goal) return { winner: 'east', reason: `Fühlung ${Math.round(goal / 60)} Minuten gehalten, der Konvoi ist gemeldet` };
    if (w.time >= timeLimitS) return { winner: 'west', reason: 'Zeit abgelaufen, die Fühlung ist abgerissen' };
    return undefined;
  }
  if (mission === 'meerenge') {
    if (subs.some((s) => s.pos.y >= (w.env.exitY ?? Infinity))) return { winner: 'east', reason: 'Durchbruch gelungen: ein U-Boot hat die Enge passiert' };
    if (w.time >= timeLimitS) return { winner: 'west', reason: 'Zeit abgelaufen, die Enge hat gehalten' };
    return undefined;
  }
  // Reconnaissance: a radio report from a boat that has an escort in its periscope (classified by sight)
  for (const e of w.events) {
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
    } else if (w.time - w.env.reportAt >= escapeS(timeLimitS)) return { winner: 'east', reason: 'Feindmeldung abgesetzt und entkommen' };
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
