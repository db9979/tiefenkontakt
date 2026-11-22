import { CLASSES } from './classes.js';
import { mastRaised, type Ship } from './entities.js';
import { clamp, distance } from './math.js';

/**
 * Voice radio rules, shared by server (who may talk to whom) and client (what to show).
 * Surface ships are always on the air; a submarine only when surfaced or at periscope
 * depth with the mast up (VLF and the trailing antenna carry no voice). Range is UHF line
 * of sight, set by both antenna heights; the link gets noisier toward the horizon.
 * Crew of the same ship talk over the intercom, always and without noise.
 */

/** Antenna height above the water (m). */
export function antennaHeight(s: Ship): number {
  if (CLASSES[s.cls].submarine) return s.depth <= 0.5 ? 6 : 4;
  return s.cls === 'kor' ? 20 : 30;
}

/** A ship can send and receive voice right now. */
export function radioUp(s: Ship): boolean {
  if (!s.alive) return false;
  if (!CLASSES[s.cls].submarine) return true;
  return s.depth <= 0.5 || mastRaised(s);
}

/** Why a ship can't use voice radio, or undefined if it can. */
export function radioDownReason(s: Ship): string | undefined {
  if (!s.alive) return 'Schiff verloren';
  if (radioUp(s)) return undefined;
  return 'Kein Sprechfunk getaucht · auf Sehrohrtiefe gehen und Funkmast ausfahren';
}

/** UHF line-of-sight range between two antennas (m): 4.12 km × (√h1 + √h2). */
export function voiceRange(a: Ship, b: Ship): number {
  return 4120 * (Math.sqrt(antennaHeight(a)) + Math.sqrt(antennaHeight(b)));
}

/** Link quality 0..1 between two ships (0 = no link). Same ship = intercom = 1. */
export function voiceQuality(a: Ship, b: Ship): number {
  if (a.id === b.id) return a.alive ? 1 : 0;
  if (!radioUp(a) || !radioUp(b)) return 0;
  const d = distance(a.pos, b.pos);
  const r = voiceRange(a, b);
  if (d > r) return 0;
  return clamp(1 - (d / r) ** 4, 0.15, 1);
}

export interface IceServerConfig { urls: string | string[]; username?: string; credential?: string }

export interface VoicePeer { playerId: string; callsign: string; ship: string; sameShip: boolean }

/** Link from me to another voice member: quality (0 = out of reach) and whether they are talking to me now. */
export interface VoiceLink { playerId: string; q: number; talking: boolean }

/** WebRTC signalling payload relayed between two team mates (mesh mode). */
export interface VoiceSignal {
  sdp?: { type: 'offer' | 'answer'; sdp: string };
  ice?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
}

export type VoiceClientMsg =
  | { t: 'voice'; op: 'join' }
  | { t: 'voice'; op: 'leave' }
  | { t: 'voice'; op: 'signal'; to: string; data: VoiceSignal }
  | { t: 'voice'; op: 'ptt'; on: boolean };

export type VoiceServerMsg =
  /** Joined: ICE servers for the mesh, or the selective forwarding unit (server-enforced). */
  | { t: 'voice'; op: 'config'; ice: IceServerConfig[]; sfu?: { url: string; token: string; room: string } }
  | { t: 'voice'; op: 'peers'; peers: VoicePeer[] }
  | { t: 'voice'; op: 'signal'; from: string; data: VoiceSignal }
  | { t: 'voice'; op: 'state'; canTx: boolean; reason?: string; ptt: boolean; links: VoiceLink[] };
