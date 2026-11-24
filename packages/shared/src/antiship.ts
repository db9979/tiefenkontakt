import { SAM_SPECS, airDefOf, samsLeft } from './airdef.js';
import { CLASSES, isEscort, type ClassId, type Team } from './classes.js';
import { weaponsBroken } from './damage.js';
import type { Ship } from './entities.js';
import { lineOfSight } from './terrain.js';
import { angleDiff, bearing, distance, headingVec, type Vec2 } from './math.js';
import { weaponHit } from './weapons.js';
import type { World } from './world.js';

/**
 * Ship-launched anti-ship missiles (sea skimmers, P-15/Termit era): the Ostpakt's patrol ship
 * carries them so it can strike the convoy itself instead of only hunting submarines. The missile
 * flies a straight leg to the aim point, switches on its radar seeker for the last stretch and
 * homes on the biggest surface echo in its cone, whoever that belongs to. Escorts defend
 * automatically: their surface-to-air missiles (radar on) and the guns as a last ditch.
 * Values are era-plausible game balance.
 */
export interface SsmSpec {
  name: string;
  magazine: number;
  minRange: number;
  maxRange: number;
  /** Cruise speed (m/s). */
  speedMs: number;
  /** Radar seeker: switch-on distance before the aim point, reach and half cone. */
  seekerOn: number;
  seekerRange: number;
  seekerHalf: number;
  damage: number;
  /** Seconds between two rounds from the launchers. */
  cycleS: number;
}

export const SSM_SPECS: Partial<Record<ClassId, SsmSpec>> = {
  ffk: { name: 'Seeziel-FK P-12 (zwei Vierfachstarter)', magazine: 8, minRange: 6000, maxRange: 40_000, speedMs: 290, seekerOn: 9000, seekerRange: 11_000, seekerHalf: 22, damage: 55, cycleS: 4 },
};

/** Point defence: SAM engagement window and the guns' last-ditch range. */
const SAM_SHOT_M = 9000;
const GUN_M = 2000;
const SAM_PK_SKIMMER = 0.25;
const GUN_PK = 0.12;
/** Seconds a gun mount needs to shift to the next round. */
const GUN_CYCLE_S = 8;
const HIT_M = 60;

export interface Ssm {
  id: string;
  ownerId: string;
  team: Team;
  pos: Vec2;
  heading: number;
  aim: Vec2;
  launchedAt: number;
  flown: number;
  maxFlight: number;
  targetId?: string;
  /** Defenders that already fired at this round (one SAM and one gun burst each). */
  samBy?: string[];
  gunBy?: string[];
  done?: 'hit' | 'miss' | 'shot';
  doneAt?: number;
  hitId?: string;
}

export interface SsmState {
  missiles: Ssm[];
  nextId: number;
  lastShot: Record<string, number>;
  /** Rounds fired per ship (magazine). */
  fired: Record<string, number>;
}

export function ssmOf(w: World): SsmState {
  return (w.env.ssm ??= { missiles: [], nextId: 1, lastShot: {}, fired: {} });
}

export function ssmLeft(w: World, s: Ship): number {
  const spec = SSM_SPECS[s.cls];
  return spec ? spec.magazine - (w.env.ssm?.fired[s.id] ?? 0) : 0;
}

/** Fire one round at a sea position (from the ship's own picture). */
export function fireSsm(w: World, ship: Ship, aim: Vec2): true | string {
  const spec = SSM_SPECS[ship.cls];
  if (!spec) return 'Keine Seezielflugkörper an Bord';
  if (!ship.alive) return 'Schiff kann nicht feuern';
  if (weaponsBroken(ship)) return 'Waffenanlage ausgefallen';
  if (w.env.weaponsTight === ship.team) return 'Waffen gesperrt';
  if (ssmLeft(w, ship) <= 0) return 'Starter leer';
  const st = ssmOf(w);
  const wait = spec.cycleS - (w.time - (st.lastShot[ship.id] ?? -1e9));
  if (wait > 0) return `Starter lädt nach · ${Math.ceil(wait)} s`;
  const r = distance(ship.pos, aim);
  if (r < spec.minRange) return `Ziel zu nah · mindestens ${spec.minRange / 1000} km`;
  if (r > spec.maxRange) return `Ziel zu weit · höchstens ${spec.maxRange / 1000} km`;
  st.lastShot[ship.id] = w.time;
  st.fired[ship.id] = (st.fired[ship.id] ?? 0) + 1;
  st.missiles.push({
    id: `M${st.nextId++}`, ownerId: ship.id, team: ship.team, pos: { ...ship.pos }, heading: bearing(ship.pos, aim), aim: { ...aim },
    launchedAt: w.time, flown: 0, maxFlight: r + spec.seekerRange,
  });
  w.events.push({ kind: 'weapon', time: w.time, sourceId: ship.id, what: 'ssm' });
  w.events.push({ kind: 'transient', time: w.time, sourceId: ship.id, x: ship.pos.x, y: ship.pos.y, what: 'launch' });
  return true;
}

/** Radar echo size of a surface ship (bigger hulls win the seeker). */
function echo(s: Ship): number {
  return CLASSES[s.cls].tonnage;
}

function seek(w: World, m: Ssm, spec: SsmSpec): Ship | undefined {
  let best: Ship | undefined;
  let score = 0;
  for (const s of w.ships) {
    if (!s.alive || s.id === m.ownerId || CLASSES[s.cls].submarine) continue;
    const r = distance(m.pos, s.pos);
    if (r > spec.seekerRange || r < 1) continue;
    if (Math.abs(angleDiff(m.heading, bearing(m.pos, s.pos))) > spec.seekerHalf) continue;
    if (!lineOfSight(w.env.seabed, m.pos, 5, s.pos, 10)) continue;
    const sc = echo(s) / r;
    if (sc > score) {
      score = sc;
      best = s;
    }
  }
  return best;
}

