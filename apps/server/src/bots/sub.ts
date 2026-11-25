import {
  crewOf,
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
  headingVec,
  isEscort,
  trueDeg3,
} from '@tk/shared';
import { considerMine } from './mines.js';
import { SKILL, isFriendly, isNeutral, solveFor, voted, type BotMemory, type BotSkill } from './common.js';

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
  // Any ping heard (even faint) means rig for silent running for five minutes
  if (tracks.some((t) => t.sensors.includes('intercept') && now - t.lastSeen < 30)) m.silentUntil = now + 300;
  crewOf(s).silent = now < (m.silentUntil ?? 0);
  // A merchant nearby whose noise masks ours: with escorts close, creep in under it
  const cover = !w.ships.some(isConvoyShip) ? undefined
    : fresh.filter((t) => voted(m, t) === 'merchant' && !isFriendly(w, s, t, m) && !isNeutral(w, s, t, m) && t.se > 10).sort((a, b) => b.se - a.se)[0];
  // Strait breakthrough: creep north through the deepest water, deep and slow, ignore targets (a West boat hunts them)
  if (w.env.mission === 'meerenge' && s.team === 'east') {
    // Straight north unless the water ahead gets shallow; then the deeper side
    let best = 0;
    let bestDepth = depthAt(w.env.seabed, s.pos.x, s.pos.y + 1500);
    if (bestDepth < 80) {
      for (const off of [-25, 25, -45, 45]) {
        const v = headingVec(off);
        const d = depthAt(w.env.seabed, s.pos.x + v.x * 1500, s.pos.y + v.y * 1500);
        if (d > bestDepth + 15) [best, bestDepth] = [off, d];
      }
    }
    s.order.heading = wrap360(best);
    s.order.speedKn = threatNear ? 4 : 7;
    s.order.depth = Math.max(25, Math.min(maxSafe, (s.btLayer ?? 80) + 30, bestDepth - 30));
    considerMine(w, m, s, threatNear);
    return;
  }
  // A boat in direct support of its own convoy hunts the wolves instead of merchants
  const guard = w.ships.some((x) => isConvoyShip(x) && x.team === s.team);
  // Harbour attack: run in to the charted anchorage and fire into it from periscope depth
  if (!guard && w.env.mission === 'hafen' && harbourRun(w, m, s, threatNear, maxSafe, k.salvo)) return;
  // Convoy battles: merchants. In a duel (no merchants on the map) the enemy boats are the targets
  const duel = !w.ships.some(isConvoyShip) || guard;
  const wanted = duel ? 'submarine' : 'merchant';
  const hostile = (want: string) => fresh.filter((t) => voted(m, t) === want && !isFriendly(w, s, t, m) && !isNeutral(w, s, t, m)).sort((a, b) => b.se - a.se)[0];
  // A guarding boat fights back against the enemy's warship when it is being hunted by it
  const target = hostile(wanted) ?? (guard && threatNear ? hostile('warship') : undefined);
  // A mine barrage across the convoy track takes the helm while it runs
  if (!duel && considerMine(w, m, s, threatNear, target)) return;

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
      // A guarding boat holds a station some 7 km ahead of its convoy instead
      const own = guard ? w.ships.filter((x) => isConvoyShip(x) && x.team === s.team && x.alive) : [];
      if (own.length) {
        const c = { x: own.reduce((a, x) => a + x.pos.x, 0) / own.length, y: own.reduce((a, x) => a + x.pos.y, 0) / own.length };
        const ahead = headingVec(w.convoy?.guideHeading ?? 0);
        const st = { x: c.x + ahead.x * 7000, y: c.y + ahead.y * 7000 };
        s.order.heading = Math.hypot(st.x - s.pos.x, st.y - s.pos.y) > 2500 ? wrap360((Math.atan2(st.x - s.pos.x, st.y - s.pos.y) * 180) / Math.PI) : wrap360((w.convoy?.guideHeading ?? 0) + 60 * m.legSign);
      } else s.order.heading = wrap360((s.team === 'east' ? 180 : 0) + 35 * m.legSign);
    }
    const sprinting = now < m.sprintUntil;
    if (!sprinting && now > m.sprintUntil + 180) m.sprintUntil = now + 240;
    s.order.speedKn = sprinting && !threatNear ? (CLASSES[s.cls].submarine && cap ? 8 : 12) : 3;
    if (sprinting && !threatNear) s.order.depth = hide;
    if (threatNear && cover) {
      s.order.heading = cover.bearing;
      s.order.speedKn = 5;
    }
    return;
  }

  // Legs across the line of sight make the range observable for the TMA (a long patrol leg
  // from the search ends at once: the plot needs the turns)
  if (m.legUntil > now + LEG_S) m.legUntil = now;
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
  // Hunted: close in under the merchants' noise instead of legging across the line of sight
  s.order.heading = wrap360(target.bearing + (threatNear && !duel ? 8 : 40) * m.legSign);
  s.order.speedKn = threatNear ? 3 : Math.round((range !== undefined && range < 6000 ? 4 : 6) * tr.speed * (w.env.adapt?.east?.fast ? 0.8 : 1));

  // Reconnaissance: an escort seen through the periscope gets reported at once
  if (w.env.mission === 'aufklaerung' && mastRaised(s) && tracks.some((t) => (t.classified !== undefined && isEscort(t.classified) && t.classified !== 'ffk') && now - t.lastSeen < 60 && (t.range ?? Infinity) < 4000)) {
    transmit(w, s, 'Feindmeldung: Geleitschiff in Sicht');
  }
  // Pack report: costs a periscope-depth excursion and an ESM bearing for the escorts
  if (k.pack && now - m.lastReport > (w.env.mission === 'fuehlung' ? 480 : REPORT_EVERY) && !threatNear) {
    if (mastRaised(s)) {
      transmit(w, s, `Konvoi Peilung ${trueDeg3(w, target.bearing)}`);
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

  // A guarding boat holds fire while its own convoy or neutral traffic is near the target: the seeker would take them
  const rad = (target.bearing * Math.PI) / 180;
  const aimAt = range !== undefined ? { x: s.pos.x + Math.sin(rad) * range, y: s.pos.y + Math.cos(rad) * range } : undefined;
  const fouled = guard && !!aimAt && w.ships.some((x) => x.alive && x.id !== s.id && (x.team === s.team || x.team === 'neutral') && distance(x.pos, aimAt) < GUARD_CLEAR_M);
  if (range !== undefined && range < 8000 && !fouled && now - m.lastShot > SHOT_COOLDOWN) {
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

/** A guarding boat's torpedo needs this much water free of friends and neutrals around its target (m). */
const GUARD_CLEAR_M = 3000;

function headingTo(s: Ship, r: { x: number; y: number; b: number }): number {
  // Steer for a point 12 km down the reported bearing from where it was reported
  const rad = (r.b * Math.PI) / 180;
  const p = { x: r.x + Math.sin(rad) * 12_000, y: r.y + Math.cos(rad) * 12_000 };
  return (Math.atan2(p.x - s.pos.x, p.y - s.pos.y) * 180) / Math.PI;
}

/** Centre of the anchored merchants (harbour attack): the anchorage is charted. */
function anchorageOf(w: World): { x: number; y: number } | undefined {
  const ms = w.ships.filter((x) => x.cls === 'merchant' && x.alive);
  if (!ms.length) return undefined;
  return { x: ms.reduce((a, x) => a + x.pos.x, 0) / ms.length, y: ms.reduce((a, x) => a + x.pos.y, 0) / ms.length };
}

/** Firing range into the anchorage (m): close enough for a fan of slow passive torpedoes. */
const HARBOUR_FIRE_M = 4200;

/**
 * Harbour attack: the anchorage is charted and the ships lie still. Run in deep and steady
 * (slower when escorts are close), then come up to periscope depth, take a look and fire a fan
 * at the nearest ship at anchor; between salvos hold off quietly. Returns false without targets.
 */
function harbourRun(w: World, m: BotMemory, s: Ship, threatNear: boolean, maxSafe: number, salvo: number): boolean {
  const anch = anchorageOf(w);
  if (!anch) return false;
  const now = w.time;
  const d = distance(s.pos, anch);
  const toAnch = wrap360((Math.atan2(anch.x - s.pos.x, anch.y - s.pos.y) * 180) / Math.PI);
  s.snorkel = false;
  if (d > HARBOUR_FIRE_M) {
    s.order = { heading: toAnch, speedKn: threatNear ? 4 : 7, depth: Math.min(maxSafe, 120) };
    s.mastUp = false;
    return true;
  }
  if (now - m.lastShot < SHOT_COOLDOWN) {
    // Reloading: hold off, deep and slow, nose on the anchorage
    s.order = { heading: toAnch, speedKn: 2, depth: Math.min(maxSafe, 90) };
    s.mastUp = false;
    return true;
  }
  // A look through the periscope, then the fan at the nearest ship at anchor
  s.order = { heading: toAnch, speedKn: 3, depth: PERISCOPE_DEPTH };
  s.mastUp = s.depth <= PERISCOPE_DEPTH + 0.5;
  if (!s.mastUp) return true;
  const ships = w.ships.filter((x) => x.cls === 'merchant' && x.alive).sort((a, b) => distance(s.pos, a.pos) - distance(s.pos, b.pos));
  const tgt = ships[0];
  if (!tgt) return true;
  const r = distance(s.pos, tgt.pos);
  const brg = wrap360((Math.atan2(tgt.pos.x - s.pos.x, tgt.pos.y - s.pos.y) * 180) / Math.PI);
  let fired = 0;
  for (let i = 0; i < Math.max(2, salvo); i++) {
    const spread = (i - (Math.max(2, salvo) - 1) / 2) * 4;
    const res = fireTorpedo(w, s, { heading: wrap360(brg + spread), enableAfter: Math.max(600, r * 0.7), mode: 'passive', searchDepth: 8, speedKn: 30 });
    if (typeof res !== 'string') fired++;
  }
  if (fired) m.lastShot = now;
  return true;
}
