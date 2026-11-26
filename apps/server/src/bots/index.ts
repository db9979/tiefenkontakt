import { CLASSES, bearing, launchNoisemaker, setTowedDecoy, wrap360, type World } from '@tk/shared';
import { SKILL, heardBearing, newMemory, recordTrack, type BotMemory, type BotSkill } from './common.js';
import { thinkFrigate } from './frigate.js';
import { thinkAirDefense } from './airdef.js';
import { sweepScope, thinkSub, type PackReport } from './sub.js';
import { heardLaunchDatum, planSide, type EscortTask } from './escort-team.js';
import { obeySub } from './orders-ai.js';

export type { BotSkill } from './common.js';
/** Kept for save files written before the AI rewrite. */
export type BotState = BotMemory;

export interface SavedCrew {
  skill: BotSkill;
  bots: BotMemory[];
  pack: PackReport[];
}

/**
 * A boat with a torpedo on it beams it, sprints and crosses the layer this long (s), then goes
 * back to its attack quietly (at 120 s the sprints kept it off its plot for a third of the battle).
 */
const SUB_TORPEDO_EVADE_S = 90;

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

  constructor(private skill: BotSkill = 'normal') {}

  setSkill(skill: BotSkill): void {
    this.skill = skill;
  }

  add(shipId: string, passive = false): void {
    this.bots.push(newMemory(shipId, passive));
  }

  get size(): number {
    return this.bots.length;
  }

  toJSON(): SavedCrew {
    return { skill: this.skill, bots: this.bots.map((b) => ({ ...b })), pack: [...this.pack] };
  }

  restore(saved: SavedCrew | BotMemory[]): void {
    if (Array.isArray(saved)) {
      this.bots = saved.map((b) => ({ ...newMemory(b.shipId, b.passive), ...b }));
      return;
    }
    this.skill = saved.skill;
    this.bots = saved.bots.map((b) => ({ ...newMemory(b.shipId, b.passive), ...b }));
    this.pack = saved.pack;
  }

  step(w: World): void {
    const k = SKILL[this.skill];
    this.heardAlerts(w);
    if (w.time - this.planAt >= k.think) {
      this.planAt = w.time;
      const mems = new Map(this.bots.map((b) => [b.shipId, b]));
      this.tasks = new Map([...planSide(w, 'west', mems), ...planSide(w, 'east', mems)]);
    }
    for (const m of this.bots) {
      const ship = w.ships.find((s) => s.id === m.shipId);
      if (!ship?.alive) continue;
      recordTrack(m, ship, w.time);
      this.readEvents(w, m);
      // The periscope looks where the captain trains it, every second, not only when he thinks
      if (CLASSES[ship.cls].submarine) sweepScope(w, ship);
      if (w.time < m.nextThink) continue;
      const sub = CLASSES[ship.cls].submarine;
      m.nextThink = w.time + (sub ? k.subThink : k.think);
      if (sub) {
        thinkSub(w, m, ship, this.skill, this.pack);
        obeySub(w, m, ship);
      } else {
        thinkFrigate(w, m, ship, this.skill, this.tasks.get(ship.id));
        thinkAirDefense(w, m, ship, this.skill);
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

  private readEvents(w: World, m: BotMemory): void {
    const ship = w.ships.find((s) => s.id === m.shipId)!;
    const fresh = w.events.slice(m.eventCursor);
    m.eventCursor = w.events.length;
    const sub = CLASSES[ship.cls].submarine;
    for (const e of fresh) {
      if (e.kind === 'torpedo_alert' && e.shipId === ship.id && !m.passive) {
        m.evadeUntil = w.time + (sub ? SUB_TORPEDO_EVADE_S : 120);
        if (sub) launchNoisemaker(w, ship);
        else setTowedDecoy(w, ship, true);
        // Beam the torpedo, sprint, and (submarine) cross the layer
        ship.order.heading = wrap360(e.bearing + 100 * m.legSign);
        ship.order.speedKn = CLASSES[ship.cls].maxSpeedKn;
        if (sub) ship.order.depth = ship.depth < (ship.btLayer ?? 120) ? (ship.btLayer ?? 120) + 50 : 40;
      } else if (e.kind === 'transient' && e.sourceId !== ship.id && e.what !== 'charge') {
        const b = heardBearing(w, ship, e.x, e.y, TRANSIENT_HEARING[e.what]);
        if (b !== undefined) {
          m.lead = { x: ship.pos.x, y: ship.pos.y, b, t: w.time };
          m.alertUntil = w.time + 600;
          // An escort that hears a tube flood or a launch keeps the line for the team's heard datum
          if (!sub && (e.what === 'flood' || e.what === 'launch')) m.launchHeard = { x: ship.pos.x, y: ship.pos.y, b, t: w.time };
        }
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
