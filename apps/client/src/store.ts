import type { Debrief, Marks, OwnFix, Snapshot, TmaSolution } from '@tk/shared';

export type Realism = 'einsteiger' | 'profi';

/** Client-side game state: latest snapshot plus everything the player derived from it. */
export const store = {
  snap: undefined as Snapshot | undefined,
  matchId: undefined as string | undefined,
  playerId: undefined as string | undefined,
  debrief: undefined as Debrief | undefined,
  /** performance.now() when the latest snapshot arrived (for smooth extrapolation). */
  snapAt: 0,
  ownTrack: [] as OwnFix[],
  solutions: new Map<string, TmaSolution>(),
  selected: undefined as string | undefined,
  /** Operator line marks per contact label (LOFAR fundamental, DEMON shaft/blade). */
  marks: new Map<string, Marks>(),
  /** Player's choice of towed-array side for unresolved contacts. */
  tasSide: new Map<string, 'stb' | 'port'>(),
  realism: (localStorage.getItem('tk_realism') as Realism | null) ?? 'einsteiger',
  lastError: '',
  ended: undefined as { winner: string; reason: string } | undefined,

  ingest(s: Snapshot): void {
    this.snap = s;
    this.snapAt = performance.now();
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
    this.tasSide.clear();
    this.selected = undefined;
    this.ended = undefined;
    this.debrief = undefined;
  },

  /** Keep the player's own analysis (track, TMA, marks) across reloads of this tab. */
  saveLocal(): void {
    if (!this.matchId) return;
    sessionStorage.setItem(`tk_state_${this.matchId}`, JSON.stringify({
      ownTrack: this.ownTrack.slice(-1800), solutions: [...this.solutions], marks: [...this.marks],
      tasSide: [...this.tasSide], selected: this.selected,
    }));
  },

  loadLocal(): void {
    if (!this.matchId) return;
    try {
      const raw = sessionStorage.getItem(`tk_state_${this.matchId}`);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.ownTrack = d.ownTrack ?? [];
      this.solutions = new Map(d.solutions ?? []);
      this.marks = new Map(d.marks ?? []);
      this.tasSide = new Map(d.tasSide ?? []);
      this.selected = d.selected;
    } catch {
      /* corrupt local state: start fresh */
    }
  },

  clearLocal(): void {
    if (this.matchId) sessionStorage.removeItem(`tk_state_${this.matchId}`);
  },

  setRealism(r: Realism): void {
    this.realism = r;
    localStorage.setItem('tk_realism', r);
  },

  selectedContact() {
    return this.snap?.contacts.find((c) => c.label === this.selected);
  },
};
