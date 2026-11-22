import {
  mastRaised,
  CLASSES,
  PERISCOPE_DEPTH,
  depthAt,
  distance,
  fireTorpedo,
  interceptHeading,
  targetPosAt,
  transmit,
  wrap360,
  type Ship,
  type World,
  isConvoyShip,
  TRAITS,
  commanderTrait,
} from '@tk/shared';
import { SKILL, isFriendly, solveFor, voted, type BotMemory, type BotSkill } from './common.js';

export interface PackReport {
  t: number;
  x: number;
  y: number;
  b: number;
  team: string;
}

const LEG_S = 180;
const SHOT_COOLDOWN = 150;
const REPORT_EVERY = 900;

/**
 * Submarine captain: listens above the layer, hides below it when hunted, runs
 * deliberate legs so its TMA gets a range, reports the convoy to the pack (and
 * pays for it with an ESM bearing), fires salvos on a good solution, then evades.
 */
export function thinkSub(w: World, m: BotMemory, s: Ship, skill: BotSkill, pack: PackReport[]): void {
  const k = SKILL[skill];
  // The commander's character scales the tactics (shot quality, speed, patience)
  const tr = TRAITS[commanderTrait(s.id, w.env.seed ?? 0)];
  const now = w.time;
  if (m.passive) {
    if (now > m.legUntil) {
      m.legSign = -m.legSign;
      m.legUntil = now + 300;
      s.order = { heading: wrap360(250 + 35 * m.legSign), speedKn: 5, depth: 60 };
    }
    return;
  }
  if (now < m.evadeUntil) return;

  const bottom = depthAt(w.env.seabed, s.pos.x, s.pos.y);
  const maxSafe = Math.max(25, Math.min(CLASSES[s.cls].maxDepth * 0.85, bottom - 30));
  const tracks = w.books.get(s.id)?.tracks() ?? [];
  const fresh = tracks.filter((t) => now - t.lastSeen < 15 && t.sensors.some((x) => x === 'hull' || x === 'towed'));
  // A ping heard from far away is a warning, not a threat; a loud one means the escort is close
  const pinged = tracks.some((t) => t.sensors.includes('intercept') && now - t.lastSeen < 90 && t.se > 25);
  const warships = fresh.filter((t) => voted(m, t) === 'warship' && !isFriendly(w, s, t, m));
  // Escorts are loud from far away: only a strong signal (close) or a ping counts as a threat
  const threatNear = pinged || warships.some((t) => t.se > 24 || (t.range !== undefined && t.range < 6000));
  // Convoy battles: merchants. In a duel (no merchants on the map) the enemy boats are the targets
  const duel = !w.ships.some(isConvoyShip);
  const wanted = duel ? 'submarine' : 'merchant';
  const target = fresh.filter((t) => voted(m, t) === wanted && !isFriendly(w, s, t, m)).sort((a, b) => b.se - a.se)[0];

  // Depth: listen above the layer, hide below it (or deep) when hunted, peek at periscope depth
  const layer = s.btLayer;
  const hide = Math.min(maxSafe, layer !== undefined ? layer + 40 : 150);
  const peeking = now < m.peekUntil;
  // Learned: against escorts that ping a lot, stay under the layer even when it's quiet
  const quietDepth = w.env.adapt?.east?.ping && layer !== undefined ? Math.min(layer + 30, maxSafe) : Math.min(60, maxSafe);
  s.order.depth = peeking ? PERISCOPE_DEPTH : threatNear ? hide : quietDepth;
  s.mastUp = peeking && s.depth <= PERISCOPE_DEPTH + 0.5;
  s.snorkel = false;

  // Diesel boats recharge when it's quiet
  const cap = CLASSES[s.cls].battery?.capacityKnH;
  if (cap && s.battery !== undefined) {
    if (s.battery < cap * 0.25 && !threatNear) m.snorkelUntil = now + 1800;
    if (now < m.snorkelUntil && !threatNear && s.battery < cap * 0.6) {
      s.order.depth = PERISCOPE_DEPTH;
      s.snorkel = true;
      s.order.speedKn = 6;
      return;
    }
    m.snorkelUntil = 0;
  }

  if (!target) {
    // Search: head for the pack's latest report or the last lead, sprint below the layer, then drift and listen
    const report = pack.filter((r) => r.team === s.team && now - r.t < 1800).pop();
    const lead = report ?? m.lead;
    if (lead) s.order.heading = lead.b === undefined ? s.order.heading : wrap360(headingTo(s, lead));
    else {
      // Patrol toward the enemy's side of the map in zigzag legs (east starts north, west south)
      if (now > m.legUntil) {
        m.legSign = -m.legSign;
        m.legUntil = now + 600;
      }
      s.order.heading = wrap360((s.team === 'east' ? 180 : 0) + 35 * m.legSign);
    }
    const sprinting = now < m.sprintUntil;
    if (!sprinting && now > m.sprintUntil + 180) m.sprintUntil = now + 240;
    s.order.speedKn = sprinting && !threatNear ? (CLASSES[s.cls].submarine && cap ? 8 : 12) : 3;
    if (sprinting && !threatNear) s.order.depth = hide;
    return;
  }

  // Legs across the line of sight make the range observable for the TMA
  if (now > m.legUntil) {
    m.legSign = -m.legSign;
    m.legUntil = now + LEG_S;
  }
  const choice = voted(m, target);
  const solved = solveFor(m, target, now, choice);
  const goodTma = solved && solved.q >= k.tmaQuality + tr.tma;
  // Against boats there's no periscope range: shoot on a good TMA (or a close, loud contact)
  const close = duel && target.se > 18 ? 4000 : undefined;
  const measured = target.range !== undefined && target.rangeAt !== undefined && now - target.rangeAt < 120 ? target.range : undefined;
  const range = close ?? measured ?? (goodTma ? distance(s.pos, targetPosAt(solved!.sol, now)) : undefined);
  s.order.heading = wrap360(target.bearing + 40 * m.legSign);
  s.order.speedKn = threatNear ? 3 : Math.round((range !== undefined && range < 6000 ? 4 : 6) * tr.speed * (w.env.adapt?.east?.fast ? 0.8 : 1));

  // Pack report: costs a periscope-depth excursion and an ESM bearing for the escorts
  if (k.pack && now - m.lastReport > REPORT_EVERY && !threatNear) {
    if (mastRaised(s)) {
      transmit(w, s, `Konvoi Peilung ${Math.round(target.bearing)}`);
      pack.push({ t: now, x: s.pos.x, y: s.pos.y, b: target.bearing, team: s.team });
      m.lastReport = now;
      m.peekUntil = 0;
    } else if (!peeking) m.peekUntil = now + 90;
  }
  // No range yet and no good TMA: a quick periscope look (surface targets only)
  if (range === undefined && !threatNear && target.se > 6 && now > m.peekAgain) {
    m.peekUntil = now + 60;
    m.peekAgain = now + 420 * tr.peek;
  }

  if (range !== undefined && range < 8000 && now - m.lastShot > SHOT_COOLDOWN) {
    // Long passive shots run slow: quieter, and the seeker hears more without flow noise
    const runKn = !duel && range > 4000 ? 30 : 40;
    const aim = solved ? interceptHeading(s.pos, runKn, solved.sol, now) ?? target.bearing : target.bearing;
    let fired = 0;
    for (let i = 0; i < k.salvo; i++) {
      const spread = k.salvo > 1 ? (i === 0 ? -3 : 3) : 0;
      const r = fireTorpedo(w, s, { heading: wrap360(aim + spread), enableAfter: Math.max(800, range * 0.6), mode: duel ? 'active' : 'passive', searchDepth: duel ? Math.max(40, s.depth) : 15, speedKn: runKn });
      if (typeof r !== 'string') fired++;
    }
    if (fired) {
      m.lastShot = now;
      // Shoot and scoot: turn away, go deep, open the range
      m.evadeUntil = now + 180;
      s.order = { heading: wrap360(target.bearing + 150 * m.legSign), speedKn: 8, depth: hide };
    }
  }
}

function headingTo(s: Ship, r: { x: number; y: number; b: number }): number {
  // Steer for a point 12 km down the reported bearing from where it was reported
  const rad = (r.b * Math.PI) / 180;
  const p = { x: r.x + Math.sin(rad) * 12_000, y: r.y + Math.cos(rad) * 12_000 };
  return (Math.atan2(p.x - s.pos.x, p.y - s.pos.y) * 180) / Math.PI;
}
