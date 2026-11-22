import { PERISCOPE_DEPTH, activeOrders, bearing, distance, mastRaised, transmit, type Ship, type World } from '@tk/shared';
import { classify, type BotMemory } from './common.js';

/**
 * Submarine captains and fleet command's FLASH orders (once read aboard): clear an area,
 * send an enemy report or a situation report. Attacking the convoy is what they do anyway.
 * Runs after the captain's own decision and only bends it where an order says so.
 */
export function obeySub(w: World, m: BotMemory, s: Ship): void {
  const now = w.time;
  if (m.passive || now < m.evadeUntil) return;
  // Hunted, or an escort close enough to hear the mast and DF the transmission: not now
  const escortNear = (w.books.get(s.id)?.tracks() ?? []).some((t) => now - t.lastSeen < 60 && !t.sensors.includes('esm') && t.se > 15 && classify(t) === 'warship');
  const hunted = now < (m.silentUntil ?? 0) || escortNear;
  for (const o of activeOrders(w, s)) {
    if (o.kind === 'clear' && o.area) {
      // Leave the area by the shortest way, a little faster than creeping
      const r = distance(s.pos, o.area);
      if (r < o.area.r + 800) {
        s.order.heading = bearing(o.area, s.pos);
        s.order.speedKn = Math.max(s.order.speedKn, 6);
      }
    } else if (o.kind === 'report') {
      // Report as soon as the next pack report is possible
      m.lastReport = Math.min(m.lastReport, now - 3600);
    } else if (o.kind === 'sitrep' && !hunted && (o.deadline - now < 900 || !w.ships.some((x) => x.team === s.team && x.id < s.id && x.alive))) {
      // One boat (the first of the pack, or whoever when time runs short) goes up and reports
      s.order.depth = PERISCOPE_DEPTH;
      s.order.speedKn = Math.min(s.order.speedKn, 5);
      s.snorkel = false;
      if (s.depth <= PERISCOPE_DEPTH + 0.5) s.mastUp = true;
      if (mastRaised(s)) {
        transmit(w, s, 'Lagebericht: Boot einsatzbereit');
        s.mastUp = false;
      }
    }
  }
}
