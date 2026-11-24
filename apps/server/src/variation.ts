import { Rng, type MatchSetup, type Variation, type Vec2 } from '@tk/shared';
import type { MissionId, ScenarioSettings, TimeOfDay } from './scenario.js';

/**
 * Per-match variation of a mission, rolled from the match seed: where the boats wait, how the
 * escorts screen, the convoy's route and speed, sea state, time of day and weather. The same
 * seed and lobby settings always give the same situation (rematch "gleiche Lage").
 * "aus" keeps every mission exactly as designed; lessons never vary.
 */
export type { Variation };

/** The lobby choices a rematch needs to rebuild the same situation. */
export type LobbyChoice = MatchSetup['settings'];

export interface Rolled {
  /** 0 = off, 1 = light, 2 = strong. */
  a: number;
  /** Where along the route each boat waits (fraction), and its sideways factor. */
  subFrac(i: number, base: number): number;
  subX(i: number, base: number): number;
  /** Shift of each boat along the route (m), for missions with fixed start lines. */
  subDy(i: number): number;
  escortX(i: number, base: number): number;
  escortDy(i: number): number;
  convoyKnDelta: number;
  /** Spacing of the convoy columns (m). */
  spacing: number;
  /** Convoy waypoints for a route of this length (bends only in open water). */
  waypoints(route: number): Vec2[];
}

/** Missions whose route runs through open water: the convoy may take a dog-leg. */
const OPEN_WATER: MissionId[] = ['groenland', 'schelf', 'fuehlung', 'aufklaerung'];
/** Missions where positions are tied to a narrow channel or a harbour: only small shifts. */
const TIGHT: MissionId[] = ['fjord', 'meerenge', 'hafen'];

const STRENGTH: Record<Variation, number> = { aus: 0, leicht: 1, stark: 2 };

/** Roll time of day, weather and sea state ("zufall" and the ±1 of the sea state). */
export function resolveLobby(s: ScenarioSettings, seed: number): ScenarioSettings {
  const a = s.lesson || s.sandbox ? 0 : STRENGTH[s.variation ?? 'leicht'];
  const rng = new Rng((seed ^ 0x51ea) >>> 0);
  const tods: TimeOfDay[] = ['tag', 'tag', 'daemmerung', 'nacht'];
  const tod = s.timeOfDay === 'zufall' ? tods[Math.floor(rng.next() * tods.length)]! : s.timeOfDay;
  const weather = s.weather === 'zufall' ? (rng.next() < 0.6 ? 'wechselhaft' : 'stabil') : s.weather;
  const r = rng.next();
  const dSea = a === 0 ? 0 : a === 1 ? (r < 0.25 ? -1 : r > 0.75 ? 1 : 0) : r < 0.1 ? -2 : r < 0.35 ? -1 : r > 0.9 ? 2 : r > 0.65 ? 1 : 0;
  const asSet: LobbyChoice = {
    mission: s.mission, area: s.area, timeOfDay: s.timeOfDay, weather: s.weather, seaState: s.seaState, timeLimitMin: s.timeLimitMin,
    merchants: s.merchants, fillBots: s.fillBots, botSkill: s.botSkill, custom: s.custom, variation: s.variation,
  };
  return { ...s, timeOfDay: tod, weather, seaState: Math.max(1, Math.min(6, s.seaState + dSea)), asSet: s.asSet ?? asSet };
}

export function rollVariation(s: ScenarioSettings, seed: number): Rolled {
  const a = s.lesson || s.sandbox ? 0 : STRENGTH[s.variation ?? 'leicht'];
  const rng = new Rng((seed ^ 0x7a2c) >>> 0);
  const sym = () => rng.next() * 2 - 1;
  const tight = TIGHT.includes(s.mission);
  // Rolled once each so the numbers do not depend on how many ships ask
  const subRoll = Array.from({ length: 8 }, () => [sym(), sym(), sym()] as const);
  const escRoll = Array.from({ length: 8 }, () => [sym(), sym()] as const);
  const flip = a > 0 && rng.next() < 0.5 ? -1 : 1;
  const knRoll = sym();
  const spacing = 900 + Math.round(sym() * 120 * a);
  const bends = [sym(), sym(), sym()];
  const at = <T>(arr: readonly T[], i: number) => arr[i % arr.length]!;
  return {
    a,
    // Grönland: the shallow bank lies at 40 % of the route; boats waiting on it unbalanced the mission
    subFrac: (i, base) => (a === 0 ? base : Math.max(s.mission === 'groenland' ? 0.45 : 0.38, Math.min(0.85, base + at(subRoll, i)[0] * 0.08 * a))),
    subX: (i, base) => (a === 0 ? base : flip * base * (1 + at(subRoll, i)[1] * (tight ? 0.15 : 0.3) * a)),
    subDy: (i) => at(subRoll, i)[2] * (tight ? 400 : 2500) * a,
    escortX: (i, base) => (a === 0 ? base : base * (1 + at(escRoll, i)[0] * (tight ? 0.1 : 0.25) * a)),
    escortDy: (i) => at(escRoll, i)[1] * (tight ? 250 : 800) * a,
    convoyKnDelta: Math.round(knRoll * 0.5 * a * 2) / 2,
    spacing,
    waypoints(route) {
      if (a === 0 || !OPEN_WATER.includes(s.mission)) return [{ x: 0, y: route * 0.5 }, { x: 0, y: route }];
      // The dog-legs must not lengthen the passage: more time under the boats favoured the pack
      const off = 1500 * a;
      const xs = [0, bends[0]! * off, bends[1]! * off, bends[2]! * off * 0.5];
      const fr = [0, 0.33, 0.66, 1];
      const len = (k: number) => fr.slice(1).reduce((t, f, j) => t + Math.hypot(xs[j + 1]! - xs[j]!, (f - fr[j]!) * route * k), 0);
      let k = 1;
      for (let it = 0; it < 4; it++) k *= route / len(k);
      return fr.slice(1).map((f, j) => ({ x: xs[j + 1]!, y: f * route * k }));
    },
  };
}
