import type { ClassId } from './classes.js';

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
}

const TEMPLATES: Record<ClassId, Omit<Loadout, 'tubes'> & { tubeCount: number }> = {
  ssn: { heavy: 16, light: 0, rockets: 0, depthCharges: 0, noisemakers: 8, tubeCount: 4, reloadTime: 90, towedDecoy: false, xbt: 0 },
  ssk: { heavy: 12, light: 0, rockets: 0, depthCharges: 0, noisemakers: 6, tubeCount: 6, reloadTime: 120, towedDecoy: false, xbt: 0 },
  ffg: { heavy: 0, light: 6, rockets: 8, depthCharges: 12, noisemakers: 0, tubeCount: 2, reloadTime: 60, towedDecoy: false, xbt: 8 },
  merchant: { heavy: 0, light: 0, rockets: 0, depthCharges: 0, noisemakers: 0, tubeCount: 0, reloadTime: 0, towedDecoy: false, xbt: 0 },
};

export function createLoadout(cls: ClassId): Loadout {
  const { tubeCount, ...rest } = TEMPLATES[cls];
  const stock = cls === 'ffg' ? rest.light : rest.heavy;
  const loaded = Math.min(tubeCount, stock);
  const tubes = Array.from({ length: tubeCount }, (_, i) => ({ loaded: i < loaded, reloadDoneAt: 0 }));
  if (cls === 'ffg') rest.light -= loaded;
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
      const key = cls === 'ffg' ? 'light' : 'heavy';
      if (l[key] > 0) {
        l[key] -= 1;
        t.reloadDoneAt = now + l.reloadTime * slowdown;
      }
    }
  }
}
