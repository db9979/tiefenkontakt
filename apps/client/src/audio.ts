import { detonation, makeReverb, motor, sinkingNoises, sonarPing, torpedoLaunch, type Fx } from './audio-fx.js';
import { inSquall, type Snapshot } from '@tk/shared';
import { WeatherSound } from './audio-weather.js';
import { SonarVoice, type SonarHearing } from './audio-sonar.js';
import { breakUpSequence } from './audio-sinking.js';
import { Diesel, seekerPing, wireSnap } from './audio-boat.js';
import { onLightning } from './widgets/lightning.js';
import { Aboard } from './audio-aboard.js';

export type ListenMode = 'breitband' | 'gefiltert' | 'ueberlagerung';


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
  private sonar?: SonarVoice;
  private fx?: Fx;
  private mastMotor?: (on: number) => void;
  private winch?: (on: number) => void;
  private lastMastExt?: number;
  private lastTowed?: number;
  private aboard?: Aboard;
  private lastOrder?: number;
  private engineChangedAt = 0;
  private seenAlerts = new Set<string>();
  private lastPing = -1;
  private lastTorps = 0;
  private diesel?: Diesel;
  private wired = new Set<string>();
  private seeker?: { bearing?: number; at: number };
  private nextSeekerAt = 0;
  private weather?: WeatherSound;
  private timeScale = 1;
  /** How much of the weather the crew hears (1 on deck … 0 deep down). */
  private exposure = 0;
  muted = localStorage.getItem('tk_muted') === '1';
  volume = Number(localStorage.getItem('tk_volume') ?? '0.7');

  /** Silent looping <audio>: on iOS it moves the page into the "playback" audio session, so the ringer switch does not silence Web Audio. */
  private keepAwake?: HTMLAudioElement;

  /**
   * Must be called from a user gesture (browser autoplay rules). Safe to call on every gesture: it
   * creates the context once and resumes it whenever the browser suspended or interrupted it
   * (iOS does so after a call, a lock or a tab switch). On iOS only touchend/click count as a
   * gesture, so installUnlock() listens to those too.
   */
  unlock(): void {
    if (!this.ctx) this.create();
    const ctx = this.ctx!;
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try {
      if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
    } catch { /* older browsers */ }
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => undefined);
      // Classic iOS unlock: start a one-sample silent buffer inside the gesture
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    }
    if (!nav.audioSession && /iP(hone|ad|od)|Macintosh.*Mobile/.test(navigator.userAgent)) {
      this.keepAwake ??= Object.assign(document.createElement('audio'), { src: silentWav(), loop: true, playsInline: true });
      if (this.keepAwake.paused) void this.keepAwake.play().catch(() => undefined);
    }
  }

  /** True once the browser lets the page make sound. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  private create(): void {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    // A gentle limiter before the speakers: explosions next to a quiet hydrophone never clip
    const lim = this.ctx.createDynamicsCompressor();
    lim.threshold.value = -10;
    lim.knee.value = 6;
    lim.ratio.value = 8;
    lim.attack.value = 0.003;
    lim.release.value = 0.25;
    this.master.connect(lim).connect(this.ctx.destination);
    // Long noise buffer: loops are not heard as a pattern
    const len = this.ctx.sampleRate * 9;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.fx = { ctx: this.ctx, noise: this.noiseBuf, reverb: makeReverb(this.ctx, this.master) };
  }

  setMuted(m: boolean): void {
    this.muted = m;
    // Switching sound on is a gesture: make sure the context really runs
    if (!m) this.unlock();
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
    const dur = this.noiseBuf.duration;
    const start = s.start.bind(s);
    s.start = ((when = 0, offset?: number, d?: number) => (d === undefined ? start(when, offset ?? Math.random() * dur) : start(when, offset ?? Math.random() * dur, d))) as typeof s.start;
    return s;
  }

  private startHum(): void {
    if (!this.ctx || !this.master || this.hum) return;
    const c = this.ctx;
    const gain = c.createGain();
    gain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const osc = c.createOscillator();
    // Soft machinery: a triangle through a low-pass, not a buzzing sawtooth
    osc.type = 'triangle';
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
  ping(distant = false, pan = 0, lfm = false): void {
    if (!this.ctx || !this.master) return;
    if (this.fx) return sonarPing(this.fx, this.out(pan), distant, lfm);
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

  /** Short console chime before a crew report: 'info' rising, 'warn' falling. */
  chime(kind: 'info' | 'warn' = 'info'): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'info' ? 880 : 1175, t);
    o.frequency.setValueAtTime(kind === 'info' ? 1175 : 880, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.out(0));
    o.start(t);
    o.stop(t + 0.3);
  }

  /** FLASH order from fleet command: a teletype burst (two groups of three high beeps). */
  flash(): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = 1568;
    g.gain.value = 0;
    for (let i = 0; i < 6; i++) {
      const at = t + i * 0.12 + (i >= 3 ? 0.25 : 0);
      g.gain.setValueAtTime(0.045, at);
      g.gain.setValueAtTime(0, at + 0.07);
    }
    o.connect(g).connect(this.out(0));
    o.start(t);
    o.stop(t + 1.2);
  }

  /** Depth / ground-clearance alarm: two soft beeps for a warning, three sharp ones for danger. */
  depthAlarm(danger: boolean): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = danger ? 'square' : 'triangle';
    o.frequency.value = danger ? 990 : 520;
    g.gain.value = 0;
    const n = danger ? 3 : 2;
    for (let i = 0; i < n; i++) {
      g.gain.setValueAtTime(danger ? 0.05 : 0.07, t + i * 0.22);
      g.gain.setValueAtTime(0, t + i * 0.22 + 0.14);
    }
    o.connect(g).connect(this.out(0));
    o.start(t);
    o.stop(t + n * 0.22 + 0.05);
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
  /** Another ship going down: the long break-up on the hydrophone. */
  sinking(pan = 0): void {
    if (!this.ctx || !this.master || !this.fx) return this.explosion(true);
    breakUpSequence(this.fx, this.out(pan));
  }

  explosion(near: boolean, pan = 0): void {
    if (!this.ctx || !this.master) return;
    if (this.fx) {
      detonation(this.fx, this.out(pan), near);
      // A ship that was hit breaks up audibly a few seconds later (not our own hull)
      if (!near) sinkingNoises(this.fx, this.out(pan), 3 + Math.random() * 2, 0.22);
      return;
    }
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
  /** An echo of our own ping; closingKn shifts its pitch (CW: higher when the target closes, the operator hears the Doppler). */
  echo(delayS: number, lfm: boolean, strength: number, pan = 0, closingKn = 0): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime + Math.max(0, delayS);
    const o = c.createOscillator();
    o.type = 'sine';
    // Two-way Doppler: 1 + 2v/c
    const dop = 1 + (2 * closingKn * 0.5144) / 1500;
    if (lfm) {
      o.frequency.setValueAtTime(3300 * dop, t);
      o.frequency.linearRampToValueAtTime(3700 * dop, t + 0.25);
    } else o.frequency.value = 3500 * dop;
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
    if (this.fx) return torpedoLaunch(this.fx, this.master);
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
   * Hydrophone: the sea and the selected contact in the operator's headphones (audio-sonar.ts).
   * Pass undefined to fade out.
   */
  hydrophone(c: SonarHearing | undefined): void {
    if (!this.fx || !this.master) return;
    this.sonar ??= new SonarVoice(this.fx, this.master);
    this.sonar.update(c);
    // Torpedoes in the water the own ship knows of, besides the contact listened to
    this.sonar.ear.update(c ? this.aboard?.heardTorpedo : undefined, c?.voice === 'torpedo', this.timeScale);
  }

  /** Drive continuous sounds and fire one-shots for new events in the snapshot. */
  update(s: Snapshot, submarine: boolean): void {
    if (!this.ctx) return;
    this.startHum();
    const h = this.hum!;
    const t = this.ctx.currentTime;
    const sp = s.own.alive ? s.own.speedKn : 0;
    // The ear gets used to a steady drone: loud only for a while after the engine order changes
    const order = s.own.order.speedKn;
    if (this.lastOrder === undefined || Math.abs(order - this.lastOrder) > 0.4) this.engineChangedAt = t;
    this.lastOrder = order;
    const swell = Math.exp(-(t - this.engineChangedAt) / 12);
    const on = localStorage.getItem('tk_engine') !== '0';
    const level = Math.min(0.05, 0.006 + sp * (submarine ? 0.0015 : 0.0025)) * (0.3 + 0.7 * swell);
    h.gain.gain.setTargetAtTime(on ? level : 0, t, 0.8);
    h.osc.frequency.setTargetAtTime(38 + sp * 2.2, t, 0.8);
    h.osc2.frequency.setTargetAtTime(76 + sp * 4.4, t, 0.8);
    h.flow.gain.setTargetAtTime(on ? Math.min(0.08, sp * sp * 0.0002) : 0, t, 0.8);
    h.flowFilter.frequency.setTargetAtTime(200 + sp * 25, t, 0.5);

    if (s.own.lastPingAt !== undefined && s.own.lastPingAt !== this.lastPing) {
      const firstSeen = this.lastPing < 0;
      this.lastPing = s.own.lastPingAt;
      if (!firstSeen) {
        this.ping(false, 0, s.own.pulse === 'lfm');
        // Echoes return after 2R/c, scaled to real time
        for (const c of s.contacts) {
          if (c.via !== 'own' || c.rangeAt !== s.own.lastPingAt || c.range === undefined || !c.sensors.includes('active')) continue;
          const delay = (2 * c.range) / 1500 / Math.max(1, s.timeScale) - (s.time - s.own.lastPingAt) / Math.max(1, s.timeScale);
          this.echo(delay, s.own.pulse === 'lfm', c.se, this.panFor(s, c.bearing), c.dopplerKn ?? 0);
        }
      }
    }
    this.timeScale = Math.max(1, s.timeScale);
    this.ambience(s, submarine);
    this.aboard ??= new Aboard(this.fx!, this.master!, (p) => this.out(p));
    this.aboard.update(s, submarine, on, swell);
    // A guidance wire parting: the torpedo is still running, but no longer on the wire
    for (const t of s.torpedoes) if (!t.wire && this.wired.has(t.id) && this.fx) wireSnap(this.fx, this.out(0.3));
    this.wired = new Set(s.torpedoes.filter((t) => t.wire).map((t) => t.id));
    // An incoming torpedo's seeker pings for about a minute after the warning, faster as it closes
    if (this.seeker && s.time - this.seeker.at < 60 && this.fx && this.ctx) {
      const now = this.ctx.currentTime;
      if (now >= this.nextSeekerAt) {
        const k = (s.time - this.seeker.at) / 60;
        seekerPing(this.fx, this.out(this.panFor(s, this.seeker.bearing)), 0.05 + 0.15 * k);
        this.nextSeekerAt = now + Math.max(0.35, 1.6 - k * 1.3) / Math.max(1, s.timeScale);
      }
    }
    if (s.torpedoes.length > this.lastTorps) this.launch();
    this.lastTorps = s.torpedoes.length;

    for (const a of s.alerts) {
      const key = `${a.time}|${a.text}`;
      if (this.seenAlerts.has(key)) continue;
      this.seenAlerts.add(key);
      if (s.time - a.time > 3) continue;
      this.aboard?.alert(a);
      const pan = this.panFor(s, a.bearing);
      if (a.kind === 'torpedo') {
        this.torpedoAlarm(pan);
        this.seeker = { bearing: a.bearing, at: a.time };
      }
      else if (a.kind === 'ping') this.ping(true, pan);
      // Another ship: a detonation, or (her sinking after the hit) the long break-up
      else if (a.kind === 'hit') (a.sink ? this.sinking(pan) : this.explosion(false, pan));
      // Own ship: a mine or a hit is a blast; running aground is a long grinding scrape, no explosion
      else if (a.kind === 'sunk') (/GRUND/.test(a.text) ? this.fx && sinkingNoises(this.fx, this.out(0), 0, 0.35) : this.explosion(true));
      // A depth charge going off: a deep, muffled blast; other transients their own sound
      else if (a.kind === 'transient') (/WASSERBOMBE/.test(a.text) && this.fx ? detonation(this.fx, this.out(pan), false) : this.transient(pan));
    }
  }

  /** Mast hydraulics, the towed-array winch and hull creaks under pressure. */
  private ambience(s: Snapshot, submarine: boolean): void {
    if (!this.fx || !this.master) return;
    this.mastMotor ??= motor(this.fx, this.master, 190, 0.6);
    // Snorkel diesel: runs while the snorkel head is up
    this.diesel ??= new Diesel(this.fx, this.master);
    this.diesel.set(!!this.aboard?.diesel(s), s.own.speedKn);
    this.winch ??= motor(this.fx, this.master, 95, 0.25);
    const ext = s.own.mastExt ?? (s.own.mastUp ? 1 : 0);
    this.mastMotor(this.lastMastExt !== undefined && Math.abs(ext - this.lastMastExt) > 0.001 ? 1 : 0);
    this.lastMastExt = ext;
    const tow = s.own.towedLength;
    this.winch(this.lastTowed !== undefined && tow !== this.lastTowed ? 1 : 0);
    this.lastTowed = tow;
    // Weather on deck: wind, sea, rain, thunder (a submarine below hears none of it)
    if (!this.weather) {
      this.weather = new WeatherSound(this.fx, this.master);
      onLightning((d) => this.weather?.thunder(d, this.exposure));
    }
    this.exposure = !submarine ? 1 : s.own.depth < 2 ? 1 : s.own.depth < 20 ? 0.25 : 0;
    const met = s.env.met;
    const windMs = met ? Math.hypot(met.wind.x, met.wind.y) : 2 + s.env.seaState * 2.6;
    this.weather.update({
      exposure: s.own.alive ? this.exposure : 0, seaState: s.env.seaState, windMs,
      rain: s.env.rain || inSquall(met, s.own) ? 1 : 0,
    });
  }

  stopAll(): void {
    void this.ctx?.close();
    this.ctx = undefined;
    this.fx = undefined;
    this.mastMotor = undefined;
    this.winch = undefined;
    this.hum = undefined;
    this.sonar = undefined;
    this.weather = undefined;
    this.aboard = undefined;
    this.diesel = undefined;
    onLightning(undefined);
    this.seenAlerts.clear();
    this.lastPing = -1;
    this.lastTorps = 0;
  }
}

export const audio = new Audio();

/** Half a second of silence as a WAV data URI (8 kHz, 8 bit). */
function silentWav(): string {
  const n = 4000;
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const str = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  b.fill(128, 44);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** Unlock sound on every kind of gesture (iOS only accepts touchend/click, desktop pointerdown/keydown). */
export function installUnlock(signal?: AbortSignal): void {
  const go = () => audio.unlock();
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, go, { capture: true, signal });
}
