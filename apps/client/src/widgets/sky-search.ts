import { angleDiff } from '@tk/shared';
import type { PeriscopeTarget } from './periscope3d.js';
import { deg3, km } from './format.js';

/**
 * Sky search with the periscope: the head prism elevates so the operator can look for
 * aircraft before the boat stays up. Elevation by dragging vertically or the buttons; the
 * quick sweep raises the prism and turns the scope once round. Only aircraft that passed
 * through the field of view count as seen; a sweep without any gives "LUFT FREI".
 */

export const ELEV_MIN = -5;
export const ELEV_MAX = 60;
/** Real seconds for one full turn of the quick sweep, and the prism elevation it uses. */
const SWEEP_S = 14;
const SWEEP_ELEV = 13;
/** An aircraft stays reported this long after it was last in the optic (sim s). */
const HOLD_S = 45;
/** "Air clear" is valid this long after a sweep that found nothing (sim s). */
const CLEAR_S = 180;
/** Eye height of the periscope head (m). */
const EYE = 4;

export interface SkyReadout {
  text: string;
  tone: 'alarm' | 'clear' | 'dim';
}

export class SkySearch {
  elev = 0;
  elevTarget = 0;
  private sweep?: { t0: number; from: number; elev: number; spotted: boolean };
  private clearAt?: number;
  private seen = new Map<string, number>();
  private lastBearing?: number;

  get sweeping(): boolean {
    return !!this.sweep;
  }

  /** Raise or lower the prism by d degrees (stops a running sweep). */
  nudge(d: number): void {
    this.sweep = undefined;
    this.elevTarget = Math.max(ELEV_MIN, Math.min(ELEV_MAX, this.elevTarget + d));
  }

  level(): void {
    this.sweep = undefined;
    this.elevTarget = 0;
  }

  startSweep(nowMs: number, bearing: number): void {
    this.sweep = { t0: nowMs, from: bearing, elev: this.elevTarget, spotted: false };
  }

  cancel(): void {
    if (this.sweep) this.elevTarget = this.sweep.elev;
    this.sweep = undefined;
  }

  /**
   * Once per frame. Returns the bearing the sweep wants the scope trained on (undefined when
   * the operator trains it). `fov` is the optic's full field of view in degrees.
   */
  frame(nowMs: number, dtS: number, bearing: number, fov: number, planes: PeriscopeTarget[], simTime: number): number | undefined {
    let want: number | undefined;
    if (this.sweep) {
      const p = (nowMs - this.sweep.t0) / (SWEEP_S * 1000);
      if (p >= 1) {
        if (!this.sweep.spotted) this.clearAt = simTime;
        want = this.sweep.from;
        this.elevTarget = this.sweep.elev;
        this.sweep = undefined;
      } else {
        // First lift the prism, then turn once round at a steady rate
        this.elevTarget = SWEEP_ELEV;
        want = this.sweep.from + 360 * Math.max(0, (p - 0.06) / 0.94);
      }
    }
    this.elev += (this.elevTarget - this.elev) * Math.min(1, dtS * 4);
    // The optic swept the arc from the last frame's bearing to this one (matters at low frame rates)
    const from = this.lastBearing ?? bearing;
    const arc = angleDiff(from, bearing);
    this.lastBearing = bearing;
    for (const pl of planes) {
      if (!pl.plane) continue;
      const el = (Math.atan2((pl.alt ?? 0) - EYE, pl.range) * 180) / Math.PI;
      const rel = angleDiff(from, pl.bearing);
      const az = Math.sign(rel) === Math.sign(arc) && Math.abs(rel) <= Math.abs(arc) ? 0 : Math.min(Math.abs(rel), Math.abs(angleDiff(bearing, pl.bearing)));
      if (Math.hypot(az, el - this.elev) < fov / 2) {
        this.seen.set(pl.label, simTime);
        if (this.sweep) this.sweep.spotted = true;
        this.clearAt = undefined;
      }
    }
    return want;
  }

  /** What the operator reports: an aircraft seen and still in sight, air clear after a sweep, or unchecked. */
  readout(planes: PeriscopeTarget[], simTime: number, raised: boolean): SkyReadout {
    if (!raised) return { text: 'LUFT · MAST UNTEN', tone: 'dim' };
    const spotted = planes
      .filter((p) => p.plane && simTime - (this.seen.get(p.label) ?? -1e9) < HOLD_S)
      .sort((a, b) => a.range - b.range)[0];
    if (spotted) {
      const n = planes.filter((p) => p.plane && simTime - (this.seen.get(p.label) ?? -1e9) < HOLD_S).length;
      return { text: `FLUGZEUG! · ${deg3(spotted.bearing)}° · ${km(Math.hypot(spotted.range, spotted.alt ?? 0))}${n > 1 ? ` · ${n} IN SICHT` : ''}`, tone: 'alarm' };
    }
    if (this.sweep) return { text: 'HIMMEL ABSUCHEN …', tone: 'dim' };
    if (this.clearAt !== undefined && simTime - this.clearAt < CLEAR_S) return { text: 'LUFT FREI', tone: 'clear' };
    return { text: 'LUFT UNGEPRÜFT', tone: 'dim' };
  }

  /** Elevation scale at the right edge of the optic and the readout at the top. */
  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: SkyReadout, t: number): void {
    ctx.save();
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const col = r.tone === 'alarm' ? '#f09595' : r.tone === 'clear' ? '#9fe1cb' : '#6f8a78';
    if (r.tone !== 'alarm' || Math.sin(t * 8) > -0.3) {
      ctx.fillStyle = 'rgba(3,5,4,0.7)';
      const w = ctx.measureText(r.text).width + 12;
      ctx.fillRect(cx - w / 2, cy - R + 14, w, 16);
      ctx.fillStyle = col;
      ctx.fillText(r.text, cx, cy - R + 26);
    }
    // Elevation tape: -5 .. 60 deg along the right edge
    const x = cx + R + 14;
    const y0 = cy + R * 0.8;
    const k = (R * 1.6) / (ELEV_MAX - ELEV_MIN);
    ctx.strokeStyle = 'rgba(159,225,203,0.5)';
    ctx.beginPath(); ctx.moveTo(x, y0 + ELEV_MIN * k); ctx.lineTo(x, y0 - ELEV_MAX * k); ctx.stroke();
    ctx.fillStyle = 'rgba(159,225,203,0.7)';
    ctx.textAlign = 'left';
    for (let e = 0; e <= ELEV_MAX; e += 15) {
      ctx.beginPath(); ctx.moveTo(x - 3, y0 - e * k); ctx.lineTo(x + 3, y0 - e * k); ctx.stroke();
      ctx.fillText(String(e), x + 6, y0 - e * k + 4);
    }
    ctx.fillStyle = '#e8c37a';
    const ey = y0 - this.elev * k;
    ctx.beginPath(); ctx.moveTo(x - 4, ey); ctx.lineTo(x - 11, ey - 4); ctx.lineTo(x - 11, ey + 4); ctx.fill();
    ctx.fillText(`ELEV ${this.elev >= 0 ? '+' : ''}${Math.round(this.elev)}°`, x - 8, y0 + 18);
    ctx.restore();
  }
}
