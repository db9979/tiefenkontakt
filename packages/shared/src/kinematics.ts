import { CLASSES, isEscort, type ClassId } from './classes.js';
import { speedFactor } from './damage.js';
import type { Ship } from './entities.js';
import { PERISCOPE_DEPTH, isAtPeriscopeDepth } from './entities.js';

/** Rise rate during an emergency blow (m/s). */
const BLOW_RISE_MS = 3.5;
import { DEG, KN, angleDiff, approach, clamp, headingVec, wrap360, type Vec2 } from './math.js';

/** The sea around a ship for her motion: sea state and the surface wind (m/s, blowing toward). */
export interface SeaWay {
  seaState: number;
  wind?: Vec2;
}

/**
 * Speed lost running into a heavy head sea: the ship slams and her captain eases her. A frigate
 * gives up 8 % of her top speed per sea state above 3 dead into the sea (SS6: about 23 of 30 kn),
 * a corvette 12 %; beam and following seas cost nothing here. Waves run with the wind.
 */
export const HEAD_SEA_LOSS: Partial<Record<ClassId, number>> = { ffg: 0.08, ffv: 0.08, ffk: 0.08, kor: 0.12 };
export function headSeaFactor(cls: ClassId, heading: number, sea?: SeaWay): number {
  const k = HEAD_SEA_LOSS[cls];
  if (!k || !sea?.wind || !isEscort(cls)) return 1;
  const w = Math.hypot(sea.wind.x, sea.wind.y);
  if (w < 0.5) return 1;
  // Direction the waves come from (opposite to the way the wind blows)
  const from = wrap360(Math.atan2(-sea.wind.x, -sea.wind.y) / DEG);
  const into = Math.max(0, Math.cos(angleDiff(heading, from) * DEG));
  return 1 - k * Math.max(0, sea.seaState - 3) * into * into;
}

/** Most a ship makes astern (kn): about 40 % of her top speed, at most 8 kn. */
export function asternMaxKn(cls: ClassId): number {
  return Math.min(8, Math.round(CLASSES[cls].maxSpeedKn * 0.4));
}

/** Most a ship makes with the Nixie towed decoy streamed (the tow cable and body). */
export const NIXIE_MAX_KN = 25;
/** Above this speed the mast (periscope, ESM, radar) can't be raised: the water would bend or tear it (boat.ts lowers it). */
export const MAST_MAX_KN = 10;

/** Speed above which a snorkeling SSK floods the snorkel / can't charge. */
export const SNORKEL_MAX_KN = 8;

