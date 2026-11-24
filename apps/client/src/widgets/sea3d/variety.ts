import type * as THREE from 'three';
import type { HullSpec } from './hullkit.js';
import { rng } from './civilkit.js';

/**
 * Variety for merchant and civil models. Every ship gets a seed from her id, so she looks the
 * same each time she is drawn (and her sister ships do not): type within her class, size, how
 * deep she is loaded, how rusty she is, her colours. Without an id (recognition book) the
 * look is the plain textbook one.
 */

export const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;

/** Stable 32-bit seed from an id (FNV-1a). */
export function seedOf(id: string | number): number {
  const s = String(id);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

export interface Look {
  r: () => number;
  seed: number;
  /** False for the recognition book: textbook proportions, laden, clean. */
  varied: boolean;
  /** 0 laden (down to her marks) … 1 in ballast (high, the red bottom showing). */
  ballast: number;
  /** Rust streaks 0..1. */
  rust: number;
}

export function look(id?: string | number): Look {
  if (id === undefined) return { r: rng(1), seed: 1, varied: false, ballast: 0, rust: 0 };
  const seed = seedOf(id);
  const r = rng(seed);
  // Convoys sail mostly laden; a few return in ballast. Most ships are kept up, some are tramps.
  const ballast = r() < 0.25 ? 0.5 + r() * 0.5 : 0;
  const rust = r() < 0.35 ? 0.2 + r() * 0.8 : r() * 0.15;
  return { r, seed, varied: true, ballast, rust };
}

/**
 * Hull spec for this ship: in ballast she floats up to `lift` metres higher (deck, houses and
 * all ride up with the deck) and the boot-top grows into a broad red band; rust and an
 * optional sheer stripe.
 */
export function hullFor(lk: Look, s: HullSpec, lift: number, stripe?: number): HullSpec {
  const up = lk.ballast * lift;
  const [b0, b1] = s.boot ?? [-0.4, 0.6];
  return { ...s, freeboard: s.freeboard + up, draft: s.draft - up, boot: [b0, b1 + up * 0.9], rust: lk.rust, stripe, seed: lk.seed };
}

/** Size within the type: a little longer or shorter, broader or narrower (houses stretch with it). */
export function stretch(g: THREE.Group, lk: Look, len = 0.12, beam = 0.06): void {
  if (!lk.varied) return;
  g.scale.set(1 + (lk.r() * 2 - 1) * beam, 1, 1 + (lk.r() * 2 - 1) * len);
}
