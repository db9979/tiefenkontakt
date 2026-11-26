import type { Fx } from './audio-fx.js';

/**
 * More sounds aboard, synthesised: the boat's hull groaning near its test depth, the roar of an
 * emergency blow, the trim pumps, the snorkel head valve slamming shut; on a surface ship her
 * gas turbines, the helicopter's rotors on deck, ASW rockets and depth charges leaving, and the
 * bow slamming into a heavy sea. Continuous voices are built once (lazily) and only re-aimed.
 */

function noiseSrc(fx: Fx): AudioBufferSourceNode {
  const s = fx.ctx.createBufferSource();
  s.buffer = fx.noise;
  s.loop = true;
  return s;
}

function env(ctx: BaseAudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  // Silent until the envelope starts (a gain is 1 before its first scheduled value)
  g.gain.value = 0.0001;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

/** The whole hull groaning under pressure: a deep, slowly bending moan with a frame popping first. */
export function hullGroan(fx: Fx, dest: AudioNode, strain: number): void {
  const { ctx } = fx;
  const t = ctx.currentTime;
  const len = 2 + Math.random() * 1.8;
  const k = Math.min(1.5, Math.max(0.3, strain));
  // A frame popping as it takes the load
  const pop = noiseSrc(fx);
  const pf = ctx.createBiquadFilter();
  pf.type = 'bandpass';
  pf.frequency.value = 1400 + Math.random() * 1200;
  pf.Q.value = 9;
  const pg = env(ctx, t, 0.25 * k, 0.002, 0.12);
  pop.connect(pf).connect(pg);
  pg.connect(dest);
  pg.connect(fx.reverb);
  pop.start(t, Math.random() * fx.noise.duration);
  pop.stop(t + 0.2);
  // The moan: a low sawtooth through a resonance that bends down, rough with stick-slip
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f = 38 + Math.random() * 22;
  o.frequency.setValueAtTime(f, t + 0.1);
  o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.15), t + len);
  const res = ctx.createBiquadFilter();
  res.type = 'lowpass';
  res.Q.value = 9;
  res.frequency.setValueAtTime(160 + Math.random() * 80, t + 0.1);
  res.frequency.exponentialRampToValueAtTime(70, t + len);
  const rough = ctx.createGain();
  rough.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 7 + Math.random() * 6;
  const lg = ctx.createGain();
  lg.gain.value = 0.4;
  lfo.connect(lg).connect(rough.gain);
  const g = env(ctx, t + 0.1, 0.35 * k, len * 0.35, len * 0.75);
  o.connect(res).connect(rough).connect(g);
  g.connect(dest);
  g.connect(fx.reverb);
  o.start(t + 0.1);
  lfo.start(t + 0.1);
  o.stop(t + len + 0.3);
  lfo.stop(t + len + 0.3);
}

