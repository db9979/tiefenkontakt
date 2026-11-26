import { CLASSES, type ClassId } from './classes.js';

export interface Tube {
  loaded: boolean;
  reloadDoneAt: number; // sim time when reload completes
}

export interface Loadout {
  heavy: number; // heavyweight torpedoes in storage (subs)
  light: number; // lightweight torpedoes for tubes (frigate)
  rockets: number; // ASW rockets (frigate)
  depthCharges: number;
  noisemakers: number;
  tubes: Tube[];
  reloadTime: number; // s
  towedDecoy: boolean; // frigate towed torpedo decoy streamed
  xbt: number; // expendable bathythermographs
  /** Naval mines (laid through the tubes, carried instead of some torpedoes). */
  mines?: number;
  /** Surface-to-air missiles left (escorts; undefined = full magazine, airdef.ts). */
  sams?: number;
  /** Wake-homing torpedoes in the rack (east SSN; fired in place of a tube's heavyweight). */
  wake?: number;
}

const NONE = { heavy: 0, light: 0, rockets: 0, depthCharges: 0, noisemakers: 0, tubeCount: 0, reloadTime: 0, towedDecoy: false, xbt: 0 };
const TEMPLATES: Record<ClassId, Omit<Loadout, 'tubes'> & { tubeCount: number }> = {
  // Project 9 (Victor III / Akula type): 4 of its 16 weapons are wake homers of the 65-76 type
  // (650 mm, anti-ship); the rest passive/active heavyweights
  ssn: { heavy: 12, light: 0, rockets: 0, depthCharges: 0, noisemakers: 8, tubeCount: 4, reloadTime: 90, towedDecoy: false, xbt: 0, wake: 4 },
  // Kilo-type: two torpedo stowages hold four mines instead
  ssk: { heavy: 10, light: 0, rockets: 0, depthCharges: 0, noisemakers: 6, tubeCount: 6, reloadTime: 120, towedDecoy: false, xbt: 0, mines: 4 },
  // Coastal boat: eight bow tubes and no reloads (Type-206 style)
  // ... and an external mine belt around the hull (laid without using a tube)
  ssc: { heavy: 8, light: 0, rockets: 0, depthCharges: 0, noisemakers: 4, tubeCount: 8, reloadTime: 150, towedDecoy: false, xbt: 0, mines: 4 },
  // Escorts: depthCharges counts salvos of the ahead-throwing mortar (six charges each)
  kor: { heavy: 0, light: 4, rockets: 4, depthCharges: 8, noisemakers: 0, tubeCount: 2, reloadTime: 50, towedDecoy: false, xbt: 6 },
  ssw: { heavy: 14, light: 0, rockets: 0, depthCharges: 0, noisemakers: 8, tubeCount: 4, reloadTime: 90, towedDecoy: false, xbt: 0 },
  // Frigates: two triple tube mounts, all six loaded; a reload from the magazine takes 15 minutes
  ffk: { heavy: 0, light: 10, rockets: 8, depthCharges: 6, noisemakers: 0, tubeCount: 6, reloadTime: 900, towedDecoy: false, xbt: 6 },
  ffv: { heavy: 0, light: 10, rockets: 8, depthCharges: 6, noisemakers: 0, tubeCount: 6, reloadTime: 900, towedDecoy: false, xbt: 8 },
  ssa: { heavy: 8, light: 0, rockets: 0, depthCharges: 0, noisemakers: 6, tubeCount: 4, reloadTime: 120, towedDecoy: false, xbt: 0, mines: 4 },
  fischer: NONE, tanker: NONE, container: NONE, faehre: NONE, schlepper: NONE, yacht: NONE,
  ffg: { heavy: 0, light: 8, rockets: 8, depthCharges: 6, noisemakers: 0, tubeCount: 6, reloadTime: 900, towedDecoy: false, xbt: 8 },
  merchant: { heavy: 0, light: 0, rockets: 0, depthCharges: 0, noisemakers: 0, tubeCount: 0, reloadTime: 0, towedDecoy: false, xbt: 0 },
};

export function createLoadout(cls: ClassId): Loadout {
  const { tubeCount, ...rest } = TEMPLATES[cls];
  const surface = !CLASSES[cls].submarine;
  const stock = surface ? rest.light : rest.heavy;
  const loaded = Math.min(tubeCount, stock);
  const tubes = Array.from({ length: tubeCount }, (_, i) => ({ loaded: i < loaded, reloadDoneAt: 0 }));
  if (surface) rest.light -= loaded;
  else rest.heavy -= loaded;
  return { ...rest, tubes };
}

/** Complete reloads whose timer elapsed and start new ones from storage. */
export function stepReload(l: Loadout, cls: ClassId, now: number, slowdown = 1): void {
  for (const t of l.tubes) {
    if (t.loaded) continue;
    if (t.reloadDoneAt > 0 && now >= t.reloadDoneAt) {
      t.loaded = true;
      t.reloadDoneAt = 0;
      continue;
    }
    if (t.reloadDoneAt === 0) {
      const key = CLASSES[cls].submarine ? 'heavy' : 'light';
      if (l[key] > 0) {
        l[key] -= 1;
        t.reloadDoneAt = now + l.reloadTime * slowdown;
      }
    }
  }
}
