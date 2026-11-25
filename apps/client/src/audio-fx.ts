/**
 * Richer synthesized effects for the boat's soundscape (no recordings needed): an underwater
 * reverb, layered detonations followed by sinking noises, pings with a long water tail,
 * hull creaks under pressure, hydraulic and winch motors, and a torpedo launch.
 * Every function takes the AudioContext and a destination node.
 */

export interface Fx {
  ctx: AudioContext;
  noise: AudioBuffer;
  /** Wet bus: everything sent here gets the long underwater reverb. */
  reverb: AudioNode;
}

/** Convolution reverb with a synthetic impulse: dense early field, long dark decay. */
export function makeReverb(ctx: AudioContext, dest: AudioNode, seconds = 3.2): AudioNode {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / ctx.sampleRate;
      // Low-pass the noise more as it decays: water swallows the highs first
      const k = Math.min(0.95, 0.35 + tt * 0.25);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.exp(-tt * 2.1) * 2.2;
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  conv.connect(wet).connect(dest);
  return conv;
}

function src(fx: Fx): AudioBufferSourceNode {
  const s = fx.ctx.createBufferSource();
  s.buffer = fx.noise;
  s.loop = true;
  // Start every source at a random place in the long buffer, so no two noises are the same
  const start = s.start.bind(s);
  s.start = ((when = 0, offset?: number, duration?: number) =>
    duration === undefined ? start(when, offset ?? Math.random() * fx.noise.duration) : start(when, offset ?? Math.random() * fx.noise.duration, duration)) as typeof s.start;
  return s;
}

