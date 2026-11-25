import type { Fx } from './audio-fx.js';

/**
 * Weather you can hear on deck: wind rising with the sea state (gusts, a howl in the rigging
 * in a gale), the wash of the sea along the hull in the rhythm of the waves, rain drumming on
 * steel, and thunder rolling in after the lightning, about three seconds per kilometre late.
 * Below the surface a submarine hears none of it, at periscope depth only the slap of the sea.
 */

interface Loop { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode }

export interface WeatherHearing {
  /** 1 on deck or bridge, 0.25 at periscope depth (hull slap only), 0 deeper. */
  exposure: number;
  seaState: number;
  /** Wind speed (m/s). */
  windMs: number;
  /** Rain 0..1. */
  rain: number;
}

export class WeatherSound {
  private wind: Loop;
  private howl: Loop;
  private wash: Loop;
  private rain: Loop;
  private t0: number;

  constructor(private fx: Fx, private dest: AudioNode) {
    const c = fx.ctx;
    this.t0 = c.currentTime;
    this.wind = this.loop('bandpass', 500, 0.7);
    this.howl = this.loop('bandpass', 900, 9);
    this.wash = this.loop('lowpass', 380, 0.8);
    this.rain = this.loop('highpass', 2600, 0.5);
  }

  private loop(type: BiquadFilterType, hz: number, q: number): Loop {
    const c = this.fx.ctx;
    const src = c.createBufferSource();
    src.buffer = this.fx.noise;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = hz;
    filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.dest);
    src.start(0, Math.random() * this.fx.noise.duration);
    return { src, gain, filter };
  }

  /** Follow the weather (called with every snapshot; changes glide). */
  update(h: WeatherHearing): void {
    const c = this.fx.ctx;
    const t = c.currentTime;
    const e = Math.max(0, Math.min(1, h.exposure));
    const deck = e >= 0.9 ? 1 : 0;
    // Gusts: two slow beats; the wind gets louder and brighter with its speed
    const gust = 0.7 + 0.2 * Math.sin((t - this.t0) * 0.45) + 0.1 * Math.sin((t - this.t0) * 1.7);
    const w = Math.min(1, h.windMs / 25);
    this.wind.gain.gain.setTargetAtTime(deck * (0.004 + 0.05 * w * w) * gust, t, 0.6);
    this.wind.filter.frequency.setTargetAtTime(350 + 700 * w * gust, t, 0.6);
    // Howl in the rigging from about Beaufort 7
    this.howl.gain.gain.setTargetAtTime(deck * Math.max(0, w - 0.55) * 0.05 * gust, t, 0.8);
    this.howl.filter.frequency.setTargetAtTime(700 + 500 * gust, t, 0.8);
    // The sea along the hull, swelling with each passing wave (period grows with the sea)
    const period = 3 + h.seaState * 1.1;
    const wave = 0.5 + 0.5 * Math.sin(((t - this.t0) * 2 * Math.PI) / period);
    const sea = Math.min(1, h.seaState / 6);
    this.wash.gain.gain.setTargetAtTime(e * (0.006 + 0.05 * sea) * (0.35 + 0.65 * wave), t, 0.4);
    // Rain on deck and on the bridge windows
    this.rain.gain.gain.setTargetAtTime(deck * 0.05 * Math.max(0, Math.min(1, h.rain)), t, 1.2);
  }

  /** Lightning `distanceM` away: thunder after the sound's travel time, duller and fainter far off. */
  thunder(distanceM: number, exposure: number): void {
    if (exposure < 0.9 || distanceM > 25_000) return;
    const c = this.fx.ctx;
    const at = c.currentTime + distanceM / 343;
    const near = Math.max(0, 1 - distanceM / 25_000);
    const src = c.createBufferSource();
    src.buffer = this.fx.noise;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120 + 900 * near * near;
    const g = c.createGain();
    // A crack when close, then the long rolling rumble
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.02 + 0.25 * near * near, at + 0.05 + 0.4 * (1 - near));
    g.gain.exponentialRampToValueAtTime(0.03 * (0.3 + near), at + 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 4 + 4 * (1 - near));
    src.connect(lp).connect(g).connect(this.dest);
    src.start(at, Math.random() * this.fx.noise.duration);
    src.stop(at + 9);
  }

  stop(): void {
    for (const l of [this.wind, this.howl, this.wash, this.rain]) l.src.stop();
  }
}
