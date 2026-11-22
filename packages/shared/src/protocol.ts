import type { ClassId, NeutralClass, Team } from './classes.js';
import type { VoiceClientMsg, VoiceServerMsg } from './voice.js';
import type { ContactTrack } from './contacts.js';
import type { DamageState, ShipSystem } from './damage.js';
import type { CompartmentView, WreckView } from './compartments.js';
import type { ClassChoice } from './signatures.js';

export type MissionKey = 'groenland' | 'schelf' | 'fjord' | 'duell' | 'hafen' | 'eigene' | 'fuehlung' | 'meerenge' | 'aufklaerung';
export interface CustomMissionSettings {
  convoyKn: number;
  seabed: 'tief' | 'schelf' | 'fjord';
  subFrac: number;
}
import type { SeekerMode } from './weapons.js';

/** Messages client -> server. Validated with zod on the server. */
export type ClientMsg =
  | { t: 'create_match'; name: string; private?: boolean }
  /** Join through an invite link: the server picks the team with fewer players. */
  | { t: 'join_code'; matchId: string }
  | { t: 'join'; matchId: string; team: Exclude<Team, 'neutral'> }
  | { t: 'leave' }
  | { t: 'pick_class'; cls: Exclude<ClassId, 'merchant' | NeutralClass> }
  | { t: 'ready'; ready: boolean }
  | { t: 'order'; heading?: number; speedKn?: number; depth?: number }
  /** silent = "Ruhe im Boot", battle = Gefechtsstationen, buoyant = Schleppantenne (receive-only). */
  | { t: 'toggle'; what: 'mast' | 'snorkel' | 'radar' | 'active' | 'decoy' | 'silent' | 'battle' | 'buoyant' | 'vds'; on: boolean }
  | { t: 'blow' }
  | { t: 'mad'; bearing: number; range: number }
  | { t: 'towed'; length: number }
  | { t: 'fire'; heading: number; enableAfter: number; mode: SeekerMode; searchDepth: number; speedKn: number }
  | { t: 'steer'; torpId: string; heading: number }
  | { t: 'rocket'; bearing: number; range: number }
  | { t: 'dc'; depth: number }
  | { t: 'noisemaker' }
  | { t: 'radio'; text: string }
  | { t: 'lobby_chat'; text: string }
  /** Report the sender of a radio message (ship name as shown) to the moderators. */
  | { t: 'report'; from: string; reason: string }
  | { t: 'classify'; label: string; choice: ClassChoice }
  | { t: 'pulse'; pulse: 'cw' | 'lfm' }
  | { t: 'bt' }
  | { t: 'buoy'; bearing: number; range: number; deep: boolean; active?: boolean }
  | { t: 'dip'; bearing: number; range: number; deep: boolean }
  | { t: 'helotorp'; bearing: number; range: number }
  | { t: 'mpa'; bearing: number; range: number }
  | { t: 'repair'; system: ShipSystem }
  /** Pass a FLASH order on (convoy turn) to the commodore. */
  | { t: 'execute_order'; id: string }
  /** Damage control: send the party to a compartment, or close / open its bulkheads. */
  | { t: 'compartment'; index: number; action: 'priority' | 'seal' | 'open' }
  | VoiceClientMsg
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
    sandbox?: boolean;
  }
  /** Start the next mission of the player's campaign run (accounts). */
  | { t: 'campaign_start' }
  | SandboxClientMsg;

/** Sandbox / training mode controls (only accepted in sandbox matches). */
export interface SandboxClientMsg {
  t: 'sandbox';
  op: 'speed' | 'truth' | 'spawn' | 'steer' | 'remove';
  /** speed: 0 = pause, 1 … 10. */
  scale?: number;
  on?: boolean;
  cls?: ClassId;
  /** spawn: from the player's own ship. */
  bearing?: number;
  range?: number;
  heading?: number;
  speedKn?: number;
  depth?: number;
  id?: string;
}

/** God's-eye picture of a sandbox match: true positions of every unit. */
export interface TruthView {
  time: number;
  ships: { id: string; name: string; cls: ClassId; team: Team; x: number; y: number; heading: number; speedKn: number; depth: number; alive: boolean }[];
  torpedoes: { id: string; ownerId: string; x: number; y: number }[];
}

export interface PlayerSlot {
  playerId: string;
  callsign: string;
  team: Exclude<Team, 'neutral'>;
  cls: Exclude<ClassId, 'merchant' | NeutralClass>;
  ready: boolean;
  /** AI captain filling an empty team. */
  bot?: boolean;
  /** Set when this player serves as crew on the captain's ship. */
  crewOf?: string;
  /** Station the player mans (index into the ship's station tabs). */
  station?: number;
  /** Naval rank from the service record (accounts only). */
  rank?: string;
  /** Elo rating (accounts; guests 1000). */
  rating?: number;
}

