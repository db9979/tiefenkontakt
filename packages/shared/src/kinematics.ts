import { CLASSES } from './classes.js';
import { speedFactor } from './damage.js';
import type { Ship } from './entities.js';
import { PERISCOPE_DEPTH, isAtPeriscopeDepth } from './entities.js';
import { KN, angleDiff, approach, clamp, headingVec, wrap360 } from './math.js';

/** Speed above which a snorkeling SSK floods the snorkel / can't charge. */
export const SNORKEL_MAX_KN = 8;

/** Advance one ship's motion, depth, masts and battery by dt seconds. */
export function stepShip(s: Ship, dt: number, now: number): void {
  if (!s.alive) {
    s.speed = approach(s.speed, 0, 0.2 * dt);
    return;
  }
  const spec = CLASSES[s.cls];

  // Battery limits (SSK submerged)
  let maxKn = spec.maxSpeedKn * speedFactor(s);
  if (spec.battery && s.battery !== undefined && s.battery <= 0 && s.depth > 0.5 && !isSnorkeling(s)) {
    maxKn = 0;
  }
  if (isSnorkeling(s)) maxKn = Math.min(maxKn, SNORKEL_MAX_KN);

  const targetSpeed = clamp(s.order.speedKn, 0, maxKn) * KN;
  s.speed = approach(s.speed, targetSpeed, spec.accel * dt);

  // Turning: rudder authority drops at low speed
  const speedKn = s.speed / KN;
  const rate = spec.turnRateDeg * clamp(speedKn / 6, 0.15, 1);
  const diff = angleDiff(s.heading, s.order.heading);
  const step = clamp(diff, -rate * dt, rate * dt);
  s.heading = wrap360(s.heading + step);
  if (Math.abs(step) > 0.05 * dt) s.lastTurnAt = now;

  // Depth
  if (spec.submarine) {
    const target = clamp(s.order.depth, 0, spec.maxDepth);
    s.depth = approach(s.depth, target, spec.depthRate * dt);
    // Masts retract when going deep; the snorkel order persists and takes effect at periscope depth
    if (s.depth > PERISCOPE_DEPTH + 0.5) s.mastUp = false;
  }

  // Position
  const v = headingVec(s.heading);
  s.pos.x += v.x * s.speed * dt;
  s.pos.y += v.y * s.speed * dt;

  stepBattery(s, dt);
}

export function isSnorkeling(s: Ship): boolean {
  return s.snorkel && isAtPeriscopeDepth(s);
}

function stepBattery(s: Ship, dt: number): void {
  const spec = CLASSES[s.cls];
  if (!spec.battery || s.battery === undefined) return;
  const hours = dt / 3600;
  const kn = s.speed / KN;
  const surfaced = s.depth <= 0.5;
  if (surfaced || isSnorkeling(s)) {
    s.battery = Math.min(spec.battery.capacityKnH, s.battery + 40 * hours);
    return;
  }
  // Drain grows roughly with the square of speed plus hotel load
  const drain = 1 + (kn * kn) / 4;
  s.battery = Math.max(0, s.battery - drain * hours);
}

/** Estimated remaining submerged endurance in seconds at current speed. */
export function batteryEndurance(s: Ship): number | undefined {
  if (s.battery === undefined) return undefined;
  const kn = s.speed / KN;
  const drain = 1 + (kn * kn) / 4;
  return (s.battery / drain) * 3600;
}
