import { CLASSES, isEscort, type Team } from './classes.js';
import type { Ship } from './entities.js';
import { KN, angleDiff, bearing, clamp, distance, headingVec, wrap360, type Vec2 } from './math.js';
import { depthAt } from './seabed.js';
import { weaponHit } from './weapons.js';
import type { World } from './world.js';

/**
 * Naval influence mines, laid by submarines through their torpedo tubes. Shallow water
 * only: on the seabed down to 60 m, moored at a set depth down to 300 m. A ship whose
 * magnetic/acoustic signature comes within the trigger radius sets it off — any ship,
 * own side, neutral and convoy alike. Escorts find them with the high-frequency
 * mine-avoidance mode of their active sonar at short range, ahead of the bow; known
 * mines are shared over the datalink and the convoy steers clear of them.
 */

export interface Mine {
  id: string;
  ownerId: string;
  team: Team;
  pos: Vec2;
  depth: number;
  bottom: boolean;
  laidAt: number;
  armedAt: number;
  /** Teams that know where it lies (its own side always does). */
  known: Team[];
}

export interface MineState {
  mines: Mine[];
  nextId: number;
  lastLay: Record<string, number>;
  detectAccum: number;
}

export const MINE_MIN_WATER = 25;
export const MINE_MAX_WATER = 300;
/** Down to this water depth a mine lies on the seabed; deeper it is moored at MOORED_DEPTH. */
export const MINE_BOTTOM_MAX = 60;
export const MOORED_DEPTH = 10;
export const MINE_ARM_S = 180;
export const MINE_LAY_MAX_KN = 8;
export const MINE_LAY_INTERVAL_S = 30;
/** Mine-avoidance sonar: range against a moored mine ahead (m) and its sector (±deg). */
export const MINE_DETECT_M = 1000;
export const MINE_DETECT_SECTOR = 70;

export function mineStateOf(w: World): MineState {
  return (w.env.mines ??= { mines: [], nextId: 1, lastLay: {}, detectAccum: 0 });
}

/** Mines left aboard. */
export function minesLeft(w: World, s: Ship): number {
  return w.weapons?.loadouts.get(s.id)?.mines ?? 0;
}

/** Influence radius (m): a big hull's magnetic and acoustic signature reaches further. */
export function triggerRadius(s: Ship): number {
  return clamp(30 + 12 * Math.log10(Math.max(10, CLASSES[s.cls].tonnage) / 100), 25, 90);
}

/** Lay a mine where the boat is. Uses a tube for one reload cycle (a loaded torpedo waits); the coastal boat uses its mine belt. */
export function layMine(w: World, s: Ship): true | string {
  const spec = CLASSES[s.cls];
  const l = w.weapons?.loadouts.get(s.id);
  if (!s.alive || !spec.submarine || !l) return 'Nur U-Boote legen Minen';
  if (!l.mines) return 'Keine Minen an Bord';
  if (w.env.weaponsTight === s.team) return 'Waffen gesperrt: Fühlung halten, nicht schießen';
  if (s.speed / KN > MINE_LAY_MAX_KN + 0.3) return `Minen nur bis ${MINE_LAY_MAX_KN} kn legen`;
  const water = depthAt(w.env.seabed, s.pos.x, s.pos.y);
  if (water > MINE_MAX_WATER) return `Wasser zu tief für Minen (${Math.round(water)} m, max. ${MINE_MAX_WATER} m)`;
  if (water < MINE_MIN_WATER) return 'Wasser zu flach';
  const st = mineStateOf(w);
  if (w.time - (st.lastLay[s.id] ?? -1e9) < MINE_LAY_INTERVAL_S) return 'Rohr wird noch klargemacht';
  // Through a tube: prefer an empty, idle one; else a loaded one (its torpedo is reloaded afterwards).
  // The coastal boat drops them from its external mine belt instead
  if (s.cls !== 'ssc') {
    const tube = l.tubes.find((t) => !t.loaded && t.reloadDoneAt === 0) ?? l.tubes.find((t) => t.loaded) ?? l.tubes[0];
    if (!tube) return 'Kein Rohr';
    if (tube.loaded) {
      tube.loaded = false;
      tube.reloadDoneAt = w.time + l.reloadTime;
    } else if (tube.reloadDoneAt > 0) tube.reloadDoneAt += MINE_LAY_INTERVAL_S;
  }
  l.mines -= 1;
  st.lastLay[s.id] = w.time;
  const bottom = water <= MINE_BOTTOM_MAX;
  st.mines.push({
    id: `M${st.nextId++}`, ownerId: s.id, team: s.team, pos: { ...s.pos }, bottom, depth: bottom ? water : MOORED_DEPTH,
    laidAt: w.time, armedAt: w.time + MINE_ARM_S, known: [s.team],
  });
  w.events.push({ kind: 'transient', time: w.time, sourceId: s.id, x: s.pos.x, y: s.pos.y, what: 'flood' });
  return true;
}