export interface LobbyChatLine {
  from: string;
  text: string;
  at: number;
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
  /** Chat among the players while the match is being set up. */
  chat?: LobbyChatLine[];
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
    /** Not listed; joined only through an invite link. */
    private?: boolean;
    weather: 'wechselhaft' | 'stabil';
    custom?: CustomMissionSettings;
    merchantsCount?: number;
    lesson?: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd';
    /** Training sandbox: truth view, time controls and spawning. */
    sandbox?: boolean;
    /** A mission of a player's campaign run. */
    campaign?: boolean;
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
  /** Mast and snorkel hoist state 0..1 (they take seconds to move). */
  mastExt?: number;
  snorkelExt?: number;
  mastUpSince?: number;
  radarOn: boolean;
  activeSonar: boolean;
  pulse: 'cw' | 'lfm';
  lastPingAt?: number;
  towedLength: number;
  towedOrder?: number;
  vdsDepth?: number;
  vdsOrder?: number;
  towedReady: boolean;
  /** People aboard, air (diesel boats), trim, high-pressure air, blow, buoy antenna (crew.ts, boat.ts). */
  crew?: { fatigue: number; morale: number; wounded: number; battle: boolean; silent: boolean; performance: number; xp?: number };
  air?: { co2: number; o2: number; scrubbers: number; candles: number };
  trim?: number;
  hpAir?: number;
  blowing?: boolean;
  buoyAntenna?: boolean;
  /** Submerged boats: estimated position uncertainty (m) since the last fix; x/y are the dead-reckoned position. */
  navUncertainty?: number;
  rudderJam?: boolean;
  towedLost?: boolean;
  /** Fleet-command broadcasts: seconds to the next window (0 = open), copy progress 0..1, how. */
  command?: { nextS: number; progress: number; done: boolean; via?: 'vlf' | 'buoy' };
  noiseDb: number;
  cavitationKn: number;
  damage: DamageState;
  repair?: ShipSystem;
  /** Compartments bow first (compartmentLayout(cls) names them), where the party works, trim/list/settling. */
  comps?: CompartmentView[];
  dcComp?: number;
  dcAt?: number;
  wreck?: WreckView;
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
  /** Navigation lights on. */
  lit?: boolean;
  /** Visible damage: list, trim, fire, settling. */
  wreck?: WreckView;
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
  kind: 'torpedo' | 'esm' | 'ping' | 'sunk' | 'hit' | 'transient' | 'sighting' | 'boat' | 'splash' | 'command' | 'flash';
  /** Intercepted ping: received level (dB over threshold) and the kind of source. */
  level?: number;
  source?: 'hull' | 'dip' | 'buoy';
  /** Lookout sightings: what, rough range and the contact label. */
  what?: 'mast' | 'snorkel' | 'surfaced';
  range?: number;
  label?: string;
  bearing?: number;
  /** Sinking noises of a ship that was already reported hit (no new detonation). */
  sink?: boolean;
  text: string;
}

/** Mission briefing, sent with complete snapshots (start and reconnect). */
export interface Briefing {
  title: string;
  info: string;
  goal: string;
  intel: string[];
  steps: string[];
  timeLimitMin: number;
  timeOfDay: string;
  ship: string;
}

export interface Snapshot {
  /** Aircraft this ship knows of (datalink, radar, eye, ESM). */
  planes?: import('./airspace.js').PlaneView[];
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
  briefing?: Briefing;
  own: OwnShipView;
  contacts: (Omit<ContactTrack, 'history'> & {
    /** Delta: only samples newer than the previous snapshot (all of them when `full`). */
    history: ContactTrack['history'];
    via: 'own' | 'datalink';
    /** What the periscope shows of the target's damage. */
    wreck?: WreckView;
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
    /** Met forecast: fog banks, rain squalls, ice floes and icebergs (public). */
    met?: import('./met.js').MetCells;
    /** Ship's clock, hour of day. */
    clock?: number;
  };
  score: { sunkTons: number; arrivedTons: number; totalTons: number; timeLeftS: number };
  /** FLASH orders from fleet command read aboard (orders.ts). */
  orders?: import('./orders.js').OrderView[];
  /** Surface ships: the AI escorts' team datum and hunter-killer roles (ship names), via datalink. */
  hunt?: { datum?: { x: number; y: number; t: number; q: number }; director?: string; attacker?: string };
  /** Own team's sonobuoys and helicopters (surface ships, via datalink). */
  air?: {
    buoys: { id: string; x: number; y: number; depth: number; leftS: number; active?: boolean }[];
    helos: { x: number; y: number; kind: 'buoy' | 'dip' | 'torpedo' | 'mpa' | 'mad'; hovering: boolean }[];
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
  /** What the AI adapted to from this player's earlier matches (shown in the debrief). */
  learned?: string[];
  /** FLASH orders of both sides and how they ended. */
  orders?: import('./orders.js').OrderSummary[];
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
  /** Share of the match spent at periscope depth, above the layer, above 12 kn, pinging (0..1). */
  habits?: Habits;
  /** Bonus/penalty for the side's FLASH orders (counts in the service points). */
  orderPoints?: number;
}

export interface Habits {
  pd: number;
  above: number;
  fast: number;
  ping: number;
}

export type ServerMsg =
  | VoiceServerMsg
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
  | { t: 'removed'; msg: string }
  /** Sandbox matches: time scale (0 = paused) and, for players who switched it on, the truth view. */
  | { t: 'sandbox'; scale: number; truth?: TruthView };
