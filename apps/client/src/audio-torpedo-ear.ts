import type { Fx } from './audio-fx.js';
import type { HeardTorpedo } from './audio-triggers.js';

/**
 * A torpedo running, in the sonar operator's headphones, besides the contact he listens to:
 * the loudest torpedo in the water the own ship knows of (own fish on the wire, or an enemy one
 * the sensors hold, audio-triggers.ts loudestTorpedo). A hissing high whine beaten by its
 * screw, Doppler-shifted by its range rate, from its bearing; a homing own torpedo's seeker
 * pings ride on it. One fixed set of nodes: the pings are envelopes on a running oscillator.
 */
export class TorpedoEar {
  private g: GainNode;
  private pan: StereoPannerNode;
  private whine: OscillatorNode;
  private hiss: BiquadFilterNode;
  private ping: GainNode;
  private nextPing = 0;

  constructor(private fx: Fx, dest: AudioNode) {
    const c = fx.ctx;
    this.pan = c.createStereoPanner();
    this.pan.connect(dest);
    this.g = c.createGain();
    this.g.gain.value = 0;
    this.g.connect(this.pan);
    const n = c.createBufferSource();
    n.buffer = fx.noise;
    n.loop = true;
    this.hiss = c.createBiquadFilter();
    this.hiss.type = 'bandpass';
    this.hiss.frequency.value = 3000;
    this.hiss.Q.value = 1.1;
    // Screw beat on the hiss
    const beat = c.createGain();
    beat.gain.value = 0.65;
    const blade = c.createOscillator();
    blade.type = 'sawtooth';
    blade.frequency.value = 52;
    const bd = c.createGain();
    bd.gain.value = -0.3;
    blade.connect(bd).connect(beat.gain);
    n.connect(this.hiss).connect(beat).connect(this.g);
    this.whine = c.createOscillator();
    this.whine.type = 'sawtooth';
    this.whine.frequency.value = 1450;
    const wf = c.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 1600;
    wf.Q.value = 5;
    const wg = c.createGain();
    wg.gain.value = 0.25;
    this.whine.connect(wf).connect(wg).connect(this.g);
    // Seeker: a 7,4 kHz oscillator gated into short blips
    const so = c.createOscillator();
    so.frequency.value = 7400;
    this.ping = c.createGain();
    this.ping.gain.value = 0;
    so.connect(this.ping).connect(this.pan);
    n.start(0, Math.random() * fx.noise.duration);
    blade.start();
    this.whine.start();
    so.start();
  }

  /** Follow the torpedo (undefined: none heard); `duck` while the operator listens to a torpedo himself. */
  update(h: HeardTorpedo | undefined, duck: boolean, timeScale: number): void {
    const t = this.fx.ctx.currentTime;
    const lvl = h && !duck ? h.level : 0;
    this.g.gain.setTargetAtTime(0.35 * lvl, t, 0.3);
    if (!h) return;
    this.pan.pan.setTargetAtTime(Math.sin((h.rel * Math.PI) / 180) * 0.85, t, 0.3);
    this.whine.frequency.setTargetAtTime(1450 * h.pitch, t, 0.4);
    this.hiss.frequency.setTargetAtTime(3000 * h.pitch, t, 0.4);
    if (h.homing && lvl > 0 && t >= this.nextPing) {
      const p = this.ping.gain;
      const at = Math.max(t, this.nextPing);
      p.setValueAtTime(0, at);
      p.linearRampToValueAtTime(0.12 * lvl, at + 0.004);
      p.exponentialRampToValueAtTime(0.0001, at + 0.06);
      p.setValueAtTime(0, at + 0.07);
      this.nextPing = at + 1.1 / Math.max(1, timeScale);
    }
  }
}
