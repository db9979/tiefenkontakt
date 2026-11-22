import { aircraftPosition, type Sortie } from './aviation.js';
import { CLASSES } from './classes.js';
import { canCopy } from './command-radio.js';
import { isConvoyShip, mastRaised, type Ship } from './entities.js';
import { KN, angleDiff, bearing, clamp, distance, headingVec, wrap360, type Vec2 } from './math.js';
import type { World } from './world.js';

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
  via: AirVia[];
}

const SORTIE_ALT: Record<string, number> = { mpa: 300, mad: 60, dip: 25, buoy: 120, torpedo: 120 };

/** Every aircraft in the air right now, including the helicopters and patrol aircraft of both sides. */
export function allPlanes(w: World): Plane[] {
  const out = [...(w.env.airspace?.planes ?? [])];
  for (const s of w.air?.sorties ?? []) {
    const ship = w.ships.find((x) => x.id === s.shipId);
    const p = ship ? aircraftPosition(s as Sortie, w.time, ship) : undefined;
    if (!p || !ship) continue;
    const next = aircraftPosition(s as Sortie, w.time + 5, ship) ?? p;
    const moving = distance(p, next) > 1;
    const mpa = s.kind === 'mpa';
    out.push({
      id: `${mpa ? 'P' : 'H'}${s.shipId}-${Math.round(s.launchAt)}`, kind: mpa ? 'mpa' : 'helo', team: ship.team as 'west' | 'east',
      pos: p, alt: SORTIE_ALT[s.kind ?? 'buoy'] ?? 120, heading: moving ? bearing(p, next) : 0,
      speedKn: moving ? distance(p, next) / 5 / KN : 0, radar: mpa,
    });
  }
  return out;
}

/** Radar horizon (m) between an antenna and an aircraft at a height. */
function radarHorizon(antenna: number, alt: number): number {
  return 4120 * (Math.sqrt(antenna) + Math.sqrt(alt));
}

/** Eye range (m) to an aircraft: day by size or contrail, night only its lights. */
function eyeRange(p: Plane, light: number, rain: boolean): number {
  const day = { airliner: 45_000, recon: 18_000, mpa: 15_000, helo: 9000, light: 6000 }[p.kind];
  const night = 25_000;
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
    const via: AirVia[] = [];
    // Own aircraft over the datalink: surface ships always, boats only with the mast up
    if (p.team === own.team && (!sub || mastRaised(own))) via.push('datalink');
    if (radarOn && d < Math.min(110_000, radarHorizon(30, p.alt))) via.push('radar');
    if (eyeUp && d < Math.min(eyeRange(p, light, !!w.env.rain), radarHorizon(sub ? 2 : 20, p.alt))) via.push('visual');
    if (esmUp && p.radar && p.team !== own.team && d < AIR_RADAR_M * 2) via.push('esm');
    if (!via.length) continue;
    const fix = via.some((v) => v !== 'esm');
    out.push({
      id: p.id, kind: p.kind, bearing: bearing(own.pos, p.pos), via, radar: p.radar,
      side: p.team === own.team ? 'friend' : p.team === 'neutral' ? 'neutral' : fix || via.includes('esm') ? 'hostile' : 'unknown',
      lit: p.kind !== 'recon' && !(p.kind === 'helo' && p.team !== 'neutral' && light > 0.4),
      ...(fix ? { x: Math.round(p.pos.x), y: Math.round(p.pos.y), alt: Math.round(p.alt), heading: Math.round(p.heading), speedKn: Math.round(p.speedKn) } : {}),
    });
  }
  return out;
}
