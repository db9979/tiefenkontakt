import { CLASSES, launchNoisemaker, setTowedDecoy, wrap360, type World } from '@tk/shared';
import { SKILL, heardBearing, newMemory, recordTrack, type BotMemory, type BotSkill } from './common.js';
import { thinkFrigate } from './frigate.js';
import { thinkSub, type PackReport } from './sub.js';

export type { BotSkill } from './common.js';
/** Kept for save files written before the AI rewrite. */
export type BotState = BotMemory;

export interface SavedCrew {
  skill: BotSkill;
  bots: BotMemory[];
  pack: PackReport[];
}

const TRANSIENT_HEARING = { flood: 14_800, launch: 65_000 } as const;

/** AI captains for empty teams (and passive training targets). */
export class BotCrew {
  private bots: BotMemory[] = [];
  private pack: PackReport[] = [];

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
    for (const m of this.bots) {
      const ship = w.ships.find((s) => s.id === m.shipId);
      if (!ship?.alive) continue;
      recordTrack(m, ship, w.time);
      this.readEvents(w, m);
      if (w.time < m.nextThink) continue;
      const sub = CLASSES[ship.cls].submarine;
      m.nextThink = w.time + (sub ? k.subThink : k.think);
      if (sub) thinkSub(w, m, ship, this.skill, this.pack);
      else thinkFrigate(w, m, ship, this.skill);
    }
    this.pack = this.pack.filter((r) => w.time - r.t < 3600);
  }

  private readEvents(w: World, m: BotMemory): void {
    const ship = w.ships.find((s) => s.id === m.shipId)!;
    const fresh = w.events.slice(m.eventCursor);
    m.eventCursor = w.events.length;
    const sub = CLASSES[ship.cls].submarine;
    for (const e of fresh) {
      if (e.kind === 'torpedo_alert' && e.shipId === ship.id && !m.passive) {
        m.evadeUntil = w.time + 120;
        if (sub) launchNoisemaker(w, ship);
        else setTowedDecoy(w, ship, true);
        // Beam the torpedo, sprint, and (submarine) cross the layer
        ship.order.heading = wrap360(e.bearing + 100 * m.legSign);
        ship.order.speedKn = CLASSES[ship.cls].maxSpeedKn;
        if (sub) ship.order.depth = ship.depth < (ship.btLayer ?? 120) ? (ship.btLayer ?? 120) + 50 : 40;
      } else if (e.kind === 'transient' && e.sourceId !== ship.id) {
        const b = heardBearing(w, ship, e.x, e.y, TRANSIENT_HEARING[e.what]);
        if (b !== undefined) {
          m.lead = { x: ship.pos.x, y: ship.pos.y, b, t: w.time };
          m.alertUntil = w.time + 600;
        }
      } else if (e.kind === 'sunk') {
        m.alertUntil = w.time + 600;
      }
    }
  }
}
