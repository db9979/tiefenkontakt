import type { OwnFix, Snapshot, TmaSolution } from '@tk/shared';

/** Client-side game state: latest snapshot plus everything the player derived from it. */
export const store = {
  snap: undefined as Snapshot | undefined,
  ownTrack: [] as OwnFix[],
  solutions: new Map<string, TmaSolution>(),
  selected: undefined as string | undefined,
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
    this.selected = undefined;
    this.ended = undefined;
  },

  selectedContact() {
    return this.snap?.contacts.find((c) => c.label === this.selected);
  },
};
