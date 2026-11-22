import {
  isEscort,
  KN,
  bearing,
  depthAt,
  distance,
  dropXbt,
  headingVec,
  launchAswRocket,
  sendBuoy,
  sendDip,
  sendHeloTorpedo,
  callMpa,
  setTowedDecoy,
  targetPosAt,
  wrap360,
  type ContactTrack,
  type Ship,
  type Vec2,
  type World,
} from '@tk/shared';
import { SKILL, isFriendly, solveFor, voted, type BotMemory, type BotSkill } from './common.js';

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
export function thinkFrigate(w: World, m: BotMemory, s: Ship, skill: BotSkill): void {
  const now = w.time;
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
  s.towedLength = s.speed / KN > 14 ? 0 : hunting && Math.floor(now / 300) % 2 === 1 ? 1200 : 600;
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
  const leadB = target ? target.bearing : m.lead && now - m.lead.t < 900 ? m.lead.b : undefined;
  const prosecuting = leadB !== undefined && distance(s.pos, center) < PROSECUTE_MAX;
  s.activeSonar = now < m.alertUntil || prosecuting || now % 600 < SKILL[skill].pingDuty;

  if (prosecuting) {
    m.alertUntil = Math.max(m.alertUntil, now + 300);
    const solved = target ? solveFor(m, target, now) : undefined;
    const est = target?.range !== undefined && target.rangeAt !== undefined && now - target.rangeAt < 60
      ? target.range
      : solved && solved.q > 40 ? distance(s.pos, targetPosAt(solved.sol, now)) : 7000;
    // Buoy down the bearing; the helicopter is the fastest sensor
    const v = headingVec(leadB!);
    const drop = { x: s.pos.x + v.x * Math.min(est, 20_000), y: s.pos.y + v.y * Math.min(est, 20_000) };
    // Helicopter: alternate dipping sonar and buoys along the bearing
    const deep = (s.btLayer ?? 0) > 0;
    if (SKILL[skill].air && Math.floor(now / 400) % 2 === 0) sendDip(w, s, drop, deep && Math.floor(now / 800) % 2 === 1);
    else if (w.air?.buoys.every((b) => distance(b.pos, drop) > 3000)) sendBuoy(w, s, drop, deep);
    // A radio/transient lead far out: ask the patrol aircraft for a buoy line across it
    if (SKILL[skill].air && !target && m.lead && now - m.lead.t < 300) {
      const lv = headingVec(m.lead.b);
      callMpa(w, s, { x: m.lead.x + lv.x * 15_000, y: m.lead.y + lv.y * 15_000 }, m.lead.b);
    }
    s.order.heading = wrap360(leadB! + (est < 4000 ? 40 * m.legSign : 0));
    s.order.speedKn = est > 9000 ? 20 : 10;
    if (now > m.legUntil) {
      m.legSign = -m.legSign;
      m.legUntil = now + 120;
    }
  } else if (merchants.length) {
    // Screen ahead on a flank (escorts split left/right), weaving to clear the baffles
    const ahead = w.convoy ? headingVec(w.convoy.guideHeading) : { x: 0, y: 1 };
    const side = flankOf(w, s);
    const station = { x: center.x + ahead.x * 3000 + ahead.y * side * 3500, y: center.y + ahead.y * 3000 - ahead.x * side * 3500 };
    const to = bearing(s.pos, station);
    if (now > m.legUntil) {
      m.legSign = -m.legSign;
      m.legUntil = now + 180;
    }
    s.order.heading = distance(s.pos, station) > 2500 ? to : wrap360(to + 50 * m.legSign);
    s.order.speedKn = distance(s.pos, station) > 4000 ? 18 : 12;
  }

  if (now - m.lastShot < ROCKET_COOLDOWN / SKILL[skill].fireRate) return;
  const friends = w.ships.filter((f) => f.team === s.team && f.alive);
  // Weaker captains aim worse
  const err = SKILL[skill].aimErr;
  const scatter = (p: Vec2): Vec2 => (err ? { x: p.x + w.rng.gauss(0, err), y: p.y + w.rng.gauss(0, err) } : p);
  // A lightweight torpedo searches a wide circle: never fire near own ships
  const shoot = (aim: Vec2) => {
    if (friends.some((f) => distance(f.pos, aim) < 3000)) return false;
    const p = scatter(aim);
    if (launchAswRocket(w, s, p) !== true) return false;
    m.lastShot = now;
    return true;
  };
  for (const t of tracks) {
    const cls = voted(m, t);
    if (cls !== 'submarine' || isFriendly(w, s, t, m)) continue;
    // Aim at the echo itself, from where the ping went out
    const echo = [...t.history].reverse().find((h) => h.sensor === 'active' && h.r !== undefined && now - h.t < 30);
    if (echo) {
      const at = echo.ox !== undefined ? { x: echo.ox, y: echo.oy! } : [...m.track].reverse().find((f) => f.t <= echo.t + 3) ?? s.pos;
      const v = headingVec(echo.b);
      const fix = { x: at.x + v.x * echo.r!, y: at.y + v.y * echo.r! };
      if (shoot(fix)) return;
      // Out of rocket range or rockets gone: the helicopter delivers
      if (!friends.some((f) => distance(f.pos, fix) < 3000) && sendHeloTorpedo(w, s, scatter(fix)) === true) {
        m.lastShot = now;
        return;
      }
    }
    if (SKILL[skill].pack) {
      const fix = fixFromBuoy(t, s, m.track);
      if (fix && distance(s.pos, fix) < 12_000 && shoot(fix)) return;
    }
  }
}
