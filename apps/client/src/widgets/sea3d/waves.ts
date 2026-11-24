import * as THREE from 'three';

/**
 * The sea surface, shared by the GPU (ocean, floes, wakes) and the CPU (ships riding it).
 *
 * Seven wave trains with deep-water dispersion (ω = √(g·k)): the long ones run with the wind,
 * a swell crosses at an angle, short wind waves spread around it. Phases are computed here in
 * double precision from the own position, so the sea stays put on the map while the ship moves
 * through it (water streams past the hull), and the shader only adds small local coordinates.
 * The ocean grid is dense at the eye and coarse far off; short waves fade where the grid or the
 * pixel can no longer carry them, so nothing aliases into crests running the wrong way.
 */

/** Wave numbers (rad/m): twelve trains from 251 m down to 5.7 m wavelength, √2 apart. */
export const WK = Array.from({ length: 12 }, (_, i) => 0.025 * Math.pow(44, i / 11));
const N = WK.length;
/** Direction of each train relative to the wind (degrees): a spread sea, not a few regular rows. */
const SPREAD = [24, -6, 17, -21, 8, -33, 29, -12, 41, -47, 3, 58];
/** Fixed phase of each train, so the trains never line up at one point. */
const PH0 = [0, 2.1, 4.4, 1.3, 5.6, 3.2, 0.7, 4.9, 2.8, 6.0, 1.8, 3.9];
/** First train counted as short wind sea (k ≥ 0.15 rad/m): where it breaks, whitecaps. */
const CHOP0 = WK.findIndex((k) => k >= 0.15);
/**
 * Significant wave height (m) by sea state, WMO code 3700 (upper middle of each band):
 * 1 rippled, 2 smooth, 3 slight (0.5–1.25 m), 4 moderate (1.25–2.5), 5 rough (2.5–4),
 * 6 very rough (4–6), 7 high (6–9).
 */
const HS = [0.05, 0.25, 0.8, 1.6, 2.8, 4.2, 6, 8.5, 11, 14];
export function sigHeight(sea: number): number {
  const s = Math.max(0, Math.min(HS.length - 1, sea));
  const i = Math.min(HS.length - 2, Math.floor(s));
  return HS[i]! + (HS[i + 1]! - HS[i]!) * (s - i);
}

/** Wave number of the spectral peak (rad/m) by sea state. */
function peakK(sea: number): number {
  const P = [0.9, 0.6, 0.38, 0.24, 0.15, 0.1, 0.075, 0.055, 0.045, 0.04];
  const s = Math.max(0, Math.min(P.length - 1, sea));
  const i = Math.min(P.length - 2, Math.floor(s));
  return P[i]! + (P[i + 1]! - P[i]!) * (s - i);
}

/** Default share of the crest height per train (before the first frame). */
const SHARE = WK.map((k) => 1 / (1 + Math.pow(k / 0.08, 1.5)) / 4.1);
const G = 9.81;
/** Wrap of the offset handed to the noise patterns (the noise repeats exactly at this length). */
export const NOISE_WRAP = 32768;

export interface Waves {
  /** Overall crest amplitude (m). */
  amp: number;
  /** Scale of the crest sharpening (keeps the surface from folding). */
  chop: number;
  /** Amplitude share of each train (sums to 1). */
  wa: number[];
  /** Unit direction of travel of each train in scene x/z. */
  wd: [number, number][];
  /** Phase of each train at the scene origin, time included (rad, wrapped). */
  ph: number[];
  /** Downwind unit vector in scene x/z. */
  wind: [number, number];
  /** Own position in scene x/z, wrapped for the noise; and in the wind frame. */
  offR: [number, number];
  offW: [number, number];
}

const wrap = (v: number, m: number): number => v - Math.floor(v / m) * m;

/**
 * The sea for this frame.
 * @param sea sea state 0..9
 * @param windToward wind (m/s, toward) east/north, or none (a default westerly)
 * @param own own position east/north (m)
 * @param t seconds
 */