/** Advance one ship's motion, depth, masts and battery by dt seconds (sea: sea state and wind, if known). */
export function stepShip(s: Ship, dt: number, now: number, sea?: SeaWay): void {
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
  if (s.nixie) maxKn = Math.min(maxKn, NIXIE_MAX_KN);
  maxKn *= headSeaFactor(s.cls, s.heading, sea);

  // Speed: engines push up slowly, drag and astern power bring it down a bit quicker;
  // a hard turn bleeds speed (rudder and hull drag)
  const turnShare = Math.abs(s.yawRate ?? 0) / Math.max(0.1, spec.turnRateDeg);
  // Astern: the engines reverse; she first loses her way, then gathers sternway (slowly, the
  // screw works badly backwards). Speed stays a magnitude; `sternway` says which way she moves.
  const wantKn = clamp(s.order.speedKn, -Math.min(maxKn, asternMaxKn(s.cls)), maxKn) * KN * (1 - 0.25 * Math.min(1, turnShare));
  const now0 = s.sternway ? -s.speed : s.speed;
  const braking = Math.abs(wantKn) < Math.abs(now0) || Math.sign(wantKn) !== Math.sign(now0);
  const signed = approach(now0, wantKn, (braking ? 1.3 : wantKn < 0 ? 0.6 : 1) * spec.accel * dt);
  s.sternway = signed < -1e-6;
  s.speed = Math.abs(signed);

  // Turning: rate of turn = speed / turning radius (a slow ship turns slowly), with rudder lag;
  // the turn is eased off ahead of the ordered course so it doesn't overshoot
  const speedMs = s.speed;
  // Going astern the rudder bites badly: half the rate of turn
  const maxRate = speedMs < 0.15 ? 0 : Math.min(spec.turnRateDeg, ((speedMs / spec.turnRadius) * 180) / Math.PI) * (s.sternway ? 0.5 : 1);
  const yawAcc = Math.max(0.05, maxRate / 6); // about 6 s to full rate of turn
  // A jammed rudder holds whatever turn it had (incident)
  const diff = (s.rudderJamUntil ?? 0) > now ? Math.sign(s.yawRate ?? 0) * 90 : angleDiff(s.heading, s.order.heading);
  const want = Math.sign(diff) * Math.min(maxRate, Math.sqrt(2 * yawAcc * Math.abs(diff)));
  s.yawRate = approach(s.yawRate ?? 0, want, yawAcc * dt);
  const step = s.yawRate * dt;
  if (Math.abs(diff) < 0.02 || (Math.abs(diff) <= Math.abs(step) && Math.sign(diff) === Math.sign(step))) {
    // On the ordered course: meet her (rudder amidships)
    s.heading = wrap360(s.order.heading);
    s.yawRate = 0;
  } else s.heading = wrap360(s.heading + step);
  settleTowed(s, now, step);

  if (spec.submarine) {
    // Depth: planes give speed · sin(angle); trim and ballast a little more at any speed
    // Orders may go below the test depth (to the crush depth at 1.5×); boat.ts makes that dangerous
    // A heavy sea sucks a boat at periscope depth upward in the swell; a broach throws her up
    const ordered = clamp(s.order.depth, 0, spec.maxDepth * 1.5);
    const target = ordered <= PERISCOPE_DEPTH + 1 && ordered > 0.5
      ? Math.max(0.6, (s.broachUntil ?? 0) > now ? Math.min(ordered, BROACH_DEPTH_M) : ordered - periscopeSwellM(sea?.seaState ?? 0, s.speed / KN, now, s.id))
      : ordered;
    const planes = speedMs * Math.sin(((spec.planeAngleDeg ?? 15) * Math.PI) / 180);
    const vmax = Math.min(spec.depthRate, 0.2 + planes);
    // Level off gently instead of stopping dead at the ordered depth
    const v = Math.min(vmax, 0.05 + Math.abs(target - s.depth) * 0.08);
    // Emergency blow: the tanks are blown dry, the boat rises fast regardless of speed
    s.blowing = (s.blowUntil ?? 0) > now;
    s.depth = s.blowing ? Math.max(0, s.depth - BLOW_RISE_MS * dt) : approach(s.depth, target, v * dt);
    // Masts: hoisting takes about 8 s, lowering 5 s; the snorkel head 15 s up, 6 s down
    const atPd = s.depth <= PERISCOPE_DEPTH + 0.5;
    if (!atPd) s.mastUp = false;
    // A mast ordered on the way up goes up on arrival (unless the boat was sent deep again)
    if (s.mastPending && atPd && s.speed / KN <= MAST_MAX_KN) {
      s.mastUp = true;
      s.mastPending = false;
    }
    if (s.mastPending && s.order.depth > PERISCOPE_DEPTH + 0.5) s.mastPending = false;
    // The radar sits on the mast: lowering it (or diving) switches it off
    if (!s.mastUp) s.radarOn = false;
    s.mastExt = approach(s.mastExt ?? 0, s.mastUp && atPd ? 1 : 0, (s.mastUp && atPd ? 1 / 8 : 1 / 5) * dt);
    const snorkelOut = s.snorkel && atPd;
    s.snorkelExt = approach(s.snorkelExt ?? 0, snorkelOut ? 1 : 0, (snorkelOut ? 1 / 15 : 1 / 6) * dt);
  }

  // Variable-depth sonar: about 2 m/s on the winch; above its speed limit it has to be housed
  const vds = CLASSES[s.cls].vds;
  if (vds && (s.vdsOrder !== undefined || (s.vdsDepth ?? 0) > 0)) {
    if (s.speed / KN > vds.maxSpeedKn) s.vdsOrder = 0;
    s.vdsDepth = approach(s.vdsDepth ?? 0, Math.min(s.vdsOrder ?? 0, vds.maxDepth), 2 * dt);
  }

  // Towed array winch: streaming 900 m takes almost 4 minutes; a moving array is not settled
  if (s.towedOrder !== undefined && s.towedOrder !== s.towedLength) {
    s.towedLength = approach(s.towedLength, s.towedOrder, (s.towedOrder > s.towedLength ? 4 : 3) * dt);
    s.lastTurnAt = now;
  }

  // Position
  const v = headingVec(s.heading);
  const way = s.sternway ? -s.speed : s.speed;
  s.pos.x += v.x * way * dt;
  s.pos.y += v.y * way * dt;

  stepBattery(s, dt, now, sea?.seaState ?? 0);
}

