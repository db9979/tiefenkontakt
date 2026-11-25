import { CLASSES, type ClassId } from './classes.js';
import type { PlaneKind } from './airspace.js';
import { KN, distance, headingVec, type Vec2 } from './math.js';

/**
 * Emitter library: every radar in the game has an invented designation, a band, a scan
 * character and a threat class. An ESM intercept names the emitter; from it the operator
 * infers the likely platform. Where two classes carry the same set (the two frigates, all
 * merchant ships) the emitter only narrows it down, it never identifies the ship for certain.
 */

export type EmitterThreat = 'nav' | 'surface' | 'air' | 'aircraft' | 'fire';

export interface EmitterSpec {
  id: string;
  /** Frequency band (generic letter band). */
  band: string;
  /** Antenna rotation period (s); undefined = no rotation (tracking or sector scan). */
  rotationS?: number;
  /** Pulse / scan character as the ESM operator hears it. */
  pulse: string;
  threat: EmitterThreat;
  /** Likely platform as the operator would call it (short, upper case). */
  likely: string;
  /** Classes and aircraft kinds that carry this set: more than one = ambiguous. */
  carriers: (ClassId | PlaneKind)[];
}

export const EMITTERS: Record<string, EmitterSpec> = {
  'SEEFALKE-2': { id: 'SEEFALKE-2', band: 'X', rotationS: 2.5, pulse: 'kurze Pulse, hohe Folgefrequenz', threat: 'surface', likely: 'FREGATTE', carriers: ['ffg', 'ffv'] },
  'KORMORAN-1': { id: 'KORMORAN-1', band: 'X', rotationS: 3, pulse: 'kurze Pulse, gestaffelt', threat: 'surface', likely: 'KORVETTE', carriers: ['kor'] },
  'TAIFUN-11': { id: 'TAIFUN-11', band: 'S', rotationS: 6, pulse: 'lange Pulse, niedrige Folgefrequenz', threat: 'air', likely: 'WACHSCHIFF', carriers: ['ffk'] },
  'ZIELSPINNE-4': { id: 'ZIELSPINNE-4', band: 'Ku', pulse: 'Dauerstrich, Zielverfolgung', threat: 'fire', likely: 'FREGATTE', carriers: ['ffg', 'ffv'] },
  'BLITZAUGE-2': { id: 'BLITZAUGE-2', band: 'Ku', pulse: 'Konusabtastung, Zielverfolgung', threat: 'fire', likely: 'KORVETTE', carriers: ['kor'] },
  'SKORPION-F': { id: 'SKORPION-F', band: 'C', pulse: 'Zielverfolgung, Doppelkeule', threat: 'fire', likely: 'WACHSCHIFF', carriers: ['ffk'] },
  'LOTSE-9': { id: 'LOTSE-9', band: 'X', rotationS: 2.4, pulse: 'Navigationsradar, kurze Pulse', threat: 'nav', likely: 'HANDELSSCHIFF', carriers: ['merchant', 'tanker', 'container', 'faehre'] },
  'MÖWE-M': { id: 'MÖWE-M', band: 'X', rotationS: 2, pulse: 'kleines Navigationsradar, schwach', threat: 'nav', likely: 'KLEINFAHRZEUG', carriers: ['fischer', 'schlepper', 'yacht'] },
  'ALBATROS-7': { id: 'ALBATROS-7', band: 'X', rotationS: 4, pulse: 'Sektorabtastung, Pulskompression', threat: 'aircraft', likely: 'SEEAUFKLÄRER', carriers: ['mpa'] },
  'LIBELLE-5': { id: 'LIBELLE-5', band: 'X', rotationS: 3, pulse: 'kurze Pulse, schnelle Rundsuche', threat: 'aircraft', likely: 'HUBSCHRAUBER', carriers: ['helo'] },
  'NORDLICHT-3': { id: 'NORDLICHT-3', band: 'X', rotationS: 5, pulse: 'lange Pulse, Seeraumüberwachung', threat: 'aircraft', likely: 'FERNAUFKLÄRER', carriers: ['recon'] },
};

/** Search / navigation radar per ship class (submarines carry none in this game). */
const SHIP_SEARCH: Partial<Record<ClassId, string>> = {
  ffg: 'SEEFALKE-2', ffv: 'SEEFALKE-2', kor: 'KORMORAN-1', ffk: 'TAIFUN-11',
  merchant: 'LOTSE-9', tanker: 'LOTSE-9', container: 'LOTSE-9', faehre: 'LOTSE-9',
  fischer: 'MÖWE-M', schlepper: 'MÖWE-M', yacht: 'MÖWE-M',
};

/** Fire-control radar per class: radiates while the ship guides a missile. */
const SHIP_FIRE: Partial<Record<ClassId, string>> = { ffg: 'ZIELSPINNE-4', ffv: 'ZIELSPINNE-4', kor: 'BLITZAUGE-2', ffk: 'SKORPION-F' };

