import type { ClassId } from './classes.js';
import type { Rng } from './rng.js';

/**
 * Acoustic signatures and the measurements a sonar operator gets from them.
 * The server sends only measurements (lines with noise); naming a contact is
 * the player's decision, helped by the class library below.
 */

export type SigKey = ClassId | 'torpedo' | BioKind;
/** Biological sound sources: whales, dolphins and snapping shrimp beds. */
export type BioKind = 'bio' | 'blauwal' | 'buckelwal' | 'pottwal' | 'orca' | 'delfine' | 'garnelen';
export const BIO_KINDS: BioKind[] = ['bio', 'blauwal', 'buckelwal', 'pottwal', 'orca', 'delfine', 'garnelen'];
export type ClassChoice = 'merchant' | 'warship' | 'submarine' | 'torpedo' | 'bio' | 'unknown';

export interface Tonal {
  hz: number;
  /** dB relative to the broadband signal excess (narrowband processing gain included). */
  level: number;
}

export interface Signature {
  key: SigKey;
  name: string;
  choice: ClassChoice;
  /** Blade count actually fitted (first) and those the catalog accepts. */
  blades: number[];
  rpmPerKn: number;
  rpmRange: [number, number];
  tonalBand: [number, number];
  tonals: Tonal[];
  /** Extra lines while snorkeling (diesel). */
  snorkelTonals?: Tonal[];
  maxSpeedKn: number;
}

