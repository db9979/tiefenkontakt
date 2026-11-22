import type { ClassId } from './classes.js';
import type { Detection, SensorKind } from './sensors.js';
import type { Evidence } from './signatures.js';
import type { Sighting } from './lookout.js';

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
  se: number;
  sensors: SensorKind[];
  /** Visual identification only (periscope). */
  classified?: ClassId;
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
      tr.range = d.range;
      tr.rangeAt = d.time;
    }
    if (!tr.sensors.includes(d.sensor)) tr.sensors.push(d.sensor);
    if (d.classified) tr.classified = d.classified;
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
