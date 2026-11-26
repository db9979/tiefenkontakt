import { AI_LEVEL_LABEL, CLASSES, createLoadout, emptyDamage, SYSTEMS, type DamageState } from '@tk/shared';
import type { MissionId, PlayableClass, ScenarioSettings, TimeOfDay } from './scenario.js';

/**
 * Campaign with consequences (pure state transitions, no I/O): one ship per account carries
 * hull damage, system damage, crew losses and spent weapons from mission to mission. Between
 * missions the dockyard trades repair and resupply time against an enemy that grows stronger.
 * Losing the ship costs a big penalty and a replacement of a lesser class; with no lesser
 * class left (or after two replacements) the run is over.
 */

export type CampSide = 'west' | 'east';

export interface CampStock {
  /** Heavyweights (boats) or lightweights (escorts), tubes included. */
  torpedoes: number;
  rockets: number;
  depthCharges: number;
  noisemakers: number;
  /** Naval mines (boats only; missing in runs saved before mines existed = full). */
  mines?: number;
  /** Wake homers (the SSN, beside its heavyweights; missing in runs saved before they existed = full). */
  wake?: number;
}

export interface CampShip {
  cls: PlayableClass;
  /** Hull integrity 0..1 (share of the class's hit points). */
  hull: number;
  damage: DamageState;
  /** Crew lost (killed or in hospital) and not yet replaced: posts stay empty. */
  crewLost: number;
  stock: CampStock;
}

export interface CampCrew {
  /** Experience 0 green … 1 veteran. */
  xp: number;
  missions: number;
  kills: number;
  survivedAttacks: number;
}

export interface CampLogEntry {
  n: number;
  at: number;
  day: number;
  title: string;
  cls: PlayableClass;
  won: boolean;
  lost: boolean;
  reason: string;
  kills: number;
  tonnage: number;
  hullAfter: number;
  xpGain: number;
  points: number;
}

export type CampStatus = 'dock' | 'ready' | 'sea' | 'complete' | 'lost';

export interface CampaignRun {
  v: 1;
  status: CampStatus;
  side: CampSide;
  ship: CampShip;
  crew: CampCrew;
  /** Index of the next mission in the side's mission list. */
  stage: number;
  /** Campaign calendar (days since the run started). */
  day: number;
  /** Days spent in the dockyard since the last mission (the enemy uses them). */
  dockDays: number;
  points: number;
  replacements: number;
  history: CampLogEntry[];
}

export interface CampMission {
  mission: MissionId;
  timeOfDay: TimeOfDay;
  title: string;
  brief: string;
}

export const CAMPAIGN_MISSIONS: Record<CampSide, CampMission[]> = {
  east: [
    { mission: 'groenland', timeOfDay: 'tag', title: 'Grönland-Lücke bei Tag', brief: 'Ein Geleitzug läuft nach Nordwesten. Unter der Sprungschicht annähern und die Frachter angreifen.' },
    { mission: 'schelf', timeOfDay: 'daemmerung', title: 'Schelfmeer in der Dämmerung', brief: 'Flaches Wasser: wenig Tiefe zum Ausweichen, viel Nachhall für die Sonare der Eskorte.' },
    { mission: 'fjord', timeOfDay: 'nacht', title: 'Fjordausfahrt bei Nacht', brief: 'Der Konvoi verlässt den Fjord. Im engen Kanal auf ihn warten – Untiefen beachten.' },
    { mission: 'hafen', timeOfDay: 'daemmerung', title: 'Hafenangriff', brief: 'Frachter ankern in der Bucht. An der Eskorte vorbei in die Einfahrt und treffen.' },
    { mission: 'duell', timeOfDay: 'tag', title: 'U-Boot-Duell', brief: 'Ein feindliches Jagd-U-Boot sucht uns. Wer zuerst hört, gewinnt.' },
    { mission: 'groenland', timeOfDay: 'nacht', title: 'Großgeleitzug bei Nacht', brief: 'Der letzte große Konvoi des Winters. Alles, was das Boot noch hat, wird gebraucht.' },
  ],
  west: [
    { mission: 'groenland', timeOfDay: 'tag', title: 'Geleit durch die Grönland-Lücke', brief: 'Den Konvoi sicher nach Nordwesten bringen. Schleppsonar ausbringen, Bojen legen.' },
    { mission: 'schelf', timeOfDay: 'daemmerung', title: 'Schelfmeer in der Dämmerung', brief: 'Flaches Wasser, schwache Schicht: Aktivsonar kämpft mit dem Nachhall.' },
    { mission: 'fjord', timeOfDay: 'nacht', title: 'Fjordausfahrt bei Nacht', brief: 'Der Konvoi läuft aus. Die Boote warten im Kanal – vor dem Konvoi aufklären.' },
    { mission: 'meerenge', timeOfDay: 'nacht', title: 'Sperre in der Meerenge', brief: 'Die Boote wollen durch die Enge nach Osten. Niemand kommt durch.' },
    { mission: 'hafen', timeOfDay: 'daemmerung', title: 'Hafenschutz', brief: 'Die Frachter ankern in der Bucht. Die Einfahrt gegen Boote halten.' },
    { mission: 'groenland', timeOfDay: 'nacht', title: 'Großgeleitzug bei Nacht', brief: 'Der letzte große Konvoi des Winters, und die Wölfe sind hungrig.' },
  ],
};

