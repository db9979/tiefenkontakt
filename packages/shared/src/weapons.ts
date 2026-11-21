import { crossesLayer, sourceLevel } from './acoustics.js';
import { CLASSES } from './classes.js';
import type { Ship } from './entities.js';
import { applyHitDamage, reloadFactor, weaponsBroken } from './damage.js';
import { createLoadout, stepReload, type Loadout } from './loadout.js';
import { KN, angleDiff, approach, bearing, clamp, distance, headingVec, wrap360, type Vec2 } from './math.js';
import { measureLayer, type World } from './world.js';

export type TorpedoKind = 'heavy' | 'light';
export type SeekerMode = 'passive' | 'active';

export interface Torpedo {
  id: string;
  kind: TorpedoKind;
  ownerId: string;
  pos: Vec2;
  depth: number;
  heading: number;
  speedKn: number;
  searchDepth: number;
  enableAfter: number; // m run before the seeker switches on
  mode: SeekerMode;
  run: number; // m travelled
  maxRun: number;
  wire: boolean;
  homingOn?: string; // target or decoy id
  launchedAt: number;
  alerted: string[]; // ship ids already warned
}

export interface Decoy {
  id: string;
  pos: Vec2;
  depth: number;
  sl: number;
  expiresAt: number;
  towedBy?: string;
}

export interface DelayedEffect {
  at: number;
  kind: 'rocket' | 'depthcharge';
  ownerId: string;
  pos: Vec2;
  depth: number;
}

export interface WeaponsState {
  torpedoes: Torpedo[];
  decoys: Decoy[];
  pending: DelayedEffect[];
  loadouts: Map<string, Loadout>;
  nextId: number;
}

const SPEC: Record<TorpedoKind, { speedKn: number; maxRun: number; damage: number; turn: number }> = {
  heavy: { speedKn: 40, maxRun: 25_000, damage: 80, turn: 10 },
  light: { speedKn: 45, maxRun: 8_000, damage: 55, turn: 14 },
};
const SEEKER_HALF_ANGLE = 45;
const HIT_RADIUS = 35;
const WIRE_MAX_RANGE = 18_000;
const WIRE_MAX_OWNER_KN = 12;
const ALERT_RANGE = 8_000;
const ROCKET_MAX_RANGE = 18_000;
const ROCKET_FLIGHT = 40;
const DC_SINK_RATE = 4;
const DC_LETHAL = 60;

export function createWeaponsState(ships: Ship[]): WeaponsState {
  const loadouts = new Map<string, Loadout>();
  for (const s of ships) loadouts.set(s.id, createLoadout(s.cls));
  return { torpedoes: [], decoys: [], pending: [], loadouts, nextId: 1 };
}

function ws(w: World): WeaponsState {
  if (!w.weapons) throw new Error('weapons system not installed');
  return w.weapons;
}

export interface FireOptions {
  heading: number;
  enableAfter?: number;
  mode?: SeekerMode;
  searchDepth?: number;
  speedKn?: number;
}

/** Fire a torpedo from a loaded tube. Returns the torpedo or an error string. */
export function fireTorpedo(w: World, shooter: Ship, o: FireOptions): Torpedo | string {
  const st = ws(w);
  const l = st.loadouts.get(shooter.id);
  if (!shooter.alive || !l) return 'Schiff kann nicht feuern';
  if (weaponsBroken(shooter)) return 'Waffenanlage ausgefallen';
  const tube = l.tubes.find((t) => t.loaded);
  if (!tube) return 'Kein Rohr geladen';
  tube.loaded = false;
  const kind: TorpedoKind = CLASSES[shooter.cls].submarine ? 'heavy' : 'light';
  const sp = SPEC[kind];
  const t: Torpedo = {
    id: `T${st.nextId++}`, kind, ownerId: shooter.id, pos: { ...shooter.pos },
    depth: Math.max(shooter.depth, 10), heading: wrap360(o.heading),
    speedKn: clamp(o.speedKn ?? sp.speedKn, 25, sp.speedKn),
    searchDepth: o.searchDepth ?? (kind === 'heavy' ? shooter.depth : 100),
    enableAfter: Math.max(o.enableAfter ?? 1500, 500), mode: o.mode ?? 'passive',
    run: 0, maxRun: sp.maxRun, wire: kind === 'heavy', launchedAt: w.time, alerted: [shooter.id],
  };
  st.torpedoes.push(t);
  const at = { x: shooter.pos.x, y: shooter.pos.y };
  if (kind === 'heavy') w.events.push({ kind: 'transient', time: w.time, sourceId: shooter.id, ...at, what: 'flood' });
  w.events.push({ kind: 'transient', time: w.time, sourceId: shooter.id, ...at, what: 'launch' });
  return t;
}

