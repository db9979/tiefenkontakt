import type { Snapshot } from '@tk/shared';

export type ListenMode = 'breitband' | 'gefiltert' | 'ueberlagerung';

export interface HydrophoneInput {
  se: number;
  shaftHz?: number;
  bladeHz?: number;
  tonals: { hz: number; snr: number }[];
  mode: ListenMode;
  band: [number, number];
}

/**
 * Procedural sound: everything is synthesized with Web Audio, no asset files.
 * Machinery hum and flow noise follow own speed, alerts trigger one-shot effects,
 * the hydrophone lets the player listen to the selected sonar contact.
 */
class Audio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noiseBuf?: AudioBuffer;
  private hum?: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; flow: GainNode; flowFilter: BiquadFilterNode };
  private phone?: {
    src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; lfoGain: GainNode; lfo: OscillatorNode;
    noiseGain: GainNode; tones: { o: OscillatorNode; g: GainNode }[];
  };
  private seenAlerts = new Set<string>();
  private lastPing = -1;
  private lastTorps = 0;
  muted = localStorage.getItem('tk_muted') === '1';
  volume = Number(localStorage.getItem('tk_volume') ?? '0.7');

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    localStorage.setItem('tk_muted', m ? '1' : '0');
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v: number): void {
    this.volume = v;
    localStorage.setItem('tk_volume', String(v));
    if (this.master && this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Output node panned to a bearing relative to the own bow (left = port). */
  private out(pan = 0): AudioNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master!);
    return p;
  }

  private panFor(s: Snapshot, bearing?: number): number {
    if (bearing === undefined) return 0;
    return Math.sin(((bearing - s.own.heading) * Math.PI) / 180);
  }

  private noise(): AudioBufferSourceNode | undefined {
    if (!this.ctx || !this.noiseBuf) return undefined;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    return s;
  }

  private startHum(): void {
    if (!this.ctx || !this.master || this.hum) return;
    const c = this.ctx;
    const gain = c.createGain();
    gain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;
    const osc2 = c.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 100;
    osc.connect(lp);
    osc2.connect(lp);
    lp.connect(gain).connect(this.master);
    const flowFilter = c.createBiquadFilter();
    flowFilter.type = 'bandpass';
    flowFilter.frequency.value = 300;
    flowFilter.Q.value = 0.7;
    const flow = c.createGain();
    flow.gain.value = 0;
    const n = this.noise()!;
    n.connect(flowFilter).connect(flow).connect(this.master);
    osc.start();
    osc2.start();
    n.start();
    this.hum = { osc, osc2, gain, flow, flowFilter };
  }

  /** Short sine burst with optional echo tail: active sonar ping. */
  ping(distant = false, pan = 0): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = distant ? 3200 : 3500;
    const g = c.createGain();
    const peak = distant ? 0.08 : 0.35;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + (distant ? 0.9 : 2.2));
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.28;
    const fb = c.createGain();
    fb.gain.value = 0.35;
    const dest = this.out(pan);
    o.connect(g);
    g.connect(dest);
    g.connect(delay).connect(fb).connect(delay);
    fb.connect(dest);
    o.start(t);
    o.stop(t + 2.5);
  }

  /** Two-tone klaxon for an incoming torpedo. */
  torpedoAlarm(pan = 0): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square';
    const g = c.createGain();
    g.gain.value = 0.07;
    for (let i = 0; i < 6; i++) o.frequency.setValueAtTime(i % 2 ? 660 : 880, t + i * 0.28);
    g.gain.setValueAtTime(0.07, t + 1.6);
    g.gain.linearRampToValueAtTime(0, t + 1.7);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + 1.75);
  }

  /** Low-passed noise burst. near = own ship hit or close detonation. */
  explosion(near: boolean, pan = 0): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const n = this.noise()!;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(near ? 900 : 300, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 3);
    const g = c.createGain();
    g.gain.setValueAtTime(near ? 0.9 : 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (near ? 4 : 3));
    n.connect(lp).connect(g).connect(this.out(pan));
    n.start(t);
    n.stop(t + 4.2);
  }

  /** Metallic transient (tube flooding, launch) heard from a bearing. */
  transient(pan = 0): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const n = this.noise()!;
    const hp = c.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 900;
    hp.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(hp).connect(g).connect(this.out(pan));
    n.start(t);
    n.stop(t + 0.6);
  }

  /** Active echo after its two-way travel time: CW = soft tone, LFM = short sweep. */
  echo(delayS: number, lfm: boolean, strength: number, pan = 0): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime + Math.max(0, delayS);
    const o = c.createOscillator();
    o.type = 'sine';
    if (lfm) {
      o.frequency.setValueAtTime(3300, t);
      o.frequency.linearRampToValueAtTime(3700, t + 0.25);
    } else o.frequency.value = 3500;
    const g = c.createGain();
    const peak = Math.min(0.25, 0.03 + strength / 80);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + (lfm ? 0.3 : 0.6));
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + 0.7);
  }

  /** Compressed-air launch whoosh. */
  launch(): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const n = this.noise()!;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.exponentialRampToValueAtTime(1200, t + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 1.3);
  }

  /** Soft UI tick for buttons. */
  click(): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.05);
  }

  /**
   * Hydrophone: listen to the selected contact. Broadband = cavitation noise
   * amplitude-modulated at the shaft rate; filtered = band-limited to the LOFAR band
   * with the contact's tonals; heterodyne = tonals shifted up by 700 Hz so low
   * machinery lines become audible. Pass undefined to fade out.
   */
  hydrophone(c: HydrophoneInput | undefined): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (!c) {
      if (this.phone) this.phone.gain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    if (!this.phone) {
      const src = this.noise()!;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const amp = ctx.createGain();
      amp.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.connect(lfoGain).connect(amp.gain);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const noiseGain = ctx.createGain();
      src.connect(filter).connect(amp).connect(noiseGain).connect(gain).connect(this.master);
      const tones = Array.from({ length: 6 }, () => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(g).connect(gain);
        o.start();
        return { o, g };
      });
      src.start();
      lfo.start();
      this.phone = { src, filter, gain, lfoGain, lfo, noiseGain, tones };
    }
    const p = this.phone;
    const level = Math.min(0.6, Math.max(0.04, c.se / 25));
    p.gain.gain.setTargetAtTime(level, t, 0.2);
    const modulate = c.shaftHz !== undefined && c.shaftHz > 0.3;
    p.lfo.frequency.setTargetAtTime(modulate ? c.shaftHz! : 0.01, t, 0.3);
    p.lfoGain.gain.setTargetAtTime(modulate ? 0.45 : 0, t, 0.3);
    if (c.mode === 'breitband') {
      p.filter.frequency.setTargetAtTime(600, t, 0.2);
      p.filter.Q.setTargetAtTime(0.3, t, 0.2);
      p.noiseGain.gain.setTargetAtTime(1, t, 0.2);
    } else {
      const [lo, hi] = c.band;
      const shift = c.mode === 'ueberlagerung' ? 700 : 0;
      p.filter.frequency.setTargetAtTime(Math.max(30, (lo + hi) / 2 + shift), t, 0.2);
      p.filter.Q.setTargetAtTime(Math.max(0.5, ((lo + hi) / 2 + shift) / Math.max(10, hi - lo)), t, 0.2);
      p.noiseGain.gain.setTargetAtTime(0.5, t, 0.2);
    }
    const lines = c.mode === 'breitband' ? [] : c.tonals.filter((x) => x.hz >= c.band[0] && x.hz <= c.band[1]);
    p.tones.forEach((tone, i) => {
      const line = lines[i];
      if (!line) return tone.g.gain.setTargetAtTime(0, t, 0.1);
      tone.o.frequency.setTargetAtTime(line.hz + (c.mode === 'ueberlagerung' ? 700 : 0), t, 0.1);
      tone.g.gain.setTargetAtTime(Math.min(0.25, line.snr / 60), t, 0.2);
    });
  }

  /** Drive continuous sounds and fire one-shots for new events in the snapshot. */
  update(s: Snapshot, submarine: boolean): void {
    if (!this.ctx) return;
    this.startHum();
    const h = this.hum!;
    const t = this.ctx.currentTime;
    const sp = s.own.alive ? s.own.speedKn : 0;
    h.gain.gain.setTargetAtTime(Math.min(0.12, 0.02 + sp * (submarine ? 0.004 : 0.006)), t, 0.5);
    h.osc.frequency.setTargetAtTime(38 + sp * 2.2, t, 0.8);
    h.osc2.frequency.setTargetAtTime(76 + sp * 4.4, t, 0.8);
    h.flow.gain.setTargetAtTime(Math.min(0.25, sp * sp * 0.0006), t, 0.5);
    h.flowFilter.frequency.setTargetAtTime(200 + sp * 25, t, 0.5);

    if (s.own.lastPingAt !== undefined && s.own.lastPingAt !== this.lastPing) {
      const firstSeen = this.lastPing < 0;
      this.lastPing = s.own.lastPingAt;
      if (!firstSeen) {
        this.ping(false);
        // Echoes return after 2R/c, scaled to real time
        for (const c of s.contacts) {
          if (c.via !== 'own' || c.rangeAt !== s.own.lastPingAt || c.range === undefined || !c.sensors.includes('active')) continue;
          const delay = (2 * c.range) / 1500 / Math.max(1, s.timeScale) - (s.time - s.own.lastPingAt) / Math.max(1, s.timeScale);
          this.echo(delay, s.own.pulse === 'lfm', c.se, this.panFor(s, c.bearing));
        }
      }
    }
    if (s.torpedoes.length > this.lastTorps) this.launch();
    this.lastTorps = s.torpedoes.length;

    for (const a of s.alerts) {
      const key = `${a.time}|${a.text}`;
      if (this.seenAlerts.has(key)) continue;
      this.seenAlerts.add(key);
      if (s.time - a.time > 3) continue;
      const pan = this.panFor(s, a.bearing);
      if (a.kind === 'torpedo') this.torpedoAlarm(pan);
      else if (a.kind === 'ping') this.ping(true, pan);
      else if (a.kind === 'hit') this.explosion(false, pan);
      else if (a.kind === 'sunk') this.explosion(true);
      else if (a.kind === 'transient') this.transient(pan);
    }
  }

  stopAll(): void {
    void this.ctx?.close();
    this.ctx = undefined;
    this.hum = undefined;
    this.phone = undefined;
    this.seenAlerts.clear();
    this.lastPing = -1;
    this.lastTorps = 0;
  }
}

export const audio = new Audio();
