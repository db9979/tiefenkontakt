import { aircraftPosition, type Sortie } from './aviation.js';
import { heloLow } from './helo.js';
import { fogAt, inSquall } from './met.js';
import { CLASSES, isEscort } from './classes.js';
import { canCopy } from './command-radio.js';
import { isConvoyShip, mastRaised, type Ship } from './entities.js';
import { KN, angleDiff, bearing, clamp, distance, headingVec, wrap360, type Vec2 } from './math.js';
import { bookFor, type World } from './world.js';
import { aircraftEmitter, emitterSpec, esmLevel, esmTrend } from './emitters.js';
import { antennaTurned, exposedMast, mastDetectP, type Detection, type MastKind } from './sensors.js';
import { lineOfSight } from './terrain.js';
import { gridRef } from './orders.js';

/**
 * Air traffic and aircraft as sensors see them. Civil airliners cross on airways high up,
 * now and then a light aircraft low down; the Ostpakt sends a long-range reconnaissance
 * aircraft that searches with its radar and reports the convoy to its boats. The own
 * helicopter and patrol aircraft come from the aviation sorties. What a ship knows of an
 * aircraft: datalink (own team), radar (by radar horizon), eye (day: shape or contrail,
 * night: lights only) and ESM (bearing on an aircraft whose radar is on).
 */

export type PlaneKind = 'airliner' | 'light' | 'recon' | 'helo' | 'mpa';

export interface Plane {
  id: string;
  kind: PlaneKind;
  team: 'west' | 'east' | 'neutral';
  pos: Vec2;
  alt: number;
  heading: number;
  speedKn: number;
  radar: boolean;
  /** Recon: orbit centre and end of the orbit; reported already. */
  orbit?: Vec2;
  orbitUntil?: number;
  reported?: boolean;
  /** Breaking away from a missile (or fighter) until this time, away from that point. */
  evadeUntil?: number;
  evadeFrom?: Vec2;
  /** Recon after losses: orbits this far out from the convoy instead of overhead. */
  standoff?: number;
}

export interface AirspaceState { planes: Plane[]; nextCivil: number; nextRecon: number; nextId: number }

const AREA_M = 70_000;
const AIRLINER_ALT = [9000, 11500];
const RECON_KN = 330;
/** The recon aircraft identifies the convoy (and reports it) from this range. */
const RECON_ID_M = 20_000;
/** Search radar of patrol and recon aircraft: detection of ships and range at which ESM hears it. */
export const AIR_RADAR_M = 70_000;

export function installAirspace(w: World): void {
  w.env.airspace = { planes: [], nextCivil: w.time + 120 + w.rng.next() * 300, nextRecon: w.time + 1500 + w.rng.next() * 900, nextId: 1 };
  // One airliner already overhead at the start
  spawnCivil(w, 'airliner', true);
}

function centre(w: World): Vec2 {
  const convoy = w.ships.filter((s) => s.alive && isConvoyShip(s));
  const set = convoy.length ? convoy : w.ships.filter((s) => s.alive && s.team !== 'neutral');
  if (!set.length) return { x: 0, y: 0 };
  return { x: set.reduce((a, s) => a + s.pos.x, 0) / set.length, y: set.reduce((a, s) => a + s.pos.y, 0) / set.length };
}

function spawnCivil(w: World, kind: 'airliner' | 'light', inside = false): void {
  const st = w.env.airspace!;
  const c = centre(w);
  const a = w.rng.next() * 360;
  const v = headingVec(a);
  const r = inside ? w.rng.next() * 30_000 : AREA_M;
  const heading = wrap360(a + 180 + w.rng.gauss(0, 25));
  st.planes.push({
    id: `F${st.nextId++}`, kind, team: 'neutral', pos: { x: c.x + v.x * r, y: c.y + v.y * r }, heading,
    alt: kind === 'airliner' ? AIRLINER_ALT[0]! + w.rng.next() * (AIRLINER_ALT[1]! - AIRLINER_ALT[0]!) : 500 + w.rng.next() * 600,
    speedKn: kind === 'airliner' ? 440 + w.rng.next() * 40 : 110, radar: false,
  });
}

function spawnRecon(w: World): void {
  const st = w.env.airspace!;
  const c = centre(w);
  const a = w.rng.next() * 360;
  const v = headingVec(a);
  // Burnt once: later recon flights stay high and work from a stand-off orbit
  const losses = w.env.airdef?.reconLosses ?? 0;
  st.planes.push({
    id: `R${st.nextId++}`, kind: 'recon', team: 'east', pos: { x: c.x + v.x * AREA_M, y: c.y + v.y * AREA_M },
    heading: wrap360(a + 180), alt: losses ? 6000 + 1000 * Math.min(2, losses - 1) : 1500, speedKn: RECON_KN, radar: true, orbit: c,
    standoff: losses ? Math.min(34_000, 22_000 + 6000 * (losses - 1)) : 0,
  });
}