function env(ctx: AudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

/** Detonation: crack, a deep pressure thump, a long rumble; far blasts are duller and wetter. */
export function detonation(fx: Fx, dest: AudioNode, near: boolean): void {
  const { ctx } = fx;
  const t = ctx.currentTime;
  const loud = near ? 1 : 0.45;
  // Crack
  const n1 = src(fx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'lowpass';
  bp.frequency.value = near ? 4000 : 1200;
  const g1 = env(ctx, t, 0.8 * loud, 0.004, 0.25);
  n1.connect(bp).connect(g1);
  g1.connect(dest);
  g1.connect(fx.reverb);
  n1.start(t);
  n1.stop(t + 0.4);
  // Thump: falling sine, the shock wave through the hull
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
  const g2 = env(ctx, t, 0.9 * loud, 0.01, 1.4);
  o.connect(g2).connect(dest);
  o.start(t);
  o.stop(t + 1.6);
  // Rumble
  const n3 = src(fx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(near ? 700 : 260, t);
  lp.frequency.exponentialRampToValueAtTime(45, t + 6);
  const g3 = env(ctx, t, 0.5 * loud, 0.15, 6);
  n3.connect(lp).connect(g3);
  g3.connect(dest);
  g3.connect(fx.reverb);
  n3.start(t);
  n3.stop(t + 6.5);
}

/** Breaking-up noises a few seconds after a hit: bulkheads giving way, groaning steel, bubbling. */
export function sinkingNoises(fx: Fx, dest: AudioNode, startIn = 3, gain = 0.3): void {
  const { ctx } = fx;
  const t0 = ctx.currentTime + startIn;
  // Groans: slow, falling, resonant sawtooth
  for (let i = 0; i < 4; i++) {
    const at = t0 + i * (1.5 + Math.random() * 2.5);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = 70 + Math.random() * 90;
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, at + 2.2);
    const res = ctx.createBiquadFilter();
    res.type = 'bandpass';
    res.frequency.value = 180 + Math.random() * 200;
    res.Q.value = 6;
    const g = env(ctx, at, gain * 0.5, 0.4, 2);
    o.connect(res).connect(g);
    g.connect(dest);
    g.connect(fx.reverb);
    o.start(at);
    o.stop(at + 2.6);
  }
  // Bulkheads: sharp metallic bangs
  for (let i = 0; i < 3; i++) {
    const at = t0 + 0.8 + i * (2 + Math.random() * 3);
    const n = src(fx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600 + Math.random() * 900;
    bp.Q.value = 3;
    const g = env(ctx, at, gain, 0.003, 0.5);
    n.connect(bp).connect(g);
    g.connect(dest);
    g.connect(fx.reverb);
    n.start(at);
    n.stop(at + 0.6);
  }
  // Bubbling: amplitude-modulated band noise
  const n = src(fx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 1.5;
  const am = ctx.createGain();
  am.gain.value = 0;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 9;
  const lfoG = ctx.createGain();
  lfoG.gain.value = gain * 0.25;
  lfo.connect(lfoG).connect(am.gain);
  const g = env(ctx, t0, 1, 1.5, 7);
  n.connect(bp).connect(am).connect(g).connect(dest);
  n.start(t0);
  lfo.start(t0);
  n.stop(t0 + 9);
  lfo.stop(t0 + 9);
}

/** Active sonar ping: a clean tone with a slight sweep and a long water reverb tail. */
export function sonarPing(fx: Fx, dest: AudioNode, distant: boolean, lfm = false): void {
  const { ctx } = fx;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  const f = distant ? 3200 : 3500;
  o.frequency.setValueAtTime(lfm ? f * 0.94 : f, t);
  // CW: one steady tone; LFM: a clear upward sweep across the band
  o.frequency.linearRampToValueAtTime(lfm ? f * 1.06 : f * 1.004, t + 0.35);
  const g = env(ctx, t, distant ? 0.09 : 0.6, 0.008, distant ? 0.6 : 0.9);
  o.connect(g);
  g.connect(dest);
  g.connect(fx.reverb);
  o.start(t);
  o.stop(t + 1.2);
}

/** A single hull creak: pressure working the frames (louder and lower when deep). */
export function hullCreak(fx: Fx, dest: AudioNode, depthM: number): void {
  const { ctx } = fx;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f = 140 + Math.random() * 120 - depthM * 0.15;
  o.frequency.setValueAtTime(Math.max(60, f), t);
  o.frequency.linearRampToValueAtTime(Math.max(50, f * (0.8 + Math.random() * 0.3)), t + 0.9);
  // Stick-slip: a fast tremolo makes it sound like straining steel
  const trem = ctx.createGain();
  trem.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 25 + Math.random() * 30;
  const lg = ctx.createGain();
  lg.gain.value = 0.5;
  lfo.connect(lg).connect(trem.gain);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 300 + Math.random() * 300;
  bp.Q.value = 5;
  const g = env(ctx, t, Math.min(0.5, 0.15 + depthM / 800), 0.15, 0.9);
  o.connect(trem).connect(bp).connect(g);
  g.connect(dest);
  g.connect(fx.reverb);
  o.start(t);
  lfo.start(t);
  o.stop(t + 1.2);
  lfo.stop(t + 1.2);
}

/** A continuous motor (mast hydraulics, towed-array winch): returns a setter for 0..1 activity. */
export function motor(fx: Fx, dest: AudioNode, hz: number, hiss: number): (on: number) => void {
  const { ctx } = fx;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = hz;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = hz * 3;
  const n = src(fx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.value = hiss;
  const g = ctx.createGain();
  g.gain.value = 0;
  o.connect(lp).connect(g);
  n.connect(bp).connect(ng).connect(g);
  g.connect(dest);
  o.start();
  n.start();
  return (on: number) => {
    const t = ctx.currentTime;
    g.gain.setTargetAtTime(on * 0.05, t, 0.15);
    o.frequency.setTargetAtTime(hz * (0.85 + 0.15 * on), t, 0.3);
  };
}

/** Torpedo launch: tube flooding gurgle, the air impulse, the thump of the ram. */
export function torpedoLaunch(fx: Fx, dest: AudioNode): void {
  const { ctx } = fx;
  const t = ctx.currentTime;
  const n = src(fx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  const g = env(ctx, t, 0.15, 0.4, 1.2);
  n.connect(lp).connect(g).connect(dest);
  n.start(t);
  n.stop(t + 1.8);
  const at = t + 1.4;
  const n2 = src(fx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 400;
  const g2 = env(ctx, at, 0.35, 0.02, 0.7);
  n2.connect(hp).connect(g2);
  g2.connect(dest);
  g2.connect(fx.reverb);
  n2.start(at);
  n2.stop(at + 0.9);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(70, at);
  o.frequency.exponentialRampToValueAtTime(35, at + 0.4);
  const g3 = env(ctx, at, 0.5, 0.005, 0.45);
  o.connect(g3).connect(dest);
  o.start(at);
  o.stop(at + 0.6);
}
