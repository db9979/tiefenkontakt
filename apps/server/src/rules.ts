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
export function evaluate(w: World, timeLimitS: number): MatchResult | undefined {
  const sc = computeScore(w);
  if (sc.totalTons > 0 && sc.sunkTons >= sc.totalTons * 0.5) return { winner: 'east', reason: 'Die Hälfte der Konvoi-Tonnage versenkt' };
  if (sc.totalTons > 0 && sc.arrivedTons > sc.totalTons * 0.5) return { winner: 'west', reason: 'Der Konvoi hat sein Ziel erreicht' };
  const subs = w.ships.filter((s) => s.team === 'east');
  if (subs.length > 0 && subs.every((s) => !s.alive)) return { winner: 'west', reason: 'Alle U-Boote versenkt' };
  const escorts = w.ships.filter((s) => s.team === 'west' && s.cls !== 'merchant');
  if (escorts.length > 0 && escorts.every((s) => !s.alive) && sc.sunkTons > 0) {
    return { winner: 'east', reason: 'Geleitschutz vernichtet' };
  }
  if (w.time >= timeLimitS) {
    return sc.sunkTons >= sc.totalTons * 0.3
      ? { winner: 'east', reason: 'Zeit abgelaufen, genug Tonnage versenkt' }
      : { winner: 'west', reason: 'Zeit abgelaufen, Konvoi weitgehend unversehrt' };
  }
  return undefined;
}