/** Snorkel head valve slamming shut: a heavy metallic clang, then the dull pressure drop (ears pop). */
export function headValveSlam(fx: Fx, dest: AudioNode): void {
  const { ctx } = fx;
  const t = ctx.currentTime;
  const n = noiseSrc(fx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 520;
  bp.Q.value = 5;
  const g = env(ctx, t, 0.9, 0.002, 0.4);
  n.connect(bp).connect(g);
  g.connect(dest);
  g.connect(fx.reverb);
  n.start(t, Math.random() * fx.noise.duration);
  n.stop(t + 0.45);
  // The valve body ringing
  const ring = ctx.createOscillator();
  ring.type = 'triangle';
  ring.frequency.setValueAtTime(310, t);
  ring.frequency.exponentialRampToValueAtTime(290, t + 0.8);
  const rg = env(ctx, t, 0.3, 0.003, 0.9);
  ring.connect(rg);
  rg.connect(dest);
  rg.connect(fx.reverb);
  ring.start(t);
  ring.stop(t + 0.9);
  // The diesels suck the boat's air: a deep swelling push in the ears
  const p = ctx.createOscillator();
  p.frequency.setValueAtTime(34, t + 0.15);
  p.frequency.linearRampToValueAtTime(24, t + 1.4);
  const pg = env(ctx, t + 0.15, 0.35, 0.35, 1);
  p.connect(pg).connect(dest);
  p.start(t + 0.15);
  p.stop(t + 1.6);
}

/** ASW rocket leaving the launcher: the crack of the motor and a short tearing whoosh. */
export function rocketLaunch(fx: Fx, dest: AudioNode, delayS = 0): void {
  const { ctx } = fx;
  const t = ctx.currentTime + delayS;
  const n = noiseSrc(fx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  const g = env(ctx, t, 0.5, 0.003, 0.25);
  n.connect(lp).connect(g).connect(dest);
  const n2 = noiseSrc(fx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(900, t);
  bp.frequency.exponentialRampToValueAtTime(2800, t + 0.9);
  const g2 = env(ctx, t + 0.02, 0.28, 0.08, 1.1);
  n2.connect(bp).connect(g2).connect(dest);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(80, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  const g3 = env(ctx, t, 0.45, 0.003, 0.3);
  o.connect(g3).connect(dest);
  for (const s of [n, n2]) s.start(t, Math.random() * fx.noise.duration);
  o.start(t);
  n.stop(t + 0.4);
  n2.stop(t + 1.4);
  o.stop(t + 0.4);
}

/** A depth charge rolling off the stern rack: a clank, the splash. */
export function chargeDrop(fx: Fx, dest: AudioNode, delayS = 0): void {
  const { ctx } = fx;
  const t = ctx.currentTime + delayS;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = 420;
  const g = env(ctx, t, 0.3, 0.002, 0.2);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.2);
  const n = noiseSrc(fx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 1200;
  hp.Q.value = 0.6;
  const g2 = env(ctx, t + 0.55, 0.7, 0.01, 0.7);
  n.connect(hp).connect(g2).connect(dest);
  n.start(t + 0.55, Math.random() * fx.noise.duration);
  n.stop(t + 1.3);
}

/** The bow slamming into a sea: a deep thud through the ship, a shudder, the spray coming over. */
export function bowSlam(fx: Fx, dest: AudioNode, k: number): void {
  const { ctx } = fx;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(62, t);
  o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
  const g = env(ctx, t, 0.32 * k, 0.01, 0.7);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.8);
  const n = noiseSrc(fx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 220;
  const g2 = env(ctx, t, 0.16 * k, 0.03, 1.2);
  n.connect(lp).connect(g2).connect(dest);
  const n2 = noiseSrc(fx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const g3 = env(ctx, t + 0.25, 0.09 * k, 0.15, 1.4);
  n2.connect(hp).connect(g3).connect(dest);
  for (const s of [n, n2]) s.start(t, Math.random() * fx.noise.duration);
  n.stop(t + 1.4);
  n2.stop(t + 1.9);
}

/** A continuous voice: one output gain set by `level` (0 = silent), with its own shaping. */
abstract class Voice {
  protected g: GainNode;
  constructor(protected fx: Fx, dest: AudioNode) {
    this.g = fx.ctx.createGain();
    this.g.gain.value = 0;
    this.g.connect(dest);
  }
  protected level(v: number, tc: number): void {
    this.g.gain.setTargetAtTime(v, this.fx.ctx.currentTime, tc);
  }
}

/** Emergency blow: high-pressure air roaring into the tanks, the water boiling out below. */
export class BlowRoar extends Voice {
  private on = false;
  constructor(fx: Fx, dest: AudioNode) {
    super(fx, dest);
    const c = fx.ctx;
    const hiss = noiseSrc(fx);
    const hp = c.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 2400;
    hp.Q.value = 0.5;
    hiss.connect(hp).connect(this.g);
    const boil = noiseSrc(fx);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const am = c.createGain();
    am.gain.value = 1.2;
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 6;
    const d = c.createGain();
    d.gain.value = 0.8;
    lfo.connect(d).connect(am.gain);
    boil.connect(lp).connect(am).connect(this.g);
    for (const s of [hiss, boil]) s.start(0, Math.random() * fx.noise.duration);
    lfo.start();
  }
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    const t = this.fx.ctx.currentTime;
    this.g.gain.cancelScheduledValues(t);
    if (on) {
      // A slam of the valves, then the roar dying down as the bottle empties
      this.g.gain.setValueAtTime(0.0001, t);
      this.g.gain.exponentialRampToValueAtTime(0.22, t + 0.12);
      this.g.gain.exponentialRampToValueAtTime(0.09, t + 14);
    } else this.g.gain.setTargetAtTime(0, t, 0.6);
  }
}

/** Gas turbines: the intake roar and the compressor's whine, climbing with the load. */
export class Turbine extends Voice {
  private whine: OscillatorNode;
  private roarF: BiquadFilterNode;
  constructor(fx: Fx, dest: AudioNode) {
    super(fx, dest);
    const c = fx.ctx;
    this.whine = c.createOscillator();
    this.whine.frequency.value = 1100;
    const wg = c.createGain();
    wg.gain.value = 0.18;
    this.whine.connect(wg).connect(this.g);
    const roar = noiseSrc(fx);
    this.roarF = c.createBiquadFilter();
    this.roarF.type = 'bandpass';
    this.roarF.frequency.value = 700;
    this.roarF.Q.value = 0.8;
    roar.connect(this.roarF).connect(this.g);
    roar.start(0, Math.random() * fx.noise.duration);
    this.whine.start();
  }
  set(level: number, hz: number): void {
    const t = this.fx.ctx.currentTime;
    this.level(0.07 * level, 1.5);
    // Spool-up: the whine follows the power slowly
    this.whine.frequency.setTargetAtTime(hz, t, 2.5);
    this.roarF.frequency.setTargetAtTime(hz * 0.6, t, 2.5);
  }
}

/** The own helicopter's rotors: blade-slap beating low noise, and the engine's whine. */
export class Rotor extends Voice {
  private slap: OscillatorNode;
  private whine: OscillatorNode;
  constructor(fx: Fx, dest: AudioNode) {
    super(fx, dest);
    const c = fx.ctx;
    const n = noiseSrc(fx);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const beat = c.createGain();
    beat.gain.value = 0.5;
    this.slap = c.createOscillator();
    this.slap.type = 'sawtooth';
    this.slap.frequency.value = 4;
    const depth = c.createGain();
    depth.gain.value = -0.5;
    this.slap.connect(depth).connect(beat.gain);
    n.connect(lp).connect(beat).connect(this.g);
    this.whine = c.createOscillator();
    this.whine.frequency.value = 2600;
    const wg = c.createGain();
    wg.gain.value = 0.05;
    this.whine.connect(wg).connect(this.g);
    n.start(0, Math.random() * fx.noise.duration);
    this.slap.start();
    this.whine.start();
  }
  /** Loudness as heard aboard (0..1) and rotor speed (0 stopped … 1 flying). */
  set(level: number, spin: number): void {
    const t = this.fx.ctx.currentTime;
    this.level(0.4 * level, level > 0 ? 1.2 : 2.5);
    // Blade passing: about 18/s at full rotor speed, slower while it spins up or down
    this.slap.frequency.setTargetAtTime(5 + 13 * spin, t, 2);
    this.whine.frequency.setTargetAtTime(1600 + 1600 * spin, t, 2);
  }
}
