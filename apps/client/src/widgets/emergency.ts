import { CLASSES } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';

/**
 * Orders that must work from any station in an emergency (E3): the buttons on the stations
 * and the emergency keys in screens/game.ts both call these.
 */

/** Alarmtauchen: masts and snorkel in, deep (under the layer when it is known), full speed. */
export function crashDive(): void {
  const s = store.snap;
  if (!s) return;
  const o = s.own;
  const maxD = CLASSES[o.cls].maxDepth;
  const bottom = s.env.bottom ?? 9999;
  const layer = s.env.layerDepth;
  if (o.mastUp || o.mastPending) net.send({ t: 'toggle', what: 'mast', on: false });
  if (o.snorkel) net.send({ t: 'toggle', what: 'snorkel', on: false });
  net.send({ t: 'order', depth: Math.max(40, Math.min(maxD * 0.8, bottom - 30, layer !== undefined ? layer + 40 : 150)), speedKn: CLASSES[o.cls].maxSpeedKn });
}

/** Mast (periscope / radio mast) in. */
export function mastDown(): void {
  net.send({ t: 'toggle', what: 'mast', on: false });
}

/** Submarine: a noisemaker; surface ship: stream the towed decoy (a second press does not recover it). */
export function decoy(): void {
  const s = store.snap;
  if (!s) return;
  if (CLASSES[s.own.cls].submarine) net.send({ t: 'noisemaker' });
  else if (!s.own.loadout.towedDecoy) net.send({ t: 'toggle', what: 'decoy', on: true });
}

/** One active ping (surface ship). */
export function singlePing(): void {
  net.send({ t: 'ping', single: true });
}
