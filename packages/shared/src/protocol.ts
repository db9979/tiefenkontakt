import type { Season } from './climate.js';
import type { RegionId } from './regions.js';
import type { ClassId, NeutralClass, Team } from './classes.js';
import type { VoiceClientMsg, VoiceServerMsg } from './voice.js';
import type { ContactTrack } from './contacts.js';
import type { DamageState, ShipSystem } from './damage.js';
import type { CompartmentView, WreckView } from './compartments.js';
import type { ClassChoice } from './signatures.js';
import type { StationId } from './stations.js';

export type MissionKey = 'groenland' | 'schelf' | 'fjord' | 'duell' | 'hafen' | 'eigene' | 'fuehlung' | 'meerenge' | 'aufklaerung';
export interface CustomMissionSettings {
  convoyKn: number;
  seabed: 'tief' | 'schelf' | 'fjord';
  subFrac: number;
}
import type { SeekerMode } from './weapons.js';
import type { EscortCmdKind } from './orders.js';

/** What the escort commander sees: the convoy's ordered state and each AI escort's task. */
export interface EscortCommandView {
  convoy?: {
    zigzag: boolean;
    /** Zigzag plan steamed now (1–6, 0 = none), seconds to the next zig, and every plan's speed of advance (fraction). */
    zigPlan?: number;
    zigLeftS?: number;
    zigPlans?: { n: number; name: string; text: string; advance: number }[];
    /** Speed the convoy makes now and the commander's change to the route speed (kn). */
    speedKn: number;
    adj: number;
    /** Emergency turn under way: to which side and seconds until it resumes the route. */
    turn?: { side: -1 | 1; leftS: number };
    /** Sideways detour from the route (m, + starboard). */
    offset?: number;
    /** Course ordered by the commander (game frame); absent = on the route. */
    course?: number;
  };
  escorts: {
    id: string;
    name: string;
    cls: ClassId;
    /** What the planner has her doing (screen, hunter, director, attacker) or the ordered task. */
    role?: string;
    /** The commander's order she follows (until cancelled or done). */
    task?: { kind: EscortCmdKind; x?: number; y?: number; rel?: number; range?: number; sinceS: number };
    helo: boolean;
  }[];
}

/** Einsteiger: assistance (auto-classification, ranges); Profi: what the crew can really know. */
export type Realism = 'einsteiger' | 'profi';
/** Powers of the attack periscope. */
export type ScopeMag = 1.5 | 6 | 12;