/** Escorts in reach shoot at the incoming round: one SAM each (radar on), then the guns. */
function defend(w: World, m: Ssm): boolean {
  for (const d of w.ships) {
    if (!d.alive || d.team === m.team || d.team === 'neutral' || !isEscort(d.cls) || weaponsBroken(d)) continue;
    const r = distance(d.pos, m.pos);
    const sam = SAM_SPECS[d.cls];
    // One launcher: a salvo saturates it (the same cycle as against aircraft)
    const ad = airDefOf(w);
    const samReady = sam && w.time - (ad.lastShot[d.id] ?? -1e9) >= sam.cycleS;
    if (sam && samReady && d.radarOn && r < SAM_SHOT_M && r > sam.minRange && !m.samBy?.includes(d.id) && samsLeft(w, d) > 0) {
      (m.samBy ??= []).push(d.id);
      ad.lastShot[d.id] = w.time;
      const l = w.weapons?.loadouts.get(d.id);
      if (l) l.sams = samsLeft(w, d) - 1;
      w.events.push({ kind: 'airdef', time: w.time, what: 'launch', team: d.team as 'west' | 'east', shipId: d.id, x: m.pos.x, y: m.pos.y });
      if (w.rng.next() < SAM_PK_SKIMMER) return true;
    }
    const gunKey = `gun:${d.id}`;
    if (r < GUN_M && !m.gunBy?.includes(d.id) && w.time - (ad.lastShot[gunKey] ?? -1e9) >= GUN_CYCLE_S) {
      (m.gunBy ??= []).push(d.id);
      ad.lastShot[gunKey] = w.time;
      if (w.rng.next() < GUN_PK * (d.radarOn ? 1 : 0.5)) return true;
    }
  }
  return false;
}

function stepSsm(w: World, m: Ssm, dt: number): void {
  const owner = w.ships.find((s) => s.id === m.ownerId);
  const spec = SSM_SPECS[owner?.cls ?? 'ffk']!;
  const finish = (how: 'hit' | 'miss' | 'shot') => {
    m.done = how;
    m.doneAt = w.time;
  };
  if (defend(w, m)) {
    finish('shot');
    w.events.push({ kind: 'transient', time: w.time, sourceId: m.ownerId, x: m.pos.x, y: m.pos.y, what: 'splash' });
    return;
  }
  // Seeker on for the last stretch: lock the biggest echo in the cone and keep it
  if (distance(m.pos, m.aim) < spec.seekerOn || m.targetId) {
    let t = m.targetId ? w.ships.find((s) => s.id === m.targetId && s.alive) : undefined;
    if (!t) {
      t = seek(w, m, spec);
      m.targetId = t?.id;
    }
    if (t) m.heading = bearing(m.pos, t.pos);
  }
  const step = spec.speedMs * dt;
  const v = headingVec(m.heading);
  m.pos = { x: m.pos.x + v.x * step, y: m.pos.y + v.y * step };
  m.flown += step;
  const t = m.targetId ? w.ships.find((s) => s.id === m.targetId) : undefined;
  if (t?.alive && distance(m.pos, t.pos) < HIT_M + spec.speedMs * dt) {
    m.hitId = t.id;
    finish('hit');
    weaponHit(w, t, spec.damage, m.ownerId, { ...t.pos });
    return;
  }
  if (m.flown > m.maxFlight) {
    finish('miss');
    w.events.push({ kind: 'transient', time: w.time, sourceId: m.ownerId, x: m.pos.x, y: m.pos.y, what: 'splash' });
  }
}

export function stepAntiShip(w: World, dt: number): void {
  const st = w.env.ssm;
  if (!st) return;
  for (const m of st.missiles) if (!m.done) stepSsm(w, m, dt);
  st.missiles = st.missiles.filter((m) => !m.done || w.time - (m.doneAt ?? 0) < 20);
}

export interface SsmView {
  id: string;
  x: number;
  y: number;
  heading: number;
  own: boolean;
  team: boolean;
  done?: 'hit' | 'miss' | 'shot';
}

/** Rounds a ship can see: its own side's on the datalink, others on radar (sea skimmer, short horizon) or by eye. */
export function ssmFor(w: World, own: Ship): { left?: number; name?: string; maxRange?: number; minRange?: number; readyInS?: number; missiles: SsmView[] } | undefined {
  const st = w.env.ssm;
  const spec = SSM_SPECS[own.cls];
  const sub = CLASSES[own.cls].submarine;
  const missiles: SsmView[] = [];
  for (const m of st?.missiles ?? []) {
    const team = m.team === own.team && !sub;
    const r = distance(own.pos, m.pos);
    const seen = team || (!sub && ((own.radarOn && r < 28_000) || r < 8000)) || (sub && own.depth < 20 && r < 6000);
    if (!seen) continue;
    missiles.push({ id: m.id, x: Math.round(m.pos.x), y: Math.round(m.pos.y), heading: Math.round(m.heading), own: m.ownerId === own.id, team: m.team === own.team, done: m.done });
  }
  if (!spec) return missiles.length ? { missiles } : undefined;
  return {
    missiles, left: ssmLeft(w, own), name: spec.name, maxRange: spec.maxRange, minRange: spec.minRange,
    readyInS: Math.max(0, Math.ceil(spec.cycleS - (w.time - (st?.lastShot[own.id] ?? -1e9)))),
  };
}
