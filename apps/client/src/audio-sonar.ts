import type { SoundVoice } from '@tk/shared';
import type { Fx } from './audio-fx.js';
import { BioCalls } from './audio-bio.js';
import { TorpedoEar } from './audio-torpedo-ear.js';

/**
 * The hydrophone in the operator's headphones, synthesised (no recordings):
 *  - the sea's own noise (sea state, rain on the surface, grinding ice, the own boat's flow at
 *    speed) under everything, so a weak contact sinks into it as its signal excess falls;
 *  - the contact: broadband noise beaten by its screw at the blade rate (thump-thump), with the
 *    shaft rate on top, cavitation crackle when the screw cavitates, duller the farther away
 *    (water swallows the highs), from its bearing (left/right of the bow), its tonal lines
 *    Doppler-shifted while it closes or opens;
 *  - what the ear recognises at once: whale pulses and songs, sperm-whale and dolphin clicks,
 *    whistles, snapping shrimp, and the high whine of a torpedo.
 * Modes: broadband (all of it), filtered (the LOFAR band), heterodyne (lines shifted up 700 Hz).
 */

export interface SonarHearing {
  mode: 'breitband' | 'gefiltert' | 'ueberlagerung';
  band: [number, number];
  /** Signal excess of the contact (dB); undefined: nothing selected or nothing fresh. */
  se?: number;
  shaftHz?: number;
  bladeHz?: number;
  tonals: { hz: number; snr: number }[];
  cav?: boolean;
  voice?: SoundVoice;
  /** Bearing relative to the own bow (degrees, + starboard). */
  rel?: number;
  rangeM?: number;
  /** Closing speed (kn, + approaching), for the Doppler shift. */
  closingKn?: number;
  sea: number;
  rain: boolean;
  ice: number;
  ownKn: number;
}

/** A sparse train of clicks (snaps, crackle, ice) in a loopable buffer. */
function clickBuffer(ctx: AudioContext, perSecond: number, decayS: number, seconds = 3): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  const len = Math.floor(ctx.sampleRate * decayS);
  for (let k = 0; k < perSecond * seconds; k++) {
    const at = Math.floor(Math.random() * n);
    const amp = 0.3 + Math.random() * 0.7;
    for (let i = 0; i < len && at + i < n; i++) d[at + i]! += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 4));
  }
  return b;
}

export class SonarVoice {
  private out: GainNode;
  private sea: { g: GainNode; f: BiquadFilterNode };
  private rain: GainNode;
  private ice: GainNode;
  private flow: { g: GainNode; f: BiquadFilterNode };
  private tgt: { g: GainNode; lp: BiquadFilterNode; band: BiquadFilterNode; beat: GainNode; blade: OscillatorNode; bladeDepth: GainNode; shaft: OscillatorNode; shaftDepth: GainNode; pan: StereoPannerNode };
  private cav: GainNode;
  private tones: { o: OscillatorNode; g: GainNode }[];
  private bio: { songG: GainNode; clicks: AudioBufferSourceNode; clickG: GainNode; whistleG: GainNode; snap: GainNode; pulse: OscillatorNode; pulseG: GainNode; pulseAm: OscillatorNode; calls: BioCalls };
  private whine: { o: OscillatorNode; g: GainNode; vib: OscillatorNode };
  private t0: number;
  /** Torpedoes in the water besides the contact (audio-torpedo-ear.ts), in the same headphones. */
  readonly ear: TorpedoEar;