/** Mission has boats of the Ostpakt that a recon aircraft would work for. */
function wantsRecon(w: World): boolean {
  return w.env.mission !== 'duell' && w.ships.some((s) => s.alive && s.team === 'east' && CLASSES[s.cls].submarine) && w.ships.some(isConvoyShip);
}

export function stepAirspace(w: World, dt: number): void {
  const st = w.env.airspace;
  if (!st) return;
  if (w.time >= st.nextCivil) {
    st.nextCivil = w.time + 360 + w.rng.next() * 480;
    spawnCivil(w, w.rng.next() < 0.8 || w.env.seabed?.kind === 'tief' ? 'airliner' : 'light');
  }
  if (w.time >= st.nextRecon) {
    st.nextRecon = w.time + 2400 + w.rng.next() * 1200;
    if (wantsRecon(w) && !st.planes.some((p) => p.kind === 'recon')) spawnRecon(w);
  }
  const c = centre(w);
  for (const p of st.planes) {
    if (p.kind === 'recon' && p.orbit) {
      // Run in, descend to 300 m over the convoy (or hold a stand-off ring), orbit 5 minutes with radar on, then leave
      const conv = centre(w);
      const d = distance(p.pos, conv);
      const ring = p.standoff ?? 0;
      if (p.evadeUntil !== undefined && w.time < p.evadeUntil && p.evadeFrom) {
        // Missile warning: hard turn away from the launcher and down toward the sea clutter
        p.heading = wrap360(p.heading + clamp(angleDiff(p.heading, bearing(p.evadeFrom, p.pos)), -6 * dt, 6 * dt));
        p.alt = Math.max(ring ? 3000 : 120, p.alt - 25 * dt);
      } else {
        if (p.orbitUntil === undefined && d < ring + 4000) p.orbitUntil = w.time + 300;
        if (p.orbitUntil !== undefined && w.time < p.orbitUntil) {
          if (ring) p.heading = wrap360(bearing(conv, p.pos) + 90 + clamp((d - ring) / 100, -40, 40));
          else {
            p.heading = wrap360(p.heading + 3 * dt);
            p.alt = Math.max(300, p.alt - 10 * dt);
          }
        } else if (p.orbitUntil === undefined) {
          p.heading = bearing(p.pos, conv);
          if (ring) p.alt = Math.min(7000, p.alt + 5 * dt);
        }
      }
    }
    // The report goes out once the convoy is identified: inside 20 km (or from the stand-off orbit)
    if (p.kind === 'recon' && p.orbit && !p.reported && (p.orbitUntil !== undefined || distance(p.pos, c) < RECON_ID_M)) {
      p.reported = true;
      w.events.push({ kind: 'recon', time: w.time, x: c.x, y: c.y, course: Math.round(w.convoy?.guideHeading ?? 0), speedKn: Math.round((w.convoy?.baseSpeedKn ?? 8)) });
    }
    const v = headingVec(p.heading);
    p.pos.x += v.x * p.speedKn * KN * dt;
    p.pos.y += v.y * p.speedKn * KN * dt;
  }
  st.planes = st.planes.filter((p) => distance(p.pos, c) < AREA_M + 5000 || (p.kind === 'recon' && p.orbitUntil === undefined));
}

export type AirVia = 'datalink' | 'radar' | 'visual' | 'esm';

export interface PlaneView {
  id: string;
  kind: PlaneKind;
  side: 'friend' | 'hostile' | 'neutral' | 'unknown';
  bearing: number;
  /** Position, height, course and speed: only with datalink, radar or a visual fix. */
  x?: number;
  y?: number;
  alt?: number;
  heading?: number;
  speedKn?: number;
  radar?: boolean;
  lit?: boolean;
  /** Seen by eye only: the plot shows a rough estimate (bearing good, range and height guessed). */
  rough?: boolean;
  via: AirVia[];
  /** ESM: the aircraft's radar (emitters.ts), signal strength 0..2 and trend. */
  emitter?: string;
  esmLvl?: number;
  esmTrend?: number;
}

const SORTIE_ALT: Record<string, number> = { mpa: 300, mad: 60, dip: 25, buoy: 120, torpedo: 120 };

/** An own-side aircraft of the air wing (patrol aircraft sortie or ship's helicopter). */
interface WingAircraft {
  key: object;
  id: string;
  kind: 'mpa' | 'helo';
  owner: Ship;
  pos: Vec2;
  alt: number;
  heading: number;
  speedKn: number;
  radar: boolean;
}

