import type { ClassId } from './classes.js';
import type { Rng } from './rng.js';

/**
 * Acoustic signatures and the measurements a sonar operator gets from them.
 * The server sends only measurements (lines with noise); naming a contact is
 * the player's decision, helped by the class library below.
 */

export type SigKey = 'merchant' | 'ffg' | 'kor' | 'ssn' | 'ssk' | 'ssc' | 'torpedo';
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
    key: 'kor', name: 'Korvette K-7 (Diesel)', choice: 'warship', blades: [4],
    rpmPerKn: 9, rpmRange: [50, 230], tonalBand: [40, 220], maxSpeedKn: 26,
    tonals: [{ hz: 75, level: 6 }, { hz: 150, level: 4 }, { hz: 225, level: 2 }],
  },
  ssc: {
    key: 'ssc', name: 'Küsten-U-Boot Projekt 2', choice: 'submarine', blades: [5],
    rpmPerKn: 12, rpmRange: [30, 170], tonalBand: [20, 80], maxSpeedKn: 14,
    tonals: [{ hz: 60, level: -4 }],
    snorkelTonals: [{ hz: 30, level: 7 }, { hz: 60, level: 6 }, { hz: 90, level: 4 }],
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
  merchant: 14, warship: 30, submarine: 30, torpedo: 50, bio: 10, unknown: 30,
};
