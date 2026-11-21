import type { ClassId, Team } from './classes.js';
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
  mastUp: boolean; // periscope / radio mast raised (needs periscope depth)
  radarOn: boolean;
  towedLength: number; // m deployed, 0 = stowed
  activeSonar: boolean; // pings periodically when true
  lastPingAt: number;
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
  };
}

export function isAtPeriscopeDepth(s: Ship): boolean {
  return CLASSES[s.cls].submarine && s.depth <= PERISCOPE_DEPTH + 0.5;
}