/** The air wing in the air: patrol aircraft sorties (older saves: helicopter sorties) and the ships' helicopters. */
function wingAircraft(w: World): WingAircraft[] {
  const out: WingAircraft[] = [];
  for (const s of w.air?.sorties ?? []) {
    const ship = w.ships.find((x) => x.id === s.shipId);
    const p = ship ? aircraftPosition(s as Sortie, w.time, ship) : undefined;
    if (!p || !ship) continue;
    const next = aircraftPosition(s as Sortie, w.time + 5, ship) ?? p;
    const moving = distance(p, next) > 1;
    const mpa = s.kind === 'mpa';
    out.push({
      key: s, id: `${mpa ? 'P' : 'H'}${s.shipId}-${Math.round(s.launchAt)}`, kind: mpa ? 'mpa' : 'helo', owner: ship,
      pos: p, alt: SORTIE_ALT[s.kind ?? 'buoy'] ?? 120, heading: moving ? bearing(p, next) : 0,
      speedKn: moving ? distance(p, next) / 5 / KN : 0, radar: sortieRadarOn(s as Sortie, w.time),
    });
  }
  for (const h of Object.values(w.air?.helos ?? {})) {
    const ship = w.ships.find((x) => x.id === h.shipId);
    if (!ship || h.state !== 'air') continue;
    // Low and slow while it dips or flies the MAD pattern (radar off); in transit at 120 m, radar on
    const low = heloLow(h);
    const loiter = !h.queue.length;
    out.push({
      key: h, id: `H${h.shipId}-${Math.round(h.launchAt)}`, kind: 'helo', owner: ship, pos: { x: h.x, y: h.y },
      alt: low ? SORTIE_ALT[low]! : 120, heading: h.heading, speedKn: low === 'dip' || loiter ? 0 : low === 'mad' ? 60 : 120, radar: !low,
    });
  }
  return out;
}

/** Every aircraft in the air right now, including the helicopters and patrol aircraft of both sides. */
export function allPlanes(w: World): Plane[] {
  const out = [...(w.env.airspace?.planes ?? [])];
  for (const a of wingAircraft(w)) {
    out.push({ id: a.id, kind: a.kind, team: a.owner.team as 'west' | 'east', pos: a.pos, alt: a.alt, heading: a.heading, speedKn: a.speedKn, radar: a.radar });
  }
  return out;
}

/**
 * A sortie's search radar is on the air: the patrol aircraft always, the helicopter in transit
 * (not while it hovers to dip or flies its low MAD pattern).
 */
export function sortieRadarOn(s: Sortie, now: number): boolean {
  if (s.kind === 'mpa') return true;
  return !(s.hoverUntil !== undefined && now >= s.dropAt && now <= s.hoverUntil);
}

/**
 * Aircraft search radar against masts: limit per aircraft and mast kind (m). Seen from above a
 * snorkel's spray and exhaust stand out far better than a thin periscope.
 */
export const AIR_MAST_RADAR: Record<'mpa' | 'helo', Record<MastKind, number>> = {
  mpa: { snorkel: 30_000, mast: 9_000 },
  helo: { snorkel: 15_000, mast: 6_000 },
};
/** Position error of an aircraft radar fix, per axis (m): about 1 km off in all. */
export const AIR_FIX_SD = 700;
const AIR_ALERT_GAP_S = 120;
const airAlertAt = new WeakMap<object, Record<string, number>>();

/**
 * Once a second: every friendly aircraft with its radar on gets one look per antenna sweep at
 * the exposed masts and snorkels of enemy boats. A paint goes over the datalink to every escort
 * of the side as a fix from the aircraft (≈1 km error) and the crews are told.
 */