export const SIGNATURES: Record<SigKey, Signature> = {
  merchant: {
    key: 'merchant', name: 'Frachter (Einwellen-Diesel)', choice: 'merchant', blades: [4, 5],
    rpmPerKn: 8.5, rpmRange: [50, 125], tonalBand: [40, 180], maxSpeedKn: 14,
    tonals: [{ hz: 50, level: 8 }, { hz: 100, level: 6 }, { hz: 150, level: 3 }, { hz: 37.5, level: 4 }],
  },
  ffg: {
    key: 'ffg', name: 'Fregatte F-12 (Gasturbine)', choice: 'warship', blades: [5],
    rpmPerKn: 7, rpmRange: [40, 200], tonalBand: [55, 250], maxSpeedKn: 28,
    tonals: [{ hz: 60, level: 7 }, { hz: 120, level: 5 }, { hz: 180, level: 3 }, { hz: 233, level: 2 }],
  },
  ssn: {
    key: 'ssn', name: 'Atom-U-Boot Projekt 9', choice: 'submarine', blades: [7],
    rpmPerKn: 7.5, rpmRange: [30, 230], tonalBand: [20, 130], maxSpeedKn: 30,
    tonals: [{ hz: 25, level: 4 }, { hz: 60, level: 2 }, { hz: 120, level: 1 }],
  },
  ssk: {
    key: 'ssk', name: 'Diesel-U-Boot Projekt 4', choice: 'submarine', blades: [6, 7],
    rpmPerKn: 10, rpmRange: [30, 190], tonalBand: [20, 90], maxSpeedKn: 18,
    tonals: [{ hz: 50, level: -2 }],
    snorkelTonals: [{ hz: 24, level: 8 }, { hz: 48, level: 7 }, { hz: 72, level: 5 }],
  },
  kor: {
    key: 'kor', name: 'Korvette K-7 (Diesel, Gasturbine)', choice: 'warship', blades: [4],
    rpmPerKn: 9, rpmRange: [50, 230], tonalBand: [40, 220], maxSpeedKn: 26,
    tonals: [{ hz: 75, level: 6 }, { hz: 150, level: 4 }, { hz: 225, level: 2 }],
  },
  ssc: {
    key: 'ssc', name: 'Küsten-U-Boot Projekt 2', choice: 'submarine', blades: [5],
    rpmPerKn: 12, rpmRange: [30, 170], tonalBand: [20, 80], maxSpeedKn: 14,
    tonals: [{ hz: 60, level: -4 }],
    snorkelTonals: [{ hz: 30, level: 7 }, { hz: 60, level: 6 }, { hz: 90, level: 4 }],
  },
  ssa: {
    // AIP: no snorkel lines while the plant runs; a faint 400 Hz converter hum gives it away
    key: 'ssa', name: 'U-Boot Projekt 6 (AIP)', choice: 'submarine', blades: [7],
    rpmPerKn: 11, rpmRange: [30, 200], tonalBand: [20, 420], maxSpeedKn: 20,
    tonals: [{ hz: 400, level: -3 }, { hz: 50, level: -5 }],
    snorkelTonals: [{ hz: 27, level: 7 }, { hz: 54, level: 6 }, { hz: 81, level: 4 }],
  },
  ffv: {
    key: 'ffv', name: 'Fregatte F-30 (Dampfturbine)', choice: 'warship', blades: [3],
    rpmPerKn: 8, rpmRange: [40, 230], tonalBand: [45, 290], maxSpeedKn: 28,
    tonals: [{ hz: 60, level: 4 }, { hz: 190, level: 5 }, { hz: 285, level: 3 }],
  },
  fischer: {
    // Old trawler: noisy diesel, winch and a strong blade line at low speed
    key: 'fischer', name: 'Fischtrawler (Diesel)', choice: 'merchant', blades: [3, 4],
    rpmPerKn: 22, rpmRange: [80, 260], tonalBand: [30, 300], maxSpeedKn: 11,
    tonals: [{ hz: 30, level: 9 }, { hz: 90, level: 6 }, { hz: 270, level: 4 }],
  },
  // Civil traffic. Slow two-stroke diesels turn a big screw slowly: firing rate = rpm × cylinders / 60
  tanker: {
    key: 'tanker', name: 'Supertanker (Zweitakt-Diesel)', choice: 'merchant', blades: [5, 4],
    rpmPerKn: 5.5, rpmRange: [30, 90], tonalBand: [5, 120], maxSpeedKn: 15,
    tonals: [{ hz: 9, level: 9 }, { hz: 50, level: 6 }, { hz: 100, level: 4 }],
  },
  container: {
    key: 'container', name: 'Containerschiff (Zweitakt-Diesel)', choice: 'merchant', blades: [6, 5],
    rpmPerKn: 4.6, rpmRange: [40, 110], tonalBand: [8, 180], maxSpeedKn: 23,
    tonals: [{ hz: 12, level: 8 }, { hz: 60, level: 6 }, { hz: 120, level: 4 }, { hz: 180, level: 2 }],
  },
  faehre: {
    key: 'faehre', name: 'RoRo-Fähre (Mittelschnellläufer, zwei Wellen)', choice: 'merchant', blades: [4],
    rpmPerKn: 8.5, rpmRange: [60, 180], tonalBand: [20, 260], maxSpeedKn: 21,
    tonals: [{ hz: 33, level: 7 }, { hz: 50, level: 6 }, { hz: 67, level: 5 }, { hz: 250, level: 3 }],
  },
  schlepper: {
    key: 'schlepper', name: 'Schlepper (Diesel, Düsenpropeller)', choice: 'merchant', blades: [4],
    rpmPerKn: 16, rpmRange: [80, 250], tonalBand: [25, 280], maxSpeedKn: 15,
    tonals: [{ hz: 40, level: 9 }, { hz: 80, level: 6 }, { hz: 120, level: 5 }],
  },
  yacht: {
    key: 'yacht', name: 'Segelyacht (Hilfsdiesel)', choice: 'merchant', blades: [2, 3],
    rpmPerKn: 110, rpmRange: [300, 900], tonalBand: [20, 120], maxSpeedKn: 8,
    tonals: [{ hz: 25, level: 4 }, { hz: 50, level: 2 }],
  },
  // Biology: no shaft or blades. Fin whales pulse at 20 Hz, blue whales lower still; humpbacks sing;
  // sperm whales, orcas and dolphins click (the click rate shows on DEMON like a slow shaft)
  bio: {
    key: 'bio', name: 'Finnwal', choice: 'bio', blades: [1],
    rpmPerKn: 0, rpmRange: [0, 0], tonalBand: [15, 40], maxSpeedKn: 12,
    tonals: [{ hz: 20, level: 7 }, { hz: 40, level: 2 }],
  },
  blauwal: {
    key: 'blauwal', name: 'Blauwal', choice: 'bio', blades: [1],
    rpmPerKn: 0, rpmRange: [0, 0], tonalBand: [8, 75], maxSpeedKn: 10,
    tonals: [{ hz: 17, level: 8 }, { hz: 35, level: 4 }, { hz: 70, level: 2 }],
  },
  buckelwal: {
    key: 'buckelwal', name: 'Buckelwal (Gesang)', choice: 'bio', blades: [1],
    rpmPerKn: 0, rpmRange: [0, 0], tonalBand: [80, 300], maxSpeedKn: 8,
    tonals: [{ hz: 110, level: 5 }, { hz: 180, level: 4 }, { hz: 260, level: 3 }],
  },
  pottwal: {
    key: 'pottwal', name: 'Pottwal (Klicks)', choice: 'bio', blades: [1],
    rpmPerKn: 20, rpmRange: [20, 120], tonalBand: [0, 0], maxSpeedKn: 8,
    tonals: [],
  },
  orca: {
    key: 'orca', name: 'Schwertwale (Orcas)', choice: 'bio', blades: [1],
    rpmPerKn: 40, rpmRange: [60, 400], tonalBand: [200, 300], maxSpeedKn: 15,
    tonals: [{ hz: 230, level: 3 }, { hz: 285, level: 2 }],
  },
  delfine: {
    key: 'delfine', name: 'Delfinschule', choice: 'bio', blades: [1],
    rpmPerKn: 60, rpmRange: [120, 900], tonalBand: [260, 300], maxSpeedKn: 15,
    tonals: [{ hz: 290, level: 2 }],
  },
  garnelen: {
    key: 'garnelen', name: 'Knallkrebse (Garnelenbank)', choice: 'bio', blades: [1],
    rpmPerKn: 0, rpmRange: [0, 0], tonalBand: [0, 0], maxSpeedKn: 0,
    tonals: [],
  },
  torpedo: {
    key: 'torpedo', name: 'Schwergewichtstorpedo', choice: 'torpedo', blades: [9, 11],
    rpmPerKn: 38, rpmRange: [900, 2000], tonalBand: [0, 0], maxSpeedKn: 50,
    tonals: [],
  },
};

