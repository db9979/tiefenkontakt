import { northOffset, toGame, toTrue } from '@tk/shared';

/**
 * North-up display. The simulation and every number in the protocol stay in the game frame
 * (+y along the convoy route); the client turns the chart so true north is up and shows and
 * takes true degrees. Set from the snapshot's sea area (or the debrief's).
 */
let off = 0;

export function setNorthRegion(region: unknown): void {
  off = northOffset(region);
}
/** Degrees to add to a game-frame direction for true north. */
export const northOff = (): number => off;
/** Game-frame direction → true degrees for display. */
export const trueDeg = (game: number): number => toTrue(game, off);
/** True degrees the player entered → game frame for the server. */
export const gameDeg = (tru: number): number => toGame(tru, off);
/** Game-frame vector (x, y) → north-up frame (east, north). */
export function toNorthUp(x: number, y: number): { x: number; y: number } {
  const b = (off * Math.PI) / 180;
  return { x: x * Math.cos(b) + y * Math.sin(b), y: -x * Math.sin(b) + y * Math.cos(b) };
}
/** North-up frame (east, north) → game frame. */
export function fromNorthUp(e: number, n: number): { x: number; y: number } {
  const b = (off * Math.PI) / 180;
  return { x: e * Math.cos(b) - n * Math.sin(b), y: e * Math.sin(b) + n * Math.cos(b) };
}
