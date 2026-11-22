import { SAM_SPECS, callFighter, distance, fireSam, inEnvelope, knownMines, planesFor, samsLeft, steerClear, type Ship, type World } from '@tk/shared';
import { SKILL, type BotMemory, type BotSkill } from './common.js';

/**
 * Escort AI against the enemy reconnaissance aircraft: an air contact heard on ESM brings
 * the radar up (which the boats can hear), a radar track inside the launcher's envelope
 * draws a missile, one out of reach calls the interceptors. And: steer clear of known mines.
 */
export function thinkAirDefense(w: World, m: BotMemory, s: Ship, skill: BotSkill): void {
  s.order.heading = steerClear(s.pos, s.order.heading, knownMines(w, s.team));
  const hostile = planesFor(w, s).filter((p) => p.side === 'hostile' && p.kind === 'recon');
  if (!hostile.length) {
    if (m.airRadar) {
      s.radarOn = false;
      m.airRadar = false;
    }
    return;
  }
  if (!s.radarOn) {
    s.radarOn = true;
    m.airRadar = true;
  }
  const spec = SAM_SPECS[s.cls];
  const sams = w.env.airdef?.sams ?? [];
  const flying = new Set(sams.filter((x) => !x.done && x.team === s.team).map((x) => x.targetId));
  for (const p of hostile) {
    if (!p.via.includes('radar') || p.x === undefined || p.y === undefined) continue;
    const r = distance(s.pos, { x: p.x, y: p.y });
    // Inside two thirds of the reach: a breaking target can't simply outrun the missile
    if (!spec || !inEnvelope(spec, r, p.alt ?? 0) || r > spec.maxRange * 0.67 || samsLeft(w, s) <= 0) continue;
    // One missile at a time per target: wait for the result before the next
    if (!flying.has(p.id) && fireSam(w, s, p.id) === true) return;
  }
  // Interceptors (one call per aircraft): for a high stand-off flight, or after the missiles failed
  const tough = hostile.find((p) => (p.alt ?? 0) > (spec?.maxAlt ?? 0) || sams.filter((x) => x.targetId === p.id && x.done === 'miss').length >= 2 || (!!spec && samsLeft(w, s) <= 0));
  if (SKILL[skill].air && tough && m.fighterFor !== tough.id && callFighter(w, s) === true) m.fighterFor = tough.id;
}
