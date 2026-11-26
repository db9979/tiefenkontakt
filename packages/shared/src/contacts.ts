import type { ClassId } from './classes.js';
import type { Detection, SensorKind } from './sensors.js';
import type { Evidence } from './signatures.js';
import type { Sighting } from './lookout.js';

/** Weight of a new optical range against the running estimate. */
const OPTICAL_BLEND = 0.15;
/** Einsteiger: a ship held this long (s) unbroken in the periscope at AUTO_ID_MAG or more is named. */
export const AUTO_ID_S = 10;
export const AUTO_ID_MAG = 6;
/** Periscope looks closer together than this (s) count as one unbroken look (sensors run every second). */
const SCOPE_GAP_S = 2;

export interface BearingSample {
  t: number;
  b: number;
  alt?: number;
  r?: number;
  sensor: SensorKind;
  /** Measurement origin when not the own ship (sonobuoy). */
  ox?: number;
  oy?: number;
}

/** A contact as known to one observer. Contains no ground truth. */
export interface ContactTrack {
  label: string;
  firstSeen: number;
  lastSeen: number;
  bearing: number;
  bearingAlt?: number;
  range?: number;
  rangeAt?: number;
  /** Last optical (periscope, lookout) range: later ones refine it. */
  optAt?: number;
  se: number;
  sensors: SensorKind[];
  /** When each sensor last held the contact (sensors only grows; this says who holds it now). */
  seenBy?: Partial<Record<SensorKind, number>>;
  /**
   * Visual identification only (periscope). On the server's books the class seen; a player's
   * snapshot carries it only in Einsteiger mode after the auto-identification (idAt).
   */
  classified?: ClassId;
  /** Which sensor gave the current range. */
  rangeBy?: SensorKind;
  /** Last periscope measurement of the stadimeter angle (mrad, blended like the optical range). */
  subtense?: number;
  /** Last time the ship was in the periscope's field of view. */
  scopeAt?: number;
  /** Start of the current unbroken look at her at 6× or more. */
  zoomSince?: number;
  /** When she was held long enough in the high-power optic to be named (Einsteiger auto-classification). */
  idAt?: number;
  /** Last periscope look showed navigation lights. */
  lit?: boolean;
  /** Latest bridge-lookout sighting and when it was made. */
  sighting?: Sighting;
  sightedAt?: number;
  /** Start of the current sighting episode (a new one begins after a minute without sightings). */
  sightingSince?: number;
  /** Latest passive narrowband/DEMON measurement. */
  evidence?: Evidence;
  evidenceAt?: number;
  /** Towed-array side state: both mirror bearings, resolution by hull sonar, ghost flag. */
  tas?: { stb: number; port: number; at: number; resolved?: 'stb' | 'port'; ghost?: boolean };
  hull?: { b: number; at: number };
  /** Last CW Doppler closing speed (kn). */
  dopplerKn?: number;
  /** Set when the latest bearing was measured away from the own ship (sonobuoy position). */
  originX?: number;
  originY?: number;
  /** ESM: last intercepted radar (emitters.ts), its strength 0..2 and trend. */
  emitter?: string;
  esmLvl?: number;
  esmTrend?: number;
  history: BearingSample[];
}

const RESOLVE_DEG = 5;
const GHOST_DEG = 9;
const MATCH_WINDOW = 15; // s

/** Compare hull and towed bearings: confirm a side or flag a possible ghost. */
function resolveTas(tr: ContactTrack): void {
  if (!tr.tas || !tr.hull || Math.abs(tr.tas.at - tr.hull.at) > MATCH_WINDOW) return;
  const d = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  const ds = d(tr.hull.b, tr.tas.stb);
  const dp = d(tr.hull.b, tr.tas.port);
  const best = Math.min(ds, dp);
  if (best <= RESOLVE_DEG || (best < GHOST_DEG && !tr.tas.resolved)) {
    tr.tas.resolved = ds <= dp ? 'stb' : 'port';
    tr.tas.ghost = false;
  } else if (best >= GHOST_DEG) {
    tr.tas.ghost = true;
  }
}

const HISTORY_MAX = 180;
/**
 * Track re-association (S6, F7): a new track within this many degrees of one dropped in the last
 * REASSOC_S seconds (with the same sensor letter, and a shared tonal when both have tonals) takes
 * the old label back, so S2 doesn't come back as S13 and its TMA solution stays with it.
 * N1: only when the call is unambiguous. In a convoy the merchants share their 50/60 Hz lines and
 * sit a degree or two apart, so a new ship on S2's old bearing took S2 (and the player's class and
 * solution for S2 then sat on the wrong ship). No reclaim when another live track, or a second
 * dropped candidate, lies within the gate; the gate shrinks to REASSOC_CROWDED_DEG when other
 * tracks are within CROWD_DEG; and the label only ever goes back to the ship that carried it.
 */