/** Messages client -> server. Validated with zod on the server. */
export type ClientMsg =
  /** setup: rebuild a finished match's situation (same seed and lobby choices, debrief "Gleiche Lage"). */
  | { t: 'create_match'; name: string; private?: boolean; setup?: MatchSetup }
  /** Join through an invite link: the server picks the team with fewer players. */
  | { t: 'join_code'; matchId: string }
  | { t: 'join'; matchId: string; team: Exclude<Team, 'neutral'> }
  | { t: 'leave' }
  | { t: 'pick_class'; cls: Exclude<ClassId, 'merchant' | NeutralClass> }
  | { t: 'ready'; ready: boolean }
  | { t: 'order'; heading?: number; speedKn?: number; depth?: number } | { t: 'route'; wps?: import('./route.js').Waypoint[]; idx?: number; active?: boolean }
  /** silent = "Ruhe im Boot", battle = Gefechtsstationen, buoyant = Schleppantenne (receive-only). */
  | { t: 'toggle'; what: 'mast' | 'snorkel' | 'radar' | 'active' | 'decoy' | 'silent' | 'battle' | 'buoyant' | 'vds' | 'mineavoid' | 'sounding'; on: boolean }
  | { t: 'blow' }
  | { t: 'mad'; bearing: number; range: number }
  | { t: 'towed'; length: number }
  /** salvo: 1–4 torpedoes fanned about heading, spread degrees apart (default one). */
  | { t: 'fire'; heading: number; enableAfter: number; mode: SeekerMode; searchDepth: number; speedKn: number; transitKn?: number; salvo?: number; spread?: number }
  | { t: 'steer'; torpId: string; heading: number }
  | { t: 'rocket'; bearing: number; range: number }
  | { t: 'ssm'; bearing: number; range: number }
  | { t: 'dc'; depth: number }
  | { t: 'noisemaker' }
  | { t: 'radio'; text: string }
  | { t: 'lobby_chat'; text: string }
  /** Report the sender of a radio message (ship name as shown) to the moderators. */
  | { t: 'report'; from: string; reason: string }
  | { t: 'classify'; label: string; choice: ClassChoice; cls?: ClassId }
  /** Periscope or bridge photo: where the camera looked; the server grades it from the truth. */
  | { t: 'photo'; id: string; bearing: number; fov: number; vfov: number; pitch: number; label?: string }
  /** Where the attack periscope looks (game-frame bearing) and its power; sent on change, at most 4/s. */
  | { t: 'scope'; bearing: number; mag: ScopeMag }
  /** The player's realism mode (once per connection and match, and when changed). */
  | { t: 'realism'; realism: Realism }
  | { t: 'pulse'; pulse: 'cw' | 'lfm' }
  /** Active sonar: set the range scale (m; sets the ping interval) and/or send one single ping. */
  | { t: 'ping'; range?: 4000 | 8000 | 16000; single?: boolean }
  | { t: 'bt' }
  | { t: 'buoy'; bearing: number; range: number; deep: boolean; active?: boolean }
  | { t: 'dip'; bearing: number; range: number; deep: boolean }
  /**
   * Helicopter task queue: 'add' appends a task, 'now' replaces the queue with it, 'remove' strikes
   * task `id`, 'clear' empties the queue (airborne: home). The point is bearing/range from the own
   * ship; `label` = contact whose latest fix the task follows; `axis` = search direction (dip) or
   * direction of the buoy line; `count` = dips or buoys (4–6).
   */
  | {
    t: 'helo'; op: 'add' | 'now' | 'remove' | 'clear'; kind?: import('./helo.js').HeloTaskKind; bearing?: number; range?: number;
    axis?: number; count?: number; label?: string; active?: boolean; id?: number;
    /** buoys: pattern (line, staggered barrier, circle round a datum, chevron ahead of a boat); absent = line. */
    pattern?: import('./buoy-pattern.js').BuoyPattern;
  }
  | { t: 'helotorp'; bearing: number; range: number }
  | { t: 'mpa'; bearing: number; range: number }
  /** Air defence: missile at an air track (own radar), interceptors from land; submarines lay a mine. */
  | { t: 'sam'; planeId: string }
  | { t: 'fighter' }
  | { t: 'mine' }
  /** Escort: shift the convoy's track sideways (m, + = starboard of its leg; 0 = back on the route). */
  | { t: 'convoy_detour'; offset: number }
  /**
   * Escort commander (any human escort captain) tasks an AI escort of the own side: station (world
   * point, or rel = bearing relative to the convoy's course and range from its centre), sector,
   * datum or helicopter at a world point; cancel returns her to the planner.
   */
  | { t: 'escort_task'; shipId: string; task: EscortCmdKind | 'cancel'; x?: number; y?: number; rel?: number; range?: number }
  /** Escort commander's convoy orders: emergency turn 45° (side −1 port, +1 starboard, 0 cancel), zigzag on/off, speed change (kn, ±2). */
  | { t: 'convoy_order'; order: 'turn' | 'zigzag' | 'speed' | 'course'; side?: -1 | 0 | 1; on?: boolean; /** order 'zigzag': plan 1–6, 0 off (instead of on) */ plan?: number; adj?: number; /** order 'course': game-frame course, absent = back on the route */ course?: number }
  | { t: 'repair'; system: ShipSystem }
  /** Pass a FLASH order on (convoy turn) to the commodore. */
  | { t: 'execute_order'; id: string }
  /** Damage control: send the party to a compartment, or close / open its bulkheads. */
  | { t: 'compartment'; index: number; action: 'priority' | 'seal' | 'open' }
  | VoiceClientMsg
  | { t: 'crew'; captainId: string | null }
  /** "Zeitraffer bis Ereignis": switch on (solo) or vote for it (multiplayer), or off. */
  | { t: 'fastforward'; on: boolean }
  /** Own ship sunk: the debrief so far (delayed like a spectator's view), then leave. */
  | { t: 'debrief_now' }
  | { t: 'training'; lesson: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd' | 'feindfahrt' | 'geleitfahrt' }
  | { t: 'lesson_done' }
  /** Tutorial checklist: the step the player is on now (drop-out statistics). */
  | { t: 'lesson_step'; step: number }
  /** The station this player now mans (older clients sent the tab number as `index`). */
  | { t: 'station'; id: StationId }
  | { t: 'quick' }
  /** Start at once against the AI: a random situation, or this week's (same for everyone). */
  | { t: 'solo'; team: Exclude<Team, 'neutral'>; weekly?: boolean }
  | { t: 'spectate'; matchId: string }
  /** Ask for a one-time code to put the 3D view on a phone (phone.ts on the server). */
  | { t: 'phone_link' }
  | {
    t: 'settings';
    mission?: MissionKey;
    /** Sea area (regions.ts). */
    area?: RegionId;
    timeOfDay?: 'tag' | 'daemmerung' | 'nacht' | 'zufall';
    seaState?: number;
    timeLimitMin?: number; timeScale?: number;
    fillBots?: boolean;
    botSkill?: 'leicht' | 'normal' | 'schwer';
    weather?: 'wechselhaft' | 'stabil' | 'zufall';
    season?: Season | 'zufall';
    variation?: Variation;
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

/** "Zeitraffer bis Ereignis": running, the votes so far (multiplayer), why it stopped last. */
export interface FastForwardView {
  on: boolean;
  /** Players who voted / players who must (1 in a solo game: no vote needed). */
  votes: number;
  need: number;
  mine: boolean;
  /** Why it cannot start now (fresh hostile contact), or why it stopped (shown for a while). */
  blocked?: string;
  stopped?: string;
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
  /** Went aboard a teammate's ship after the own one sank: the statistics stay with the own ship. */
  transferred?: boolean;
  /** Station the player mans. */
  station?: StationId;
  /** Naval rank from the service record (accounts only). */
  rank?: string;
  /** Elo rating (accounts; guests 1000). */
  rating?: number;
  /** Realism mode the player plays (decides what the periscope tells him); unset = Einsteiger. */
  realism?: Realism;
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
    /** Sea area (regions.ts); unset = the mission's home area. */
    area?: RegionId;
    timeOfDay: 'tag' | 'daemmerung' | 'nacht' | 'zufall';
    timeScale: number;
    layerDepth: number;
    seaState: number;
    timeLimitMin: number;
    merchants: number;
    fillBots: boolean;
    botSkill: 'leicht' | 'normal' | 'schwer';
    /** Not listed; joined only through an invite link. */
    private?: boolean;
    weather: 'wechselhaft' | 'stabil' | 'zufall';
    /** Season (month of the match); unset or zufall = drawn per match. */
    season?: Season | 'zufall';
    variation?: Variation;
    /** Set when the situation was fixed (rematch with the same seed). */
    lage?: number;
    custom?: CustomMissionSettings;
    merchantsCount?: number;
    lesson?: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd' | 'feindfahrt' | 'geleitfahrt';
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
  /** Moving stern first; order.speedKn < 0 is an astern order. */
  sternway?: boolean;
  order: { heading: number; speedKn: number; depth: number }; route?: import('./route.js').ShipRoute;
  alive: boolean;
  hp: number;
  battery?: number;
  batteryEnduranceS?: number;
  snorkel: boolean;
  mastUp: boolean; mastPending?: boolean;
  /** Mast and snorkel hoist state 0..1 (they take seconds to move). */
  mastExt?: number;
  snorkelExt?: number;
  mastUpSince?: number;
  radarOn: boolean;
  activeSonar: boolean;
  pulse: 'cw' | 'lfm';
  lastPingAt?: number;
  /** Active range scale (m) and the seconds between pings it needs; a single ping waiting to go out. */
  pingRange?: number;
  pingEvery?: number;
  pingPending?: boolean;
  towedLength: number;
  towedOrder?: number;
  /** Depth the towed array runs at now (m): shallower the faster the ship goes (towed-geometry.ts). */
  towedDepth?: number;
  vdsDepth?: number;
  vdsOrder?: number;
  /** High-frequency mine-avoidance sonar on, and the range it reaches now (m). */
  mineAvoid?: boolean;
  mineAvoidRange?: number;
  /** Escorts: the convoy's ordered detour (m, + = starboard of the leg). */
  convoyOffset?: number;
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
  /** Boats: how the last fix was taken, how long ago, the next satellite pass, fixes under way (s). */
  nav?: { lastFix?: 'land' | 'sat' | 'stars' | 'sounding'; lastFixAgo?: number; satIn: number; sat?: number; stars?: number };
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
    mines?: number;
    /** Wake homers in the rack (east SSN only). */
    wake?: number;
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
  /** Seconds of run left before the fuel is gone. */
  leftS?: number;
  /** F16: the wire is about to break (the limit and what threatens it). */
  wireWarn?: string;
  /** F16: the wire broke (or was never connected): why. Shown for a while at the break point. */
  wireLost?: string;
  /** Wake homer (no wire). */
  wake?: boolean;
  /** Two-speed run: still on the slow transit, sprinting at this speed once the seeker opens. */
  attackKn?: number;
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
  what?: 'mast' | 'snorkel' | 'surfaced' | 'glow';
  range?: number;
  label?: string; /** ESM: emitter (emitters.ts), strength 0..2, trend. */ emitter?: string; esmLvl?: number; esmTrend?: number;
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
  timeLimitMin: number; timeScale?: number;
  /** Minutes at sea (lobby limit in real minutes × time scale); absent in old saves: limit × 3. */
  seaMin?: number;
  timeOfDay: string;
  ship: string;
}

export interface Snapshot {
  /** Aircraft this ship knows of (datalink, radar, eye, ESM). */
  planes?: import('./airspace.js').PlaneView[];
  /** Own air defence, interceptors and missiles in sight; mines on the plot. */
  airdef?: import('./airdef.js').AirDefView;
  ssm?: /* own anti-ship missiles, rounds in sight */ ReturnType<typeof import('./antiship.js').ssmFor>;
  mines?: import('./mines.js').MineView[];
  time: number;
  /** Sim seconds per real second (for echo travel times and clocks). */
  timeScale: number;
  /** True when the snapshot is complete (first after (re)connect). Otherwise contact
   * histories, evidence, alerts and radio are deltas the client accumulates. */
  full?: boolean;
  /** Callsigns of everyone aboard the own ship. */
  crew: string[];
  /** Who mans which station aboard. */
  stations?: { callsign: string; station: StationId }[];
  /** "Zeitraffer bis Ereignis" state (absent in the sandbox, which has its own time controls). */
  ff?: FastForwardView;
  /** Own ship sunk: living teammates' ships with a human captain the player may go aboard. */
  boardable?: { captainId: string; callsign: string; ship: string }[];
  /** Training lesson id when this is a lesson. */
  lesson?: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd' | 'feindfahrt' | 'geleitfahrt';
  briefing?: Briefing;
  own: OwnShipView;
  contacts: (Omit<ContactTrack, 'history'> & {
    /** Delta: only samples newer than the previous snapshot (all of them when `full`). */
    history: ContactTrack['history'];
    via: 'own' | 'datalink';
    /** Datalink: age of the mate's report (s); its bearings are measured from originX/originY (the mate, in its own frame). */
    linkAgeS?: number;
    /** What the periscope shows of the target's damage. */
    wreck?: WreckView;
    /** The player's (or datalink group's) own classification decision. */
    assigned?: ClassChoice;
    /** Exact class assigned from the recognition book. */
    assignedCls?: ClassId;
    /**
     * Periscope only, while she is in view: the hull the 3D optic has to draw. Not a classification;
     * the UI never names it (Profi players identify her with the recognition book).
     */
    look?: ClassId;
  })[];
  friendlies: FriendlyView[];
  torpedoes: TorpedoView[];
  /** F16: own torpedoes whose wire broke recently (or that left without one), with the reason. */
  wireLost?: { id: string; why: string; wake?: boolean }[];
  radio: RadioMsg[];
  alerts: AlertView[];
  /** layerDepth is only known after a bathythermograph measurement. */
  env: {
    layerDepth?: number;
    /** The water here is shallower than the measured layer (or the probe found none): mixed to the bottom, no layer. */
    noLayer?: boolean;
    seaState: number;
    /** 1 = day, 0 = dark night */
    light?: number;
    /** Water depth under the own ship (m) and the chart, which is public. */
    bottom?: number;
    seabed?: { kind: 'tief' | 'schelf' | 'fjord'; seed: number; /** Shallow bank across deep water (Grönland), seabed.ts. */ bankY?: number; /** Real sea area (regions.ts). */ region?: RegionId };
    rain?: boolean;
    /** Met forecast: fog banks, rain squalls, ice floes and icebergs (public). */
    met?: import('./met.js').MetCells;
    /** Ship's clock, hour of day. */
    clock?: number;
    /** Current where the own ship is, at her depth (from the tide tables and current atlas). */
    current?: { set: number; kn: number };
    /** Sun: elevation and bearing in the map frame (degrees); month of the match. */
    sun?: { el: number; az: number };
    month?: number;
    /** Day of the month (rolls on past midnight; the moon's age) and moonlight at the sea now (0..1, moon.ts). */
    day?: number;
    moon?: number;
    /** Tidal stream: strength now, flood or ebb, seconds to the next slack water. */
    tide?: { kn: number; flood: boolean; turnsInS: number };
  };
  score: { sunkTons: number; arrivedTons: number; totalTons: number; timeLeftS: number; countedTons?: number };
  /** FLASH orders from fleet command read aboard (orders.ts). */
  orders?: import('./orders.js').OrderView[];
  /** Surface ships: the AI escorts' team datum and hunter-killer roles (ship names), via datalink. */
  hunt?: { datum?: { x: number; y: number; t: number; q: number }; director?: string; attacker?: string };
  /** Human escort captains: the AI escorts they may task and the convoy's orders (escort commander). */
  command?: EscortCommandView;
  /** Own team's sonobuoys and helicopters (surface ships, via datalink). */
  air?: {
    buoys: { id: string; x: number; y: number; depth: number; leftS: number; active?: boolean }[];
    /** Team aircraft on the plot ('transit': helicopter going home or loitering). */
    helos: { x: number; y: number; kind: 'buoy' | 'dip' | 'torpedo' | 'mpa' | 'mad' | 'transit'; hovering: boolean }[];
    /** Own helicopter: buoys and torpedoes aboard; seconds until it is next on deck and ready. */
    stock: number;
    heloReadyInS: number;
    heloTorps: number;
    /** Own helicopter: state, fuel, load, magazine and the task queue with ETAs. */
    helo?: import('./helo-view.js').HeloView;
    mpaReadyInS: number;
    mpaBuoys: number;
  };
}

/** Full truth, released only after the match ended. */
/** How much a mission's positions, route, speed and sea state vary from match to match. */
export type Variation = 'aus' | 'leicht' | 'stark';

export type { WeeklyBoard, WeeklyRow } from './weekly-board.js';

/** A match's seed and lobby choices: enough to play the same situation again. */
export interface MatchSetup {
  seed: number;
  settings: {
    mission: MissionKey;
    area?: RegionId;
    timeOfDay: 'tag' | 'daemmerung' | 'nacht' | 'zufall';
    weather: 'wechselhaft' | 'stabil' | 'zufall';
    season?: Season | 'zufall';
    seaState: number;
    timeLimitMin: number;
    merchants: number;
    fillBots: boolean;
    botSkill: 'leicht' | 'normal' | 'schwer';
    custom?: CustomMissionSettings;
    variation?: Variation;
  };
}

export interface Debrief {
  ships: { id: string; name: string; cls: ClassId; team: Team; player: boolean }[];
  /** Positions every few sim seconds: [t, [id, x, y, heading, alive(0/1)][]] */
  frames: [number, [string, number, number, number, number][]][];
  torpedoes: [number, [string, number, number][]][];
  events: { t: number; kind: 'sunk' | 'shot' | 'arrived'; shipId: string; byId?: string; what?: string }[];
  stats: PlayerStats[];
  winner: Exclude<Team, 'neutral'>;
  reason: string;
  duration: number; /** sea area (north-up chart) */ region?: string;
  /** What the AI adapted to from this player's earlier matches (shown in the debrief). */
  learned?: string[];
  /** FLASH orders of both sides and how they ended. */
  orders?: import('./orders.js').OrderSummary[];
  /** Periscope and bridge photos with their grades. */
  photos?: import('./recognition.js').PhotoRecord[];
  /** Seed and lobby choices, for a rematch in the same situation (not for lessons or campaigns). */
  setup?: MatchSetup;
  /** Asked for after the own ship sank while the match still runs: no result yet, truth cut off minutes ago. */
  provisional?: boolean;
  /** How clear the result was: klar, knapp (close) or remis (a draw in all but the rules). */
  band?: 'klar' | 'knapp' | 'remis';
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
  /** Ships sunk by this ship's own mines (part of kills; badges). */
  mineKills?: number;
  /** Torpedo attacks on this ship it lived through to the end (badges). */
  attacksSurvived?: number;
  /** Debrief grade: warhead hits scored, contacts classified right, enemy units held in the book,
   * sim seconds until an enemy first held this ship, share of convoy merchants afloat (escorts). */
  hits?: number;
  classified?: number;
  held?: number;
  undetectedS?: number;
  merchantsSafe?: number;
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
  /** One-time code for the phone's 3D view (valid 10 minutes, once). */
  | { t: 'phone_link'; code: string }
  /** From the paired phone: it connected or left, where it looks, what it selected, a photo. */
  | { t: 'phone'; ev: 'on' | 'off' }
  | { t: 'phone_look'; bearing: number; elev: number; mag: number; glass: boolean }
  | { t: 'phone_select'; label: string }
  | { t: 'phone_photo' }
  | { t: 'end'; winner: Exclude<Team, 'neutral'>; reason: string; band?: 'klar' | 'knapp' | 'remis' }
  | { t: 'debrief'; d: Debrief }
  /** Spectators get the truth picture, delayed so it can't be used to help a team. */
  | { t: 'spectate'; d: Debrief; delayS: number }
  | { t: 'error'; msg: string }
  /** Removed from the match by a moderator (kick or match ended). */
  | { t: 'removed'; msg: string }
  /** Sandbox matches: time scale (0 = paused) and, for players who switched it on, the truth view. */
  | { t: 'sandbox'; scale: number; truth?: TruthView };

/** What the paired phone sends (its own socket, /ws?phone=<code>). */
export type PhoneMsg =
  | { t: 'look'; bearing: number; elev: number; mag: number; glass: boolean }
  | { t: 'select'; label: string }
  | { t: 'photo' };
