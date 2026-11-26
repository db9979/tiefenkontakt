import type { ClassChoice, ClassId, World } from '@tk/shared';

/**
 * The players' classification decisions. FOG OF WAR: they are kept per TRACK (the ship whose
 * book holds it and its label there), never per hidden target id: a dual datalink track of the
 * same boat must not light up because the other one was classified. The marks are shared within
 * a classification group (classGroupKey: a datalink side, or one submarine); a mate's mark
 * travels with his track only where the gate merged it into the own picture (snapshot.ts).
 */
export interface ClassMark {
  /** 'unknown' is kept: a mark cleared on purpose also hides one merged in from a mate. */
  choice: ClassChoice;
  /** Exact class from the recognition book. */
  cls?: ClassId;
}

/** Marks of one classification group, keyed by markKey. */
export type ClassMarks = Map<string, ClassMark>;

/** The key of a track: the ship whose book holds it and its label in that book. */
export function markKey(ownerId: string, label: string): string {
  return `${ownerId}/${label}`;
}

/** Record (or clear) a mark. */
export function setMark(marks: ClassMarks, key: string, choice: ClassChoice, cls?: ClassId): void {
  marks.set(key, choice === 'unknown' ? { choice } : { choice, cls });
}

/** What the player is shown for a mark: nothing for a cleared one. */
export function shownMark(m: ClassMark | undefined): { assigned?: ClassChoice; assignedCls?: ClassId } {
  return !m || m.choice === 'unknown' ? {} : { assigned: m.choice, assignedCls: m.cls };
}

/** Saved form: per group, [key, mark]. Saves before per-track marks held [targetId, choice]. */
export type SavedClasses = [string, [string, ClassMark | ClassChoice][]][];

export function saveClasses(all: ReadonlyMap<string, ClassMarks>): SavedClasses {
  return [...all].map(([g, m]) => [g, [...m]]);
}

/**
 * Restore the marks. An old save keyed them by target id: each becomes a mark on every track
 * of that target in the group's books (the exact class from the recorder's idents), which is
 * what the player saw when the match was saved.
 */
export function restoreClasses(
  d: SavedClasses | undefined, w: World, groupOf: (shipId: string) => string | undefined,
  idents?: Readonly<Record<string, Readonly<Record<string, ClassId>>>>,
): Map<string, ClassMarks> {
  const out = new Map<string, ClassMarks>();
  for (const [g, entries] of d ?? []) {
    const marks: ClassMarks = new Map();
    for (const [k, v] of entries) {
      if (typeof v === 'object') {
        marks.set(k, v);
        continue;
      }
      for (const [shipId, book] of w.books) {
        if (groupOf(shipId) !== g) continue;
        for (const [tid, tr] of book.entries()) if (tid === k) setMark(marks, markKey(shipId, tr.label), v, idents?.[g]?.[tid]);
      }
    }
    out.set(g, marks);
  }
  return out;
}
