import {
  depthLimit,
  angleDiff,
  crewOf,
  mastRaised,
  CLASSES,
  PERISCOPE_DEPTH,
  depthAt,
  distance,
  interceptHeading,
  heavyPreset,
  twoSpeedMeanKn,
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
  KN,
  MAST_MAX_KN,
  LAUNCH_DEPTH_FRAC,
  defaultSpreadDeg,
  fireSalvo,
  launchBlock,
  planesFor,
  type ContactTrack,
} from '@tk/shared';
import { HARBOUR_ANCHORAGE } from '../scenario.js';
import { considerMine } from './mines.js';
import { PACE, captainPace, legsRun, looked, plotFrom, subWaits } from './pacing.js';
import { WAKE_ARM_M, WAKE_MIN_RANGE, WAKE_SHOT_KN, astern, escortKn, fastEscort, wakeAtHunter } from './wake-shot.js';
import { SKILL, classify, isFriendly, isNeutral, plotBearings, solveFor, traceShot, voted, votedPeek, type BotMemory, type BotSkill } from './common.js';

export interface PackReport {
  t: number;
  x: number;
  y: number;
  b: number;
  team: string;
}

/** A TMA leg runs at least this long once the boat is on it (s); the crew's pace adds to it. */
const LEG_MIN_S = 120;
const SHOT_COOLDOWN = 150;
/**
 * Shoot and scoot: this long turning away deep after a salvo before the attack goes on (s). At
 * 180 s the boats lost the convoy after each salvo (arena 4 seeds x 15, groenland/schelf/fjord:
 * escorts 78 % -> 63 % at 120 s, see also SUB_TORPEDO_EVADE_S in index.ts).
 */
const SCOOT_S = 120;
/** Escorts about: TMA legs this far off the line of sight (deg) and this fast (kn) while the plot needs them. */
const HUNTED_LEG_DEG = 65;
const HUNTED_LEG_KN = 5;
const REPORT_EVERY = 900;
/** A periscope look: this long with the mast up (s), and at most this long to come up for it. */
export const PEEK_LOOK_S = 10;
const PEEK_MAX_S = 120;
/** After a radar warning (aircraft radar, ship radar closing) no mast or snorkel for this long (s). */
export const RADAR_DOWN_S = 600;
/** Battery (share of capacity): snorkel below the first, until the second; no sprints below the reserve. */
export const SNORKEL_START = 0.3;
const SNORKEL_STOP = 0.7;
export const SPRINT_RESERVE = 0.4;

/**
 * Radar warner on the raised mast: an aircraft radar at any strength, or a ship radar whose
 * strength is rising (closing). Own side and neutral traffic don't count.
 */
