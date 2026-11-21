import type { ClassId } from './classes.js';
import type { Detection, SensorKind } from './sensors.js';

export interface BearingSample {
  t: number;
  b: number;
  alt?: number;
  r?: number;
  sensor: SensorKind;
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
  classified?: ClassId;
  history: BearingSample[];
}

const HISTORY_MAX = 180;
const PREFIX: Record<SensorKind, string> = {
  hull: 'S', towed: 'S', active: 'S', intercept: 'S', periscope: 'V', radar: 'R', esm: 'E',
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
    tr.bearing = d.bearing;
    tr.bearingAlt = d.bearingAlt;
    tr.se = d.se;
    if (d.range !== undefined) {
      tr.range = d.range;
      tr.rangeAt = d.time;
    }
    if (!tr.sensors.includes(d.sensor)) tr.sensors.push(d.sensor);
    if (d.classified) tr.classified = d.classified;
    tr.history.push({ t: d.time, b: d.bearing, alt: d.bearingAlt, r: d.range, sensor: d.sensor });
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

  /** Server-only: resolve a label back to the target id (e.g. for weapon targeting). */
  targetIdOf(label: string): string | undefined {
    for (const [id, tr] of this.byTarget) if (tr.label === label) return id;
    return undefined;
  }
}