export function dropXbt(w: World, ship: Ship): true | string {
  const l = ws(w).loadouts.get(ship.id);
  if (!l || l.xbt <= 0) return 'Keine Bathythermographen';
  l.xbt -= 1;
  measureLayer(w, ship);
  return true;
}

/** Wire-guided course correction. */
export function steerTorpedo(w: World, shooter: Ship, torpId: string, heading: number, enableAfter?: number): boolean {
  const t = ws(w).torpedoes.find((x) => x.id === torpId && x.ownerId === shooter.id);
  if (!t || !t.wire) return false;
  t.heading = wrap360(heading);
  t.homingOn = undefined;
  if (enableAfter !== undefined) t.enableAfter = Math.max(t.run + 200, enableAfter);
  return true;
}

export function launchAswRocket(w: World, shooter: Ship, aim: Vec2): true | string {
  const l = ws(w).loadouts.get(shooter.id);
  if (!l || l.rockets <= 0) return 'Keine Raketen';
  if (distance(shooter.pos, aim) > ROCKET_MAX_RANGE) return 'Ziel außer Reichweite';
  l.rockets -= 1;
  ws(w).pending.push({ at: w.time + ROCKET_FLIGHT, kind: 'rocket', ownerId: shooter.id, pos: { ...aim }, depth: 0 });
  return true;
}

export function dropDepthCharge(w: World, shooter: Ship, depth: number): true | string {
  const l = ws(w).loadouts.get(shooter.id);
  if (!l || l.depthCharges <= 0) return 'Keine Wasserbomben';
  l.depthCharges -= 1;
  const d = clamp(depth, 20, 400);
  ws(w).pending.push({ at: w.time + d / DC_SINK_RATE, kind: 'depthcharge', ownerId: shooter.id, pos: { ...shooter.pos }, depth: d });
  return true;
}

export function launchNoisemaker(w: World, ship: Ship): true | string {
  const st = ws(w);
  const l = st.loadouts.get(ship.id);
  if (!l || l.noisemakers <= 0) return 'Keine Täuschkörper';
  l.noisemakers -= 1;
  st.decoys.push({ id: `D${st.nextId++}`, pos: { ...ship.pos }, depth: ship.depth, sl: 150, expiresAt: w.time + 240 });
  return true;
}

export function setTowedDecoy(w: World, ship: Ship, on: boolean): void {
  const st = ws(w);
  const l = st.loadouts.get(ship.id);
  if (!l || ship.cls !== 'ffg') return;
  l.towedDecoy = on;
  st.decoys = st.decoys.filter((d) => d.towedBy !== ship.id);
  if (on) st.decoys.push({ id: `D${st.nextId++}`, pos: { ...ship.pos }, depth: 5, sl: 155, expiresAt: Infinity, towedBy: ship.id });
}

interface Candidate {
  id: string;
  pos: Vec2;
  depth: number;
  score: number;
}

/** Acquisition range of the seeker against a target (m). */
function seekerRange(t: Torpedo, sl: number, ts: number): number {
  return t.mode === 'active' ? 2000 + (ts - 15) * 80 : Math.max(0, (sl - 100) * 40);
}

function seek(w: World, t: Torpedo): Candidate | undefined {
  const st = ws(w);
  let best: Candidate | undefined;
  const consider = (id: string, pos: Vec2, depth: number, sl: number, ts: number, bonus: number) => {
    const r = distance(t.pos, pos);
    if (r < 1) return;
    if (Math.abs(angleDiff(t.heading, bearing(t.pos, pos))) > SEEKER_HALF_ANGLE) return;
    let reach = seekerRange(t, sl, ts);
    if (crossesLayer(t.depth, depth, w.env)) reach *= 0.5;
    if (r > reach) return;
    const score = (reach / r) * bonus;
    if (!best || score > best.score) best = { id, pos, depth, score };
  };
  for (const s of w.ships) {
    if (!s.alive) continue;
    if (s.id === t.ownerId && t.run < 3000) continue;
    consider(s.id, s.pos, s.depth, sourceLevel(s), CLASSES[s.cls].targetStrength, 1);
  }
  for (const d of st.decoys) consider(d.id, d.pos, d.depth, d.sl, 20, 1.3);
  return best;
}

