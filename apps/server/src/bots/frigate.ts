import {
  isEscort,
  KN,
  bearing,
  depthAt,
  distance,
  dropXbt,
  headingVec,
  launchAswRocket,
  callMpa,
  setTowedDecoy,
  targetPosAt,
  wrap360,
  type ContactTrack,
  type Ship,
  type Vec2,
  type World,
  TRAITS,
  commanderTrait,
  knownMines,
  steerClear,
  CLASSES,
  angleDiff,
  dropDepthCharge,
  MORTAR_MAX,
  MORTAR_MIN,
  ROCKET_MIN_RANGE,
} from '@tk/shared';
import { STRAIT_GUARD_Y } from '../scenario.js';
import { SKILL, isFriendly, solveFor, traceShot, vary, voted, type BotMemory, type BotSkill } from './common.js';
import { thinkStrike } from './strike.js';
import { convoyEstimate } from './convoy-estimate.js';
import { directorCourse, type EscortTask } from './escort-team.js';
import { heloAttack, heloIdle, heloOnDipContact, heloProsecute, heloSearch } from './helo.js';
import { wantMineAvoid } from './mine-cm.js';
import { PACE, activeFixes, captainPace, escortMayFire } from './pacing.js';

const ROCKET_COOLDOWN = 90;
const PROSECUTE_MAX = 16_000; // m from the convoy: beyond that, return to the screen

/** Escorts alternate between the starboard (+1) and port (-1) flank of the convoy. */
function flankOf(w: World, s: Ship): number {
  const escorts = w.ships.filter((x) => x.team === s.team && isEscort(x.cls)).map((x) => x.id).sort();
  return escorts.indexOf(s.id) % 2 === 0 ? 1 : -1;
}

/** Intersection of two bearing lines (cross-fix), if they cross at a useful angle. */
export function crossFix(a: Vec2, ba: number, b: Vec2, bb: number): Vec2 | undefined {
  const da = headingVec(ba);
  const db = headingVec(bb);
  const den = da.x * db.y - da.y * db.x;
  if (Math.abs(den) < Math.sin((15 * Math.PI) / 180)) return undefined;
  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / den;
  if (t < 200 || t > 30_000) return undefined;
  return { x: a.x + da.x * t, y: a.y + da.y * t };
}

/** Fix from the latest own-ship bearing and the latest buoy bearing on the same contact. */
function fixFromBuoy(t: ContactTrack, s: Ship, track: { t: number; x: number; y: number }[]): Vec2 | undefined {
  const buoy = [...t.history].reverse().find((h) => h.ox !== undefined && h.alt === undefined);
  const own = [...t.history].reverse().find((h) => h.ox === undefined && h.alt === undefined);
  if (!buoy || !own || Math.abs(buoy.t - own.t) > 60) return undefined;
  const at = track.find((f) => Math.abs(f.t - own.t) < 5) ?? { x: s.pos.x, y: s.pos.y };
  return crossFix(at, own.b, { x: buoy.ox!, y: buoy.oy! }, buoy.b);
}

/**
 * Escort captain: screens ahead of the convoy, measures the layer, streams the towed
 * array where the boats are, prosecutes submarine contacts and leads (ESM, transients)
 * with sprint, buoys and active sonar, and fires on active fixes or buoy cross-fixes.
 */