export const REASSOC_DEG = 3;
export const REASSOC_CROWDED_DEG = 1.5;
export const CROWD_DEG = 10;
export const REASSOC_S = 600;
/** Two tonals count as the same line within this (Hz). */
const TONAL_HZ = 1.5;

interface Dropped {
  label: string; prefix: string; bearing: number; lastSeen: number; firstSeen: number; tonals?: number[];
  /** Bearing rate (°/s) at the drop, to carry the bearing over the gap. */
  rate?: number;
  /** Measured from a sonobuoy: not comparable with own-ship bearings. */
  buoy?: boolean;
  /** Server-only: the ship that carried the label (never leaves the server, like the book's keys). */
  tid?: string;
}

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** True when both have tonals and none match, i.e. the lines say it is another ship. */
function tonalsDiffer(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a?.length || !b?.length) return false;
  return !a.some((x) => b.some((y) => Math.abs(x - y) <= TONAL_HZ));
}

/** Bearing rate (°/s) over the last minute of own-ship bearings, 0 when that is too short. */
function bearingRate(h: BearingSample[]): number {
  const own = h.filter((x) => x.ox === undefined);
  const last = own[own.length - 1];
  if (!last) return 0;
  const first = own.find((x) => last.t - x.t <= 60);
  if (!first || last.t - first.t < 20) return 0;
  return (((last.b - first.b + 540) % 360) - 180) / (last.t - first.t);
}
const PREFIX: Record<SensorKind, string> = {
  hull: 'S', towed: 'S', active: 'S', intercept: 'S', periscope: 'V', radar: 'R', esm: 'E', buoy: 'S', visual: 'A', mad: 'M',
};

/** Per-observer contact bookkeeping. Keyed internally by target, labels are opaque. */
export class ContactBook {
  private byTarget = new Map<string, ContactTrack>();
  private counters: Record<string, number> = {};
  /** Tracks dropped lately: candidates for re-association. */
  private dropped: Dropped[] = [];

  /** A dropped track the new detection matches (bearing, sensor letter, tonals), taken off the list. */
  private reclaim(d: Detection, p: string): Dropped | undefined {
    this.dropped = this.dropped.filter((x) => d.time - x.lastSeen <= REASSOC_S);
    if (d.originX !== undefined) return undefined;
    const tonals = d.evidence?.tonals.map((t) => t.hz);
    // Other ships held now, on own-ship bearings
    const live = [...this.byTarget.values()].filter((t) => t.originX === undefined && d.time - t.lastSeen <= 60);
    const crowded = live.some((t) => angDiff(t.bearing, d.bearing) <= CROWD_DEG);
    const gate = crowded ? REASSOC_CROWDED_DEG : REASSOC_DEG;
    if (live.some((t) => angDiff(t.bearing, d.bearing) <= gate)) return undefined;
    // Where each dropped track should be now: its last bearing, or carried on at its rate (capped)
    const near = this.dropped.filter((x) => {
      if (x.buoy) return false;
      const drift = Math.max(-20, Math.min(20, (x.rate ?? 0) * (d.time - x.lastSeen)));
      return Math.min(angDiff(d.bearing, x.bearing + drift), angDiff(d.bearing, x.bearing)) <= gate;
    });
    // Two candidates in the gate: the operator can't tell them apart, so a new label
    if (near.length !== 1) return undefined;
    const x = near[0]!;
    if (x.prefix !== p || tonalsDiffer(tonals, x.tonals)) return undefined;
    // Only to the ship that carried it: a neighbour never takes over S2's class and solution
    if (x.tid !== undefined && x.tid !== d.targetId) return undefined;
    // Not while another live track still carries the label (it can't, but stay safe)
    if ([...this.byTarget.values()].some((t) => t.label === x.label)) return undefined;
    this.dropped = this.dropped.filter((y) => y !== x);
    return x;
  }

