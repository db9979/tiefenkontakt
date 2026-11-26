import { cavitationSpeedAt } from './acoustics.js';
import { SAM_SPECS } from './airdef.js';
import { SSM_SPECS } from './antiship.js';
import { DIP_RANGE, HELO_RANGE } from './aviation.js';
import { CLASSES, hasHelicopter, isEscort, type ClassId } from './classes.js';
import { PERISCOPE_DEPTH } from './entities.js';
import { createLoadout } from './loadout.js';
import { MINE_MAX_WATER, MINE_MIN_WATER } from './mines.js';
import { RADAR_MAST_RANGE, RADAR_RANGE, SUB_RADAR_RANGE } from './sensors.js';
import { SIGNATURES, shaftHz, type SigKey, type Tonal } from './signatures.js';
import { DC_LETHAL, ROCKET_MAX_RANGE, TORPEDO_SPECS, WIRE_MAX_RANGE } from './weapons.js';

/**
 * The acoustic and threat pages of the recognition book, generated from the simulation's own
 * tables (signatures, classes, loadouts, weapon and sensor ranges), so the book always shows
 * what the game actually does. Also used by the handbook.
 */

/** What a class sounds like to a trained ear (German). */
export const SOUND_DESC: Partial<Record<SigKey, string>> = {
  ffg: 'Gleichmäßiges Rauschen, Turbinenpfeifen; 5 Flügel, mittlere Drehzahl.',
  ffv: 'Dampfturbine: weiches Rauschen, 3 große Flügel, Linien 190/285 Hz.',
  kor: 'Diesel-Schlag im 75-Hz-Raster, 4 Flügel, wendig und leise.',
  ssw: 'Fast unhörbar: 60-Hz-Bordnetz (West!) und Getriebe um 42 Hz, sieben Flügel, sehr langsame Welle.',
  ffk: 'Gasturbinen-Heulen bei 300 Hz, 50-Hz-Bordnetz, zwei Wellen mit je vier Flügeln.',
  ssn: 'Kaum Schraube, dafür Pumpen- und Turbinenton bei 25/60/120 Hz; viele Flügel.',
  ssk: 'Auf Batterie fast nur eine schwache 50-Hz-Linie; schnorchelnd laute Diesel bei 24/48/72 Hz.',
  ssc: 'Klein und schnell drehend, 60-Hz-Linie; schnorchelnd 30/60/90 Hz.',
  ssa: 'Leise, aber der 400-Hz-Ton der Stromrichter verrät es; 7 Flügel.',
  merchant: 'Dumpfes Stampfen, laute Linien 50/100/150 Hz, 4–5 Flügel.',
  tanker: 'Sehr langsames Stampfen, Diesel-Zündfolge um 9 Hz; Blattrate nur wenige Hertz.',
  container: 'Schnell bei niedriger Drehzahl, 6 Flügel, Linien 12/60/120 Hz.',
  faehre: 'Zwei Wellen, viele Linien zwischen 30 und 70 Hz.',
  fischer: 'Hohe Drehzahl bei kleiner Fahrt, kräftige 30-Hz-Linie.',
  schlepper: 'Düsenpropeller, 40-Hz-Linie, hohe Drehzahl je Knoten.',
  yacht: 'Sehr leise, 25-Hz-Linie, sehr hohe Drehzahl des Hilfsdiesels.',
  torpedo: 'Hohes, sirrendes Heulen, schnell lauter werdend; 9–11 Flügel, sehr hohe Drehzahl.',
};

/** Typical running speed (kn) for reading the DEMON rates; others run at 15 kn. */
export const TYPICAL_KN: Partial<Record<SigKey, number>> = { ssw: 6, ssn: 6, ssk: 4, ssc: 4, ssa: 4, torpedo: 40, yacht: 6, fischer: 8, schlepper: 10, merchant: 12 };
export const typicalKn = (k: SigKey): number => TYPICAL_KN[k] ?? 15;

