import { CLASSES, crewOf, emptyDamage, SYSTEMS, type Debrief, type Ship, type World } from '@tk/shared';
import {
  afterMission, missionSettings, nextMission, type CampaignRun, type CampStock, type MissionOutcome,
} from './campaign-state.js';
import type { CampaignStore } from './campaign-store.js';
import type { Conn, Match } from './match.js';
import type { PlayableClass, ScenarioSettings } from './scenario.js';
import { userIdOf } from './stats.js';

/** Put the campaign ship's state (hull, damage, empty posts, experience, magazines) into the world. */
export function applyCarry(w: World, ship: Ship, run: CampaignRun): void {
  const spec = CLASSES[ship.cls];
  const s = run.ship;
  ship.hp = Math.max(1, s.hull * spec.hp);
  if (SYSTEMS.some((k) => s.damage[k] > 0)) ship.damage = { ...s.damage };
  const crew = crewOf(ship);
  crew.wounded = s.crewLost;
  crew.xp = run.crew.xp;
  const l = w.weapons?.loadouts.get(ship.id);
  if (!l) return;
  const key = spec.submarine ? 'heavy' : 'light';
  const loaded = Math.min(l.tubes.length, s.stock.torpedoes);
  l.tubes.forEach((t, i) => Object.assign(t, { loaded: i < loaded, reloadDoneAt: 0 }));
  l[key] = s.stock.torpedoes - loaded;
  l.rockets = s.stock.rockets;
  l.depthCharges = s.stock.depthCharges;
  l.noisemakers = s.stock.noisemakers;
  if (s.stock.mines !== undefined && l.mines !== undefined) l.mines = Math.min(l.mines, s.stock.mines);
}

/** Magazines left aboard: storage plus loaded tubes plus tubes being reloaded. */
export function stockOf(w: World, ship: Ship): CampStock {
  const l = w.weapons?.loadouts.get(ship.id);
  if (!l) return { torpedoes: 0, rockets: 0, depthCharges: 0, noisemakers: 0, mines: 0 };
  const inTubes = l.tubes.filter((t) => t.loaded || t.reloadDoneAt > 0).length;
  return { torpedoes: (CLASSES[ship.cls].submarine ? l.heavy : l.light) + inTubes, rockets: l.rockets, depthCharges: l.depthCharges, noisemakers: l.noisemakers, mines: l.mines ?? 0 };
}

/** Read the mission's consequences for one ship from the world (and its debrief line). */
export function outcomeOf(w: World, ship: Ship, stat: { won: boolean; kills: number; tonnageSunk: number } | undefined, reason: string, aborted = false): MissionOutcome {
  // Half of the wounded (rounded up) are permanent losses: killed or sent ashore
  let casualties = 0;
  let attacks = 0;
  for (const e of w.events) {
    if (e.kind === 'boat' && e.shipId === ship.id && e.what === 'wounded') casualties += Math.ceil(Number(/^(\d+)/.exec(e.text)?.[1] ?? 0) / 2);
    if (e.kind === 'torpedo_alert' && e.shipId === ship.id) attacks++;
  }
  return {
    won: !aborted && !!stat?.won, reason, survived: ship.alive, kills: stat?.kills ?? 0, tonnage: stat?.tonnageSunk ?? 0,
    hull: Math.max(0, ship.hp / CLASSES[ship.cls].hp), damage: ship.damage ? { ...ship.damage } : emptyDamage(),
    casualties, stock: stockOf(w, ship), attacks, aborted,
  };
}

export interface CampaignPlan {
  name: string;
  team: 'west' | 'east';
  cls: PlayableClass;
  settings: Partial<ScenarioSettings>;
  /** Called right after the match started (world built). */
  started(m: Match): void;
}

/** Glue between the campaign store, the lobby and running campaign matches. */
export class CampaignService {
  constructor(private store: CampaignStore) {}

  /** Plan the next mission for a player, or an error text. */
  plan(conn: Conn): CampaignPlan | string {
    const uid = userIdOf(conn.playerId);
    if (uid === undefined) return 'Die Kampagne gibt es nur mit Konto';
    const cur = this.store.active(uid);
    if (!cur) return 'Keine laufende Kampagne';
    const settings = missionSettings(cur.run);
    if (typeof settings === 'string') return settings;
    const m = nextMission(cur.run)!;
    return {
      name: `Kampagne: ${m.title}`, team: cur.run.side, cls: cur.run.ship.cls, settings,
      started: (match) => {
        const ship = match.shipOf(conn.playerId);
        if (match.world && ship) applyCarry(match.world, ship, cur.run);
        this.store.save(cur.id, { ...cur.run, status: 'sea' });
      },
    };
  }

  /** A campaign match ended (debrief) or was dropped before its end (aborted). */
  finish(m: Match, d?: Debrief): void {
    if (!m.settings.campaign || !m.world) return;
    const slot = m.slots.find((s) => !s.bot);
    const uid = slot ? userIdOf(slot.playerId) : undefined;
    const ship = slot ? m.shipOf(slot.playerId) : undefined;
    if (uid === undefined || !ship) return;
    const cur = this.store.active(uid);
    if (!cur || cur.run.status !== 'sea') return;
    const stat = d?.stats.find((s) => s.playerId === slot!.playerId);
    this.store.save(cur.id, afterMission(cur.run, outcomeOf(m.world, ship, stat, d?.reason ?? '', !d)));
  }
}
