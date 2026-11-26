import { HELO_SPEED, bearing, depthAt, distance, heloOf, heloOrder, trackFix, type ContactTrack, type Ship, type Vec2, type World } from '@tk/shared';
import { isFriendly, traceShot, voted, type BotMemory } from './common.js';
import { commitHelo, heloCovered } from './escort-team.js';

/**
 * The AI escort's helicopter through the task queue (C11): dip-move-dip on the team datum (with a
 * buoy line across it), dip the ordered search sector, attack the latest fix of a held submarine
 * contact, and home when there is nothing to do.
 */

/** Spare fuel the AI wants before it starts a new task (s). */
const FUEL_MARGIN_S = 900;

/** Fuel for this point and home again, with a margin. */
function fuelFor(w: World, s: Ship, p: Vec2): boolean {
  const h = heloOf(w, s.id);
  if (!h) return false;
  if (h.state === 'deck') return w.time >= h.readyAt - 60;
  return h.fuel > (distance(h, p) + distance(p, s.pos)) / HELO_SPEED + FUEL_MARGIN_S;
}

/**
 * Prosecute a datum: the helicopter dips there (then moves on dip by dip, onto any echo), and lays
 * a buoy line across the line of sight when no buoys are near. Leaves it alone while it already
 * works that datum or holds a fresh echo of its own, and keeps off other helicopters' datums.
 */
export function heloProsecute(w: World, s: Ship, datum: Vec2): void {
  const h = heloOf(w, s.id);
  if (!h || heloCovered(w, s, datum) || !fuelFor(w, s, datum)) return;
  const cur = h.queue[0];
  if (cur?.kind === 'attack' || (cur?.kind === 'return' && h.state === 'air')) return;
  if (cur && (cur.kind === 'dip' || cur.kind === 'buoys') && distance(cur, datum) < 3500) {
    commitHelo(w, s, cur, 300);
    return;
  }
  if (h.fix && w.time - h.fix.t < 90) return;
  const axis = bearing(s.pos, datum);
  if (heloOrder(w, s, 'now', { kind: 'dip', at: datum, axis, count: 3 }) !== true) return;
  // Shallow water or a quiet boat that passive buoys can't hold: active (DICASS) buoys
  const shallow = depthAt(w.env.seabed, datum.x, datum.y) < 300;
  if (h.buoys >= 4 && (w.air?.buoys ?? []).every((b) => distance(b.pos, datum) > 3000)) {
    heloOrder(w, s, 'add', { kind: 'buoys', at: datum, axis: axis + 90, count: 4, active: shallow });
  }
  commitHelo(w, s, datum, 600);
}

/** Search an ordered sector: three dips across it when the helicopter has nothing else to do. */
export function heloSearch(w: World, s: Ship, sector: Vec2): void {
  const h = heloOf(w, s.id);
  if (!h || h.queue.some((t) => t.kind !== 'return') || heloCovered(w, s, sector) || !fuelFor(w, s, sector)) return;
  if (heloOrder(w, s, 'now', { kind: 'dip', at: sector, axis: bearing(s.pos, sector) + 90, count: 3 }) === true) commitHelo(w, s, sector, 600);
}

/**
 * Attack on a fix: the helicopter drops on the contact's latest held position (it follows the
 * track's newer fixes in flight). False if it cannot (none aboard, on deck being serviced).
 */
export function heloAttack(w: World, s: Ship, fix: Vec2, label?: string, off?: Vec2): boolean {
  const h = heloOf(w, s.id);
  if (!h || h.torps <= 0 || h.queue[0]?.kind === 'attack') return false;
  if (h.state === 'deck' && w.time < h.readyAt) return false;
  const ok = heloOrder(w, s, 'now', { kind: 'attack', at: fix, track: label, off }) === true;
  // The order, not the drop: the helicopter still has to fly there
  if (ok) traceShot({ t: w.time, shooter: s.id, team: s.team, weapon: 'helo', basis: label ? 'track' : 'fix', range: distance(s.pos, fix) });
  return ok;
}

/**
 * The own dipping sonar holds a submarine: attack its latest fix (a minute from the dip contact).
 * Only on a track the captain takes for a submarine and has localized (`ready`), never near own ships.
 */
export function heloOnDipContact(w: World, m: BotMemory, s: Ship, tracks: ContactTrack[], friends: Ship[], off: () => Vec2 | undefined, ready: (t: ContactTrack) => boolean = () => true): boolean {
  const h = heloOf(w, s.id);
  if (!h?.fix || w.time - h.fix.t > 30 || h.queue[0]?.kind !== 'dip' || h.torps <= 0) return false;
  const fix = h.fix;
  const t = tracks.find((x) => {
    if (voted(m, x) !== 'submarine' || isFriendly(w, s, x, m)) return false;
    const f = trackFix(w, s, x.label, 30);
    return !!f && distance(f.pos, fix) < 1500;
  });
  if (!t || !ready(t) || friends.some((f) => distance(f.pos, fix) < 3000)) return false;
  return heloAttack(w, s, fix, t.label, off());
}

/** Nothing left to do in the air: home to refuel. */
export function heloIdle(w: World, s: Ship): void {
  const h = heloOf(w, s.id);
  if (h?.state === 'air' && !h.queue.length) heloOrder(w, s, 'add', { kind: 'return' });
}
