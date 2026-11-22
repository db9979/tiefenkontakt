import type { ClassId, Team } from './classes.js';
import type { DamageState, ShipSystem } from './damage.js';
import { CLASSES } from './classes.js';
import type { Vec2 } from './math.js';

export interface ShipOrder {
  heading: number; // deg
  speedKn: number;
  depth: number; // m (ignored for surface ships)
}

export interface Ship {
  id: string;
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
  radarOn: boolean;
  towedLength: number; // m deployed, 0 = stowed
  /** Ordered array length; the winch pays out about 4 m/s and recovers about 3 m/s. */
  towedOrder?: number;
  activeSonar: boolean; // pings periodically when true
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
