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

  // Speed: engines push up slowly, drag and astern power bring it down a bit quicker;
  // a hard turn bleeds speed (rudder and hull drag)
  const turnShare = Math.abs(s.yawRate ?? 0) / Math.max(0.1, spec.turnRateDeg);
  const targetSpeed = clamp(s.order.speedKn, 0, maxKn) * KN * (1 - 0.25 * Math.min(1, turnShare));
  s.speed = approach(s.speed, targetSpeed, (targetSpeed < s.speed ? 1.3 : 1) * spec.accel * dt);

  // Turning: rate of turn = speed / turning radius (a slow ship turns slowly), with rudder lag;
  // the turn is eased off ahead of the ordered course so it doesn't overshoot
  const speedMs = s.speed;
  const maxRate = speedMs < 0.15 ? 0 : Math.min(spec.turnRateDeg, ((speedMs / spec.turnRadius) * 180) / Math.PI);
  const yawAcc = Math.max(0.05, maxRate / 6); // about 6 s to full rate of turn
  const diff = angleDiff(s.heading, s.order.heading);
  const want = Math.sign(diff) * Math.min(maxRate, Math.sqrt(2 * yawAcc * Math.abs(diff)));
  s.yawRate = approach(s.yawRate ?? 0, want, yawAcc * dt);
  const step = s.yawRate * dt;
  if (Math.abs(diff) < 0.02 || (Math.abs(diff) <= Math.abs(step) && Math.sign(diff) === Math.sign(step))) {
    // On the ordered course: meet her (rudder amidships)
    s.heading = wrap360(s.order.heading);
    s.yawRate = 0;
  } else s.heading = wrap360(s.heading + step);
  if (Math.abs(s.yawRate) > 0.05) s.lastTurnAt = now;

  if (spec.submarine) {
    // Depth: planes give speed · sin(angle); trim and ballast a little more at any speed
    const target = clamp(s.order.depth, 0, spec.maxDepth);
    const planes = speedMs * Math.sin(((spec.planeAngleDeg ?? 15) * Math.PI) / 180);
    const vmax = Math.min(spec.depthRate, 0.2 + planes);
    // Level off gently instead of stopping dead at the ordered depth
    const v = Math.min(vmax, 0.05 + Math.abs(target - s.depth) * 0.08);
    s.depth = approach(s.depth, target, v * dt);
    // Masts: hoisting takes about 8 s, lowering 5 s; the snorkel head 15 s up, 6 s down
    const atPd = s.depth <= PERISCOPE_DEPTH + 0.5;
    if (!atPd) s.mastUp = false;
    s.mastExt = approach(s.mastExt ?? 0, s.mastUp && atPd ? 1 : 0, (s.mastUp && atPd ? 1 / 8 : 1 / 5) * dt);
    const snorkelOut = s.snorkel && atPd;
    s.snorkelExt = approach(s.snorkelExt ?? 0, snorkelOut ? 1 : 0, (snorkelOut ? 1 / 15 : 1 / 6) * dt);
  }

  // Towed array winch: streaming 900 m takes almost 4 minutes; a moving array is not settled
  if (s.towedOrder !== undefined && s.towedOrder !== s.towedLength) {
    s.towedLength = approach(s.towedLength, s.towedOrder, (s.towedOrder > s.towedLength ? 4 : 3) * dt);
    s.lastTurnAt = now;
  }

  // Position
  const v = headingVec(s.heading);
  s.pos.x += v.x * s.speed * dt;
  s.pos.y += v.y * s.speed * dt;

  stepBattery(s, dt);
}

/** Snorkel fully up at periscope depth: diesels run, battery charges. */
export function isSnorkeling(s: Ship): boolean {
  return s.snorkel && isAtPeriscopeDepth(s) && (s.snorkelExt ?? 1) >= 1;
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