export interface AcousticSheet {
  name: string;
  blades: number[];
  rpmPerKn: number;
  tonals: Tonal[];
  snorkel: Tonal[];
  desc?: string;
  typicalKn: number;
  maxKn: number;
  /** DEMON rates at the typical speed (Hz). */
  shaftHz: number;
  bladeHz: number;
  /** Submarines: cavitation onset at periscope depth and at 150 m (kn; it grows with √pressure), and the AIP speed limit. */
  cavKn?: number;
  cavDeepKn?: number;
  aipKn?: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function acousticSheet(cls: ClassId): AcousticSheet | undefined {
  const sig = SIGNATURES[cls];
  if (!sig) return undefined;
  const spec = CLASSES[cls];
  const kn = Math.min(typicalKn(cls), spec.maxSpeedKn);
  const shaft = shaftHz(sig, kn);
  return {
    name: sig.name, blades: sig.blades, rpmPerKn: sig.rpmPerKn, tonals: sig.tonals, snorkel: sig.snorkelTonals ?? [],
    desc: SOUND_DESC[cls], typicalKn: kn, maxKn: spec.maxSpeedKn,
    shaftHz: Math.round(shaft * 100) / 100, bladeHz: Math.round(shaft * (sig.blades[0] ?? 0) * 100) / 100,
    cavKn: spec.cavKn === undefined ? undefined : r1(cavitationSpeedAt(cls, PERISCOPE_DEPTH)),
    cavDeepKn: spec.cavKn === undefined ? undefined : r1(cavitationSpeedAt(cls, 150)), aipKn: spec.aipKn,
  };
}

/** One bar of the narrowband chart: position 0..1 over 0..maxHz, height 0..1 from the line's level. */
export interface LofarBar { hz: number; x: number; h: number; snorkel: boolean }
const LEVEL_LO = -8;
const LEVEL_HI = 10;
export function lofarBars(sheet: Pick<AcousticSheet, 'tonals' | 'snorkel'>, maxHz = 500): LofarBar[] {
  const bar = (t: Tonal, snorkel: boolean): LofarBar => ({
    hz: t.hz, snorkel, x: Math.min(1, Math.max(0, t.hz / maxHz)),
    h: Math.round(Math.min(1, Math.max(0.08, (t.level - LEVEL_LO) / (LEVEL_HI - LEVEL_LO))) * 100) / 100,
  });
  return [...sheet.tonals.map((t) => bar(t, false)), ...sheet.snorkel.map((t) => bar(t, true))].sort((a, b) => a.hz - b.hz);
}

/** A weapon, sensor or countermeasure of a class, with its dangerous range where the simulation has one. */
export interface ThreatLine {
  kind: 'waffe' | 'sensor' | 'abwehr';
  name: string;
  /** Rounds carried. */
  count?: number;
  /** Short German fragments (each one translatable on its own). */
  details: string[];
  /** Reach (m). */
  rangeM?: number;
}

export const kmText = (m: number): string => `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;

/** Weapons, countermeasures and sensors of a warship or submarine; empty for unarmed ships. */
export function threatSheet(cls: ClassId): ThreatLine[] {
  const spec = CLASSES[cls];
  if (!spec.submarine && !isEscort(cls)) return [];
  const out: ThreatLine[] = [];
  const l = createLoadout(cls);
  const loaded = l.tubes.filter((t) => t.loaded).length;
  const tubes = l.tubes.length;
  if (spec.submarine) {
    const t = TORPEDO_SPECS.heavy;
    out.push({ kind: 'waffe', name: 'Schwere Torpedos', count: l.heavy + loaded, details: [`${tubes} Rohre`, `${t.speedKn} kn`, `drahtgelenkt bis ${kmText(WIRE_MAX_RANGE)}`], rangeM: t.maxRun });
    if (l.mines) out.push({ kind: 'waffe', name: 'Minen', count: l.mines, details: [`Wassertiefe ${MINE_MIN_WATER}–${MINE_MAX_WATER} m`] });
  } else {
    const t = TORPEDO_SPECS.light;
    if (tubes) out.push({ kind: 'waffe', name: 'Leichttorpedos', count: l.light + loaded, details: [`${tubes} Rohre`, `${t.speedKn} kn`, 'sucht im Kreis'], rangeM: t.maxRun });
    if (l.rockets) out.push({ kind: 'waffe', name: 'U-Jagd-Raketen', count: l.rockets, details: ['tragen einen Leichttorpedo ans Ziel'], rangeM: ROCKET_MAX_RANGE });
    if (l.depthCharges) out.push({ kind: 'waffe', name: 'Wasserbomben', count: l.depthCharges, details: ['Salve 400–800 m voraus geworfen', `tödlich im Umkreis von ${DC_LETHAL} m`] });
    const ssm = SSM_SPECS[cls];
    if (ssm) out.push({ kind: 'waffe', name: 'Seezielflugkörper', count: ssm.magazine, details: [ssm.name, 'gegen Schiffe', `ab ${kmText(ssm.minRange)}`], rangeM: ssm.maxRange });
    const sam = SAM_SPECS[cls];
    if (sam) out.push({ kind: 'waffe', name: 'Flugabwehrraketen', count: sam.magazine, details: [sam.name, `bis ${kmText(sam.maxAlt)} Höhe`, 'braucht Radar'], rangeM: sam.maxRange });
    if (hasHelicopter(cls)) out.push({ kind: 'waffe', name: 'Bordhubschrauber', details: ['Sonarbojen', `Tauchsonar ${kmText(DIP_RANGE)}`, 'Leichttorpedo', 'MAD'], rangeM: HELO_RANGE });
  }
  if (l.noisemakers) out.push({ kind: 'abwehr', name: 'Täuschkörper', count: l.noisemakers, details: ['lenken Torpedos ab'] });
  out.push({ kind: 'sensor', name: spec.hull.activeSl ? 'Rumpfsonar (passiv und aktiv)' : 'Rumpfsonar (passiv)', details: [`blind achteraus ±${spec.hull.baffleHalfAngle}°`] });
  if (spec.towed) out.push({ kind: 'sensor', name: 'Schleppsonar', details: [`${spec.towed.maxLength} m Kabel`, `nutzbar bis ${spec.towed.maxSpeedKn} kn`, `nach Kurswechsel ${spec.towed.settleTime} s`] });
  if (spec.vds) out.push({ kind: 'sensor', name: 'Tiefensonar (VDS)', details: [`bis ${spec.vds.maxDepth} m tief`, `nutzbar bis ${spec.vds.maxSpeedKn} kn`, 'hört unter der Schicht'] });
  if (!spec.submarine) out.push({ kind: 'sensor', name: 'Radar', details: ['Schiffe', `U-Boot-Mast bis ${kmText(RADAR_MAST_RANGE)}`], rangeM: RADAR_RANGE });
  else out.push({ kind: 'sensor', name: 'Mastradar', details: ['nur mit Mast oben', 'verrät sich im ESM'], rangeM: SUB_RADAR_RANGE });
  return out;
}
