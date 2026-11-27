import { CLASSES, bearing, launchNoisemaker, setTowedDecoy, wrap360, type Ship, type World } from '@tk/shared';
import { SKILL, heardBearing, newMemory, recordTrack, type BotMemory, type BotSkill } from './common.js';
import { thinkFrigate } from './frigate.js';
import { thinkAirDefense } from './airdef.js';
import { sweepScope, thinkSub, type PackReport } from './sub.js';
import { heardLaunchDatum, planSide, type EscortTask } from './escort-team.js';
import { obeySub } from './orders-ai.js';
import { steerFlyingCourse } from './helo.js';
import { noteTurn } from './veteran-escort.js';
import { reconReport } from './convoy-estimate.js';

export type { BotSkill } from './common.js';
/** Kept for save files written before the AI rewrite. */
export type BotState = BotMemory;

/** Per-role levels (the arena plays one level against another): boats, surface ships. */
export interface RoleSkills {
  sub?: BotSkill;
  escort?: BotSkill;
}

export interface SavedCrew {
  skill: BotSkill;
  roles?: RoleSkills;
  bots: BotMemory[];
  pack: PackReport[];
}

/**
 * A boat with a torpedo on it beams it, sprints and crosses the layer for SKILL.evadeS (NORMAL 90 s),
 * then goes back to its attack quietly (at 120 s the sprints kept it off its plot for a third of the battle).
 */
const ESCORT_TORPEDO_EVADE_S = 120;
/** VETERAN: the second noisemaker goes this long after the first (s), as the torpedo comes through the first. */
const SECOND_DECOY_S = 25;

const TRANSIENT_HEARING = { flood: 14_800, launch: 65_000, mishap: 9_000, blow: 25_000, splash: 7_400, sam: 20_000, mine: 40_000, sounding: 4_000 } as const;

/** AI captains for empty teams (and passive training targets). */
export class BotCrew {
  private bots: BotMemory[] = [];
  private pack: PackReport[] = [];
  /** Escort teamwork: tasks from the last plan (rebuilt every think interval). */
  private tasks = new Map<string, EscortTask>();
  private planAt = -1e9;
  /** Events already scanned for torpedo alerts on the side's ships (heard datum). */
  private alertCursor = 0;

  constructor(private skill: BotSkill = 'normal', private roles: RoleSkills = {}) {}

  setSkill(skill: BotSkill): void {
    this.skill = skill;
  }

  /** The level a ship's captain plays at: its role's level, else the crew's. */
  skillOf(ship: Ship): BotSkill {
    return (CLASSES[ship.cls].submarine ? this.roles.sub : this.roles.escort) ?? this.skill;
  }

  add(shipId: string, passive = false): void {
    this.bots.push(newMemory(shipId, passive));
  }

  get size(): number {
    return this.bots.length;
  }

  toJSON(): SavedCrew {
    return { skill: this.skill, ...(this.roles.sub || this.roles.escort ? { roles: { ...this.roles } } : {}), bots: this.bots.map((b) => ({ ...b })), pack: [...this.pack] };
  }

  restore(saved: SavedCrew | BotMemory[]): void {
    if (Array.isArray(saved)) {
      this.bots = saved.map((b) => ({ ...newMemory(b.shipId, b.passive), ...b }));
      return;
    }
    this.skill = saved.skill;
    this.roles = saved.roles ?? {};
    this.bots = saved.bots.map((b) => ({ ...newMemory(b.shipId, b.passive), ...b }));
    this.pack = saved.pack;
  }

  step(w: World): void {
    this.heardAlerts(w);
    const escortSkill = this.roles.escort ?? this.skill;
    if (w.time - this.planAt >= SKILL[escortSkill].think) {
      this.planAt = w.time;
      const mems = new Map(this.bots.map((b) => [b.shipId, b]));
      this.tasks = new Map([...planSide(w, 'west', mems, escortSkill), ...planSide(w, 'east', mems, escortSkill)]);
    }
    for (const m of this.bots) {
      const ship = w.ships.find((s) => s.id === m.shipId);
      if (!ship?.alive) continue;
      recordTrack(m, ship, w.time);
      const skill = this.skillOf(ship);
      // Own escorts' hard turns (knuckles): a VETERAN sonar team doesn't take them for a boat
      if (skill === 'schwer' && !CLASSES[ship.cls].submarine) noteTurn(w, ship);
      const k = SKILL[skill];
      this.readEvents(w, m, skill);
      // A slower crew reacts to the torpedo alert late; a veteran's second decoy goes as the torpedo comes through the first
      if (m.torpAlert && w.time >= m.torpAlert.at) {
        evadeTorpedo(w, m, ship, skill, m.torpAlert.b);
        m.torpAlert = undefined;
      }
      if (m.decoyAt !== undefined && w.time >= m.decoyAt) {
        m.decoyAt = undefined;
        if (w.time < m.evadeUntil) launchNoisemaker(w, ship);
      }
      // The periscope looks where the captain trains it, every second, not only when he thinks
      if (CLASSES[ship.cls].submarine) sweepScope(w, ship);
      if (w.time < m.nextThink) continue;
      const sub = CLASSES[ship.cls].submarine;
      m.nextThink = w.time + (sub ? k.subThink : k.think);
      if (sub) {
        thinkSub(w, m, ship, skill, this.pack);
        obeySub(w, m, ship);
      } else {
        thinkFrigate(w, m, ship, skill, this.tasks.get(ship.id));
        thinkAirDefense(w, m, ship, skill);
        // The helicopter's launch or recovery needs a flying course (not while dodging a torpedo)
        if (!m.passive && w.time >= m.evadeUntil) steerFlyingCourse(w, ship);
        // VDS frigates hunt with the body under the layer whenever they are slow enough
        const vds = CLASSES[ship.cls].vds;
        if (vds) {
          const layer = ship.btLayer ?? w.env.layerDepth;
          ship.vdsOrder = ship.order.speedKn <= vds.maxSpeedKn ? Math.min(vds.maxDepth, layer !== undefined ? layer + 40 : 150) : 0;
        }
      }
    }
    this.pack = this.pack.filter((r) => w.time - r.t < 3600);
  }

