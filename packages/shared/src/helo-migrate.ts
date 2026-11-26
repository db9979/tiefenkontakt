import { aircraftPosition } from './aviation.js';
import { hasHelicopter } from './classes.js';
import { HELO_BUOYS, HELO_ENDURANCE_S, HELO_TORPS, makeTask, newHelo, type HeloOrder } from './helo.js';
import type { World } from './world.js';

/**
 * Older saves flew one sortie per task (kind undefined = buoy) and kept every buoy and torpedo
 * in the ship's stock. Turn each ship's sortie into the airborne helicopter with that task still
 * to do (then home), or into the helicopter on deck finishing its turnaround.
 */
export function migrateHelos(w: World): void {
  const air = w.air;
  if (!air) return;
  const old = air.sorties.filter((s) => s.kind !== 'mpa');
  if (air.helos && !old.length) return;
  air.helos ??= {};
  air.heloTorps ??= new Map();
  for (const ship of w.ships) {
    if (!hasHelicopter(ship.cls) || air.helos[ship.id]) continue;
    const stock = air.stock.get(ship.id) ?? 0;
    const torps = air.heloTorps.get(ship.id) ?? 0;
    const h = newHelo(ship, Math.min(HELO_BUOYS, stock), Math.min(HELO_TORPS, torps));
    air.stock.set(ship.id, stock - h.buoys);
    air.heloTorps.set(ship.id, torps - h.torps);
    air.helos[ship.id] = h;
    const s = old.find((x) => x.shipId === ship.id && w.time < x.readyAt);
    if (!s) continue;
    if (w.time >= s.landAt) {
      h.readyAt = s.readyAt;
      continue;
    }
    const p = aircraftPosition(s, w.time, ship) ?? ship.pos;
    Object.assign(h, { state: 'air', x: p.x, y: p.y, launchAt: s.launchAt, fuel: HELO_ENDURANCE_S - (w.time - s.launchAt) });
    const kind = s.kind ?? 'buoy';
    const at = { x: s.target.x, y: s.target.y };
    const task = (o: HeloOrder) => h.queue.push(makeTask(h, ship, o));
    if (!s.dropped) {
      // The buoy or torpedo of this sortie was already taken from the stock: it is aboard
      if (kind === 'buoy') { h.buoys++; task({ kind: 'buoys', at, count: 1, active: s.active }); }
      else if (kind === 'torpedo') { h.torps++; task({ kind: 'attack', at }); }
      else if (kind === 'dip' || kind === 'mad') task({ kind, at, count: 1 });
    } else if ((kind === 'dip' || kind === 'mad') && s.hoverUntil !== undefined && w.time < s.hoverUntil) {
      task({ kind, at, count: 1 });
      Object.assign(h.queue[0]!, { phase: 'work', from: s.dropAt, until: s.hoverUntil, lastPing: s.lastPing ?? -1e9, madHit: s.madHit });
    }
    task({ kind: 'return' });
  }
  air.sorties = air.sorties.filter((s) => s.kind === 'mpa');
}
