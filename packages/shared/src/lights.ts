import { CLASSES } from './classes.js';
import type { World } from './world.js';

/**
 * Navigation lights. Neutral traffic always burns them. The convoy keeps them on so the
 * columns can hold station, and darkens the moment a threat shows (torpedo alarm, a ship
 * lost, a periscope sighted) until 30 quiet minutes have passed. Escorts follow the convoy
 * and also go dark while they hunt (pinging or at battle stations). Boats never show lights.
 * Lit ships are seen much farther at night.
 */

export const THREAT_MEMORY_S = 1800;

const cursor = new WeakMap<World, number>();

export function stepLights(w: World): void {
  const from = cursor.get(w) ?? 0;
  for (let i = from; i < w.events.length; i++) {
    const e = w.events[i]!;
    const westShip = 'shipId' in e ? w.ships.find((s) => s.id === e.shipId)?.team === 'west' : false;
    if ((e.kind === 'torpedo_alert' || e.kind === 'sunk' || e.kind === 'sighting') && westShip) w.env.threatAt = e.time;
  }
  cursor.set(w, w.events.length);
  const alarm = w.env.threatAt !== undefined && w.time - w.env.threatAt < THREAT_MEMORY_S;
  for (const s of w.ships) {
    if (!s.alive) {
      s.lights = false;
      continue;
    }
    if (s.team === 'neutral') s.lights = true;
    else if (CLASSES[s.cls].submarine) s.lights = false;
    else if (s.cls === 'merchant') s.lights = !alarm;
    else s.lights = !alarm && !s.activeSonar && !s.crew?.battle;
  }
}