export function aircraftRadarSweep(w: World): void {
  for (const a of wingAircraft(w)) {
    const { owner, kind, alt, pos: p, key: s } = a;
    if (!owner.alive || !a.radar) continue;
    const rot = emitterSpec(aircraftEmitter(kind))?.rotationS ?? 4;
    if (!antennaTurned(`${kind}${a.id}`, rot, w.time)) continue;
    for (const sub of w.ships) {
      if (!sub.alive || sub.team === owner.team || !CLASSES[sub.cls].submarine) continue;
      const mk = exposedMast(sub);
      if (!mk) continue;
      const r = distance(p, sub.pos);
      const pDet = mastDetectP(mk, r, w.env.seaState, AIR_MAST_RADAR[kind][mk]) * (inSquall(w.env.met, sub.pos) ? 0.25 : 1);
      if (pDet <= 0 || w.rng.next() > pDet) continue;
      if (!lineOfSight(w.env.seabed, p, alt, sub.pos, 3)) continue;
      const fix = { x: sub.pos.x + w.rng.gauss(0, AIR_FIX_SD), y: sub.pos.y + w.rng.gauss(0, AIR_FIX_SD) };
      const escorts = w.ships.filter((e) => e.alive && e.team === owner.team && (e === owner || isEscort(e.cls)));
      for (const e of escorts) {
        const det: Detection = {
          observerId: e.id, targetId: sub.id, sensor: 'radar', time: w.time,
          bearing: bearing(p, fix), range: Math.max(50, distance(p, fix)), se: 15, originX: p.x, originY: p.y,
        };
        w.lastDetections.push(det);
        bookFor(w, e.id).ingest(det);
      }
      const seen = (airAlertAt.get(s) ?? {});
      airAlertAt.set(s, seen);
      if (w.time - (seen[sub.id] ?? -1e9) < AIR_ALERT_GAP_S) continue;
      seen[sub.id] = w.time;
      const text = `${kind === 'mpa' ? 'SEEAUFKLÄRER' : 'BORDHUBSCHRAUBER'} · RADARKONTAKT ${mk === 'snorkel' ? 'SCHNORCHEL' : 'SEHROHR'} · PLANQUADRAT ${gridRef(fix.x, fix.y)}`;
      for (const e of escorts) w.events.push({ kind: 'boat', time: w.time, shipId: e.id, what: 'airradar', text });
    }
  }
}

/** Radar horizon (m) between an antenna and an aircraft at a height. */
function radarHorizon(antenna: number, alt: number): number {
  return 4120 * (Math.sqrt(antenna) + Math.sqrt(alt));
}

/** Eye range (m) to an aircraft: day by size or contrail, night only its lights. */
function eyeRange(p: Plane, light: number, rain: boolean, lit: boolean): number {
  const day = { airliner: 45_000, recon: 18_000, mpa: 15_000, helo: 9000, light: 6000 }[p.kind];
  // At night only navigation lights carry far; a darkened aircraft is a noise and a shadow close by
  const night = lit ? 25_000 : 2500;
  const r = light > 0.4 ? day : light > 0.15 ? Math.max(day * 0.6, night * 0.6) : night;
  return r * (rain ? 0.4 : 1);
}

/** What one ship knows of the aircraft around it. */
export function planesFor(w: World, own: Ship): PlaneView[] {
  const out: PlaneView[] = [];
  const sub = CLASSES[own.cls].submarine;
  const eyeUp = sub ? mastRaised(own) : true;
  const radarOn = !sub && !!own.radarOn;
  const esmUp = sub ? mastRaised(own) || canCopy(own) === 'buoy' : true;
  const light = w.env.light ?? 1;
  for (const p of allPlanes(w)) {
    const d = distance(own.pos, p.pos);
    const lit = p.kind !== 'recon' && !(p.kind === 'helo' && p.team !== 'neutral' && light > 0.4);
    const via: AirVia[] = [];
    // Own aircraft over the datalink: surface ships always, boats only with the mast up
    if (p.team === own.team && (!sub || mastRaised(own))) via.push('datalink');
    if (radarOn && d < Math.min(110_000, radarHorizon(30, p.alt))) via.push('radar');
    if (eyeUp && d < Math.min(eyeRange(p, light, !!w.env.rain || inSquall(w.env.met, own.pos), lit) * (1 - 0.9 * fogAt(w.env.met, own.pos)), radarHorizon(sub ? 2 : 20, p.alt))) via.push('visual');
    if (esmUp && p.radar && p.team !== own.team && d < AIR_RADAR_M * 2) via.push('esm');
    if (!via.length) continue;
    const fix = via.some((v) => v !== 'esm');
    const rough = fix && !via.includes('radar') && !via.includes('datalink');
    out.push({
      id: p.id, kind: p.kind, bearing: bearing(own.pos, p.pos), via, radar: p.radar,
      side: p.team === own.team ? 'friend' : p.team === 'neutral' ? 'neutral' : fix || via.includes('esm') ? 'hostile' : 'unknown',
      lit, ...(rough ? { rough: true } : {}),
      ...(via.includes('esm') ? { emitter: aircraftEmitter(p.kind), esmLvl: esmLevel(d, AIR_RADAR_M * 2), esmTrend: esmTrend(own.pos, own.heading, own.speed, p.pos, p.heading, p.speedKn * KN) } : {}),
      ...(fix ? { x: Math.round(p.pos.x), y: Math.round(p.pos.y), alt: Math.round(p.alt), heading: Math.round(p.heading), speedKn: Math.round(p.speedKn) } : {}),
    });
  }
  return out;
}