  ingest(d: Detection): ContactTrack {
    let tr = this.byTarget.get(d.targetId);
    if (!tr) {
      const p = PREFIX[d.sensor];
      const old = this.reclaim(d, p);
      if (!old) this.counters[p] = (this.counters[p] ?? 0) + 1;
      tr = {
        label: old?.label ?? `${p}${this.counters[p]}`, firstSeen: old?.firstSeen ?? d.time, lastSeen: d.time,
        bearing: d.bearing, se: d.se, sensors: [], history: [],
      };
      this.byTarget.set(d.targetId, tr);
    }
    tr.lastSeen = d.time;
    tr.se = d.se;
    let alt = d.bearingAlt;
    if (d.sensor === 'towed' && d.bearingAlt !== undefined) {
      tr.tas = { stb: d.bearing, port: d.bearingAlt, at: d.time, resolved: tr.tas?.resolved, ghost: tr.tas?.ghost };
      resolveTas(tr);
      const side = tr.tas.resolved;
      tr.bearing = side === 'port' ? d.bearingAlt : d.bearing;
      alt = side ? undefined : d.bearingAlt;
      tr.bearingAlt = alt;
    } else if (d.originX !== undefined) {
      // Sonobuoy: bearing from the buoy, not from the own ship
      tr.bearing = d.bearing;
      tr.bearingAlt = undefined;
    } else {
      if (d.sensor === 'hull') {
        tr.hull = { b: d.bearing, at: d.time };
        resolveTas(tr);
      }
      tr.bearing = d.bearing;
      tr.bearingAlt = undefined;
    }
    if (d.dopplerKn !== undefined) tr.dopplerKn = d.dopplerKn;
    tr.originX = d.originX;
    tr.originY = d.originY;
    if (d.range !== undefined) {
      // Range by eye or stadimeter: the watch refines one estimate instead of guessing anew every
      // second (a fresh noisy guess each sweep made ships pump bigger and smaller in the optics)
      const optical = d.sensor === 'periscope' || d.sensor === 'visual';
      const keep = optical && tr.range !== undefined && tr.optAt !== undefined && d.time - tr.optAt < 15;
      tr.range = keep ? tr.range! + (d.range - tr.range!) * OPTICAL_BLEND : d.range;
      tr.rangeAt = d.time;
      tr.rangeBy = d.sensor;
      if (d.subtense !== undefined) tr.subtense = keep && tr.subtense !== undefined ? tr.subtense + (d.subtense - tr.subtense) * OPTICAL_BLEND : d.subtense;
      if (optical) tr.optAt = d.time;
    }
    if (d.sensor === 'periscope') {
      // Einsteiger auto-classification: held unbroken in the 6× or 12× optic for AUTO_ID_S
      const unbroken = tr.scopeAt !== undefined && d.time - tr.scopeAt <= SCOPE_GAP_S;
      if ((d.mag ?? 0) < AUTO_ID_MAG) tr.zoomSince = undefined;
      else if (!unbroken || tr.zoomSince === undefined) tr.zoomSince = d.time;
      if (tr.zoomSince !== undefined && d.time - tr.zoomSince >= AUTO_ID_S) tr.idAt ??= d.time;
      tr.scopeAt = d.time;
    }
    if (!tr.sensors.includes(d.sensor)) tr.sensors.push(d.sensor);
    (tr.seenBy ??= {})[d.sensor] = d.time;
    if (d.classified) tr.classified = d.classified;
    if (d.emitter) {
      tr.emitter = d.emitter;
      tr.esmLvl = d.esmLvl;
      tr.esmTrend = d.esmTrend;
    }
    if (d.sensor === 'periscope') tr.lit = d.lit;
    if (d.sighting) {
      if (tr.sightedAt === undefined || d.time - tr.sightedAt > 60) tr.sightingSince = d.time;
      tr.sighting = d.sighting;
      tr.sightedAt = d.time;
    }
    if (d.evidence) {
      tr.evidence = d.evidence;
      tr.evidenceAt = d.time;
    }
    tr.history.push({ t: d.time, b: tr.bearing, alt, r: d.range, sensor: d.sensor, ox: d.originX, oy: d.originY });
    if (tr.history.length > HISTORY_MAX) tr.history.shift();
    return tr;
  }

  /** Drop contacts not seen for `timeout` seconds (kept a while for re-association). */
  expire(now: number, timeout = 180): void {
    for (const [id, tr] of this.byTarget) {
      if (now - tr.lastSeen <= timeout) continue;
      this.byTarget.delete(id);
      const m = /^([A-Z]+)\d+$/.exec(tr.label);
      if (m) this.dropped.push({
        label: tr.label, prefix: m[1]!, bearing: tr.bearing, lastSeen: tr.lastSeen, firstSeen: tr.firstSeen,
        tonals: tr.evidence?.tonals.map((t) => t.hz), rate: bearingRate(tr.history), tid: id,
        ...(tr.originX !== undefined ? { buoy: true } : {}),
      });
    }
    if (this.dropped.length > 64) this.dropped.splice(0, this.dropped.length - 64);
  }

  tracks(): ContactTrack[] {
    return [...this.byTarget.values()];
  }

  toJSON(): { tracks: [string, ContactTrack][]; counters: Record<string, number>; dropped?: Dropped[] } {
    return { tracks: this.entries(), counters: { ...this.counters }, dropped: this.dropped.map((x) => ({ ...x })) };
  }

  static fromJSON(data: { tracks: [string, ContactTrack][]; counters: Record<string, number>; dropped?: Dropped[] }): ContactBook {
    const b = new ContactBook();
    for (const [id, tr] of data.tracks) b.byTarget.set(id, tr);
    b.counters = { ...data.counters };
    b.dropped = (data.dropped ?? []).map((x) => ({ ...x }));
    return b;
  }

  /** Server-only: tracks with their hidden target ids. */
  entries(): [string, ContactTrack][] {
    return [...this.byTarget.entries()];
  }

  /** Server-only: resolve a label back to the target id (e.g. for weapon targeting). */
  targetIdOf(label: string): string | undefined {
    for (const [id, tr] of this.byTarget) if (tr.label === label) return id;
    return undefined;
  }
}