/** Depth a broaching boat is thrown up to (m): the conning tower is out of the water. */
export const BROACH_DEPTH_M = 7;

/** Is the boat broaching right now (thrown up by the sea, conning tower out of the water)? Unknown time: no. */
export function isBroaching(s: Ship, now: number | undefined): boolean {
  return now !== undefined && (s.broachUntil ?? 0) > now && s.depth <= BROACH_DEPTH_M + 4;
}

/**
 * Heavy sea at periscope depth: the swell's suction pulls the boat up and the planesmen can't
 * hold her. From sea state 5 the ordered depth swings up by as much as 2 m (SS5) or 4 m (SS6)
 * over a 10 s swell; with way on (4 kn and more) the planes bite and halve it. Only upward:
 * the boat is never dragged below the ordered depth by it.
 */
export function periscopeSwellM(seaState: number, kn: number, now: number, id = ''): number {
  if (seaState < 5) return 0;
  const amp = (seaState - 4) * (kn < 4 ? 1 : 0.5);
  let ph = 0;
  for (let i = 0; i < id.length; i++) ph = (ph * 31 + id.charCodeAt(i)) % 997;
  return amp * (1 + Math.sin((2 * Math.PI * now) / 10 + ph));
}

/**
 * Towed array settling: a small alteration (< 10°) leaves the array straight; up to 45° it needs
 * a minute on the new course, a bigger turn two and a half. The clock runs from the end of the turn.
 */
export const SETTLE_SMALL_DEG = 10;
export const SETTLE_LARGE_DEG = 45;
export const SETTLE_MEDIUM_S = 60;
export const SETTLE_LARGE_S = 150;

function settleTowed(s: Ship, now: number, step: number): void {
  if (Math.abs(s.yawRate ?? 0) <= 0.05) {
    s.turnFrom = undefined;
    return;
  }
  // Heading before this step's turn: where the alteration began
  s.turnFrom ??= wrap360(s.heading - step);
  const alt = Math.abs(angleDiff(s.turnFrom, s.heading));
  if (alt < SETTLE_SMALL_DEG) return;
  const need = alt > SETTLE_LARGE_DEG ? SETTLE_LARGE_S : SETTLE_MEDIUM_S;
  // A new turn while the array still snakes from the last one keeps the longer wait
  const unsettled = now - s.lastTurnAt < (s.towedSettle ?? 0);
  s.towedSettle = unsettled ? Math.max(s.towedSettle ?? 0, need) : need;
  s.lastTurnAt = now;
}

/** Snorkel fully up at periscope depth: diesels run, battery charges. */
export function isSnorkeling(s: Ship): boolean {
  return s.snorkel && isAtPeriscopeDepth(s) && (s.snorkelExt ?? 1) >= 1;
}

/**
 * Battery drain in % of capacity per hour at a speed (kn): hotel load plus propulsion,
 * which grows with the cube of the speed (1 %/h stopped, ≈5 %/h at 6 kn, ≈15 %/h at 10 kn,
 * a full battery in about an hour flat out).
 */
export function batteryDrainPctH(kn: number): number {
  return 1 + (kn * kn * kn) / 70;
}

/**
 * What the diesels put into the battery (% per hour) at a state of charge (%): a lead-acid
 * battery takes the full current (40 %/h here, time compressed) up to about 70 %, then its
 * acceptance falls (absorption phase) toward 12 %/h near full, so the last 30 % take about as
 * long as the first 70. In a heavy sea the snorkel head dips and the diesels are throttled:
 * 12 % less per sea state above 3.
 */
