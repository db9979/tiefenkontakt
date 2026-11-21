import { CLASSES, type World } from '@tk/shared';

export interface Score {
  sunkTons: number;
  arrivedTons: number;
  totalTons: number;
}

export interface MatchResult {
  winner: 'west' | 'east';
  reason: string;
}

export function computeScore(w: World): Score {
  const merchants = w.ships.filter((s) => s.cls === 'merchant');
  const tons = (ids: string[]) => ids.length * CLASSES.merchant.tonnage;
  return {
    sunkTons: tons(merchants.filter((m) => !m.alive).map((m) => m.id)),
    arrivedTons: tons(w.convoy?.arrived ?? []),
    totalTons: tons(merchants.map((m) => m.id)),
  };
}

/** Win conditions; undefined while the match continues. */
export function evaluate(w: World, timeLimitS: number, mission = 'groenland'): MatchResult | undefined {
  if (mission === 'duell') return duel(w, timeLimitS);
  const sc = computeScore(w);
  if (sc.totalTons > 0 && sc.sunkTons >= sc.totalTons * 0.5) return { winner: 'east', reason: 'Die Hälfte der Konvoi-Tonnage versenkt' };
  if (sc.totalTons > 0 && sc.arrivedTons > sc.totalTons * 0.5) return { winner: 'west', reason: 'Der Konvoi hat sein Ziel erreicht' };
  const subs = w.ships.filter((s) => s.team === 'east');
  if (subs.length > 0 && subs.every((s) => !s.alive)) return { winner: 'west', reason: 'Alle U-Boote versenkt' };
  if (w.time >= timeLimitS) {
    if (mission === 'hafen') {
      return sc.sunkTons >= sc.totalTons * 0.3
        ? { winner: 'east', reason: 'Zeit abgelaufen, der Hafen ist getroffen' }
        : { winner: 'west', reason: 'Zeit abgelaufen, der Hafen hat gehalten' };
    }
    return sc.sunkTons >= sc.totalTons * 0.3
      ? { winner: 'east', reason: 'Zeit abgelaufen, genug Tonnage versenkt' }
      : { winner: 'west', reason: 'Zeit abgelaufen, Konvoi weitgehend unversehrt' };
  }
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