export function radarWarning(w: World, s: Ship, m: BotMemory, tracks: ContactTrack[]): boolean {
  if (!mastRaised(s)) return false;
  if (planesFor(w, s).some((p) => p.via.includes('esm') && p.side === 'hostile')) return true;
  return tracks.some((t) => t.sensors.includes('esm') && w.time - t.lastSeen < 15 && t.esmTrend === 1 && !isFriendly(w, s, t, m) && !isNeutral(w, s, t, m));
}

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
  // A damaged hull dives less deep (boat.ts depthLimit)
  const maxSafe = Math.max(25, Math.min(depthLimit(s) * 0.85, bottom - 30));
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
  // Radar warner: mast and snorkel down, below the layer, and stay down for a while
  if (radarWarning(w, s, m, tracks)) {
    if (now >= (m.radarDownUntil ?? 0)) m.peekUntil = 0;
    m.radarDownUntil = now + RADAR_DOWN_S;
  }
  const radarDown = now < (m.radarDownUntil ?? 0);
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
  // The captain stays on the ship he is plotting while he still hears her (a two minutes' dropout
  // or a louder neighbour doesn't restart the attack); otherwise the loudest
  const kept = tracks.find((t) => t.label === m.attackLabel && now - t.lastSeen < KEEP_S);
  let reacquired = false;
  const hostile = (want: string) => {
    const ok = (t: ContactTrack) => voted(m, t) === want && !isFriendly(w, s, t, m) && !isNeutral(w, s, t, m);
    if (kept && ok(kept)) return kept;
    // Lost and found again on the same bearing (a new track label): the same ship, the plot goes on
    const again = !kept && m.attackBrg !== undefined && now - (m.attackSeen ?? -1e9) < REACQUIRE_S
      ? fresh.filter((t) => ok(t) && Math.abs(angleDiff(t.bearing, m.attackBrg!)) < REACQUIRE_DEG)
        .sort((a, b) => Math.abs(angleDiff(a.bearing, m.attackBrg!)) - Math.abs(angleDiff(b.bearing, m.attackBrg!)))[0]
      : undefined;
    if (again) {
      carryPlot(m, m.attackLabel!, again.label);
      reacquired = true;
      return again;
    }
    return fresh.filter(ok).sort((a, b) => b.se - a.se)[0];
  };
  // The plotter keeps every merchant it hears, so the next target after a salvo has a plot ready
  if (!duel) for (const t of fresh) if (voted(m, t) === 'merchant' && !isNeutral(w, s, t, m)) plotBearings(m, t, now);
  // An SSN with wake homers turns on a fast escort that hunts it: the homer runs up the trail and the
  // towed decoy means nothing to it. The attack switches only once the escort runs fast (the usual
  // pacing gates still hold the shot). Which contacts are escorts goes by the latest reading of the
  // lines, not the whole vote: a frigate shadowing at 12 kn reads like a boat (60 Hz, five blades),
  // at speed her turn count gives her away, and that is when she leaves a trail worth taking
  const wakeRack = s.cls === 'ssn' && !duel && (w.weapons?.loadouts.get(s.id)?.wake ?? 0) > 0;
  const escortsNow = wakeRack ? fresh.filter((t) => (classify(t) === 'warship' || votedPeek(m, t) === 'warship') && !isFriendly(w, s, t, m) && !isNeutral(w, s, t, m)) : [];
  for (const t of escortsNow) plotBearings(m, t, now);
  // Only an escort on top of the boat (pinging her, loud, close): the convoy attack waits only while she is pinned down anyway
  const pinned = pinged || escortsNow.some((t) => t.se > 32 || (t.range !== undefined && t.range < 3000));
  const hunter = wakeRack && pinned ? fastEscort(m, escortsNow, now) : undefined;
  // A guarding boat fights back against the enemy's warship when it is being hunted by it
  const target = hostile(wanted) ?? (guard && threatNear ? hostile('warship') : undefined);
  if (target && target.label !== m.attackLabel && !reacquired) m.attackFirst = target.firstSeen;
  if (target) [m.attackLabel, m.attackBrg, m.attackSeen] = [target.label, target.bearing, now];
  else if (now - (m.attackSeen ?? -1e9) >= REACQUIRE_S) m.attackLabel = undefined;
  // A mine barrage across the convoy track takes the helm while it runs
  if (!duel && considerMine(w, m, s, threatNear, target)) return;

  // Depth: listen above the layer, hide below it (or deep) when hunted, peek at periscope depth
  const layer = s.btLayer;
  const hide = Math.min(maxSafe, layer !== undefined ? layer + 40 : 150);
  // A periscope look is short: ten seconds with the mast up, then down again
  if (m.peekUp !== undefined && now - m.peekUp >= PEEK_LOOK_S) m.peekUntil = 0;
  if (radarDown) m.peekUntil = 0;
  const peeking = now < m.peekUntil;
  if (!peeking) m.peekUp = undefined;
  // Learned: against escorts that ping a lot, stay under the layer even when it's quiet
  const quietDepth = w.env.adapt?.east?.ping && layer !== undefined ? Math.min(layer + 30, maxSafe) : Math.min(60, maxSafe);
  s.order.depth = peeking ? PERISCOPE_DEPTH : threatNear || radarDown ? hide : quietDepth;
  // Mast and periscope only below 10 kn
  const mastOk = s.depth <= PERISCOPE_DEPTH + 0.5 && s.speed / KN <= MAST_MAX_KN;
  s.mastUp = peeking && mastOk;
  if (s.mastUp) m.peekUp ??= now;
  s.snorkel = false;

  // Diesel boats recharge when it's quiet: snorkel with the mast up (the radar warner listens)
  const cap = CLASSES[s.cls].battery?.capacityKnH;
  const charge = cap && s.battery !== undefined ? s.battery / cap : 1;
  if (cap && s.battery !== undefined) {
    if (charge < SNORKEL_START && !threatNear && !radarDown) m.snorkelUntil = now + 3600;
    if (now < m.snorkelUntil && !threatNear && !radarDown && charge < SNORKEL_STOP) {
      s.order.depth = PERISCOPE_DEPTH;
      s.snorkel = true;
      s.order.speedKn = 6;
      s.mastUp = mastOk;
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
    // Sprints only with the battery above the reserve (kept for evading)
    if (!sprinting && now > m.sprintUntil + 180 && charge > SPRINT_RESERVE) m.sprintUntil = now + 240;
    s.order.speedKn = sprinting && !threatNear ? (CLASSES[s.cls].submarine && cap ? 8 : 12) : 3;
    if (sprinting && !threatNear) s.order.depth = hide;
    if (threatNear && cover) {
      s.order.heading = cover.bearing;
      s.order.speedKn = 5;
    }
    return;
  }

  // The crew's pace (pacing.ts): time on each leg, listening, the solution settling
  const pace = PACE[skill];
  const pf = captainPace(s.id, w.env.seed ?? 0, commanderTrait(s.id, w.env.seed ?? 0));
  const legS = Math.max(LEG_MIN_S, Math.round(pace.legS * pf) + 30);
  // Legs across the line of sight make the range observable for the TMA (a long patrol leg
  // from the search ends at once: the plot needs the turns)
  // (an own timer: a contact that drops out for a moment and the search's zigzag don't cut a leg short)
  if ((m.tmaLegUntil ?? 0) > now + legS) m.tmaLegUntil = now;
  if (now > (m.tmaLegUntil ?? 0)) {
    m.legSign = -m.legSign;
    m.tmaLegUntil = now + legS;
    // The captain's leg log for the TMA (the last half hour)
    const starts = (m.legStarts ??= []);
    starts.push(now);
    while (starts.length > 12) starts.shift();
  }
  // The leg's clock runs only once the boat has come round onto it (a slow boat turns for minutes),
  // but no leg lasts more than twice its time
  const legStart = m.legStarts?.[m.legStarts.length - 1] ?? now;
  if (Math.abs(angleDiff(s.heading, s.order.heading)) > 15) m.tmaLegUntil = Math.min(Math.max(m.tmaLegUntil ?? 0, now + legS), legStart + 2 * legS);
  const choice = voted(m, target);
  const solved = solveFor(m, target, now, choice);
  // The fast nuclear boat shoots on a rougher solution (arena, base setup 60 games: 43:17 -> 33:27, West mixed 30:30 -> 32:28)
  const qMin = k.tmaQuality + tr.tma - (s.cls === 'ssn' ? SSN_TMA_RELIEF : 0);
  const goodTma = !!solved && solved.q >= qMin;
  // How long the solution has held above the threshold (a single lucky fit doesn't count)
  const qs = (m.qualSince ??= {});
  if (goodTma) qs[target.label] ??= now;
  else delete qs[target.label];
  // Against boats there's no periscope range: shoot on a good TMA (or a close, loud contact)
  const close = duel && target.se > 18 ? 4000 : undefined;
  const measured = target.range !== undefined && target.rangeAt !== undefined && now - target.rangeAt < 120 ? target.range : undefined;
  const range = close ?? measured ?? (goodTma ? distance(s.pos, targetPosAt(solved!.sol, now)) : undefined);
  const since = m.attackFirst ?? target.firstSeen;
  const held = now - since;
  const seen = looked(target);
  const legs = legsRun(m.legStarts ?? [], plotFrom(pace, pf, since, now), now, pace.legS * pf);
  const settled = goodTma ? now - qs[target.label]! : 0;
  const wait = subWaits(pace, pf, { held, seen, legs, q: solved?.q, qMin, settled, range, maxRange: guard ? GUARD_FIRE_M : 8000, measured: measured !== undefined, close: close !== undefined });
  // Solution in hand but out of reach: close in on a narrower weave (the plot keeps its legs)
  const approach = wait === 'range' && range !== undefined;
  // Hunted: still slow legs across the line of sight while the plot needs them (pointing at the
  // target gives the TMA no range), then close in under the merchants' noise once it holds
  const plotting = wait === 'classify' || wait === 'legs' || wait === 'tma';
  s.order.heading = wrap360(target.bearing + (threatNear && !duel ? (plotting ? HUNTED_LEG_DEG : 8) : approach ? 20 : 40) * m.legSign);
  // Escorts about but nobody on to the boat (no loud ping, no escort close aboard): the plot needs
  // the merchants' noise, so it stays above the layer; hunted, it goes under
  const hunted = pinged || warships.some((t) => t.se > 32 || (t.range !== undefined && t.range < 3000));
  if (plotting && threatNear && !hunted && !radarDown && !peeking && !duel) s.order.depth = quietDepth;
  s.order.speedKn = threatNear ? (plotting && !duel ? HUNTED_LEG_KN : 3) : Math.round((range !== undefined && range < 6000 ? 4 : 6) * tr.speed * (w.env.adapt?.east?.fast ? 0.8 : 1));

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
    } else if (!peeking && !radarDown) m.peekUntil = now + PEEK_MAX_S;
  }
  // No range yet and no good TMA: a quick periscope look (surface targets only)
  if (range === undefined && !threatNear && !radarDown && target.se > 6 && now > m.peekAgain) {
    m.peekUntil = now + PEEK_MAX_S;
    m.peekAgain = now + 420 * tr.peek;
  }
  // Coming up for a look: slow enough for the mast
  if (now < m.peekUntil) s.order.speedKn = Math.min(s.order.speedKn, MAST_MAX_KN - 4);
  // Launch envelope: within reach of a shot, no deeper than the tubes fire (0.8 × test depth)
  const launchDeep = Math.floor(CLASSES[s.cls].maxDepth * LAUNCH_DEPTH_FRAC) - 5;
  if (range !== undefined && range < 10_000) s.order.depth = Math.min(s.order.depth, launchDeep);

  // A guarding boat holds fire while its own convoy or neutral traffic is near the target: the seeker would take them
  const rad = (target.bearing * Math.PI) / 180;
  const aimAt = range !== undefined ? { x: s.pos.x + Math.sin(rad) * range, y: s.pos.y + Math.cos(rad) * range } : undefined;
  const fouled = guard && !!aimAt && w.ships.some((x) => x.alive && x.id !== s.id && (x.team === s.team || x.team === 'neutral') && distance(x.pos, aimAt) < GUARD_CLEAR_M);
  // Outside the launch envelope (too fast, too deep) the boat slows and comes up first: no shot yet
  const envelope = !launchBlock(s.cls, s.speed / KN, s.depth);
  // A fast escort pinning the boat down gets a wake homer on her own plot and gates (wake-shot.ts);
  // the convoy attack keeps its target, plot and legs
  if (hunter && envelope && now - m.lastShot > SHOT_COOLDOWN && wakeAtHunter(w, m, s, hunter, { pace, pf, qMin, now })) return;
  // A warship the boat is attacking anyway (a guarding boat) running fast: a wake homer too
  const wakeShot = s.cls === 'ssn' && choice === 'warship' && !!solved && (w.weapons?.loadouts.get(s.id)?.wake ?? 0) > 0
    && (escortKn(target, solved.sol, now) ?? 0) > WAKE_SHOT_KN && (range ?? 0) >= WAKE_MIN_RANGE;
  if (wait === undefined && range !== undefined && !fouled && envelope && now - m.lastShot > SHOT_COOLDOWN) {
    // Long passive shots run slow (quieter, the seeker hears more without flow noise); long active
    // shots transit at 30 kn and sprint at 40 once the seeker opens (heavyPreset, F17)
    const mode = wakeShot ? 'wake' : duel ? 'active' : 'passive';
    // The wake sensor looks up from the start of its search: it must be awake before it crosses the trail
    // (a range from a rough solution may be long: at half of it the trail was already behind it)
    const enableAfter = wakeShot ? WAKE_ARM_M : Math.max(800, range * 0.6);
    const plan = heavyPreset(range, mode);
    const runKn = twoSpeedMeanKn(plan.transitKn, plan.speedKn, enableAfter, range);
    // Wake homer: aimed to cross the escort's track some way astern of her, then it turns up the trail
    const aimSol = solved && wakeShot ? astern(solved.sol, Math.min(1000, Math.max(300, range * 0.25))) : solved?.sol;
    const aim = aimSol ? interceptHeading(s.pos, runKn, aimSol, now) ?? target.bearing : target.bearing;
    // A guarding boat alternates two and one torpedo (arena, both sides mixed: always two 42:18, always one 18:42, alternating 38:22)
    const salvo = guard ? ((m.guardShots = (m.guardShots ?? 0) + 1) % 2 === 1 ? 2 : 1) : k.salvo;
    // One salvo, fanned by the target's length at that range and the TMA's error
    const spread = defaultSpreadDeg(range, solved ? Math.min(3, Math.max(1, (100 - solved.q) / 15)) : 2);
    const shot = fireSalvo(w, s, { heading: wrap360(aim), enableAfter, mode, searchDepth: duel ? Math.max(40, s.depth) : 15, ...plan }, salvo, spread);
    const fired = typeof shot === 'string' ? 0 : shot.length;
    if (fired) {
      traceShot({ t: now, shooter: s.id, team: s.team, weapon: 'torpedo', basis: close !== undefined ? 'close' : measured !== undefined ? 'measured' : 'tma', q: solved?.q, settled, range, held, span: spanOf(m, target.label, now), legs, mode, target: choice });
      m.lastShot = now;
      // Shoot and scoot: turn away, go deep, open the range
      m.evadeUntil = now + SCOOT_S;
      s.order = { heading: wrap360(target.bearing + 150 * m.legSign), speedKn: 8, depth: hide };
    }
  }
}

