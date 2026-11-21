import { CLASSES } from './classes.js';
import type { Ship } from './entities.js';
import type { Rng } from './rng.js';

/** Damage control: hits damage systems; the crew repairs one priority system fast, others slowly. */

export type ShipSystem = 'antrieb' | 'sonar' | 'waffen' | 'leck';
export const SYSTEMS: ShipSystem[] = ['antrieb', 'sonar', 'waffen', 'leck'];

export type DamageState = Record<ShipSystem, number>;

const PRIORITY_RATE = 1 / 240; // full repair in 4 min sim
const BACKGROUND_RATE = 1 / 1500;
const LEAK_HP_PER_S = 0.12; // at full flooding

export function emptyDamage(): DamageState {
  return { antrieb: 0, sonar: 0, waffen: 0, leck: 0 };
}

/** Spread a hit over the systems: the biggest share lands on a random one, flooding always grows. */
export function applyHitDamage(s: Ship, amount: number, rng: Rng): void {
  const d = (s.damage ??= emptyDamage());
  const sev = Math.min(1, amount / 80);
  const pick = SYSTEMS[Math.floor(rng.next() * 3)]!;
  d[pick] = Math.min(1, d[pick] + 0.4 + 0.5 * sev);
  d.leck = Math.min(1, d.leck + 0.25 + 0.4 * sev);
  for (const k of SYSTEMS) if (k !== pick && k !== 'leck') d[k] = Math.min(1, d[k] + 0.1 * sev);
}

/** Repair progress and flooding effects for one tick. */
export function stepDamage(s: Ship, dt: number): void {
  const d = s.damage;
  if (!d || !s.alive) return;
  const prio = s.repair ?? (d.leck > 0 ? 'leck' : SYSTEMS.find((k) => d[k] > 0));
  for (const k of SYSTEMS) {
    if (d[k] <= 0) continue;
    d[k] = Math.max(0, d[k] - (k === prio ? PRIORITY_RATE : BACKGROUND_RATE) * dt);
  }
  if (d.leck > 0) s.hp -= LEAK_HP_PER_S * d.leck * dt;
  // A flooding submarine cannot hold great depth
  if (CLASSES[s.cls].submarine && d.leck > 0.2) {
    const limit = CLASSES[s.cls].maxDepth * (1 - 0.7 * d.leck);
    if (s.order.depth > limit) s.order.depth = limit;
  }
}

export const dmg = (s: Ship, k: ShipSystem): number => s.damage?.[k] ?? 0;

/** Max speed factor from propulsion damage. */
export const speedFactor = (s: Ship): number => 1 - 0.8 * dmg(s, 'antrieb');
/** Extra hull-sonar self noise (dB) from sonar damage. */
export const sonarPenaltyDb = (s: Ship): number => 18 * dmg(s, 'sonar');
/** Reload time factor from weapons damage. */
export const reloadFactor = (s: Ship): number => 1 + 3 * dmg(s, 'waffen');
export const weaponsBroken = (s: Ship): boolean => dmg(s, 'waffen') >= 0.9;