/** Replacement ships, each a step down. */
const LESSER: Record<PlayableClass, PlayableClass | undefined> = { ssn: 'ssk', ssk: 'ssa', ssa: 'ssc', ssc: undefined, ffg: 'ffv', ffv: 'kor', kor: undefined, ssw: undefined, ffk: undefined };
export const MAX_REPLACEMENTS = 2;
export const MAX_CREW_LOST = 10;

export const sideOf = (cls: PlayableClass): CampSide => (CLASSES[cls].submarine ? 'east' : 'west');

export function fullStock(cls: PlayableClass): CampStock {
  const l = createLoadout(cls);
  const inTubes = l.tubes.filter((t) => t.loaded).length;
  return { torpedoes: (CLASSES[cls].submarine ? l.heavy : l.light) + inTubes, rockets: l.rockets, depthCharges: l.depthCharges, noisemakers: l.noisemakers, mines: l.mines ?? 0, wake: l.wake ?? 0 };
}

export function freshShip(cls: PlayableClass): CampShip {
  return { cls, hull: 1, damage: emptyDamage(), crewLost: 0, stock: fullStock(cls) };
}

export function newRun(cls: PlayableClass): CampaignRun {
  return {
    v: 1, status: 'ready', side: sideOf(cls), ship: freshShip(cls), crew: { xp: 0, missions: 0, kills: 0, survivedAttacks: 0 },
    stage: 0, day: 0, dockDays: 0, points: 0, replacements: 0, history: [],
  };
}

export function crewLevel(xp: number): string {
  return xp >= 0.7 ? 'Veteranen' : xp >= 0.4 ? 'Erfahren' : xp >= 0.15 ? 'Eingefahren' : 'Grün';
}

export function nextMission(run: CampaignRun): CampMission | undefined {
  return CAMPAIGN_MISSIONS[run.side][run.stage];
}

const SKILLS: ScenarioSettings['botSkill'][] = ['leicht', 'normal', 'schwer'];
/** The enemy gets better with every stage; a long dockyard stay (4+ days) gives them a step more. */
export function enemySkill(run: CampaignRun): ScenarioSettings['botSkill'] {
  const base = run.stage < 2 ? 0 : run.stage < 4 ? 1 : 2;
  return SKILLS[Math.min(2, base + (run.dockDays >= 4 ? 1 : 0))]!;
}

export type RepairChoice = 'keine' | 'notdienst' | 'voll';
export interface DockChoice {
  repair: RepairChoice;
  resupply: boolean;
}

const worst = (d: DamageState) => Math.max(...SYSTEMS.map((k) => d[k]));

/** Days a dockyard plan takes (repairs and resupply run in parallel). */
export function dockDays(ship: CampShip, c: DockChoice): number {
  const repair = c.repair === 'voll'
    ? (worst(ship.damage) > 0 || ship.hull < 1 || ship.crewLost > 0 ? 1 + Math.ceil(5 * worst(ship.damage) + 6 * (1 - ship.hull)) : 0)
    : c.repair === 'notdienst' ? 1 : 0;
  return Math.max(repair, c.resupply ? 1 : 0);
}

/** Apply a dockyard plan: the ship is ready to sail afterwards. */
export function dockyard(run: CampaignRun, c: DockChoice): CampaignRun | string {
  if (run.status !== 'dock' && run.status !== 'ready') return 'Das Schiff liegt nicht in der Werft';
  const r: CampaignRun = structuredClone(run);
  const days = dockDays(r.ship, c);
  const s = r.ship;
  if (c.repair === 'voll') {
    s.hull = 1;
    s.damage = emptyDamage();
    // Replacements fill the empty posts but have to learn the boat: experience is diluted
    r.crew.xp = Math.max(0, r.crew.xp * (1 - 0.03 * s.crewLost));
    s.crewLost = 0;
  } else if (c.repair === 'notdienst') {
    s.hull = Math.min(1, s.hull + 0.2);
    for (const k of SYSTEMS) s.damage[k] = Math.round(s.damage[k] * 0.5 * 100) / 100;
    s.damage.leck = 0;
  }
  if (c.resupply) s.stock = fullStock(s.cls);
  r.day += days;
  r.dockDays += days;
  r.points -= 2 * days;
  r.status = 'ready';
  return r;
}

/** What a mission did to the ship and crew (read from the world at the end). */
export interface MissionOutcome {
  won: boolean;
  reason: string;
  survived: boolean;
  kills: number;
  tonnage: number;
  hull: number;
  damage: DamageState;
  /** New permanent crew losses in this mission. */
  casualties: number;
  stock: CampStock;
  /** Torpedo attacks and hits the ship lived through. */
  attacks: number;
  /** The player left the match before the end. */
  aborted?: boolean;
}

