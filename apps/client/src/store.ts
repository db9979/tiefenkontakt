import type { Marks, OwnFix, Snapshot, TmaSolution } from '@tk/shared';

export type Realism = 'einsteiger' | 'profi';

/** Client-side game state: latest snapshot plus everything the player derived from it. */
export const store = {
  snap: undefined as Snapshot | undefined,
  ownTrack: [] as OwnFix[],
  solutions: new Map<string, TmaSolution>(),
  selected: undefined as string | undefined,
  /** Operator line marks per contact label (LOFAR fundamental, DEMON shaft/blade). */
  marks: new Map<string, Marks>(),
  realism: (localStorage.getItem('tk_realism') as Realism | null) ?? 'einsteiger',
  lastError: '',
  ended: undefined as { winner: string; reason: string } | undefined,

  ingest(s: Snapshot): void {
    this.snap = s;
    const last = this.ownTrack[this.ownTrack.length - 1];
    if (!last || s.time - last.t >= 1) {
      this.ownTrack.push({ t: s.time, x: s.own.x, y: s.own.y });
      if (this.ownTrack.length > 3600) this.ownTrack.shift();
    }
    if (this.selected && !s.contacts.some((c) => c.label === this.selected)) this.selected = undefined;
  },

  reset(): void {
    this.snap = undefined;
    this.ownTrack = [];
    this.solutions.clear();
    this.marks.clear();
    this.selected = undefined;
    this.ended = undefined;
  },

  setRealism(r: Realism): void {
    this.realism = r;
    localStorage.setItem('tk_realism', r);
  },

  selectedContact() {
    return this.snap?.contacts.find((c) => c.label === this.selected);
  },
};
