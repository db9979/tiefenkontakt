import type { ClassId, Team } from './classes.js';
import type { DamageState, ShipSystem } from './damage.js';
import type { AtmoState, CrewState } from './crew.js';
import type { CompState } from './compartments.js';
import { CLASSES } from './classes.js';
import type { Vec2 } from './math.js';

export interface ShipOrder {
  heading: number; // deg
  speedKn: number;
  depth: number; // m (ignored for surface ships)
}

export interface Ship {
  id: string;
  /** No player at the helm (convoy, neutrals, AI crews): the auto-pilot keeps her off shoals (navigation.ts). */
  autoNav?: boolean;
  cls: ClassId;
  team: Team;
  name: string;
  playerId?: string;
  pos: Vec2;
  depth: number;
  heading: number;
  speed: number; // m/s
  order: ShipOrder;
  alive: boolean;
  hp: number;
  /** Time (s) of last significant course change; towed arrays need to settle after turns. */
  lastTurnAt: number;
  /** SSK battery in knot-hours. */
  battery?: number;
  snorkel: boolean; // ordered to snorkel (SSK, needs shallow depth)
  mastUp: boolean; // periscope / radio mast ordered up (needs periscope depth)
  /** How far the mast is out of its well, 0..1: it takes seconds to hoist and to lower. */
  mastExt?: number;
  /** Snorkel head extension 0..1; the diesels only run once it is fully up. */
  snorkelExt?: number;
  /** Current rate of turn (deg/s, + = starboard); builds up and dies away with rudder and hull inertia. */
  yawRate?: number;
  /** People aboard: fatigue, morale, wounded, battle stations, silent running (crew.ts). */
  crew?: CrewState;
  /** Air quality in diesel and coastal boats (crew.ts). */
  air?: AtmoState;
  /** Trim error in tonnes (+ light, − heavy); torpedo shots make the boat light, flooding heavy. */
  trim?: number;
  /** High-pressure air for emergency blows (bottles); refilled by the compressors when snorkeling or surfaced. */
  hpAir?: number;
  /** Emergency blow in progress until this time. */
  blowUntil?: number;
  blowing?: boolean;
  /** Dead-reckoning error of a submerged boat (m); the crew believes it is at pos + this. */
  drErr?: { x: number; y: number };
  /** Time of the last navigation fix (mast raised or surfaced). */
  lastFixAt?: number;
  /** Navigator's estimate of the position error (1 σ, m) and how the last fix was taken. */
  navSigma?: number;
  lastFix?: import('./navfix.js').FixMethod;
  /** Seconds of satellite reception / star sights with the mast up; last look for land. */
  navFix?: { sat: number; stars: number; landAt: number };
  /** Neutral on a real shipping lane (lanes.ts): lane index, direction, next waypoint. */
  lane?: { i: number; dir: 1 | -1; k: number };
  /** Floating wire / buoy antenna streamed (receive only). */
  buoyAntenna?: boolean;
  /** Copying the current fleet-command broadcast: window index, seconds of steady reception. */
  cmdRx?: { k: number; secs: number; done: boolean };
  /** Rudder jammed until this time (incident). */
  rudderJamUntil?: number;
  /** Towed array torn off and not usable until this time (driftnet). */
  towedLostUntil?: number;
  /** Route plotted on the player's chart and "Route fahren" (route.ts). */
  route?: import('./route.js').ShipRoute;
  /** Navigation lights burning (lights.ts). */
  lights?: boolean;
  /** Fouled in a driftnet until this time: crawling and noisy. */
  snagUntil?: number;
  snagged?: boolean;
  /** Snorkel head valve stuck open until this time. */
  snorkelStuckUntil?: number;
  /** Hydrogen in the battery while charging: must keep ventilating (snorkel) until this time. */
  batteryGasUntil?: number;
  radarOn: boolean;
  towedLength: number; // m deployed, 0 = stowed
  /** Ordered array length; the winch pays out about 4 m/s and recovers about 3 m/s. */
  towedOrder?: number;
  /** Variable-depth sonar: depth of the towed body (0 = housed) and the ordered depth. */
  vdsDepth?: number;
  vdsOrder?: number;
  activeSonar: boolean; // pings periodically when true
  /** High-frequency mine-avoidance sonar (escorts): finds mines further ahead; too high in pitch to be heard far away. */
  mineAvoid?: boolean;
  lastPingAt: number;
  /** Active pulse: CW (coarse range, Doppler) or LFM (precise range, beats reverberation). */
  pulse: 'cw' | 'lfm';
  /** Layer depth as measured by this ship (bathythermograph); undefined until measured. */
  btLayer?: number;
  /** Side of the layer last time we looked (subs learn the layer by crossing it). */
  layerSide?: 'above' | 'below';
  /** System damage 0..1 and the crew's repair priority. */
  damage?: DamageState;
  repair?: ShipSystem;
  /** Watertight compartments, bow first (compartments.ts), and where damage control works. */
  comps?: CompState[];
  dcComp?: number;
  /** Side a hit came from (+1 starboard, −1 port): the ship lists that way. */
  heelSide?: number;
  /** Derived from the water aboard: bow-down trim (deg), list (deg, + starboard), share of reserve buoyancy used. */
  trimDeg?: number;
  listDeg?: number;
  settle?: number;
  /** Who hit her last (credited when she sinks later from flooding or fire). */
  lastHitBy?: string;
}

export const PERISCOPE_DEPTH = 18;

export interface ShipInit {
  id: string;
  cls: ClassId;
  name: string;
  team?: Team;
  pos: Vec2;
  heading: number;
  speedKn?: number;
  depth?: number;
  playerId?: string;
}

export function createShip(init: ShipInit): Ship {
  const spec = CLASSES[init.cls];
  const depth = spec.submarine ? init.depth ?? 60 : spec.draft;
  const speedKn = init.speedKn ?? 0;
  return {
    id: init.id,
    cls: init.cls,
    team: init.team ?? spec.team,
    name: init.name,
    playerId: init.playerId,
    pos: { ...init.pos },
    depth,
    heading: init.heading,
    speed: speedKn * 0.514444,
    order: { heading: init.heading, speedKn, depth },
    alive: true,
    hp: spec.hp,
    lastTurnAt: -1e9,
    battery: spec.battery?.capacityKnH,
    snorkel: false,
    mastUp: false,
    radarOn: false,
    towedLength: 0,
    activeSonar: false,
    lastPingAt: -1e9,
    pulse: 'cw',
  };
}

/** A merchant of the convoy (neutral traffic is not part of it). */
export function isConvoyShip(s: Ship): boolean {
  return s.cls === 'merchant' && s.team !== 'neutral';
}

export function isAtPeriscopeDepth(s: Ship): boolean {
  return CLASSES[s.cls].submarine && s.depth <= PERISCOPE_DEPTH + 0.5;
}

/** Mast fully hoisted at periscope depth: optics, ESM and radio work. */
export function mastRaised(s: Ship): boolean {
  return (s.mastExt ?? (s.mastUp ? 1 : 0)) >= 1 && isAtPeriscopeDepth(s);
}

/** Enough mast or snorkel above the water for an enemy radar or lookout to notice. */
export function mastExposed(s: Ship): boolean {
  return isAtPeriscopeDepth(s) && Math.max(s.mastExt ?? (s.mastUp ? 1 : 0), s.snorkelExt ?? 0) > 0.3;
}