  /**
   * A torpedo alert on a surface ship of a side with AI escorts: the team gets a datum down the
   * heard bearing of the launch (escort-team.ts), never the true launch position.
   */
  private heardAlerts(w: World): void {
    if (this.alertCursor > w.events.length) this.alertCursor = 0;
    const fresh = w.events.slice(this.alertCursor);
    this.alertCursor = w.events.length;
    if (!fresh.length) return;
    const mems = new Map(this.bots.filter((b) => !b.passive).map((b) => [b.shipId, b]));
    for (const e of fresh) {
      if (e.kind !== 'torpedo_alert') continue;
      const victim = w.ships.find((s) => s.id === e.shipId);
      if (!victim?.alive || CLASSES[victim.cls].submarine) continue;
      heardLaunchDatum(w, victim, e.bearing, mems);
    }
  }

  private readEvents(w: World, m: BotMemory, skill: BotSkill): void {
    const ship = w.ships.find((s) => s.id === m.shipId)!;
    const fresh = w.events.slice(m.eventCursor);
    m.eventCursor = w.events.length;
    const sub = CLASSES[ship.cls].submarine;
    for (const e of fresh) {
      if (e.kind === 'torpedo_alert' && e.shipId === ship.id && !m.passive) {
        const delay = SKILL[skill].torpReactS;
        if (delay) m.torpAlert ??= { b: e.bearing, at: w.time + delay };
        else evadeTorpedo(w, m, ship, skill, e.bearing);
      } else if (e.kind === 'transient' && e.sourceId !== ship.id && e.what !== 'charge') {
        const b = heardBearing(w, ship, e.x, e.y, TRANSIENT_HEARING[e.what]);
        if (b !== undefined) {
          m.lead = { x: ship.pos.x, y: ship.pos.y, b, t: w.time };
          m.alertUntil = w.time + 600;
          // An escort that hears a tube flood or a launch keeps the line for the team's heard datum
          if (!sub && (e.what === 'flood' || e.what === 'launch')) m.launchHeard = { x: ship.pos.x, y: ship.pos.y, b, t: w.time };
        }
      } else if (e.kind === 'recon' && !sub && ship.team === 'east') {
        // The patrol ship gets the same report from fleet command, with its targeting error
        m.convoyLine = reconReport(ship, e);
      } else if (e.kind === 'recon' && sub && ship.team === 'east') {
        // Air recon via fleet command: head for the reported convoy
        m.lead = { x: ship.pos.x, y: ship.pos.y, b: bearing(ship.pos, e), t: w.time };
        m.convoyLine = { x: e.x, y: e.y, course: e.course, speedKn: e.speedKn, t: w.time };
      } else if (e.kind === 'sunk') {
        m.alertUntil = w.time + 600;
      }
    }
  }
}

/** Torpedo in the water on the ship: decoy, beam it, sprint, and (submarine) cross the layer. */
function evadeTorpedo(w: World, m: BotMemory, ship: Ship, skill: BotSkill, b: number): void {
  const k = SKILL[skill];
  const sub = CLASSES[ship.cls].submarine;
  m.evadeUntil = w.time + (sub ? k.evadeS : ESCORT_TORPEDO_EVADE_S);
  if (sub) {
    launchNoisemaker(w, ship);
    if (k.decoys > 1) m.decoyAt = w.time + SECOND_DECOY_S;
  } else setTowedDecoy(w, ship, true);
  ship.order.heading = wrap360(b + 100 * m.legSign);
  ship.order.speedKn = CLASSES[ship.cls].maxSpeedKn;
  // LEICHT: the boat only runs; it doesn't think of the layer
  if (sub && k.crossLayer) ship.order.depth = ship.depth < (ship.btLayer ?? 120) ? (ship.btLayer ?? 120) + 50 : 40;
}
