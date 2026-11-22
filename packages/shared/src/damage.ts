import { crewWorkRate } from './crew.js';
import { compartmentLayout, floodWeight, hitCompartments, reserveBuoyancy, type HitOptions } from './compartments.js';
import type { Ship } from './entities.js';
import { stepCompartments } from './flooding.js';
import type { Rng } from './rng.js';
import type { World } from './world.js';

/**
 * Damage control. The truth lives in the compartments (compartments.ts, flooding.ts);
 * the per-system figures here are derived from them every tick for everything that asks
 * "how bad is the propulsion / sonar / weapons" and for the old panels. "leck" is the share
 * of the reserve buoyancy the water aboard has used up.
 */

export type ShipSystem = 'antrieb' | 'sonar' | 'waffen' | 'leck';
export const SYSTEMS: ShipSystem[] = ['antrieb', 'sonar', 'waffen', 'leck'];

export type DamageState = Record<ShipSystem, number>;

export function emptyDamage(): DamageState {
  return { antrieb: 0, sonar: 0, waffen: 0, leck: 0 };
}

/** A hit: the compartment nearest the hit point takes it, the neighbours get some. */
export function applyHitDamage(s: Ship, amount: number, rng: Rng, o: HitOptions = {}): void {
  hitCompartments(s, amount, rng, o);
  deriveSystems(s);
}

/** Per-system damage from the compartments: wrecked, flooded, burning or sealed compartments take their systems with them. */
export function deriveSystems(s: Ship): void {
  if (!s.comps) return;
  const d = (s.damage ??= emptyDamage());
  const layout = compartmentLayout(s.cls);
  d.antrieb = 0;
  d.sonar = 0;
  d.waffen = 0;
  s.comps.forEach((x, i) => {
    const lost = x.sealed ? 1 : Math.min(1, Math.max(x.dmg, (x.flood - 0.3) / 0.5, x.fire * 0.6));
    for (const [k, share] of Object.entries(layout[i]!.sys) as [Exclude<ShipSystem, 'leck'>, number][]) d[k] = Math.max(d[k], Math.min(1, lost * share));
  });
  d.leck = Math.min(1, floodWeight(s) / reserveBuoyancy(s));
}

/** Damage control for one tick: water, fire, repairs, trim and the sinking point. */
export function stepDamage(s: Ship, dt: number, w?: World): void {
  if (!s.comps || !s.alive) return;
  stepCompartments(s, dt, w);
  deriveSystems(s);
}

export const dmg = (s: Ship, k: ShipSystem): number => s.damage?.[k] ?? 0;

/** Max speed factor from propulsion damage and the water aboard. */
export const speedFactor = (s: Ship): number => (1 - 0.8 * dmg(s, 'antrieb')) * (1 - 0.4 * dmg(s, 'leck'));
/** Extra hull-sonar self noise (dB) from sonar damage. */
export const sonarPenaltyDb = (s: Ship): number => 18 * dmg(s, 'sonar');
/** Reload time factor from weapons damage. */
export const reloadFactor = (s: Ship): number => (1 + 3 * dmg(s, 'waffen')) / crewWorkRate(s);
export const weaponsBroken = (s: Ship): boolean => dmg(s, 'waffen') >= 0.9;