function damage(w: World, target: Ship, amount: number, byId: string): void {
  target.hp -= amount;
  if (target.hp > 0) applyHitDamage(target, amount, w.rng);
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    target.order.speedKn = 0;
    w.events.push({ kind: 'sunk', time: w.time, shipId: target.id, byId });
  }
}

function stepTorpedo(w: World, t: Torpedo, dt: number): boolean {
  const sp = SPEC[t.kind];
  const owner = w.ships.find((s) => s.id === t.ownerId);
  if (t.wire && (!owner?.alive || distance(owner.pos, t.pos) > WIRE_MAX_RANGE || owner.speed / KN > WIRE_MAX_OWNER_KN)) {
    t.wire = false;
  }
  if (t.run >= t.enableAfter) {
    const c = seek(w, t);
    if (c) {
      t.homingOn = c.id;
      const want = bearing(t.pos, c.pos);
      t.heading = wrap360(t.heading + clamp(angleDiff(t.heading, want), -sp.turn * dt, sp.turn * dt));
      t.depth = approach(t.depth, c.depth, 8 * dt);
      const r3 = Math.hypot(distance(t.pos, c.pos), t.depth - c.depth);
      if (r3 < HIT_RADIUS) {
        const ship = w.ships.find((s) => s.id === c.id);
        if (ship) damage(w, ship, sp.damage, t.ownerId);
        else ws(w).decoys = ws(w).decoys.filter((d) => d.id !== c.id || !!d.towedBy);
        return false;
      }
    } else {
      t.homingOn = undefined;
      // Search pattern: heavyweights snake, lightweights circle
      const rate = t.kind === 'light' ? 8 : Math.sin((w.time - t.launchedAt) / 6) * 4;
      t.heading = wrap360(t.heading + rate * dt);
      t.depth = approach(t.depth, t.searchDepth, 5 * dt);
    }
  } else {
    t.depth = approach(t.depth, t.searchDepth, 5 * dt);
  }
  const v = headingVec(t.heading);
  const step = t.speedKn * KN * dt;
  t.pos.x += v.x * step;
  t.pos.y += v.y * step;
  t.run += step;

  for (const s of w.ships) {
    if (!s.alive || t.alerted.includes(s.id) || s.cls === 'merchant') continue;
    if (distance(s.pos, t.pos) < ALERT_RANGE) {
      t.alerted.push(s.id);
      w.events.push({ kind: 'torpedo_alert', time: w.time, shipId: s.id, bearing: bearing(s.pos, t.pos) });
    }
  }
  return t.run < t.maxRun;
}

function resolvePending(w: World, e: DelayedEffect): void {
  const st = ws(w);
  if (e.kind === 'rocket') {
    st.torpedoes.push({
      id: `T${st.nextId++}`, kind: 'light', ownerId: e.ownerId, pos: { ...e.pos }, depth: 10,
      heading: w.rng.range(0, 360), speedKn: SPEC.light.speedKn, searchDepth: 120, enableAfter: 0,
      mode: 'active', run: 0, maxRun: SPEC.light.maxRun, wire: false, launchedAt: w.time, alerted: [e.ownerId],
    });
    return;
  }
  for (const s of w.ships) {
    if (!s.alive) continue;
    const r3 = Math.hypot(distance(s.pos, e.pos), s.depth - e.depth);
    if (r3 < DC_LETHAL * 3) damage(w, s, r3 < DC_LETHAL ? 60 : 15, e.ownerId);
  }
}

/** World system: advances torpedoes, decoys, rockets, depth charges and reloads. */
export function weaponsSystem(w: World, dt: number): void {
  const st = ws(w);
  st.torpedoes = st.torpedoes.filter((t) => stepTorpedo(w, t, dt));
  const due = st.pending.filter((e) => e.at <= w.time);
  st.pending = st.pending.filter((e) => e.at > w.time);
  for (const e of due) resolvePending(w, e);
  for (const d of st.decoys) {
    const tower = d.towedBy ? w.ships.find((s) => s.id === d.towedBy) : undefined;
    if (tower) {
      const back = headingVec(tower.heading + 180);
      d.pos = { x: tower.pos.x + back.x * 400, y: tower.pos.y + back.y * 400 };
      if (!tower.alive) d.expiresAt = w.time;
    }
  }
  st.decoys = st.decoys.filter((d) => d.expiresAt > w.time);
  for (const s of w.ships) {
    const l = st.loadouts.get(s.id);
    if (l && s.alive) stepReload(l, s.cls, w.time, reloadFactor(s));
  }
}

export function installWeapons(w: World): WeaponsState {
  w.weapons = createWeaponsState(w.ships);
  w.systems.push(weaponsSystem);
  return w.weapons;
}
