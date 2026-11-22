/**
 * AI commanders' character: each AI ship draws one from the match seed. Traits only scale
 * the existing tactics (shot quality, speed, patience, how long a hunt is kept up); fleet
 * intelligence sometimes hints at the enemy commander in the briefing.
 */

export type Trait = 'draufgaenger' | 'fuchs' | 'vorsichtig' | 'jaeger';

export interface TraitMods {
  /** Added to the TMA quality a sub needs before firing (−: shoots earlier). */
  tma: number;
  /** Speed factor for transits and approaches. */
  speed: number;
  /** Factor on the time between periscope looks (>1: peeks less). */
  peek: number;
  /** Factor on how long an escort keeps up a hunt after a lead. */
  hunt: number;
  /** Factor on active-sonar duty of escorts. */
  ping: number;
}

export const TRAITS: Record<Trait, TraitMods & { de: string; en: string }> = {
  draufgaenger: { tma: -6, speed: 1.2, peek: 0.8, hunt: 1, ping: 1.3, de: 'draufgängerisch', en: 'reckless' },
  fuchs: { tma: 0, speed: 0.85, peek: 1.6, hunt: 1.2, ping: 0.7, de: 'ein schlauer Fuchs', en: 'a sly fox' },
  vorsichtig: { tma: 8, speed: 0.9, peek: 1.2, hunt: 0.8, ping: 0.9, de: 'vorsichtig', en: 'cautious' },
  jaeger: { tma: -2, speed: 1.05, peek: 1, hunt: 2, ping: 1.2, de: 'ein verbissener Jäger', en: 'a dogged hunter' },
};

const ORDER: Trait[] = ['draufgaenger', 'fuchs', 'vorsichtig', 'jaeger'];

/** Deterministic trait for a ship in a match. */
export function commanderTrait(shipId: string, seed: number): Trait {
  let h = seed | 0;
  for (let i = 0; i < shipId.length; i++) h = Math.imul(h ^ shipId.charCodeAt(i), 2654435761);
  return ORDER[((h >>> 0) % ORDER.length + ORDER.length) % ORDER.length]!;
}
