import { KN, type FriendlyView, type PlayerSlot, type SavedWorld, type ServerMsg, type Ship, type World } from '@tk/shared';
import type { SavedClasses } from './classes.js';
import type { SavedCrew, BotState } from './bots/index.js';
import type { Recorder, RecorderState } from './recorder.js';
import type { ScenarioSettings } from './scenario.js';
import type { PlayerExtras } from './snapshot.js';

export interface Conn {
  playerId: string;
  callsign: string;
  send(msg: ServerMsg): void;
  /** The link is backed up (unsent data piling up): skip this tick's snapshot. */
  congested?(): boolean;
  /** Close the transport (e.g. when the same player connects again elsewhere; 4001 = banned). */
  close?(reason: string, code?: number): void;
  /** Client address, for bans. */
  ip?: string;
  /** Naval rank of an account (shown in the lobby). */
  rank?: string;
  /** Elo rating (guests 1000). */
  rating?: number;
}

export interface SavedMatch {
  v: 1;
  id: string;
  name: string;
  seed: number;
  slots: PlayerSlot[];
  settings: ScenarioSettings;
  world: SavedWorld;
  eventCursor: number;
  tickCount: number;
  bots: SavedCrew | BotState[];
  recorder?: RecorderState;
  classes: SavedClasses;
  extras: [string, Omit<PlayerExtras, 'reports'> & { reports: [string, FriendlyView][] }][];
}


/**
 * Pieces of Match that only move data out to the players: the delayed spectator view and the
 * team radio fan-out (kept apart so match.ts stays about lobby, ticking and results).
 */

/** The spectator's picture: the full debrief so far, cut off `delayS` sim seconds ago. */
export function spectateView(recorder: Recorder, w: World, slots: PlayerSlot[], delayS: number) {
  const cutoff = w.time - delayS;
  const full = recorder.debrief(w, slots, { winner: 'west', reason: 'LIVE' });
  return {
    ...full, stats: [], reason: 'Live, verzögert', duration: Math.max(0, Math.round(cutoff)),
    frames: full.frames.filter((f) => f[0] <= cutoff),
    torpedoes: full.torpedoes.filter((f) => f[0] <= cutoff),
    events: full.events.filter((e) => e.t <= cutoff && e.kind !== 'shot'),
  };
}

/** A radio message reaches every teammate, and gives them the sender's reported position. */
export function radioToTeam(
  w: World, ship: Ship, text: string, slots: PlayerSlot[], extras: Map<string, PlayerExtras>, shipOf: (playerId: string) => Ship | undefined,
): void {
  for (const mate of slots.filter((s) => s.team === ship.team)) {
    const x = extras.get(mate.playerId);
    if (!x) continue;
    x.radio.push({ time: w.time, from: ship.name, text });
    if (x.radio.length > 60) {
      x.radio.shift();
      x.radioDropped = (x.radioDropped ?? 0) + 1;
    }
    if (shipOf(mate.playerId)?.id !== ship.id) {
      x.reports.set(ship.id, {
        id: ship.id, name: ship.name, cls: ship.cls, x: ship.pos.x, y: ship.pos.y, heading: ship.heading,
        speedKn: ship.speed / KN, reportedAt: w.time, alive: ship.alive,
      });
    }
  }
}