const AIR: Partial<Record<PlaneKind, string>> = { mpa: 'ALBATROS-7', helo: 'LIBELLE-5', recon: 'NORDLICHT-3' };

export const THREAT_LABEL: Record<EmitterThreat, string> = {
  nav: 'NAVIGATION', surface: 'OBERFLÄCHENSUCHE', air: 'LUFTSUCHE', aircraft: 'FLUGZEUGRADAR', fire: 'FEUERLEITUNG',
};

/** Emitter of a ship's radar: the fire-control set while it guides a missile, else its search radar. */
export function shipEmitter(cls: ClassId, fireControl = false): string | undefined {
  return (fireControl && SHIP_FIRE[cls]) || SHIP_SEARCH[cls];
}

export function aircraftEmitter(kind: PlaneKind): string | undefined {
  return AIR[kind];
}

export function emitterSpec(id: string | undefined): EmitterSpec | undefined {
  return id ? EMITTERS[id] : undefined;
}

/** All classes / aircraft kinds that could carry this emitter (the ESM operator's candidate list). */
export function emitterCandidates(id: string): (ClassId | PlaneKind)[] {
  return EMITTERS[id]?.carriers ?? [];
}

/** More than one class carries it: the likely platform is a guess between them. */
export function isAmbiguous(id: string): boolean {
  return emitterCandidates(id).length > 1;
}

/** Aircraft radar or fire control: a boat with a mast up should go deep. */
export function isDangerEmitter(id: string | undefined): boolean {
  const t = emitterSpec(id)?.threat;
  return t === 'aircraft' || t === 'fire';
}

/** Signal strength 0 weak, 1 medium, 2 strong from range (free-space: 20 log r against the ESM reach). */
export function esmLevel(rangeM: number, reachM: number): 0 | 1 | 2 {
  const db = 20 * Math.log10(reachM / Math.max(1, rangeM));
  return db > 12 ? 2 : db > 4 ? 1 : 0;
}

/** Strength trend from geometry: +1 rising (closing), -1 falling (opening), 0 steady. */
export function esmTrend(obs: Vec2, obsHeading: number, obsSpeed: number, em: Vec2, emHeading: number, emSpeed: number): -1 | 0 | 1 {
  const dt = 10;
  const a = headingVec(obsHeading), b = headingVec(emHeading);
  const now = distance(obs, em);
  const later = distance({ x: obs.x + a.x * obsSpeed * dt, y: obs.y + a.y * obsSpeed * dt }, { x: em.x + b.x * emSpeed * dt, y: em.y + b.y * emSpeed * dt });
  const closingKn = (now - later) / dt / KN;
  return closingKn > 2 ? 1 : closingKn < -2 ? -1 : 0;
}

const LEVEL_TEXT = ['SCHWACH', 'MITTEL', 'STARK'];
const TREND_TEXT: Record<string, string> = { '1': 'STEIGEND', '0': 'GLEICH', '-1': 'FALLEND' };

/** "STARK, STEIGEND" */
export function esmStrengthText(level?: number, trend?: number): string {
  if (level === undefined) return '';
  return `${LEVEL_TEXT[level] ?? ''}${trend !== undefined ? `, ${TREND_TEXT[String(trend)]}` : ''}`;
}

/** "SEEFALKE-2 · FREGATTE? (OBERFLÄCHENSUCHE)": the platform carries a ? when the emitter is shared. */
export function emitterText(id: string | undefined): string {
  const e = emitterSpec(id);
  if (!e) return '';
  return `${e.id} · ${e.likely}${e.carriers.length > 1 ? '?' : ''} (${THREAT_LABEL[e.threat]})`;
}

/** Full intercept line after the bearing: emitter, likely platform, strength and trend. */
export function esmIntercept(id: string | undefined, level?: number, trend?: number): string {
  const s = esmStrengthText(level, trend);
  return [emitterText(id), s].filter(Boolean).join(' · ');
}

/** Danger cue for aircraft and fire-control intercepts; a boat is told to dive. */
export function esmDangerText(id: string | undefined, submarine: boolean): string | undefined {
  const t = emitterSpec(id)?.threat;
  if (t === 'aircraft') return submarine ? 'FLUGZEUGRADAR – TAUCHEN' : 'FLUGZEUGRADAR';
  if (t === 'fire') return submarine ? 'FEUERLEITRADAR – TAUCHEN' : 'FEUERLEITRADAR – ERFASST';
  return undefined;
}

const PLANE_NAME: Partial<Record<PlaneKind, string>> = { mpa: 'Seeaufklärer', helo: 'Bordhubschrauber', recon: 'Fernaufklärer' };

/** "Fregatte F-12 / Fregatte F-30 (VDS)": the platforms the emitter could belong to. */
export function candidateNames(id: string): string {
  return emitterCandidates(id).map((c) => (c in CLASSES ? CLASSES[c as ClassId].name : PLANE_NAME[c as PlaneKind] ?? c)).join(' / ');
}
