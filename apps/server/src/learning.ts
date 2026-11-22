import type { Environment, Habits, PlayerSlot } from '@tk/shared';
import { userIdOf } from './stats.js';

/**
 * The enemy learns: from each account player's last five matches on a side, a habit that
 * showed up at least three times makes the opposing AI adapt a little. The debrief says so.
 */

const SEEN = 3;
const T = { pd: 0.25, above: 0.6, fast: 0.3, ping: 0.3 } as const;

export interface Learned {
  adapt: NonNullable<Environment['adapt']>;
  notes: string[];
}

export function learnFrom(slots: PlayerSlot[], recent: (userId: number, team: string) => Habits[]): Learned {
  const adapt: Learned['adapt'] = {};
  const notes: string[] = [];
  const habit = (team: 'west' | 'east', key: keyof Habits) =>
    slots.some((s) => {
      const uid = !s.bot && s.team === team ? userIdOf(s.playerId) : undefined;
      return uid !== undefined && recent(uid, team).filter((h) => h[key] > T[key]).length >= SEEN;
    });
  if (habit('east', 'pd')) {
    (adapt.west ??= {}).pd = true;
    notes.push('Der Gegner hat gelernt: Eure U-Boote waren oft auf Sehrohrtiefe – die Geleitschiffe setzten öfter Radar ein.');
  }
  if (habit('east', 'above')) {
    (adapt.west ??= {}).above = true;
    notes.push('Der Gegner hat gelernt: Eure U-Boote blieben meist über der Sprungschicht – Bojen und Tauchsonar gingen flacher.');
  }
  if (habit('east', 'fast')) {
    (adapt.west ??= {}).fast = true;
    notes.push('Der Gegner hat gelernt: Eure U-Boote fuhren oft schnell – die Geleitschiffe horchten mehr und pingten weniger.');
  }
  if (habit('west', 'ping')) {
    (adapt.east ??= {}).ping = true;
    notes.push('Der Gegner hat gelernt: Ihr habt viel gepingt – die U-Boote blieben unter der Sprungschicht.');
  }
  if (habit('west', 'fast')) {
    (adapt.east ??= {}).fast = true;
    notes.push('Der Gegner hat gelernt: Eure Geleitschiffe fuhren oft schnell – die U-Boote lauerten voraus und ließen euch kommen.');
  }
  return { adapt, notes };
}
