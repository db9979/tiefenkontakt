/**
 * Calls of whales and dolphins for the hydrophone (audio-sonar.ts): single calls with pauses
 * instead of a steadily wobbling tone. Every dolphin whistle gets its own contour (rising,
 * falling, U, arch, warble) and length, mostly in short bursts; whale song comes in long,
 * slowly gliding units with an overtone. All timing and pitch are random per call.
 */

type Contour = (x: number) => number;

/** Dolphin whistle shapes over x in 0..1, as a factor on the base pitch. */
const WHISTLES: Contour[] = [
  (x) => 0.7 + 0.6 * x, // rising
  (x) => 1.3 - 0.6 * x, // falling
  (x) => 1.15 - 0.5 * Math.sin(Math.PI * x), // U
  (x) => 0.75 + 0.5 * Math.sin(Math.PI * x), // arch
  (x) => 1 + 0.18 * Math.sin(2 * Math.PI * x * 2.5) + 0.2 * x, // warble
];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function curve(f0: number, shape: Contour, wobble: number): Float32Array {
  const n = 24;
  const out = new Float32Array(n);
  const ph = Math.random() * 6;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    out[i] = f0 * shape(x) * (1 + wobble * Math.sin(ph + x * 9));
  }
  return out;
}

export class BioCalls {
  private w: OscillatorNode;
  private wEnv: GainNode;
  private s: OscillatorNode;
  private s2: OscillatorNode;
  private sEnv: GainNode;
  private nextW = 0;
  private nextS = 0;
  private burst = 0;

  constructor(private c: AudioContext, whistleOut: AudioNode, songOut: AudioNode) {
    const osc = (hz: number) => {
      const o = c.createOscillator();
      o.frequency.value = hz;
      o.start();
      return o;
    };
    this.wEnv = c.createGain();
    this.wEnv.gain.value = 0;
    this.w = osc(6000);
    this.w.connect(this.wEnv).connect(whistleOut);
    this.sEnv = c.createGain();
    this.sEnv.gain.value = 0;
    this.s = osc(200);
    this.s2 = osc(400);
    const over = c.createGain();
    over.gain.value = 0.25;
    this.s.connect(this.sEnv);
    this.s2.connect(over).connect(this.sEnv);
    this.sEnv.connect(songOut);
  }

  /** Schedule the next calls while a voice is heard (call often; t = context time). */
  tick(t: number, whistling: boolean, singing: boolean): void {
    if (whistling && t >= this.nextW - 0.05) this.whistle(Math.max(t, this.nextW));
    if (singing && t >= this.nextS - 0.05) this.song(Math.max(t, this.nextS));
    if (!whistling) this.nextW = Math.max(this.nextW, t);
    if (!singing) this.nextS = Math.max(this.nextS, t);
  }

  private whistle(t: number): void {
    const dur = rnd(0.25, 1.1);
    const shape = WHISTLES[Math.floor(Math.random() * WHISTLES.length)]!;
    this.w.frequency.cancelScheduledValues(t);
    this.w.frequency.setValueCurveAtTime(curve(rnd(5000, 10000), shape, 0.03), t, dur);
    envelope(this.wEnv.gain, t, dur, 0.02, 0.05, rnd(0.6, 1));
    // Mostly bursts of two to four, then a longer quiet spell
    this.burst = this.burst > 0 ? this.burst - 1 : Math.floor(rnd(1, 4));
    this.nextW = t + dur + (this.burst > 0 ? rnd(0.08, 0.45) : rnd(1.2, 4.5));
  }

  private song(t: number): void {
    const dur = rnd(1.4, 4.2);
    const f0 = rnd(100, 380);
    const end = rnd(0.6, 1.5);
    const shape: Contour = (x) => 1 + (end - 1) * x + 0.12 * Math.sin(Math.PI * x);
    const c = curve(f0, shape, 0.015);
    for (const [o, k] of [[this.s, 1], [this.s2, 2]] as const) {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setValueCurveAtTime(k === 1 ? c : c.map((v) => v * 2), t, dur);
    }
    envelope(this.sEnv.gain, t, dur, 0.35, 0.7, rnd(0.6, 1));
    this.nextS = t + dur + rnd(0.8, 3.5);
  }
}

function envelope(p: AudioParam, t: number, dur: number, attack: number, release: number, peak: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setValueAtTime(peak, t + Math.max(attack, dur - release));
  p.linearRampToValueAtTime(0, t + dur);
}