export function thinkFrigate(w: World, m: BotMemory, s: Ship, skill: BotSkill, task?: EscortTask): void {
  const now = w.time;
  const tr = TRAITS[commanderTrait(s.id, w.env.seed ?? 0)];
  if (now < m.evadeUntil) return;
  if (m.evadeUntil > 0) {
    m.evadeUntil = 0;
    setTowedDecoy(w, s, false);
  }
  if (!m.xbtDone) {
    m.xbtDone = true;
    dropXbt(w, s);
  }
  const bottom = depthAt(w.env.seabed, s.pos.x, s.pos.y);
  // Array above the layer (where boats listen) by default; deep when a contact went quiet below it
  const hunting = now < m.alertUntil && s.btLayer !== undefined && bottom > 400;
  // The winch takes minutes: stream once and keep it out (deaf above its speed limit), go deep only on a long hunt
  s.towedOrder = hunting && Math.floor(now / 900) % 2 === 1 ? 1200 : 900;
  s.pulse = bottom < 300 ? 'lfm' : 'cw';

  const merchants = w.ships.filter((x) => x.team === s.team && x.cls === 'merchant' && x.alive);
  const center = merchants.length
    ? { x: merchants.reduce((a, x) => a + x.pos.x, 0) / merchants.length, y: merchants.reduce((a, x) => a + x.pos.y, 0) / merchants.length }
    : s.pos;

  const tracks = w.books.get(s.id)?.tracks() ?? [];
  const subs = tracks
    .filter((t) => now - t.lastSeen < 30 && !t.sensors.includes('esm') && !isFriendly(w, s, t, m))
    .filter((t) => {
      const c = voted(m, t);
      return c === 'submarine' || (c === undefined && (t.evidence?.tonals.length ?? 0) <= 1 && t.se < 14);
    })
    .sort((a, b) => b.se - a.se);
  const esm = tracks.filter((t) => t.sensors.includes('esm') && now - t.lastSeen < 600).pop();
  if (esm && (!m.lead || now - m.lead.t > 120)) m.lead = { x: s.pos.x, y: s.pos.y, b: esm.bearing, t: now };
  const target = subs[0];
  // An ordered or heard datum goes before an old lead of the own
  const leadB = target ? target.bearing : m.lead && now - m.lead.t < 900 && !task?.datum ? m.lead.b : undefined;
  // Team datum and role (escort-team.ts); without a task the ship acts alone
  const plan = w.env.hunt?.[s.team as 'west' | 'east'];
  const datum = task?.datum ? { ...task.datum, t: now, q: 50, by: s.id } : plan?.datum && now - plan.datum.t < 600 ? plan.datum : undefined;
  // Helicopter sent somewhere (commander's order, pounce on a far datum, a heard launch): it dips there, the ship keeps its task
  if (task?.helo && SKILL[skill].air) heloProsecute(w, s, task.helo);
  const role = task?.role;
  const prosecuting = task ? role !== 'screen' && (leadB !== undefined || !!datum) : leadB !== undefined && distance(s.pos, center) < PROSECUTE_MAX;
  const learned = w.env.adapt?.west;
  s.activeSonar = role === 'attacker' ? false : role === 'director' || now < m.alertUntil || prosecuting || now % 600 < SKILL[skill].pingDuty * tr.ping * (learned?.fast ? SKILL[skill].learnPing : 1);
  // Range scale (sets the ping interval): the long search scale, shorter and faster as the contact closes
  const near = target?.range !== undefined && target.rangeAt !== undefined && now - target.rangeAt < 120 ? target.range : datum ? distance(s.pos, datum) : Infinity;
  s.pingRange = near < 3000 ? 4000 : near < 7000 ? 8000 : 16_000;
  // Learned: boats that like periscope depth get radar sweeps a third of the time
  if (learned?.pd) s.radarOn = now % 600 < SKILL[skill].learnRadarS;
  // Raid warning (launch flash, ESM on the seeker): radar on for the air defence while rounds fly
  if (w.env.ssm?.missiles.some((x) => !x.done && x.team !== s.team && distance(x.pos, s.pos) < 30_000)) s.radarOn = true;

  // The hunt's clock: unbroken prosecution (a lapse of five minutes starts it again)
  if (prosecuting) {
    if (m.huntSince === undefined || now - (m.huntSeen ?? -1e9) > 300) m.huntSince = now;
    m.huntSeen = now;
    m.alertUntil = Math.max(m.alertUntil, now + 300 * tr.hunt);
    const solved = target ? solveFor(m, target, now) : undefined;
    const est = target?.range !== undefined && target.rangeAt !== undefined && now - target.rangeAt < 60
      ? target.range
      : solved && solved.q > 40 ? distance(s.pos, targetPosAt(solved.sol, now)) : 7000;
    // Buoy down the bearing; the helicopter is the fastest sensor
    const v = headingVec(leadB ?? bearing(s.pos, datum!));
    // The team's best datum first; otherwise down the own bearing
    const drop = datum && task ? { x: datum.x, y: datum.y } : { x: s.pos.x + v.x * Math.min(est, 20_000), y: s.pos.y + v.y * Math.min(est, 20_000) };
    // Helicopter: dip-move-dip on the datum with a buoy line across it; never two helicopters on
    // the same datum, and the silent attacker keeps its helicopter for the torpedo
    if (role !== 'attacker' && SKILL[skill].air) heloProsecute(w, s, drop);
    // A radio/transient lead far out and nothing better: ask the patrol aircraft for a buoy line across it
    if (SKILL[skill].air && !target && !datum && m.lead && now - m.lead.t < 300 && now - (plan?.mpaAt ?? -1e9) > 1800) {
      const lv = headingVec(m.lead.b);
      if (callMpa(w, s, { x: m.lead.x + lv.x * 15_000, y: m.lead.y + lv.y * 15_000 }, m.lead.b) === true && plan) plan.mpaAt = now;
    }
    if (role === 'director' && datum) Object.assign(s.order, directorCourse(s, datum, m.legSign));
    else if (role === 'attacker' && datum) {
      // Creeping attack: slow and silent on the director's datum, towed array streamed
      const r = distance(s.pos, datum);
      s.order.heading = bearing(s.pos, datum);
      s.order.speedKn = r > 9000 ? 14 : 6;
    } else {
      s.order.heading = wrap360((leadB ?? bearing(s.pos, datum!)) + (est < 4000 ? 30 * m.legSign : 0));
      s.order.speedKn = est > 9000 ? 20 : 10;
    }
    if (now > m.legUntil) {
      m.legSign = -m.legSign;
      m.legUntil = now + Math.round(240 * (1 + vary(skill, s.id, w.env.seed ?? 0, Math.round(now))));
    }
  } else if (!merchants.length && s.team === 'east') {
    // Ostpakt patrol ship: sweep ahead of its own wolfpack toward the convoy, drawing the escorts
    // and hunting their boat; it keeps the pack's position from fleet command (truth for own boats),
    // and the convoy only as its radar or the reconnaissance report places it (convoy-estimate.ts)
    const pack = w.ships.filter((x) => x.alive && x.team === s.team && CLASSES[x.cls].submarine);
    const mid = (l: Ship[]) => ({ x: l.reduce((a, x) => a + x.pos.x, 0) / l.length, y: l.reduce((a, x) => a + x.pos.y, 0) / l.length });
    const home = pack.length ? mid(pack) : s.pos;
    const est = convoyEstimate(w, m, s, tracks);
    const toward = est ? headingVec(bearing(home, est)) : headingVec(180);
    const station = { x: home.x + toward.x * 5000, y: home.y + toward.y * 5000 };
    if (now > m.legUntil) {
      m.legSign = -m.legSign;
      m.legUntil = now + 360;
    }
    const to = bearing(s.pos, station);
    s.order.heading = distance(s.pos, station) > 3000 ? to : wrap360(to + 60 * m.legSign);
    s.order.speedKn = distance(s.pos, station) > 5000 ? 18 : 12;
  } else if (merchants.length) {
    // Screen ahead on a flank (escorts split left/right), weaving to clear the baffles
    const ahead = w.convoy ? headingVec(w.convoy.baseHeading ?? w.convoy.guideHeading) : { x: 0, y: 1 };
    const side = flankOf(w, s);
    const station = task?.station ?? { x: center.x + ahead.x * 4000 + ahead.y * side * 4000, y: center.y + ahead.y * 4000 - ahead.x * side * 4000 };
    // Fleet command's sector: the helicopter dips it when the ship stays with the convoy
    const sector = task?.search;
    if (sector && SKILL[skill].air) heloSearch(w, s, sector);
    const to = bearing(s.pos, station);
    if (now > m.legUntil) {
      m.legSign = -m.legSign;
      // Long straight legs: the towed array needs a minute of steady course after every turn
      m.legUntil = now + Math.round(360 * (1 + vary(skill, s.id, w.env.seed ?? 0, Math.round(now))));
    }
    s.order.heading = distance(s.pos, station) > 2500 ? to : wrap360(to + 30 * m.legSign);
    s.order.speedKn = distance(s.pos, station) > 4000 ? 18 : 12;
  } else if (w.env.mission === 'meerenge') {
    // Guard the narrows: long legs across the channel around the guard line
    const station = { x: flankOf(w, s) * 1200, y: STRAIT_GUARD_Y };
    if (task?.search && SKILL[skill].air) heloSearch(w, s, task.search);
    if (now > m.legUntil) {
      m.legSign = -m.legSign;
      m.legUntil = now + 360;
    }
    s.order.heading = distance(s.pos, station) > 3000 ? bearing(s.pos, station) : m.legSign > 0 ? 80 : 260;
    s.order.speedKn = 8;
  }

  // Missile-armed patrol ship: the strike on the convoy overrides the sweep (stand-off and fire)
  if (!merchants.length && s.team === 'east') thinkStrike(w, s, tracks, convoyEstimate(w, m, s, tracks));
  // Mine-avoidance sonar wherever mines can lie, unless sprinting (it only hears up to 15 kn)
  s.mineAvoid = wantMineAvoid(w, s);
  // Known mines close ahead: turn clear of them (the escort sets them off like any hull)
  const mines = knownMines(w, s.team);
  if (mines.length) s.order.heading = steerClear(s.pos, s.order.heading, mines, 1500, 300);

  const friends = w.ships.filter((f) => f.team === s.team && f.alive);
  // Weaker captains aim worse
  const err = SKILL[skill].aimErr;
  const aimOff = (): Vec2 | undefined => (err ? { x: w.rng.gauss(0, err), y: w.rng.gauss(0, err) } : undefined);
  // Localize before a weapon goes (pacing.ts): held long enough, repeated fixes
  const pace = PACE[skill];
  const pf = captainPace(s.id, w.env.seed ?? 0, commanderTrait(s.id, w.env.seed ?? 0));
  const ready = (basis: 'echo' | 'buoy' | 'datum' | 'dip', t?: ContactTrack) =>
    escortMayFire(pace, pf, basis, t ? now - t.firstSeen : now - (m.huntSince ?? now), t ? activeFixes(t, now) : 0);
  // The own dipping sonar holds the boat: the helicopter attacks its latest fix; idle, it comes home
  heloOnDipContact(w, m, s, tracks, friends, aimOff, (t) => ready('dip', t));
  heloIdle(w, s);

  if (now - m.lastShot < ROCKET_COOLDOWN / SKILL[skill].fireRate) return;
  const scatter = (p: Vec2): Vec2 => (err ? { x: p.x + w.rng.gauss(0, err), y: p.y + w.rng.gauss(0, err) } : p);
  // A lightweight torpedo searches a wide circle: never fire near own ships
  // Inside the rocket's minimum range: turn the bow on the datum and throw a mortar salvo once
  // it lies 400–800 m ahead (fused below the measured layer, or at 60 m without one)
  const mortar = (aim: Vec2, basis: string, held?: number) => {
    const r = distance(s.pos, aim);
    const brg = bearing(s.pos, aim);
    s.order.heading = brg;
    if (r < MORTAR_MIN || r > MORTAR_MAX || Math.abs(angleDiff(s.heading, brg)) > 10) return false;
    if (friends.some((f) => f.id !== s.id && distance(f.pos, aim) < 600)) return false;
    if (dropDepthCharge(w, s, s.btLayer ? s.btLayer + 30 : 60) !== true) return false;
    traceShot({ t: now, shooter: s.id, team: s.team, weapon: 'mortar', basis, range: r, held });
    m.lastShot = now;
    return true;
  };
  const shoot = (aim: Vec2, basis: string, held?: number) => {
    if (distance(s.pos, aim) < ROCKET_MIN_RANGE) return mortar(aim, basis, held);
    if (friends.some((f) => distance(f.pos, aim) < 3000)) return false;
    const p = scatter(aim);
    if (launchAswRocket(w, s, p) !== true) return false;
    traceShot({ t: now, shooter: s.id, team: s.team, weapon: 'rocket', basis, range: distance(s.pos, aim), held });
    m.lastShot = now;
    return true;
  };
  // Hunter-killer: the attacker fires on the director's fresh echo datum; the director holds
  // fire while an attacker with rockets is on the team
  if (role === 'attacker' && datum && datum.by !== s.id && now - datum.t < 40 && datum.q >= 85 && ready('datum')) {
    if (shoot(datum, 'datum')) return;
    // Out of rocket range or rockets gone: the attacker's helicopter drops on the datum
    if (!friends.some((f) => distance(f.pos, datum) < 3000) && heloAttack(w, s, datum, undefined, aimOff())) {
      m.lastShot = now;
      return;
    }
  }
  const att = plan?.attacker && w.ships.find((x) => x.id === plan.attacker && x.alive);
  if (role === 'director' && att && (w.weapons?.loadouts.get(att.id)?.rockets ?? 0) > 0 && distance(att.pos, datum ?? att.pos) < 18_000) return;
  for (const t of tracks) {
    const cls = voted(m, t);
    if (cls !== 'submarine' || isFriendly(w, s, t, m)) continue;
    // Aim at the echo itself, from where the ping went out
    const echo = [...t.history].reverse().find((h) => h.sensor === 'active' && h.r !== undefined && now - h.t < 30);
    if (echo && ready('echo', t)) {
      const at = echo.ox !== undefined ? { x: echo.ox, y: echo.oy! } : [...m.track].reverse().find((f) => f.t <= echo.t + 3) ?? s.pos;
      const v = headingVec(echo.b);
      const fix = { x: at.x + v.x * echo.r!, y: at.y + v.y * echo.r! };
      if (shoot(fix, 'echo', now - t.firstSeen)) return;
      // Out of rocket range or rockets gone: the helicopter delivers
      if (!friends.some((f) => distance(f.pos, fix) < 3000) && heloAttack(w, s, fix, t.label, aimOff())) {
        m.lastShot = now;
        return;
      }
    }
    if (SKILL[skill].pack && ready('buoy', t)) {
      const fix = fixFromBuoy(t, s, m.track);
      if (fix && distance(s.pos, fix) < 12_000 && shoot(fix, 'buoy', now - t.firstSeen)) return;
    }
  }
}
