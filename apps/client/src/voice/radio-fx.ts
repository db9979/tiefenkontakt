/**
 * Radio sound for one incoming voice: narrow band (300–3000 Hz), a little clipping, hiss that
 * grows toward the edge of range, a click when the carrier comes up and a squelch tail when it
 * drops. The intercom of the own ship stays clean (wider band, no hiss).
 */

let noiseBuf: AudioBuffer | undefined;
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
}

function clipCurve(k: number): Float32Array<ArrayBuffer> {
  const c = new Float32Array(1024);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

export class RadioChannel {
  /** Connect the voice source here. */
  readonly input: GainNode;
  private voice: GainNode;
  private hiss: GainNode;
  private hissSrc: AudioBufferSourceNode;
  private talking = false;
  private q = 0;

  constructor(private ctx: AudioContext, private dest: AudioNode, private intercom: boolean) {
    this.input = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = intercom ? 150 : 300;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = intercom ? 6000 : 3000;
    this.voice = ctx.createGain();
    this.voice.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    shaper.curve = clipCurve(intercom ? 1.2 : 2.5);
    this.input.connect(hp).connect(lp).connect(shaper).connect(this.voice).connect(dest);
    // Hiss through the same band, only while a carrier is up
    this.hissSrc = ctx.createBufferSource();
    this.hissSrc.buffer = noise(ctx);
    this.hissSrc.loop = true;
    const hb = ctx.createBiquadFilter();
    hb.type = 'bandpass';
    hb.frequency.value = 1600;
    hb.Q.value = 0.6;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    this.hissSrc.connect(hb).connect(this.hiss).connect(dest);
    this.hissSrc.start();
  }

  /** Link quality 0..1 and whether the other side is keyed to me right now. */
  set(q: number, talking: boolean): void {
    const now = this.ctx.currentTime;
    const keyUp = talking && q > 0;
    if (keyUp && !this.talking) this.burst(0.02, 0.35);
    if (!keyUp && this.talking && !this.intercom) this.burst(0.18, 0.22 + (1 - this.q) * 0.2);
    this.talking = keyUp;
    this.q = q;
    this.voice.gain.setTargetAtTime(keyUp ? 1 : 0, now, 0.02);
    this.hiss.gain.setTargetAtTime(keyUp && !this.intercom ? 0.015 + (1 - q) * 0.12 : 0, now, 0.03);
  }

  /** Short noise burst: key-up click or squelch tail. */
  private burst(dur: number, level: number): void {
    const s = this.ctx.createBufferSource();
    s.buffer = noise(this.ctx);
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(g).connect(this.dest);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  close(): void {
    try {
      this.hissSrc.stop();
    } catch {
      /* already stopped */
    }
    this.input.disconnect();
    this.voice.disconnect();
    this.hiss.disconnect();
  }
}