export function seaWaves(sea: number, windToward: { x: number; y: number } | undefined, own: { x: number; y: number }, t: number): Waves {
  // Scene x = east, scene z = south
  let wx = windToward?.x ?? 0.8;
  let wz = -(windToward?.y ?? 0.6);
  const n = Math.hypot(wx, wz) || 1;
  wx /= n;
  wz /= n;
  const base = Math.atan2(wz, wx);
  // Wind sea: energy peaks at a wavelength that grows with the sea state (about 25 m in a slight
  // sea, 80 m in a rough one, 100+ m very rough), so the sea gets steep, not just long; a little
  // old swell always runs underneath
  const kp = peakK(sea);
  const raw = WK.map((k, i) => {
    const x = Math.log(k / kp) / 0.55;
    return Math.exp(-0.5 * x * x) * (k < kp ? 1 : Math.pow(kp / k, 0.6)) + (k < 0.05 ? 0.06 : 0.012) * (i % 2 ? 0.8 : 1.2);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  const wa = raw.map((s) => s / sum);
  // Crest scale from the WMO significant wave height of the sea state (Hs ≈ 4σ of the summed trains)
  const sigma = Math.sqrt(wa.reduce((a, x) => a + x * x, 0) / 2);
  const amp = sigHeight(sea) / (4 * sigma);
  // Crest sharpening, limited so the surface never folds over itself
  const fold = wa.reduce((a, x, i) => a + Math.min(5 * amp * x, 0.75 / WK[i]!) * WK[i]!, 0);
  const chop = Math.min(1, 0.8 / Math.max(fold, 1e-6));
  const ox = own.x;
  const oz = -own.y;
  const wd: [number, number][] = [];
  const ph: number[] = [];
  WK.forEach((k, i) => {
    const a = base + (SPREAD[i]! * Math.PI) / 180;
    const d: [number, number] = [Math.cos(a), Math.sin(a)];
    wd.push(d);
    ph.push(wrap(k * (d[0] * ox + d[1] * oz) - Math.sqrt(G * k) * t + PH0[i]!, Math.PI * 2));
  });
  return {
    amp, chop, wa, wd, ph, wind: [wx, wz],
    offR: [wrap(ox, NOISE_WRAP), wrap(oz, NOISE_WRAP)],
    offW: [wrap(ox * wx + oz * wz, NOISE_WRAP), wrap(-ox * wz + oz * wx, NOISE_WRAP)],
  };
}

/** Surface height (m) at scene x/z (relative to the eye). */
export function waveHeight(w: Waves, x: number, z: number): number {
  let h = 0;
  for (let i = 0; i < WK.length; i++) h += w.wa[i]! * Math.sin(WK[i]! * (w.wd[i]![0] * x + w.wd[i]![1] * z) + w.ph[i]!);
  return w.amp * h;
}

/**
 * How a hull of length `len` and beam `beam` on `course` (deg) at scene x/z sits on the sea:
 * heave (m), pitch (rad, bow up) and roll (rad, port side up). Long hulls bridge the short waves.
 */
export function hullOnSea(w: Waves, x: number, z: number, course: number, len: number, beam: number): { heave: number; pitch: number; roll: number } {
  const c = (course * Math.PI) / 180;
  const fx = Math.sin(c), fz = -Math.cos(c);
  const rx = Math.cos(c), rz = Math.sin(c);
  const hl = Math.max(4, len / 2);
  const hb = Math.max(3, beam);
  const bow = waveHeight(w, x + fx * hl, z + fz * hl);
  const stern = waveHeight(w, x - fx * hl, z - fz * hl);
  const mid = waveHeight(w, x, z);
  const port = waveHeight(w, x - rx * hb, z - rz * hb);
  const stbd = waveHeight(w, x + rx * hb, z + rz * hb);
  return {
    heave: (bow + stern + 2 * mid + port + stbd) / 6,
    pitch: Math.atan2(bow - stern, 2 * hl),
    roll: Math.atan2(port - stbd, 2 * hb),
  };
}

/**
 * A ship's own roll (rad): the waves excite her at her natural roll period (about 4 s plus 0.4 s
 * per metre of beam), so she swings further than the sea surface tilts, in groups that build
 * and fade over a minute. Big ships roll less; a yacht or tug in a rough sea a lot.
 */
export function ownRoll(sea: number, len: number, beam: number, t: number, phase: number): number {
  const T = 4 + beam * 0.4;
  const deg = Math.min(20, 3.2 * sigHeight(sea)) / (1 + len / 250);
  const group = 0.6 + 0.4 * Math.sin((t * 2 * Math.PI) / 55 + phase * 3.1);
  return ((deg * Math.PI) / 180) * group * Math.sin((t * 2 * Math.PI) / T + phase);
}

/** Uniforms for every material that uses the WAVES chunk. */
export function waveUniforms(): Record<string, THREE.IUniform> {
  return {
    uAmp: { value: 1 },
    uChop: { value: 1 },
    uWa: { value: SHARE.slice() },
    uWd: { value: WK.map(() => new THREE.Vector2(1, 0)) },
    uPh: { value: WK.map(() => 0) },
    uWind: { value: new THREE.Vector2(1, 0) },
    uOffR: { value: new THREE.Vector2() },
    uOffW: { value: new THREE.Vector2() },
  };
}

/** Copy this frame's sea into the shared uniforms. */
export function applyWaves(u: Record<string, THREE.IUniform>, w: Waves): void {
  u.uAmp!.value = w.amp;
  u.uChop!.value = w.chop;
  const wa = u.uWa!.value as number[];
  const ph = u.uPh!.value as number[];
  const wd = u.uWd!.value as THREE.Vector2[];
  for (let i = 0; i < WK.length; i++) {
    wa[i] = w.wa[i]!;
    ph[i] = w.ph[i]!;
    wd[i]!.set(w.wd[i]![0], w.wd[i]![1]);
  }
  (u.uWind!.value as THREE.Vector2).set(w.wind[0], w.wind[1]);
  (u.uOffR!.value as THREE.Vector2).set(w.offR[0], w.offR[1]);
  (u.uOffW!.value as THREE.Vector2).set(w.offW[0], w.offW[1]);
}

/** Half size of the ocean grid (m) and how strongly its cells grow with distance. */
const HALF = 20_000;
const POW = 3;

/**
 * Ocean grid in the x/z plane: x = ±HALF·|u|³, so cells are a few decimetres wide at the eye and
 * kilometres wide at the horizon. Returns the grid and the cell-size law for the shader
 * (cell ≈ a · d^b at distance d).
 */
export function oceanGrid(segments: number): { geo: THREE.BufferGeometry; cell: THREE.Vector2 } {
  const n = segments;
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const f = (u: number) => Math.sign(u) * HALF * Math.abs(u) ** POW;
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      pos[k++] = f((i / n) * 2 - 1);
      pos[k++] = 0;
      pos[k++] = f((j / n) * 2 - 1);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HALF * 1.5);
  // dx/du = POW · HALF^(1/POW) · x^(1 − 1/POW), du = 2/n
  const cell = new THREE.Vector2(POW * HALF ** (1 / POW) * (2 / n), 1 - 1 / POW);
  return { geo, cell };
}

/**
 * GLSL: the wave field. heightLod/slopeLod drop trains shorter than about eight times the given
 * sample spacing (grid cell or pixel footprint), which keeps far water free of aliasing.
 */
export const WAVES_GLSL = `
uniform float uAmp; uniform float uChop; uniform float uWa[${N}]; uniform vec2 uWd[${N}]; uniform float uPh[${N}];
const float WK[${N}] = float[${N}](${WK.map((k) => k.toFixed(4)).join(', ')});
float waveKeep(int i, float s) { float lam = 6.2832 / WK[i]; return 1.0 - smoothstep(lam * 0.15, lam * 0.35, s); }
float heightLod(vec2 p, float s) {
  float h = 0.0;
  for (int i = 0; i < ${N}; i++) h += uWa[i] * waveKeep(i, s) * sin(WK[i] * dot(p, uWd[i]) + uPh[i]);
  return uAmp * h;
}
float height(vec2 p) { return heightLod(p, 0.0); }
/** Gerstner shift: surface points move toward each crest, so crests sharpen and troughs widen. */
vec2 chopShift(vec2 p, float s) {
  vec2 d = vec2(0.0);
  for (int i = 0; i < ${N}; i++) {
    float a = uAmp * uWa[i];
    d -= min(5.0 * a, 0.75 / WK[i]) * waveKeep(i, s) * cos(WK[i] * dot(p, uWd[i]) + uPh[i]) * uWd[i];
  }
  return d * uChop;
}
/** The short trains only, -1..1: where the wind sea is steep enough to break. */
float chopLod(vec2 p, float s) {
  float h = 0.0; float wsum = 0.0;
  for (int i = ${CHOP0}; i < ${N}; i++) { float k = uWa[i] * waveKeep(i, s); h += k * sin(WK[i] * dot(p, uWd[i]) + uPh[i]); wsum += uWa[i]; }
  return h / max(wsum, 0.001);
}
vec2 slopeLod(vec2 p, float s) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${N}; i++) g += uWa[i] * waveKeep(i, s) * WK[i] * cos(WK[i] * dot(p, uWd[i]) + uPh[i]) * uWd[i];
  return uAmp * g;
}`;