/** A lost contact found again within this long (s) and this close to its last bearing (deg) is the same ship. */
const REACQUIRE_S = 120;
const REACQUIRE_DEG = 8;
/** The captain stays on a contact that has dropped out for less than this (s). */
const KEEP_S = 120;

/** The plot of a relabelled contact carries over: its older bearings and the solution's settling time. */
export function carryPlot(m: BotMemory, from: string, to: string): void {
  const old = m.blog?.[from];
  if (old && m.blog) {
    const cur = m.blog[to];
    const first = cur?.fixes[0]?.t ?? Infinity;
    m.blog[to] = { fixes: [...old.fixes.filter((f) => f.t < first), ...(cur?.fixes ?? [])], binEnd: Math.max(old.binEnd, cur?.binEnd ?? -1e9), seen: Math.max(old.seen, cur?.seen ?? -1e9) };
  }
  const qs = m.qualSince;
  if (qs?.[from] !== undefined) qs[to] = Math.min(qs[to] ?? Infinity, qs[from]!);
  delete m.sols[to];
}

/** Time span of the captain's bearing plot on a contact (s). */
function spanOf(m: BotMemory, label: string, now: number): number {
  const f = m.blog?.[label]?.fixes;
  return f?.length ? now - f[0]!.t : 0;
}

