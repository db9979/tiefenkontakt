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
const PREFIX: Record<SensorKind, string> = {
  hull: 'S', towed: 'S', active: 'S', intercept: 'S', periscope: 'V', radar: 'R', esm: 'E', buoy: 'S', visual: 'A', mad: 'M',
};

/** Per-observer contact bookkeeping. Keyed internally by target, labels are opaque. */
export class ContactBook {
  private byTarget = new Map<string, ContactTrack>();
  private counters: Record<string, number> = {};

  ingest(d: Detection): ContactTrack {
    let tr = this.byTarget.get(d.targetId);
    if (!tr) {
      const p = PREFIX[d.sensor];
      this.counters[p] = (this.counters[p] ?? 0) + 1;
      tr = {
        label: `${p}${this.counters[p]}`, firstSeen: d.time, lastSeen: d.time,
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

  /** Drop contacts not seen for `timeout` seconds. */
  expire(now: number, timeout = 180): void {
    for (const [id, tr] of this.byTarget) if (now - tr.lastSeen > timeout) this.byTarget.delete(id);
  }

  tracks(): ContactTrack[] {
    return [...this.byTarget.values()];
  }

  toJSON(): { tracks: [string, ContactTrack][]; counters: Record<string, number> } {
    return { tracks: this.entries(), counters: { ...this.counters } };
  }

  static fromJSON(data: { tracks: [string, ContactTrack][]; counters: Record<string, number> }): ContactBook {
    const b = new ContactBook();
    for (const [id, tr] of data.tracks) b.byTarget.set(id, tr);
    b.counters = { ...data.counters };
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
