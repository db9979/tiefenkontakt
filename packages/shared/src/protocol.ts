import type { ClassId, Team } from './classes.js';
import type { ContactTrack } from './contacts.js';
import type { DamageState, ShipSystem } from './damage.js';
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
  | { t: 'classify'; label: string; choice: ClassChoice }
  | { t: 'pulse'; pulse: 'cw' | 'lfm' }
  | { t: 'bt' }
  | { t: 'buoy'; bearing: number; range: number; deep: boolean }
  | { t: 'repair'; system: ShipSystem }
  | { t: 'crew'; captainId: string | null };

export interface PlayerSlot {
  playerId: string;
  callsign: string;
  team: Exclude<Team, 'neutral'>;
  cls: Exclude<ClassId, 'merchant'>;
  ready: boolean;
  /** AI captain filling an empty team. */
  bot?: boolean;
  /** Set when this player serves as crew on the captain's ship. */
  crewOf?: string;
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
  settings: { timeScale: number; layerDepth: number; seaState: number; timeLimitMin: number; merchants: number; fillBots: boolean };
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
  pulse: 'cw' | 'lfm';
  lastPingAt?: number;
  towedLength: number;
  towedReady: boolean;
  noiseDb: number;
  cavitationKn: number;
  damage: DamageState;
  repair?: ShipSystem;
  loadout: {
    tubes: { loaded: boolean; reloadLeft: number }[];
    heavy: number;
    light: number;
    rockets: number;
    depthCharges: number;
    noisemakers: number;
    towedDecoy: boolean;
    xbt: number;
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
  kind: 'torpedo' | 'esm' | 'ping' | 'sunk' | 'hit' | 'transient';
  bearing?: number;
  text: string;
}

export interface Snapshot {
  time: number;
  /** Sim seconds per real second (for echo travel times and clocks). */
  timeScale: number;
  /** Callsigns of everyone aboard the own ship. */
  crew: string[];
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
  /** layerDepth is only known after a bathythermograph measurement. */
  env: { layerDepth?: number; seaState: number };
  score: { sunkTons: number; arrivedTons: number; totalTons: number; timeLeftS: number };
  /** Own team's sonobuoys and helicopters (surface ships, via datalink). */
  air?: {
    buoys: { id: string; x: number; y: number; depth: number; leftS: number }[];
    helos: { x: number; y: number }[];
    stock: number;
    heloReadyInS: number;
  };
}

export type ServerMsg =
  | { t: 'welcome'; playerId: string; callsign: string }
  | { t: 'lobby'; matches: MatchSummary[] }
  | { t: 'match'; match: MatchLobby }
  | { t: 'snap'; s: Snapshot }
  | { t: 'end'; winner: Exclude<Team, 'neutral'>; reason: string }
  | { t: 'error'; msg: string };
