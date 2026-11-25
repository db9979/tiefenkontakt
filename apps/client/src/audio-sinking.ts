import type { Fx } from './audio-fx.js';

/**
 * A ship breaking up on its way down, heard on the hydrophone for about a minute: groaning and
 * shrieking steel, air escaping in bursts, compartments and bulkheads giving way one after the
 * other — sharp bangs at first, then, as the hull sinks past its strength, deep implosions with
 * a thudding low end — and the last rumble fading. Everything random per sinking, panned by
 * the bearing it comes from (dest).
 */
export function breakUpSequence(fx: Fx, dest: AudioNode, gain = 0.25, durS = 60): void {
  const { ctx } = fx;
  const t0 = ctx.currentTime + 1.5;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const out = (g: GainNode) => {
    g.connect(dest);
    g.connect(fx.reverb);
  };
  const env = (at: number, peak: number, attack: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  };
  const noise = () => {
    const n = ctx.createBufferSource();
    n.buffer = fx.noise;
    n.loop = true;
    return n;
  };

  // Groans and shrieks: stressed plating, resonant and falling, more of them early on
  const groans = Math.round(rnd(10, 16));
  for (let i = 0; i < groans; i++) {
    const at = t0 + Math.pow(Math.random(), 1.6) * durS * 0.85;
    const len = rnd(0.8, 3.2);
    const shriek = Math.random() < 0.25;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = shriek ? rnd(500, 1400) : rnd(45, 140);
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * rnd(0.45, 0.8), at + len);
    const res = ctx.createBiquadFilter();
    res.type = 'bandpass';
    res.frequency.value = shriek ? f * 1.5 : rnd(150, 420);
    res.Q.value = shriek ? 12 : 5;
    const g = env(at, gain * (shriek ? 0.25 : 0.45), len * 0.3, len * 0.8);
    o.connect(res).connect(g);
    out(g);
    o.start(at);
    o.stop(at + len * 1.2);
  }

  // Compartments giving way: bangs early, deep implosions later (the hull sinks past its strength)
  const breaks = Math.round(rnd(6, 10));
  for (let i = 0; i < breaks; i++) {
    const frac = (i + Math.random() * 0.6) / breaks;
    const at = t0 + 3 + frac * durS * 0.9;
    const deep = frac > 0.45;
    const n = noise();
    const f = ctx.createBiquadFilter();
    f.type = deep ? 'lowpass' : 'bandpass';
    f.frequency.value = deep ? rnd(180, 380) : rnd(500, 1500);
    f.Q.value = deep ? 0.8 : 2.5;
    const g = env(at, gain * (deep ? 1 : 0.7), 0.004, deep ? rnd(0.8, 1.6) : rnd(0.3, 0.6));
    n.connect(f).connect(g);
    out(g);
    n.start(at, Math.random() * fx.noise.duration);
    n.stop(at + 2);
    if (deep) {
      // The thud of collapsing hull spaces
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(rnd(50, 80), at);
      o.frequency.exponentialRampToValueAtTime(rnd(18, 28), at + 0.6);
      const g2 = env(at, gain * 1.2, 0.005, 0.9);
      o.connect(g2);
      out(g2);
      o.start(at);
      o.stop(at + 1.2);
    }
  }

  // Air escaping: bubbling bursts that thin out as she goes down
  const bubbles = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 1.2;
  const am = ctx.createGain();
  am.gain.value = 0;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 7;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(am.gain);
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, t0);
  level.gain.exponentialRampToValueAtTime(gain * 0.5, t0 + 1);
  level.gain.exponentialRampToValueAtTime(gain * 0.15, t0 + durS * 0.4);
  level.gain.exponentialRampToValueAtTime(0.0001, t0 + durS * 0.8);
  bubbles.connect(bp).connect(am).connect(level);
  out(level);
  bubbles.start(t0, Math.random() * fx.noise.duration);
  lfo.start(t0);
  bubbles.stop(t0 + durS);
  lfo.stop(t0 + durS);
  // Wobble the bubble rate so it does not sound like a machine
  for (let s = 0; s < durS * 0.8; s += 2) lfo.frequency.setValueAtTime(rnd(3, 11), t0 + s);
}
