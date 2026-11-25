/**
 * How a signal looks on the sonar displays (broadband waterfall, LOFAR, DEMON): brightness on a
 * dB scale instead of a level that saturates early, slow fading from multipath (every contact
 * and every line drifts up and down by a few dB on its own), weak signals that show only in
 * pieces, and strong sources that spread into the neighbouring beams.
 */

/** Displayed brightness 0..1 for a signal excess in dB: −6 dB is invisible, +26 dB full. */
export function dbToAmp(db: number, lo = -6, hi = 26): number {
  const x = Math.max(0, Math.min(1, (db - lo) / (hi - lo)));
  return Math.pow(x, 0.85);
}

/** Beam spread in display bins (degrees on the waterfall): about 1.2° main lobe, wider for loud sources. */
export function beamWidth(db: number): number {
  return 1.2 + 2.6 * Math.max(0, Math.min(1, (db - 12) / 18));
}

/** A weak signal breaks up: chance (0..1) that it shows in one row. */
export function showChance(db: number): number {
  return 1 / (1 + Math.exp(-(db - 1) / 1.6));
}

function gauss(): number {
  return Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
}

/**
 * Slow fading per key (contact label, "label|hz" for a line): a random walk in dB, about
 * ±5 dB, correlated over tens of seconds of sim time.
 */
export class Fader {
  private state = new Map<string, { v: number; t: number }>();

  at(key: string, t: number): number {
    let s = this.state.get(key);
    if (!s) this.state.set(key, (s = { v: gauss() * 2, t }));
    const steps = Math.min(30, Math.max(0, Math.floor(t - s.t)));
    for (let i = 0; i < steps; i++) s.v = Math.max(-6, Math.min(6, s.v * 0.96 + gauss() * 0.7));
    if (steps) s.t += steps;
    if (this.state.size > 300) this.state.clear();
    return s.v;
  }
}