export function sigKeyOf(cls: ClassId): SigKey {
  return cls;
}

/** What the analyst can extract from one passive look at a contact. */
export interface Evidence {
  tonals: { hz: number; snr: number }[];
  /** DEMON lines: shaft rate and blade rate in Hz (absent when too weak or stopped). */
  shaftHz?: number;
  bladeHz?: number;
  demonSnr?: number;
}

/** Shaft rate in Hz for a platform at a speed. */
export function shaftHz(sig: Signature, speedKn: number): number {
  return (sig.rpmPerKn * Math.max(0, speedKn)) / 60;
}

/**
 * Measure a contact. se = broadband signal excess of this look. Narrowband
 * lines get their own SNR; DEMON needs a moving, sufficiently loud target.
 */
export function measureEvidence(
  key: SigKey, speedKn: number, se: number, opts: { cavitating?: boolean; snorkel?: boolean }, rng: Rng,
): Evidence {
  const sig = SIGNATURES[key];
  const tonals: Evidence['tonals'] = [];
  for (const t of [...sig.tonals, ...(opts.snorkel ? sig.snorkelTonals ?? [] : [])]) {
    const snr = se + t.level + rng.gauss(0, 1.5);
    if (snr > 0) tonals.push({ hz: Math.round((t.hz + rng.gauss(0, 0.25)) * 10) / 10, snr: Math.round(snr * 10) / 10 });
  }
  const ev: Evidence = { tonals };
  const shaft = shaftHz(sig, speedKn);
  const demonSnr = se - 3 + (opts.cavitating ? 8 : 0) + rng.gauss(0, 1.5);
  if (shaft > 0.3 && demonSnr > 0) {
    const blades = sig.blades[0]!;
    ev.shaftHz = Math.round((shaft + rng.gauss(0, 0.04)) * 100) / 100;
    ev.bladeHz = Math.round((shaft * blades + rng.gauss(0, 0.1)) * 100) / 100;
    ev.demonSnr = Math.round(demonSnr * 10) / 10;
  }
  return ev;
}

