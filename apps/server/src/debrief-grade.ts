import { CLASSES, isConvoyShip, type ClassId, type PlayerStats, type World } from '@tk/shared';

/**
 * Figures for the per-player grade in the debrief, sampled with the recorder's frames: which
 * enemy units each player ship held in its contact book, and how long an enemy held it.
 */
export interface ContactSamples {
  /** Enemy units (true ids) each player ship has held at some sample. */
  held: Record<string, string[]>;
  /** Sim seconds an enemy book held each player ship (sampled). */
  seenS: Record<string, number>;
  /** When an enemy first held each player ship (sim s). */
  firstSeen: Record<string, number>;
}

export const emptySamples = (): ContactSamples => ({ held: {}, seenS: {}, firstSeen: {} });

/** One sample, every `dt` sim seconds. */
export function sampleContacts(w: World, c: ContactSamples, dt: number): void {
  const byId = new Map(w.ships.map((s) => [s.id, s]));
  const seen = new Set<string>();
  for (const [ownerId, book] of w.books) {
    const owner = byId.get(ownerId);
    if (!owner?.alive || owner.team === 'neutral') continue;
    const mine = owner.id.startsWith('p_');
    for (const [tid] of book.entries()) {
      const t = byId.get(tid);
      if (!t || t.team === owner.team || t.team === 'neutral' || isConvoyShip(t)) continue;
      if (mine) {
        const h = (c.held[owner.id] ??= []);
        if (!h.includes(tid)) h.push(tid);
      }
      if (t.id.startsWith('p_')) seen.add(t.id);
    }
  }
  for (const id of seen) {
    c.seenS[id] = (c.seenS[id] ?? 0) + dt;
    c.firstSeen[id] ??= w.time;
  }
}

/** The grade figures of one player's ship. */
export function gradeFigures(w: World, c: ContactSamples | undefined, shipId: string, idents: Record<string, ClassId> | undefined): Pick<PlayerStats, 'hits' | 'classified' | 'held' | 'undetectedS' | 'merchantsSafe'> {
  const ship = w.ships.find((s) => s.id === shipId);
  const hits = new Set(w.events.filter((e) => e.kind === 'hit' && e.byId === shipId).map((e) => `${(e as { shipId: string }).shipId}@${Math.round(e.time)}`)).size;
  // Classified right from the recognition book (the datalink group's shared picture)
  const classified = Object.entries(idents ?? {}).filter(([tid, cls]) => w.ships.find((s) => s.id === tid)?.cls === cls).length;
  const merchants = w.ships.filter(isConvoyShip);
  const escort = !!ship && ship.team === 'west' && !CLASSES[ship.cls].submarine;
  return {
    hits,
    classified,
    held: c?.held[shipId]?.length ?? 0,
    // Until the first enemy contact (the whole match when never found)
    undetectedS: Math.round(c?.firstSeen[shipId] ?? w.time),
    merchantsSafe: escort && merchants.length ? Math.round((merchants.filter((m) => m.alive).length / merchants.length) * 100) / 100 : undefined,
  };
}
