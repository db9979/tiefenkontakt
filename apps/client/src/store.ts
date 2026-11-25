import type { Debrief, Marks, OwnFix, Snapshot, TmaSolution } from '@tk/shared';
import { setNorthRegion } from './north.js';

/** Bearing samples kept per contact on the client (about one per second). */
const HISTORY_KEEP = 900;

type Sample = Snapshot['contacts'][number]['history'][number];
/** Compact form for the tab's session storage: [t, b, alt, r, sensor, ox, oy]. */
type PackedSample = [number, number, number | null, number | null, Sample['sensor'], number | null, number | null];
const r1 = (x: number) => Math.round(x * 10) / 10;
const opt = (x: number | undefined) => (x === undefined ? null : r1(x));
const packSample = (h: Sample): PackedSample => [r1(h.t), r1(h.b), opt(h.alt), opt(h.r), h.sensor, opt(h.ox), opt(h.oy)];
const unpackSample = ([t, b, alt, r, sensor, ox, oy]: PackedSample): Sample => ({
  t, b, sensor, ...(alt !== null && { alt }), ...(r !== null && { r }), ...(ox !== null && { ox }), ...(oy !== null && { oy }),
});

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
  briefing: undefined as import('@tk/shared').Briefing | undefined,
  ended: undefined as { winner: string; reason: string } | undefined,

  /** Accumulated bearing histories per contact (the server sends only new samples). */
  histories: new Map<string, Snapshot['contacts'][number]['history']>(),

  alerts: [] as Snapshot['alerts'],
  radio: [] as Snapshot['radio'],
  evidence: new Map<string, { ev: NonNullable<Snapshot['contacts'][number]['evidence']>; at?: number }>(),

  ingest(s: Snapshot): void {
    if (s.full) {
      this.histories.clear();
      this.evidence.clear();
      this.alerts = [];
      this.radio = [];
    }
    // Alerts and radio arrive as deltas; keep the recent ones
    this.alerts = this.alerts.concat(s.alerts).slice(-40);
    this.radio = this.radio.concat(s.radio).slice(-40);
    s.alerts = this.alerts;
    s.radio = this.radio;
    for (const c of s.contacts) {
      if (c.evidence) this.evidence.set(c.label, { ev: c.evidence, at: c.evidenceAt });
      else {
        const prev = this.evidence.get(c.label);
        if (prev) c.evidence = prev.ev;
      }
    }
    for (const c of s.contacts) {
      const prev = this.histories.get(c.label) ?? [];
      const lastT = prev[prev.length - 1]?.t ?? -Infinity;
      const merged = prev.concat(c.history.filter((h) => h.t > lastT));
      // 15 minutes of bearings: a TMA needs both legs (the server only sends its last 3 minutes)
      if (merged.length > HISTORY_KEEP) merged.splice(0, merged.length - HISTORY_KEEP);
      this.histories.set(c.label, merged);
      c.history = merged;
    }
    for (const label of this.histories.keys()) if (!s.contacts.some((c) => c.label === label)) this.histories.delete(label);
    this.snap = s;
    setNorthRegion(s.env.seabed?.region);
    this.snapAt = performance.now();
    const last = this.ownTrack[this.ownTrack.length - 1];
    if (!last || s.time - last.t >= 1) {
      this.ownTrack.push({ t: s.time, x: s.own.x, y: s.own.y });
      if (this.ownTrack.length > 3600) this.ownTrack.shift();
    }
    // A selection lapses when its contact (or own torpedo on the wire) is gone
    if (this.selected && !s.contacts.some((c) => c.label === this.selected) && !s.torpedoes.some((t) => t.id === this.selected)) this.selected = undefined;
  },

  reset(): void {
    this.snap = undefined;
    this.histories.clear();
    this.evidence.clear();
    this.alerts = [];
    this.radio = [];
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
      // Bearings of the contacts being worked on (the server resends only its last 3 minutes)
      histories: [...this.histories].filter(([l]) => this.solutions.has(l) || l === this.selected).map(([l, h]) => [l, h.map(packSample)]),
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
      this.histories = new Map((d.histories ?? []).map(([l, h]: [string, PackedSample[]]) => [l, h.map(unpackSample)]));
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
