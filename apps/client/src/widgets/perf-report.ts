import { quality, qualitySetting } from './perf.js';

/**
 * Anonymous graphics performance from real devices: frame times in the 3D views (periscope,
 * bridge) are collected and sent once after about a minute there, and once more at the match
 * end. Sent: level in effect, auto/manual, stepped down, average and 95th percentile frame
 * time, a coarse device class and a rounded pixel ratio. Nothing that identifies the player.
 */

export type DeviceClass = 'phone' | 'tablet' | 'desktop';
export type DprBucket = '1' | '1.5' | '2' | '3';

export interface PerfSampleMsg {
  quality: 'niedrig' | 'mittel' | 'hoch';
  setting: 'auto' | 'manual';
  steppedDown: boolean;
  avgMs: number;
  p95Ms: number;
  device: DeviceClass;
  dpr: DprBucket;
  phase: 'mid' | 'end';
}

/** Phone: touch with a short side under 600 CSS px; tablet: other touch screens; else desktop. */
export function deviceClass(coarse: boolean, w: number, h: number): DeviceClass {
  if (!coarse) return 'desktop';
  return Math.min(w, h) < 600 ? 'phone' : 'tablet';
}

export function dprBucket(dpr: number): DprBucket {
  return dpr < 1.25 ? '1' : dpr < 1.75 ? '1.5' : dpr < 2.5 ? '2' : '3';
}

/** Average and 95th percentile of frame intervals (ms), one decimal. */
export function frameStats(dts: number[]): { avgMs: number; p95Ms: number } {
  const s = [...dts].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  const p95 = s.length ? s[Math.min(s.length - 1, Math.floor(0.95 * s.length))]! : 0;
  return { avgMs: Math.round(avg * 10) / 10, p95Ms: Math.round(p95 * 10) / 10 };
}

/** Collects drawn-frame intervals in 3D views; `send` gets at most one 'mid' and one 'end' sample. */
export class PerfReporter {
  private dts: number[] = [];
  private spent = 0;
  private last = 0;
  private midSent = false;
  private endSent = false;

  constructor(private send: (s: PerfSampleMsg) => void, private env: () => Omit<PerfSampleMsg, 'avgMs' | 'p95Ms' | 'phase'> = currentEnv,
    private midAfterMs = 60_000, private minEndMs = 10_000) {}

  /** A frame was drawn at `now` (ms); `in3d` when a 3D view is on screen. */
  frame(now: number, in3d: boolean): void {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    if (!in3d || dt <= 0 || dt > 500 || this.endSent) return;
    this.spent += dt;
    if (this.dts.length < 20_000) this.dts.push(dt);
    if (!this.midSent && this.spent >= this.midAfterMs) {
      this.midSent = true;
      this.emit('mid');
    }
  }

  /** Match over (or the player leaves): send what was gathered since the first sample. */
  end(): void {
    if (this.endSent) return;
    this.endSent = true;
    if (this.spent >= this.minEndMs) this.emit('end');
  }

  private emit(phase: 'mid' | 'end'): void {
    if (!this.dts.length) return;
    this.send({ ...this.env(), ...frameStats(this.dts), phase });
    this.dts = [];
    this.spent = 0;
  }
}

function currentEnv(): Omit<PerfSampleMsg, 'avgMs' | 'p95Ms' | 'phase'> {
  const setting = qualitySetting();
  return {
    quality: quality(),
    setting: setting === 'auto' ? 'auto' : 'manual',
    steppedDown: Number(sessionStorage.getItem('tk_quality_down') ?? 0) > 0,
    device: deviceClass(matchMedia('(pointer: coarse)').matches, screen.width, screen.height),
    dpr: dprBucket(window.devicePixelRatio || 1),
  };
}

/** Fire and forget; survives the page being closed. */
export function beaconPerf(s: PerfSampleMsg): void {
  const body = JSON.stringify(s);
  try {
    if (navigator.sendBeacon?.('/api/perf', new Blob([body], { type: 'application/json' }))) return;
  } catch {
    /* fall back to fetch */
  }
  void fetch('/api/perf', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => undefined);
}