/** Sectors of an all-round look at 1.5× (32° field each, a little overlap). */
const SWEEP_SECTORS = 12;

/**
 * The bot's periscope: like a player it sees only what the optic points at. With a contact it
 * looks at her at 6× every other second and sweeps the horizon in between (once round in 24 s);
 * without one it sweeps all round at 1.5× (twelve 30° sectors, once round in 12 s). Called every step.
 */
export function sweepScope(w: World, s: Ship): void {
  if (!mastRaised(s)) return;
  const now = w.time;
  const tick = Math.floor(now);
  const lead = (w.books.get(s.id)?.tracks() ?? [])
    .filter((t) => now - t.lastSeen < 30 && t.sensors.some((x) => x === 'hull' || x === 'towed' || x === 'periscope'))
    .sort((a, b) => b.se - a.se)[0];
  if (lead && tick % 2 === 0) {
    s.scope = { bearing: wrap360(lead.bearing), mag: 6 };
    return;
  }
  const sector = Math.floor(lead ? tick / 2 : tick) % SWEEP_SECTORS;
  s.scope = { bearing: wrap360(s.heading + (sector * 360) / SWEEP_SECTORS), mag: 1.5 };
}

/** A guarding boat's torpedo needs this much water free of friends and neutrals around its target (m). */
const GUARD_CLEAR_M = 3000;
/** A guarding boat holds its first shot until the target is this close (m). */
const GUARD_FIRE_M = 7500;
/** TMA quality points the nuclear boat may lack and still shoot. */
const SSN_TMA_RELIEF = 16;

