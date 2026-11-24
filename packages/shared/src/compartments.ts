import { isEscort } from './classes.js';
import { CLASSES, type ClassId } from './classes.js';
import type { Ship } from './entities.js';
import { headingVec, type Vec2 } from './math.js';
import type { Rng } from './rng.js';
import type { World } from './world.js';

/**
 * Watertight compartments along the hull (bow first). Every ship is a row of them: a hit
 * strikes the one nearest the hit point and the blast spreads to its neighbours; each holds
 * water, fire, wreckage and a bulkhead state. damage.ts derives the old per-system damage
 * from them, flooding.ts runs water, fire and the damage-control parties.
 */

export type CompSystem = 'antrieb' | 'sonar' | 'waffen';

export interface CompSpec {
  /** Display name (German, upper case in the UI). */
  name: string;
  /** Dative phrase for reports: "IM MASCHINENRAUM". */
  dat: string;
  /** Share of the hull volume (the shares of one layout add up to 1). */
  vol: number;
  /** How much of each system is lost when this compartment is wrecked, flooded or sealed. */
  sys: Partial<Record<CompSystem, number>>;
  tag?: 'battery' | 'magazine' | 'engine' | 'control';
}

export interface CompState {
  /** Water 0..1 of the compartment's volume. */
  flood: number;
  /** Hole size 0..1 (1 = a torpedo hole). */
  leak: number;
  /** Fire 0..1. */
  fire: number;
  /** Wreckage of the equipment 0..1. */
  dmg: number;
  /** Bulkheads closed: no water or fire passes, the crew has left it. */
  sealed: boolean;
  /** The crew reopened it: don't seal it again on their own. */
  manual?: boolean;
}

const c = (name: string, dat: string, vol: number, sys: CompSpec['sys'] = {}, tag?: CompSpec['tag']): CompSpec => ({ name, dat, vol, sys, tag });

const SSN: CompSpec[] = [
  c('Bugraum', 'IM BUGRAUM', 0.12, { sonar: 1 }), c('Torpedoraum', 'IM TORPEDORAUM', 0.17, { waffen: 1 }, 'magazine'),
  c('Zentrale', 'IN DER ZENTRALE', 0.19, { sonar: 0.6, waffen: 0.4 }, 'control'), c('Reaktorraum', 'IM REAKTORRAUM', 0.16, { antrieb: 0.7 }),
  c('Maschinenraum', 'IM MASCHINENRAUM', 0.24, { antrieb: 1 }, 'engine'), c('Heckraum', 'IM HECKRAUM', 0.12, { antrieb: 0.5 }),
];
const SSK: CompSpec[] = [
  c('Bugraum', 'IM BUGRAUM', 0.12, { sonar: 1 }), c('Torpedoraum', 'IM TORPEDORAUM', 0.18, { waffen: 1 }, 'magazine'),
  c('Zentrale', 'IN DER ZENTRALE', 0.2, { sonar: 0.6, waffen: 0.4 }, 'control'), c('Wohnraum', 'IM WOHNRAUM', 0.16, { antrieb: 0.4 }, 'battery'),
  c('Maschinenraum', 'IM MASCHINENRAUM', 0.22, { antrieb: 1 }, 'engine'), c('Heckraum', 'IM HECKRAUM', 0.12, { antrieb: 0.5 }),
];
const SSC: CompSpec[] = [
  c('Bug-/Torpedoraum', 'IM BUG-/TORPEDORAUM', 0.3, { sonar: 1, waffen: 1 }, 'magazine'), c('Zentrale', 'IN DER ZENTRALE', 0.25, { sonar: 0.5 }, 'control'),
  c('Maschinenraum', 'IM MASCHINENRAUM', 0.3, { antrieb: 1 }, 'engine'), c('Heckraum', 'IM HECKRAUM', 0.15, { antrieb: 0.5 }, 'battery'),
];
const FFG: CompSpec[] = [
  c('Vorschiff', 'IM VORSCHIFF', 0.18, { sonar: 1 }), c('Magazin', 'IM MAGAZIN', 0.14, { waffen: 1 }, 'magazine'),
  c('Brücke/OPZ', 'IN DER OPZ', 0.2, { sonar: 0.5, waffen: 0.5 }, 'control'), c('Maschine', 'IN DER MASCHINE', 0.26, { antrieb: 1 }, 'engine'),
  c('Hangar/Achterschiff', 'IM ACHTERSCHIFF', 0.22, { antrieb: 0.4, waffen: 0.3 }),
];
const KOR: CompSpec[] = [
  c('Vorschiff', 'IM VORSCHIFF', 0.22, { sonar: 1 }), c('Brücke/OPZ', 'IN DER OPZ', 0.25, { sonar: 0.5, waffen: 1 }, 'magazine'),
  c('Maschine', 'IN DER MASCHINE', 0.3, { antrieb: 1 }, 'engine'), c('Achterschiff', 'IM ACHTERSCHIFF', 0.23, { antrieb: 0.4 }),
];
const CARGO: CompSpec[] = [
  c('Vorschiff', 'IM VORSCHIFF', 0.14), c('Laderaum 1', 'IM LADERAUM 1', 0.25), c('Laderaum 2', 'IM LADERAUM 2', 0.25),
  c('Maschine', 'IN DER MASCHINE', 0.2, { antrieb: 1 }, 'engine'), c('Achterschiff', 'IM ACHTERSCHIFF', 0.16, { antrieb: 0.3 }, 'control'),
];
const SMALL: CompSpec[] = [
  c('Vorschiff', 'IM VORSCHIFF', 0.3), c('Rumpf', 'IM RUMPF', 0.35), c('Maschine', 'IN DER MASCHINE', 0.35, { antrieb: 1 }, 'engine'),
];