/** Range at which an escort's mine-avoidance sonar finds this mine (0 = not now). */
export function mineDetectRange(w: World, s: Ship, m: Mine): number {
  if (!s.alive || !isEscort(s.cls) || !s.activeSonar) return 0;
  const kn = s.speed / KN;
  const flow = kn > 18 ? 0.5 : 1;
  const sea = 1 - 0.06 * w.env.seaState;
  return MINE_DETECT_M * flow * sea * (m.bottom ? 0.6 : 1);
}

function detonate(w: World, m: Mine, s: Ship, r3: number, reach: number): void {
  w.events.push({ kind: 'mine', time: w.time, what: 'detonated', mineId: m.id, team: m.team as 'west' | 'east', shipId: s.id, x: m.pos.x, y: m.pos.y });
  w.events.push({ kind: 'transient', time: w.time, sourceId: m.id, x: m.pos.x, y: m.pos.y, what: 'mine' });
  weaponHit(w, s, r3 < reach * 0.5 ? 90 : 55, m.ownerId);
}

/** World system: triggers armed mines, and lets escorts find them with active sonar. */
export function mineSystem(w: World, dt: number): void {
  const st = w.env.mines;
  if (!st?.mines.length) return;
  const gone = new Set<Mine>();
  for (const m of st.mines) {
    if (w.time < m.armedAt) continue;
    for (const s of w.ships) {
      if (!s.alive) continue;
      const dx = distance(s.pos, m.pos);
      const reach = triggerRadius(s);
      if (dx > reach) continue;
      const r3 = Math.hypot(dx, s.depth - m.depth);
      if (r3 > reach) continue;
      detonate(w, m, s, r3, reach);
      gone.add(m);
      break;
    }
  }
  if (gone.size) st.mines = st.mines.filter((m) => !gone.has(m));
  st.detectAccum += dt;
  if (st.detectAccum < 1) return;
  st.detectAccum = 0;
  for (const s of w.ships) {
    if (!s.alive || !s.activeSonar || !isEscort(s.cls)) continue;
    for (const m of st.mines) {
      if (m.known.includes(s.team)) continue;
      const d = distance(s.pos, m.pos);
      if (d > mineDetectRange(w, s, m) || Math.abs(angleDiff(s.heading, bearing(s.pos, m.pos))) > MINE_DETECT_SECTOR) continue;
      if (w.rng.next() > 0.35) continue;
      m.known.push(s.team);
      w.events.push({ kind: 'mine', time: w.time, what: 'detected', mineId: m.id, team: s.team as 'west' | 'east', shipId: s.id, x: m.pos.x, y: m.pos.y });
    }
  }
  // The convoy is routed around the mines its escorts know of
  if (w.convoy) {
    const team = w.ships.find((s) => s.cls === 'merchant')?.team;
    w.convoy.hazards = team ? knownMines(w, team) : [];
  }
}

/** Positions of the mines a team knows of. */
export function knownMines(w: World, team: Team): Vec2[] {
  return (w.env.mines?.mines ?? []).filter((m) => m.known.includes(team)).map((m) => m.pos);
}

/**
 * Mine avoidance: if a hazard lies close ahead on the intended heading, turn off to the side
 * that clears it; otherwise keep the heading.
 */
export function steerClear(pos: Vec2, heading: number, hazards: Vec2[], look = 1500, clear = 400): number {
  let worst: { side: number; urgency: number } | undefined;
  const v = headingVec(heading);
  for (const h of hazards) {
    const dx = h.x - pos.x;
    const dy = h.y - pos.y;
    const along = dx * v.x + dy * v.y;
    if (along < -clear || along > look) continue;
    const across = dx * v.y - dy * v.x; // + = hazard to starboard
    if (Math.abs(across) > clear) continue;
    const urgency = (clear - Math.abs(across)) / clear + (look - Math.max(0, along)) / look;
    if (!worst || urgency > worst.urgency) worst = { side: across >= 0 ? -1 : 1, urgency };
  }
  return worst ? wrap360(heading + worst.side * clamp(25 + worst.urgency * 20, 25, 60)) : heading;
}

export interface MineView {
  id: string;
  x: number;
  y: number;
  depth: number;
  bottom: boolean;
  /** Laid by the own boat (otherwise found by own or datalinked sonar). */
  own: boolean;
  armed: boolean;
}

/** Mines on a ship's plot: a boat sees the ones it laid, escorts the ones their side detected. */
export function minesFor(w: World, own: Ship): MineView[] {
  const sub = CLASSES[own.cls].submarine;
  return (w.env.mines?.mines ?? [])
    .filter((m) => (sub ? m.ownerId === own.id : m.known.includes(own.team) && m.team !== own.team))
    .map((m) => ({ id: m.id, x: Math.round(m.pos.x), y: Math.round(m.pos.y), depth: Math.round(m.depth), bottom: m.bottom, own: m.ownerId === own.id, armed: w.time >= m.armedAt }));
}