  constructor(private fx: Fx, dest: AudioNode) {
    const c = fx.ctx;
    this.t0 = c.currentTime;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.ear = new TorpedoEar(fx, this.out);
    const noise = (type: BiquadFilterType, hz: number, q = 0.7) => {
      const s = c.createBufferSource();
      s.buffer = fx.noise; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f).connect(g);
      s.start(0, Math.random() * fx.noise.duration);
      return { f, g };
    };
    const loop = (buf: AudioBuffer, type: BiquadFilterType, hz: number) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = hz;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f).connect(g).connect(this.out);
      s.start(0, Math.random() * 2);
      return { s, g };
    };
    // The sea: a deep, pinkish rush that rises with the sea state
    this.sea = noise('lowpass', 900, 0.5);
    this.sea.g.connect(this.out);
    this.rain = noise('highpass', 2500, 0.6).g;
    this.rain.connect(this.out);
    this.ice = loop(clickBuffer(c, 6, 0.08), 'lowpass', 1800).g;
    this.flow = noise('lowpass', 250, 0.6);
    this.flow.g.connect(this.out);
    // The contact: noise through a range-dependent low-pass, beaten by the screw, panned
    const tn = noise('lowpass', 3000, 0.4);
    const band = c.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 0.3; band.frequency.value = 800;
    const beat = c.createGain(); beat.gain.value = 0.6;
    const pan = c.createStereoPanner();
    const g = c.createGain(); g.gain.value = 0;
    tn.g.gain.value = 1;
    tn.g.connect(band).connect(beat).connect(g).connect(pan).connect(this.out);
    const lfo = (wave: OscillatorType) => {
      const o = c.createOscillator(); o.type = wave; o.frequency.value = 0.01;
      const d = c.createGain(); d.gain.value = 0;
      o.connect(d).connect(beat.gain);
      o.start();
      return { o, d };
    };
    // Blade rate: a sharp thump per blade (sawtooth), the shaft rate a slower swell on top
    const bl = lfo('sawtooth');
    const sh = lfo('sine');
    this.tgt = { g, lp: tn.f, band, beat, blade: bl.o, bladeDepth: bl.d, shaft: sh.o, shaftDepth: sh.d, pan };
    // Cavitation: crackle riding on the contact
    const cv = c.createBufferSource(); cv.buffer = clickBuffer(c, 140, 0.004); cv.loop = true;
    const cvf = c.createBiquadFilter(); cvf.type = 'highpass'; cvf.frequency.value = 1500;
    this.cav = c.createGain(); this.cav.gain.value = 0;
    cv.connect(cvf).connect(this.cav).connect(pan);
    cv.start(0, Math.random() * 2);
    this.tones = Array.from({ length: 6 }, () => {
      const o = c.createOscillator();
      const tg = c.createGain(); tg.gain.value = 0;
      o.connect(tg).connect(g);
      o.start();
      return { o, g: tg };
    });
    // Biology
    const osc = (type: OscillatorType, hz: number) => { const o = c.createOscillator(); o.type = type; o.frequency.value = hz; o.start(); return o; };
    // Whale song and dolphin whistles: single calls with pauses (audio-bio.ts)
    const songG = c.createGain(); songG.gain.value = 0;
    songG.connect(pan);
    const clicks = c.createBufferSource(); clicks.buffer = clickBuffer(c, 3, 0.006); clicks.loop = true;
    const clickG = c.createGain(); clickG.gain.value = 0;
    clicks.connect(clickG).connect(pan); clicks.start();
    const whistleG = c.createGain(); whistleG.gain.value = 0;
    whistleG.connect(pan);
    const calls = new BioCalls(c, whistleG, songG);
    const snap = loop(clickBuffer(c, 400, 0.003), 'highpass', 2000).g;
    // Whale pulses: the square LFO gates an inner gain around 0.5; pulseG alone sets the level (0 = silent)
    const pulse = osc('sine', 80); const pulseG = c.createGain(); pulseG.gain.value = 0;
    const pulseAm = osc('square', 0.8); const pam = c.createGain(); pam.gain.value = 0.5;
    const gate = c.createGain(); gate.gain.value = 0.5;
    pulseAm.connect(pam).connect(gate.gain);
    pulse.connect(gate).connect(pulseG).connect(pan);
    this.bio = { songG, clicks, clickG, whistleG, snap, pulse, pulseG, pulseAm, calls };
    // Torpedo: a high, rising whine with a fast flutter of its screw
    const wo = osc('sawtooth', 1400); const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1600; wf.Q.value = 4;
    const wg = c.createGain(); wg.gain.value = 0;
    const vib = osc('sine', 28); const vd = c.createGain(); vd.gain.value = 40;
    vib.connect(vd).connect(wo.frequency);
    // Mostly a hiss: high broadband flow and screw noise, the tonal whine only riding on top
    const tn2 = c.createBufferSource(); tn2.buffer = fx.noise; tn2.loop = true;
    const hiss = c.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 3200; hiss.Q.value = 0.9;
    const hissG = c.createGain(); hissG.gain.value = 1.6;
    // The screw beats the hiss at a fast blade rate
    const beatO = osc('sawtooth', 45); const beatD = c.createGain(); beatD.gain.value = -0.35;
    const beatG = c.createGain(); beatG.gain.value = 0.65;
    beatO.connect(beatD).connect(beatG.gain);
    tn2.connect(hiss).connect(hissG).connect(beatG).connect(wg);
    tn2.start(0, Math.random() * fx.noise.duration);
    const tone = c.createGain(); tone.gain.value = 0.35;
    wo.connect(wf).connect(tone).connect(wg);
    wg.connect(pan);
    this.whine = { o: wo, g: wg, vib };
  }

  /** Follow the selected contact and the sea (called with every snapshot while listening). */
  update(hh: SonarHearing | undefined): void {
    const c = this.fx.ctx;
    const t = c.currentTime;
    const k = 0.25;
    this.out.gain.setTargetAtTime(hh ? 0.9 : 0, t, 0.15);
    if (!hh) return;
    // The sea's noise floor: everything is heard against it
    const sea = Math.min(1, (hh.sea + 1) / 7);
    this.sea.g.gain.setTargetAtTime(0.02 + 0.06 * sea, t, k);
    this.sea.f.frequency.setTargetAtTime(500 + 900 * sea, t, k);
    this.rain.gain.setTargetAtTime(hh.rain ? 0.035 : 0, t, k);
    this.ice.gain.setTargetAtTime(0.25 * hh.ice, t, k);
    this.flow.g.gain.setTargetAtTime(Math.min(0.12, (hh.ownKn / 20) ** 2 * 0.12), t, k);
    const has = hh.se !== undefined;
    // Signal over the floor: 0 dB excess is just audible, +20 dB stands out clearly
    const sig = has ? Math.min(0.5, 0.02 * Math.pow(10, Math.max(-10, Math.min(28, hh.se! + 4)) / 20)) : 0;
    const voice = hh.voice;
    const machine = has && !voice;
    this.tgt.g.gain.setTargetAtTime(machine ? sig : 0, t, k);
    // Range: far contacts are dull (high frequencies absorbed), close ones bright and harsh
    const range = hh.rangeM ?? 8000;
    this.tgt.lp.frequency.setTargetAtTime(Math.max(220, 2600 * Math.exp(-range / 9000)), t, k);
    this.tgt.pan.pan.setTargetAtTime(hh.rel !== undefined ? Math.sin((hh.rel * Math.PI) / 180) * 0.85 : 0, t, k);
    // The screw: blade-rate thump, shaft-rate swell
    const blade = hh.bladeHz && hh.bladeHz > 0.3 ? hh.bladeHz : undefined;
    this.tgt.blade.frequency.setTargetAtTime(blade ?? 0.01, t, k);
    // Inverted sawtooth: each blade passing is a sharp thump that dies away (not a swell that cuts off)
    this.tgt.bladeDepth.gain.setTargetAtTime(blade ? -0.7 : 0, t, k);
    this.tgt.shaft.frequency.setTargetAtTime(hh.shaftHz && hh.shaftHz > 0.2 ? hh.shaftHz : 0.01, t, k);
    this.tgt.shaftDepth.gain.setTargetAtTime(hh.shaftHz ? 0.15 : 0, t, k);
    this.cav.gain.setTargetAtTime(machine && hh.cav ? sig * 1.2 : 0, t, k);
    // Mode: the band the operator listens to; heterodyne shifts the lines up into hearing
    const shift = hh.mode === 'ueberlagerung' ? 700 : 0;
    const [lo, hi] = hh.band;
    if (hh.mode === 'breitband') {
      // Ship noise is strongest low (100–500 Hz) and falls off above: no bump in the presence range
      this.tgt.band.frequency.setTargetAtTime(320, t, k);
      this.tgt.band.Q.setTargetAtTime(0.35, t, k);
    } else {
      const mid = Math.max(30, (lo + hi) / 2 + shift);
      this.tgt.band.frequency.setTargetAtTime(mid, t, k);
      this.tgt.band.Q.setTargetAtTime(Math.max(0.5, mid / Math.max(10, hi - lo)), t, k);
    }
    // Tonal lines, Doppler-shifted (1 kn closing ≈ +0.034 %)
    const dop = 1 + ((hh.closingKn ?? 0) * 0.5144) / 1500;
    const lines = hh.mode === 'breitband' ? hh.tonals.slice(0, 3) : hh.tonals.filter((x) => x.hz >= lo && x.hz <= hi);
    this.tones.forEach((tone, i) => {
      const line = lines[i];
      if (!line || !has) return tone.g.gain.setTargetAtTime(0, t, 0.1);
      const hz = line.hz * dop + shift;
      // Broadband: the lines only colour the noise faintly (find them in LOFAR or heterodyne); filtered: clear
      tone.o.frequency.setTargetAtTime(hz, t, 0.1);
      tone.g.gain.setTargetAtTime(Math.min(0.5, line.snr / 40) * (hh.mode === 'breitband' ? 0.04 : 0.5), t, 0.2);
    });
    // Biology and torpedoes: their own voices
    const b = this.bio;
    const on = (v: SoundVoice) => (voice === v ? sig : 0);
    b.songG.gain.setTargetAtTime(on('gesang') * 0.8, t, k);
    b.calls.tick(t, voice === 'pfiffe' && sig > 0, voice === 'gesang' && sig > 0);
    b.clickG.gain.setTargetAtTime(on('klicks') * 2 + on('pfiffe') * 0.8, t, k);
    b.clicks.playbackRate.setTargetAtTime(voice === 'pfiffe' ? 6 : 1, t, k);
    b.whistleG.gain.setTargetAtTime(on('pfiffe') * 0.25, t, k);
    b.snap.gain.setTargetAtTime(on('knistern') * 1.5, t, k);
    b.pulseG.gain.setTargetAtTime(on('puls') * 0.9, t, k);
    this.whine.g.gain.setTargetAtTime(on('torpedo') * 0.7, t, k);
    this.whine.o.frequency.setTargetAtTime(1300 * dop * (1 + Math.max(0, 6000 - range) / 30000), t, 0.3);
  }
}