const LAYOUT: Record<ClassId, CompSpec[]> = {
  ssn: SSN, ssw: SSN, ssk: SSK, ssa: SSK, ssc: SSC, ffg: FFG, ffk: FFG.map((x) => (x.name === 'Hangar/Achterschiff' ? { ...x, name: 'Achterschiff/VDS', sys: { antrieb: 0.4, sonar: 0.4 } } : x)), ffv: FFG.map((x) => (x.name === 'Hangar/Achterschiff' ? { ...x, name: 'Achterschiff/VDS', sys: { antrieb: 0.4, sonar: 0.4 } } : x)),
  kor: KOR, merchant: CARGO, tanker: CARGO, container: CARGO, faehre: CARGO, fischer: SMALL, schlepper: SMALL, yacht: SMALL,
};

/** Hull length (m) for placing a hit along the hull. */
const LENGTH: Record<ClassId, number> = {
  ssn: 107, ssw: 85, ssk: 73, ssa: 62, ssc: 48, ffg: 130, ffv: 113, ffk: 123, kor: 72, merchant: 150, tanker: 330, container: 210, faehre: 160,
  fischer: 60, schlepper: 65, yacht: 14,
};

/**
 * Share of the hull volume that may fill before the ship goes down. Escorts are well
 * subdivided; a submerged boat has almost no reserve, so it rests on its planes and air.
 */
export function reserveBuoyancy(s: Ship): number {
  const spec = CLASSES[s.cls];
  if (spec.submarine) return s.depth <= 1 ? 0.32 : 0.45;
  if (isEscort(s.cls)) return 0.45;
  if (s.cls === 'tanker') return 0.45;
  if (s.cls === 'fischer' || s.cls === 'schlepper' || s.cls === 'yacht') return 0.3;
  return 0.38;
}

export function compartmentLayout(cls: ClassId): CompSpec[] {
  return LAYOUT[cls];
}

/** Centre of each compartment along the hull, 0 = bow … 1 = stern. */
export function compartmentCentres(cls: ClassId): number[] {
  let acc = 0;
  return LAYOUT[cls].map((x) => {
    const m = acc + x.vol / 2;
    acc += x.vol;
    return m;
  });
}

export function compsOf(s: Ship): CompState[] {
  return (s.comps ??= LAYOUT[s.cls].map(() => ({ flood: 0, leak: 0, fire: 0, dmg: 0, sealed: false })));
}

/** Compartment index at a position along the hull (0 bow … 1 stern). */
export function compartmentAt(cls: ClassId, u: number): number {
  const l = LAYOUT[cls];
  let acc = 0;
  for (let i = 0; i < l.length; i++) {
    acc += l[i]!.vol;
    if (u < acc) return i;
  }
  return l.length - 1;
}

export function compartmentTagged(cls: ClassId, tag: NonNullable<CompSpec['tag']>): number | undefined {
  const i = LAYOUT[cls].findIndex((x) => x.tag === tag);
  return i < 0 ? undefined : i;
}

/** Water aboard as a share of the hull volume. */
export function floodWeight(s: Ship): number {
  if (!s.comps) return 0;
  const l = LAYOUT[s.cls];
  return s.comps.reduce((a, x, i) => a + x.flood * l[i]!.vol, 0);
}

/** Bow-down moment of the water aboard (+ bow heavy, − stern heavy), in hull-volume units. */
export function floodMoment(s: Ship): number {
  if (!s.comps) return 0;
  const l = LAYOUT[s.cls];
  const mid = compartmentCentres(s.cls);
  return s.comps.reduce((a, x, i) => a + x.flood * l[i]!.vol * (0.5 - mid[i]!), 0);
}

export function report(w: World | undefined, s: Ship, what: string, text: string): void {
  w?.events.push({ kind: 'boat', time: w.time, shipId: s.id, what, text });
}

export interface HitOptions {
  /** World point of the detonation (to find the compartment). */
  at?: Vec2;
  /** Or the position along the hull directly (0 bow … 1 stern). */
  u?: number;
  /** Who fired (credited if the ship sinks later). */
  byId?: string;
  /** Fire is likelier from a warhead than from grounding. */
  fireChance?: number;
  w?: World;
}