export const CHARGE_BULK_PCT_H = 40;
export const CHARGE_TAPER_FROM = 70;
export const CHARGE_FULL_PCT_H = 12;
export function chargeAcceptPctH(socPct: number, seaState = 0): number {
  const soc = clamp(socPct, 0, 100);
  const base = soc <= CHARGE_TAPER_FROM ? CHARGE_BULK_PCT_H
    : CHARGE_BULK_PCT_H - ((CHARGE_BULK_PCT_H - CHARGE_FULL_PCT_H) * (soc - CHARGE_TAPER_FROM)) / (100 - CHARGE_TAPER_FROM);
  return base * snorkelSeaFactor(seaState);
}

/** Share of the diesels' charge a snorkelling boat keeps in this sea (1 up to SS3, 0,64 at SS6). */
export function snorkelSeaFactor(seaState: number): number {
  return 1 - 0.12 * Math.max(0, seaState - 3);
}

/**
 * Net charge rate while snorkelling or surfaced (% per hour): what the battery accepts at this
 * charge (default: in the bulk phase), less what the run takes.
 */
export function batteryChargePctH(kn: number, socPct = 0, seaState = 0): number {
  return chargeAcceptPctH(socPct, seaState) - batteryDrainPctH(kn);
}

/** Is the charge in its slow finishing phase (above 70 %)? */
export function chargeTapering(socPct: number): boolean {
  return socPct > CHARGE_TAPER_FROM;
}

/**
 * Time (s) to charge from one state (%) to another at a speed and sea state, following the
 * taper; Infinity if the run eats all the charge.
 */
export function chargeTimeS(fromPct: number, toPct: number, kn: number, seaState = 0): number {
  let t = 0;
  for (let soc = fromPct; soc < toPct - 1e-9;) {
    const step = Math.min(1, toPct - soc);
    const rate = batteryChargePctH(kn, soc + step / 2, seaState);
    if (rate <= 0) return Infinity;
    t += (step / rate) * 3600;
    soc += step;
  }
  return t;
}

/** Drain of this boat at this speed (% per hour); 0 below the AIP plant's speed. */
function drainOf(s: Ship, kn: number): number {
  const aip = CLASSES[s.cls].aipKn;
  return aip !== undefined && kn <= aip ? 0 : batteryDrainPctH(kn);
}

/**
 * Battery charge at the start of a match (% of capacity): boats have been on patrol for a
 * while, so 40–70 %; beginners get at least 60 %.
 */
export function startBatteryPct(rnd: () => number, beginner = false): number {
  const lo = beginner ? 60 : 40;
  return lo + rnd() * (70 - lo);
}

function stepBattery(s: Ship, dt: number, now: number, seaState: number): void {
  const spec = CLASSES[s.cls];
  if (!spec.battery || s.battery === undefined) return;
  const cap = spec.battery.capacityKnH;
  const hours = dt / 3600;
  const kn = s.speed / KN;
  const surfaced = s.depth <= 0.5;
  const soc = (100 * s.battery) / cap;
  // While the snorkel's head valve is shut by a wave the diesels stop (boat.ts): no charge
  const valveShut = !surfaced && (s.headValveUntil ?? 0) > now;
  // battery is stored in capacity units (knot-hours); the rates are in % of capacity.
  // Surfaced the diesels breathe freely (no head valve, no snorkel sea loss)
  const pctH = surfaced ? batteryChargePctH(kn, soc) : isSnorkeling(s) && !valveShut ? batteryChargePctH(kn, soc, seaState) : -drainOf(s, kn);
  s.battery = clamp(s.battery + (pctH / 100) * cap * hours, 0, cap);
}

/** Estimated remaining submerged endurance in seconds at current speed (undefined: no battery, or AIP carries it). */
export function batteryEndurance(s: Ship): number | undefined {
  const cap = CLASSES[s.cls].battery?.capacityKnH;
  if (s.battery === undefined || !cap) return undefined;
  const drain = drainOf(s, s.speed / KN);
  if (drain <= 0) return undefined;
  return ((s.battery / cap) * 100 / drain) * 3600;
}
