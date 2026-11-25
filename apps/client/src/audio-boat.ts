import type { Fx } from './audio-fx.js';

/**
 * Sounds of the own boat and of weapons close by: the snorkel diesel, a wire parting, the
 * seeker pings of an incoming torpedo and the thud of a depth charge going off.
 */

/** The diesel running while snorkelling: a low firing beat with exhaust rumble. */
export class Diesel {
  private g: GainNode;
  private fire: OscillatorNode;

  constructor(fx: Fx, dest: AudioNode) {
    const c = fx.ctx;
    this.g = c.createGain();
    this.g.gain.value = 0;
    this.g.connect(dest);
    // Exhaust and block noise, beaten by the firing rate
    const n = c.createBufferSource();
    n.buffer = fx.noise;
    n.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const beat = c.createGain();
    beat.gain.value = 0.6;
    this.fire = c.createOscillator();
    this.fire.type = 'sawtooth';
    this.fire.frequency.value = 22;
    const depth = c.createGain();
    depth.gain.value = -0.4;
    this.fire.connect(depth).connect(beat.gain);
    n.connect(lp).connect(beat).connect(this.g);
    // The firing tone itself, low and rough
    const tone = c.createOscillator();
    tone.type = 'square';
    tone.frequency.value = 44;
    const tl = c.createBiquadFilter();
    tl.type = 'lowpass';
    tl.frequency.value = 140;
    const tg = c.createGain();
    tg.gain.value = 0.25;
    tone.connect(tl).connect(tg).connect(this.g);
    n.start(0, Math.random() * fx.noise.duration);
    this.fire.start();
    tone.start();
  }

  /** Running (snorkel head up and the diesel on) at this speed. */
  set(on: boolean, kn: number): void {
    const t = this.g.context.currentTime;
    this.g.gain.setTargetAtTime(on ? 0.12 : 0, t, on ? 1.2 : 0.6);
    this.fire.frequency.setTargetAtTime(18 + kn * 1.2, t, 1);
  }
}

/** The guidance wire parting: a short metallic twang. */
export function wireSnap(fx: Fx, dest: AudioNode): void {
  const c = fx.ctx;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(240, t + 0.35);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g);
  g.connect(dest);
  g.connect(fx.reverb);
  o.start(t);
  o.stop(t + 0.5);
}

/** One seeker ping of a homing torpedo: a short, very high blip. */
export function seekerPing(fx: Fx, dest: AudioNode, level: number): void {
  const c = fx.ctx;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(7400, t);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, level), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g);
  g.connect(dest);
  g.connect(fx.reverb);
  o.start(t);
  o.stop(t + 0.08);
}