/**
 * A detonation: wrecks and holes the nearest compartment, the neighbours get some of it,
 * fires may break out. Severity 1 = a heavyweight torpedo.
 */
export function hitCompartments(s: Ship, amount: number, rng: Rng, o: HitOptions = {}): number {
  const comps = compsOf(s);
  const sev = Math.min(1.2, amount / 80);
  let u = o.u;
  if (u === undefined && o.at) {
    const f = headingVec(s.heading);
    const dx = o.at.x - s.pos.x;
    const dy = o.at.y - s.pos.y;
    u = 0.5 - (dx * f.x + dy * f.y) / LENGTH[s.cls] + rng.gauss(0, 0.18);
    // Port or starboard side of the hit: the ship lists toward it
    s.heelSide = dx * f.y - dy * f.x >= 0 ? 1 : -1;
  }
  if (u === undefined) u = rng.next();
  s.heelSide ??= rng.next() < 0.5 ? -1 : 1;
  if (o.byId) s.lastHitBy = o.byId;
  const i = compartmentAt(s.cls, Math.max(0, Math.min(0.999, u)));
  const spec = LAYOUT[s.cls];
  const sub = CLASSES[s.cls].submarine;
  const hole = Math.min(1, 1.05 * Math.pow(sev, 1.25));
  const add = (k: number, share: number) => {
    const x = comps[k];
    if (!x) return;
    const newLeak = hole * share;
    if (newLeak > 0.08 && x.leak < 0.05) report(o.w, s, 'flood', `WASSEREINBRUCH ${spec[k]!.dat}`);
    x.leak = Math.min(1, x.leak + newLeak);
    x.dmg = Math.min(1, x.dmg + (0.35 + 0.6 * sev) * share);
  };
  add(i, 1);
  add(i - 1, 0.2);
  add(i + 1, 0.2);
  const chance = o.fireChance ?? (sub ? 0.1 + 0.35 * sev : 0.25 + 0.55 * sev);
  if (rng.next() < chance) igniteCompartment(s, i, 0.25 + 0.3 * Math.min(1, sev), o.w);
  return i;
}

export function igniteCompartment(s: Ship, i: number, amount: number, w?: World): void {
  const x = compsOf(s)[i];
  if (!x) return;
  if (x.fire < 0.05) report(w, s, 'fire', `FEUER ${LAYOUT[s.cls][i]!.dat}`);
  x.fire = Math.min(1, x.fire + amount);
}

/** Bulkheads: close (seal) or reopen a compartment. */
export function setSealed(s: Ship, i: number, sealed: boolean, w?: World): true | string {
  const x = compsOf(s)[i];
  if (!x) return 'Keine solche Abteilung';
  if (x.sealed === sealed) return true;
  x.sealed = sealed;
  x.manual = !sealed;
  const name = LAYOUT[s.cls][i]!.name.toUpperCase();
  report(w, s, 'bulkhead', sealed ? `SCHOTT GESCHLOSSEN · ${name}` : `SCHOTT GEÖFFNET · ${name}`);
  return true;
}

export interface CompartmentView { flood: number; leak: number; fire: number; dmg: number; sealed?: boolean }

/** What an onlooker sees of a damaged ship: list and trim (deg), fire 0..1, settling 0..1 (1 = about to go). */
export interface WreckView { list: number; trim: number; fire: number; settle: number }

export function wreckView(s: Ship): WreckView | undefined {
  if (!s.comps) return undefined;
  const fire = Math.max(...s.comps.map((x) => x.fire));
  const settle = s.settle ?? 0;
  if (fire < 0.02 && settle < 0.02) return undefined;
  const r = (v: number) => Math.round(v * 10) / 10;
  return { list: r(s.listDeg ?? 0), trim: r(s.trimDeg ?? 0), fire: Math.round(fire * 100) / 100, settle: Math.round(settle * 100) / 100 };
}

/** A damage-control order from the player: send the party there, or close / open the bulkheads. */
export function compartmentOrder(w: World, s: Ship, i: number, action: 'priority' | 'seal' | 'open'): string | undefined {
  if (i < 0 || i >= LAYOUT[s.cls].length) return 'Keine solche Abteilung';
  if (action === 'priority') {
    if (compsOf(s)[i]!.sealed) return 'Abteilung ist abgeschottet';
    s.dcComp = i;
    s.repair = undefined;
    return undefined;
  }
  const r = setSealed(s, i, action === 'seal', w);
  return r === true ? undefined : r;
}

/** Per-compartment view for the own ship's snapshot (rounded). */
export function compartmentView(s: Ship): CompartmentView[] {
  const r = (v: number) => Math.round(v * 100) / 100;
  return compsOf(s).map((x) => ({ flood: r(x.flood), leak: r(x.leak), fire: r(x.fire), dmg: r(x.dmg), sealed: x.sealed || undefined }));
}