// ---- Class library: grade catalog classes against the operator's own marks ----

export interface Marks {
  shaftHz?: number;
  bladeHz?: number;
  tonalHz?: number;
}

const EDGE_PENALTY = 0.3;
const RPM_TOL = 0.25;
const TONAL_TOL = 0.25;
const BLADE_DEV_MAX = 0.3;
const TONAL_MATCH_HZ = 1.5;
const WEIGHTS = { rpm: 0.35, blades: 0.35, tonal: 0.3 } as const;

function bandFit(v: number, lo: number, hi: number, tol: number): number {
  if (v >= lo && v <= hi) {
    const half = (hi - lo) / 2;
    return half <= 0 ? 1 : 1 - (EDGE_PENALTY * Math.abs(v - (lo + hi) / 2)) / half;
  }
  const edge = v < lo ? lo : hi;
  const d = Math.abs(v - edge) / Math.max(Math.abs(edge), 1e-6);
  return Math.max(0, (1 - EDGE_PENALTY) * (1 - d / tol));
}

const valid = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;

export function marksCount(m: Marks): number {
  return [m.shaftHz, m.bladeHz, m.tonalHz].filter(valid).length;
}

/** Blades, deviation from a whole number and RPM from shaft and blade marks. */
export function bladeCount(m: Marks): { blades: number; deviation: number; rpm: number } | undefined {
  if (!valid(m.shaftHz) || !valid(m.bladeHz)) return undefined;
  const ratio = m.bladeHz / m.shaftHz;
  const blades = Math.max(1, Math.round(ratio));
  return { blades, deviation: ratio - blades, rpm: m.shaftHz * 60 };
}

export function gradeClass(sig: Signature, m: Marks): number | undefined {
  const parts: Partial<Record<keyof typeof WEIGHTS, number>> = {};
  if (valid(m.shaftHz)) parts.rpm = bandFit(m.shaftHz * 60, sig.rpmRange[0], sig.rpmRange[1], RPM_TOL);
  const bc = bladeCount(m);
  if (bc) parts.blades = sig.blades.includes(bc.blades) ? Math.max(0, 1 - Math.abs(bc.deviation) / BLADE_DEV_MAX) : 0;
  if (valid(m.tonalHz)) {
    const hz = m.tonalHz;
    const main = sig.tonalBand[1] > 0 ? bandFit(hz, sig.tonalBand[0], sig.tonalBand[1], TONAL_TOL) : 0;
    const lines = [...sig.tonals, ...(sig.snorkelTonals ?? [])];
    const line = Math.max(0, ...lines.map((t) => 1 - Math.abs(hz - t.hz) / TONAL_MATCH_HZ));
    parts.tonal = Math.max(main * 0.8, line);
  }
  const keys = Object.keys(parts) as (keyof typeof WEIGHTS)[];
  if (!keys.length) return undefined;
  const w = keys.reduce((a, k) => a + WEIGHTS[k], 0);
  return Math.round((keys.reduce((a, k) => a + WEIGHTS[k] * parts[k]!, 0) / w) * 1000) / 1000;
}

/** Catalog classes sorted by fit to the marks (best first). Empty without marks. */
export function rankClasses(m: Marks): { sig: Signature; fit: number }[] {
  if (marksCount(m) === 0) return [];
  return Object.values(SIGNATURES)
    .map((sig) => ({ sig, fit: gradeClass(sig, m) }))
    .filter((r): r is { sig: Signature; fit: number } => r.fit !== undefined)
    .sort((a, b) => b.fit - a.fit || a.sig.key.localeCompare(b.sig.key));
}

export const CHOICE_MAX_KN: Record<ClassChoice, number> = {
  merchant: 23, warship: 30, submarine: 30, torpedo: 50, bio: 15, unknown: 30,
};