export function xpGain(o: MissionOutcome): number {
  if (o.aborted) return 0;
  return 0.04 + 0.025 * o.kills + (o.survived ? 0.015 * Math.min(6, o.attacks) : 0) + (o.won ? 0.03 : 0);
}

export function missionPoints(o: MissionOutcome): number {
  return (o.won ? 100 : -20) + Math.round(o.tonnage / 1000) + (o.survived ? 0 : -150);
}

/** Fold a finished (or aborted) mission into the run. */
export function afterMission(run: CampaignRun, o: MissionOutcome, now = Date.now()): CampaignRun {
  const r: CampaignRun = structuredClone(run);
  const m = nextMission(r);
  const gain = xpGain(o);
  const pts = missionPoints(o);
  r.history.push({
    n: r.history.length + 1, at: now, day: r.day, title: m?.title ?? '?', cls: r.ship.cls, won: o.won, lost: !o.survived,
    reason: o.aborted ? 'Einsatz abgebrochen' : o.reason, kills: o.kills, tonnage: o.tonnage, hullAfter: o.survived ? Math.round(o.hull * 100) / 100 : 0,
    xpGain: Math.round(gain * 1000) / 1000, points: pts,
  });
  if (r.history.length > 50) r.history.shift();
  r.points += pts;
  r.day += 1;
  r.dockDays = 0;
  r.crew.missions++;
  r.crew.kills += o.kills;
  if (o.survived) r.crew.survivedAttacks += o.attacks;
  r.crew.xp = Math.min(1, r.crew.xp + gain);
  if (!o.survived) {
    const lesser = LESSER[r.ship.cls];
    if (!lesser || r.replacements >= MAX_REPLACEMENTS) {
      r.status = 'lost';
      return r;
    }
    // Only part of the crew is picked up: experience halves, a smaller ship is commissioned
    r.replacements++;
    r.crew.xp = Math.round(r.crew.xp * 50) / 100;
    r.ship = freshShip(lesser);
    r.status = 'dock';
    return r;
  }
  r.ship.hull = Math.max(0, Math.min(1, o.hull));
  r.ship.damage = { ...o.damage };
  r.ship.crewLost = Math.min(MAX_CREW_LOST, r.ship.crewLost + o.casualties);
  r.ship.stock = { ...o.stock };
  if (o.won) r.stage++;
  r.status = r.stage >= CAMPAIGN_MISSIONS[r.side].length ? 'complete' : 'dock';
  return r;
}

/** Settings for the next mission of the run, or an error text. */
export function missionSettings(run: CampaignRun): Partial<ScenarioSettings> | string {
  if (run.status === 'dock') return 'Erst die Werftliegezeit festlegen';
  if (run.status !== 'ready' && run.status !== 'sea') return 'Die Kampagne ist beendet';
  const m = nextMission(run);
  if (!m) return 'Keine weitere Mission';
  return { mission: m.mission, timeOfDay: m.timeOfDay, fillBots: true, botSkill: enemySkill(run), private: true, campaign: true, timeLimitMin: 40 };
}

/** Lines for the mission briefing on the campaign screen. */
export function briefingLines(run: CampaignRun): string[] {
  const m = nextMission(run);
  if (!m) return [];
  const out = [m.brief, `Gegner: KI ${AI_LEVEL_LABEL[enemySkill(run)]}${run.dockDays >= 4 ? ' (verstärkt während der langen Werftliegezeit)' : ''}`];
  const s = run.ship;
  if (s.hull < 0.7) out.push(`Rumpf nur ${Math.round(s.hull * 100)} % – ein weiterer Treffer kann das Ende sein.`);
  const bad = SYSTEMS.filter((k) => s.damage[k] >= 0.3);
  if (bad.length) out.push(`Schäden: ${bad.map((k) => k.toUpperCase()).join(', ')}`);
  if (s.crewLost) out.push(`${s.crewLost} Posten unbesetzt – das Boot arbeitet langsamer.`);
  const full = fullStock(s.cls);
  if (s.stock.torpedoes < full.torpedoes) out.push(`Torpedos: ${s.stock.torpedoes} von ${full.torpedoes}`);
  if (s.stock.mines !== undefined && s.stock.mines < (full.mines ?? 0)) out.push(`Minen: ${s.stock.mines} von ${full.mines}`);
  if (s.stock.wake !== undefined && s.stock.wake < (full.wake ?? 0)) out.push(`Kielwassertorpedos: ${s.stock.wake} von ${full.wake}`);
  return out;
}

/** Validate a run read back from the database (unknown versions are ignored). */
export function parseRun(json: string): CampaignRun | undefined {
  try {
    const r = JSON.parse(json) as CampaignRun;
    if (r?.v !== 1 || !r.ship || !CLASSES[r.ship.cls] || !CAMPAIGN_MISSIONS[r.side]) return undefined;
    return r;
  } catch {
    return undefined;
  }
}