function headingTo(s: Ship, r: { x: number; y: number; b: number }): number {
  // Steer for a point 12 km down the reported bearing from where it was reported
  const rad = (r.b * Math.PI) / 180;
  const p = { x: r.x + Math.sin(rad) * 12_000, y: r.y + Math.cos(rad) * 12_000 };
  return (Math.atan2(p.x - s.pos.x, p.y - s.pos.y) * 180) / Math.PI;
}

/**
 * The anchorage (harbour attack): charted in the briefing; once the boat holds ships at anchor in
 * its own contact book (periscope, radar: with range), the centre of what it plotted. Never truth.
 */
function anchorageOf(w: World, m: BotMemory, s: Ship): { x: number; y: number } | undefined {
  if (!w.ships.some((x) => x.cls === 'merchant')) return undefined;
  const held = anchored(w, m, s, 1800);
  if (!held.length) return HARBOUR_ANCHORAGE;
  const ps = held.map((t) => plotted(m, s, t));
  return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
}

/** Merchants in the boat's own book with a range (periscope, radar), seen within maxAge s. */
function anchored(w: World, m: BotMemory, s: Ship, maxAge: number): ContactTrack[] {
  return (w.books.get(s.id)?.tracks() ?? []).filter((t) => w.time - t.lastSeen < maxAge && t.range !== undefined &&
    (t.classified === 'merchant' || voted(m, t) === 'merchant') && !isNeutral(w, s, t, m));
}

