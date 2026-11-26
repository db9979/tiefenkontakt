import { CLASSES, depthLimitOf, hullDamage, type AlertView, type Snapshot } from '@tk/shared';
import { hullCreak, motor, type Fx } from './audio-fx.js';
import { BlowRoar, Rotor, Turbine, bowSlam, chargeDrop, headValveSlam, hullGroan, rocketLaunch } from './audio-onboard.js';
import {
  creaksPerMin, dieselRunning, fired, groansPerMin, hullStrain, isHeadValveSlam, loudestTorpedo, nextGapS, rotorLevel,
  slamGapS, trimPumpsRunning, turbine, type HeardTorpedo,
} from './audio-triggers.js';

/**
 * Drives the on-board sounds from the snapshot (audio-triggers.ts decides, audio-onboard.ts
 * plays): what the crew of the own ship hears of her, nothing of other ships. Voices are built
 * on first need, so a frigate never builds the boat's pumps and a boat no turbines.
 */
export class Aboard {
  private lastDepth = { d: 0, t: -1 };
  private nextCreak = 0;
  private nextGroan = 0;
  private blow?: BlowRoar;
  private pump?: (on: number) => void;
  private valveShutAt = -1e9;
  private lastBattery?: number;
  private charging = false;
  private turbine?: Turbine;
  private rotor?: Rotor;
  private nextSlam = 0;
  private rockets?: number;
  private charges?: number;
  private torpMem: Parameters<typeof loudestTorpedo>[4] = { torps: new Map(), contacts: new Map() };
  /** The loudest torpedo the sonar operator hears (fed to the hydrophone). */
  heardTorpedo?: HeardTorpedo;

  constructor(private fx: Fx, private master: AudioNode, private out: (pan: number) => AudioNode) {}

  /** Snorkel diesel audible now (the head valve may have cut it). */
  diesel(s: Snapshot): boolean {
    const up = !!s.own.snorkel && (s.own.snorkelExt ?? 0) >= 1;
    return dieselRunning(up, s.time - this.valveShutAt, this.charging);
  }

  update(s: Snapshot, submarine: boolean, engineOn: boolean, swell: number): void {
    const own = s.own;
    const now = this.fx.ctx.currentTime;
    if (own.battery !== undefined) {
      if (this.lastBattery !== undefined && own.battery !== this.lastBattery) this.charging = own.battery > this.lastBattery;
      this.lastBattery = own.battery;
    }
    this.heardTorpedo = own.alive ? loudestTorpedo(own, s.time, s.torpedoes, s.contacts, this.torpMem) : undefined;
    if (submarine) this.boat(s, now);
    else this.ship(s, now, engineOn, swell);
  }

  /** A crew report that has a sound of its own. */
  alert(a: AlertView): void {
    if (a.kind === 'boat' && isHeadValveSlam(a.text)) {
      this.valveShutAt = a.time;
      this.charging = false;
      headValveSlam(this.fx, this.out(0));
    }
  }

  private boat(s: Snapshot, now: number): void {
    const own = s.own;
    const alive = own.alive;
    // Hull: creaks and groans from the strain against the present test depth
    const limit = depthLimitOf(own.cls, own.comps);
    const dmg = hullDamage(own.comps);
    const prev = this.lastDepth;
    const dt = prev.t >= 0 ? s.time - prev.t : 0;
    const rate = dt > 0 ? (own.depth - prev.d) / dt : 0;
    if (prev.t < 0 || dt > 0) {
      prev.d = own.depth;
      prev.t = s.time;
    }
    const strain = alive ? hullStrain(own.depth, limit, rate, dmg) : 0;
    if (now >= this.nextCreak) {
      const gap = nextGapS(creaksPerMin(strain));
      if (Number.isFinite(gap) && this.nextCreak > 0) hullCreak(this.fx, this.out((Math.random() - 0.5) * 1.4), own.depth);
      this.nextCreak = now + (Number.isFinite(gap) ? gap : 2);
    }
    if (now >= this.nextGroan) {
      const gap = nextGapS(alive ? groansPerMin(own.depth, limit, dmg) : 0);
      if (Number.isFinite(gap) && this.nextGroan > 0) hullGroan(this.fx, this.out((Math.random() - 0.5) * 1.2), Math.max(0.4, own.depth / limit));
      this.nextGroan = now + (Number.isFinite(gap) ? gap : 2);
    }
    // Emergency blow
    if (own.blowing || this.blow) {
      this.blow ??= new BlowRoar(this.fx, this.master);
      this.blow.set(alive && !!own.blowing);
    }
    // Trim pumps
    const pumping = alive && trimPumpsRunning(own.trim);
    if (pumping || this.pump) {
      this.pump ??= motor(this.fx, this.master, 145, 0.35);
      this.pump(pumping ? 0.8 : 0);
    }
  }

  private ship(s: Snapshot, now: number, engineOn: boolean, swell: number): void {
    const own = s.own;
    const alive = own.alive;
    // Gas turbines (the ear gets used to them like to the machinery hum)
    const tb = turbine(own.cls, own.speedKn, alive);
    if (tb.level > 0 || this.turbine) {
      this.turbine ??= new Turbine(this.fx, this.master);
      this.turbine.set(engineOn ? tb.level * (0.4 + 0.6 * swell) : 0, tb.hz);
    }
    // The own helicopter
    const h = s.air?.helo;
    const rl = alive ? rotorLevel(h, own) : 0;
    if (rl > 0 || this.rotor) {
      this.rotor ??= new Rotor(this.fx, this.master);
      this.rotor.set(rl, h?.state === 'air' ? 1 : rl);
    }
    // ASW rockets and depth charges leaving
    const nr = fired(this.rockets, own.loadout.rockets);
    for (let i = 0; i < nr; i++) rocketLaunch(this.fx, this.out(0), i * 0.35);
    this.rockets = own.loadout.rockets;
    const nc = fired(this.charges, own.loadout.depthCharges);
    for (let i = 0; i < nc; i++) chargeDrop(this.fx, this.out(0), i * 0.6);
    this.charges = own.loadout.depthCharges;
    // The bow slamming in a heavy sea
    const mean = alive ? slamGapS(s.env.seaState, own.speedKn, CLASSES[own.cls].submarine) : Infinity;
    if (now >= this.nextSlam) {
      if (Number.isFinite(mean) && this.nextSlam > 0) bowSlam(this.fx, this.out((Math.random() - 0.5) * 0.4), Math.min(1, 0.5 + (s.env.seaState - 5) * 0.2));
      this.nextSlam = now + (Number.isFinite(mean) ? mean * (0.5 + Math.random()) : 3);
    }
  }
}
