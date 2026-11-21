import type { ClassId, Team } from './classes.js';
import type { ContactTrack } from './contacts.js';
import type { DamageState, ShipSystem } from './damage.js';
import type { ClassChoice } from './signatures.js';

export type MissionKey = 'groenland' | 'schelf' | 'fjord' | 'duell' | 'hafen' | 'eigene';
export interface CustomMissionSettings {
  convoyKn: number;
  seabed: 'tief' | 'schelf' | 'fjord';
  subFrac: number;
}
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
  /** Report the sender of a radio message (ship name as shown) to the moderators. */
  | { t: 'report'; from: string; reason: string }
  | { t: 'classify'; label: string; choice: ClassChoice }
  | { t: 'pulse'; pulse: 'cw' | 'lfm' }
  | { t: 'bt' }
  | { t: 'buoy'; bearing: number; range: number; deep: boolean }
  | { t: 'dip'; bearing: number; range: number; deep: boolean }
  | { t: 'helotorp'; bearing: number; range: number }
  | { t: 'mpa'; bearing: number; range: number }
  | { t: 'repair'; system: ShipSystem }
  | { t: 'crew'; captainId: string | null }
  | { t: 'training'; lesson: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd' }
  | { t: 'lesson_done' }
  | { t: 'station'; index: number }
  | { t: 'quick' }
  | { t: 'spectate'; matchId: string }
  | {
    t: 'settings';
    mission?: MissionKey;
    timeOfDay?: 'tag' | 'daemmerung' | 'nacht';
    seaState?: number;
    timeLimitMin?: number;
    fillBots?: boolean;
    botSkill?: 'leicht' | 'normal' | 'schwer';
    weather?: 'wechselhaft' | 'stabil';
    custom?: CustomMissionSettings;
    merchants?: number;
  };

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
  /** Station the player mans (index into the ship's station tabs). */
  station?: number;
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
  settings: {
    mission: MissionKey;
    timeOfDay: 'tag' | 'daemmerung' | 'nacht';
    timeScale: number;
    layerDepth: number;
    seaState: number;
    timeLimitMin: number;
    merchants: number;
    fillBots: boolean;
    botSkill: 'leicht' | 'normal' | 'schwer';
    weather: 'wechselhaft' | 'stabil';
    custom?: CustomMissionSettings;
    merchantsCount?: number;
    lesson?: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd';
  };
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
  /** True when the snapshot is complete (first after (re)connect). Otherwise contact
   * histories, evidence, alerts and radio are deltas the client accumulates. */
  full?: boolean;
  /** Callsigns of everyone aboard the own ship. */
  crew: string[];
  /** Who mans which station aboard. */
  stations?: { callsign: string; station: number }[];
  /** Training lesson id when this is a lesson. */
  lesson?: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd';
  own: OwnShipView;
  contacts: (Omit<ContactTrack, 'history'> & {
    /** Delta: only samples newer than the previous snapshot (all of them when `full`). */
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
  env: {
    layerDepth?: number;
    seaState: number;
    /** 1 = day, 0 = dark night */
    light?: number;
    /** Water depth under the own ship (m) and the chart, which is public. */
    bottom?: number;
    seabed?: { kind: 'tief' | 'schelf' | 'fjord'; seed: number };
    rain?: boolean;
    /** Ship's clock, hour of day. */
    clock?: number;
  };
  score: { sunkTons: number; arrivedTons: number; totalTons: number; timeLeftS: number };
  /** Own team's sonobuoys and helicopters (surface ships, via datalink). */
  air?: {
    buoys: { id: string; x: number; y: number; depth: number; leftS: number }[];
    helos: { x: number; y: number; kind: 'buoy' | 'dip' | 'torpedo' | 'mpa'; hovering: boolean }[];
    stock: number;
    heloReadyInS: number;
    heloTorps: number;
    mpaReadyInS: number;
    mpaBuoys: number;
  };
}

/** Full truth, released only after the match ended. */
export interface Debrief {
  ships: { id: string; name: string; cls: ClassId; team: Team; player: boolean }[];
  /** Positions every few sim seconds: [t, [id, x, y, heading, alive(0/1)][]] */
  frames: [number, [string, number, number, number, number][]][];
  torpedoes: [number, [string, number, number][]][];
  events: { t: number; kind: 'sunk' | 'shot' | 'arrived'; shipId: string; byId?: string; what?: string }[];
  stats: PlayerStats[];
  winner: Exclude<Team, 'neutral'>;
  reason: string;
  duration: number;
}

export interface PlayerStats {
  playerId: string;
  callsign: string;
  team: Exclude<Team, 'neutral'>;
  cls: ClassId;
  survived: boolean;
  shots: number;
  rockets: number;
  buoys: number;
  kills: number;
  tonnageSunk: number;
  firstContactS?: number;
  distanceNm: number;
  won: boolean;
}

export type ServerMsg =
  | { t: 'welcome'; playerId: string; callsign: string; resume?: boolean }
  | { t: 'lobby'; matches: MatchSummary[] }
  | { t: 'match'; match: MatchLobby }
  | { t: 'snap'; s: Snapshot }
  | { t: 'end'; winner: Exclude<Team, 'neutral'>; reason: string }
  | { t: 'debrief'; d: Debrief }
  /** Spectators get the truth picture, delayed so it can't be used to help a team. */
  | { t: 'spectate'; d: Debrief; delayS: number }
  | { t: 'error'; msg: string }
  /** Removed from the match by a moderator (kick or match ended). */
  | { t: 'removed'; msg: string };