/** Where a contact with a range lies, from where the boat was when it measured it. */
function plotted(m: BotMemory, s: Ship, t: ContactTrack): { x: number; y: number } {
  const at = [...m.track].reverse().find((f) => f.t <= (t.rangeAt ?? t.lastSeen) + 3) ?? s.pos;
  const v = headingVec(t.bearing);
  return { x: at.x + v.x * t.range!, y: at.y + v.y * t.range! };
}

/** Firing range into the anchorage (m): close enough for a fan of slow passive torpedoes. */
const HARBOUR_FIRE_M = 4200;

/**
 * Harbour attack: the anchorage is charted and the ships lie still. Run in deep and steady
 * (slower when escorts are close), then come up to periscope depth, take a look and fire a fan
 * at the nearest ship at anchor; between salvos hold off quietly. Returns false without targets.
 */
function harbourRun(w: World, m: BotMemory, s: Ship, threatNear: boolean, maxSafe: number, salvo: number): boolean {
  const anch = anchorageOf(w, m, s);
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
  // A short look through the periscope (slow, at periscope depth), then the fan at the nearest
  // ship at anchor the look found (or into the anchorage when it found none)
  s.order = { heading: toAnch, speedKn: 3, depth: PERISCOPE_DEPTH };
  s.mastUp = s.depth <= PERISCOPE_DEPTH + 0.5 && s.speed / KN <= MAST_MAX_KN;
  if (!s.mastUp) {
    m.peekUp = undefined;
    return true;
  }
  m.peekUp ??= now;
  const seen = anchored(w, m, s, 30).sort((a, b) => a.range! - b.range!)[0];
  if (!seen && now - m.peekUp < PEEK_LOOK_S) return true;
  const r = seen?.range ?? d;
  const brg = seen?.bearing ?? toAnch;
  const shot = fireSalvo(w, s, { heading: brg, enableAfter: Math.max(600, r * 0.7), mode: 'passive', searchDepth: 8, speedKn: 30 }, Math.max(2, salvo), 4);
  if (typeof shot !== 'string' && shot.length) {
    traceShot({ t: now, shooter: s.id, team: s.team, weapon: 'torpedo', basis: 'harbour', mode: 'passive', range: r, held: seen ? now - seen.firstSeen : undefined });
    m.lastShot = now;
    m.peekUp = undefined;
    s.mastUp = false;
  }
  return true;
}
