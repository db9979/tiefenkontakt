import type { ClassId, Team } from './classes.js';
import type { ContactTrack } from './contacts.js';
import type { ClassChoice } from './signatures.js';
import type { SeekerMode } from './weapons.js';

/** Messages client -> server. Validated with zod on the server. */
export type ClientMsg =
  | { t: 'create_match'; name: string }
  | { t: 'join'; matchId: string; team: Exclude<Team, 'neutral'> }
  | { t: 'leave' }
  | { t: 'pick_class'; cls: Exclude<ClassId, 'merchant'> }
  | { t: 'ready'; ready: boolean }
  | { t: 'order'; heading?: number; speedKn?: number; depth?: number }
  | { t: 'toggle'; what: 'mast' | 'snorkel' | 'radar' | 'active' | 'decoy'; on: boolean }
  | { t: 'towed'; length: number }
  | { t: 'fire'; heading: number; enableAfter: number; mode: SeekerMode; searchDepth: number; speedKn: number }
  | { t: 'steer'; torpId: string; heading: number }
  | { t: 'rocket'; bearing: number; range: number }
  | { t: 'dc'; depth: number }
  | { t: 'noisemaker' }
  | { t: 'radio'; text: string }
  | { t: 'classify'; label: string; choice: ClassChoice };

export interface PlayerSlot {
  playerId: string;
  callsign: string;
  team: Exclude<Team, 'neutral'>;
  cls: Exclude<ClassId, 'merchant'>;
  ready: boolean;
}

export interface MatchSummary {
  id: string;
  name: string;
  state: 'lobby' | 'running' | 'ended';
  players: number;
  maxPlayers: number;
}

export interface MatchLobby extends MatchSummary {
  slots: PlayerSlot[];
  settings: { timeScale: number; layerDepth: number; seaState: number; timeLimitMin: number; merchants: number };
}

export interface OwnShipView {
  id: string;
  cls: ClassId;
  team: Team;
  name: string;
  x: number;
  y: number;
  depth: number;
  heading: number;
  speedKn: number;
  order: { heading: number; speedKn: number; depth: number };
  alive: boolean;
  hp: number;
  battery?: number;
  batteryEnduranceS?: number;
  snorkel: boolean;
  mastUp: boolean;
  mastUpSince?: number;
  radarOn: boolean;
  activeSonar: boolean;
  lastPingAt?: number;
  towedLength: number;
  towedReady: boolean;
  noiseDb: number;
  cavitationKn: number;
  loadout: {
    tubes: { loaded: boolean; reloadLeft: number }[];
    heavy: number;
    light: number;
    rockets: number;
    depthCharges: number;
    noisemakers: number;
    towedDecoy: boolean;
  };
}

/** Friendly unit known via datalink (surface) or last radio report (subs). */
export interface FriendlyView {
  id: string;
  name: string;
  cls: ClassId;
  x: number;
  y: number;
  heading: number;
  speedKn: number;
  reportedAt: number;
  alive: boolean;
}

export interface TorpedoView {
  id: string;
  x: number;
  y: number;
  depth: number;
  heading: number;
  wire: boolean;
  homing: boolean;
  run: number;
}

export interface RadioMsg {
  time: number;
  from: string;
  text: string;
}

export interface AlertView {
  time: number;
  kind: 'torpedo' | 'esm' | 'ping' | 'sunk' | 'hit';
  bearing?: number;
  text: string;
}

export interface Snapshot {
  time: number;
  own: OwnShipView;
  contacts: (Omit<ContactTrack, 'history'> & {
    history: ContactTrack['history'];
    via: 'own' | 'datalink';
    /** The player's (or datalink group's) own classification decision. */
    assigned?: ClassChoice;
  })[];
  friendlies: FriendlyView[];
  torpedoes: TorpedoView[];
  radio: RadioMsg[];
  alerts: AlertView[];
  env: { layerDepth: number; seaState: number };
  score: { sunkTons: number; arrivedTons: number; totalTons: number; timeLeftS: number };
}

export type ServerMsg =
  | { t: 'welcome'; playerId: string; callsign: string }
  | { t: 'lobby'; matches: MatchSummary[] }
  | { t: 'match'; match: MatchLobby }
  | { t: 'snap'; s: Snapshot }
  | { t: 'end'; winner: Exclude<Team, 'neutral'>; reason: string }
  | { t: 'error'; msg: string };
