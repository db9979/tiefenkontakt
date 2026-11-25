import type { Debrief, PlayerSlot, Ship, World } from '@tk/shared';
import type { Recorder } from './recorder.js';
import { spectateView } from './match-io.js';

/**
 * After the own ship sank: go aboard a living teammate's ship as crew (every station can be
 * manned by anyone aboard), or look at the debrief so far. The sunk player's statistics stay
 * with their own ship (`transferred`), so the ranking still counts the sinking.
 */

/** Put a sunk player aboard a teammate's ship. Returns an error text. */
export function boardTeammate(slots: PlayerSlot[], slot: PlayerSlot, captainId: string, shipOf: (playerId: string) => Ship | undefined): string | undefined {
  if (shipOf(slot.playerId)?.alive) return 'Nur nach dem Untergang des eigenen Schiffs';
  const cap = slots.find((s) => s.playerId === captainId);
  const ship = cap && shipOf(cap.playerId);
  if (!cap || cap.team !== slot.team || cap.crewOf || cap.bot || cap.playerId === slot.playerId || !ship?.alive) return 'Dieses Schiff kann niemanden aufnehmen';
  // Crew that served aboard the sunk ship goes along to the new one
  for (const s of slots) if (s.crewOf === slot.playerId) Object.assign(s, { crewOf: captainId, transferred: true, cls: cap.cls });
  Object.assign(slot, { crewOf: captainId, transferred: true, station: undefined });
  return undefined;
}

/** Teammates' ships (human captain, afloat) a sunk player may go aboard. */
export function boardable(slots: PlayerSlot[], slot: PlayerSlot, shipOf: (playerId: string) => Ship | undefined): { captainId: string; callsign: string; ship: string }[] {
  return slots.filter((c) => c.team === slot.team && !c.bot && !c.crewOf && c.playerId !== slot.playerId && shipOf(c.playerId)?.alive)
    .map((c) => ({ captainId: c.playerId, callsign: c.callsign, ship: shipOf(c.playerId)!.name }));
}

/** The debrief so far for a sunk player: truth cut off `delayS` ago (nothing to relay to the team), own figures included. */
export function provisionalDebrief(recorder: Recorder, w: World, slots: PlayerSlot[], playerId: string, delayS: number): Debrief {
  const view = spectateView(recorder, w, slots, delayS);
  const own = recorder.debrief(w, slots, { winner: 'west', reason: '' }).stats.filter((s) => s.playerId === playerId).map((s) => ({ ...s, won: false }));
  return { ...view, stats: own, reason: 'Partie läuft noch', provisional: true };
}
