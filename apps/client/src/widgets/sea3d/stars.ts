import * as THREE from 'three';
import { NOISE } from './shaders.js';
import { equToScene, faintStars, GAL_CENTRE, GAL_POLE, siderealDeg, starCatalog, type SkyPlace } from './astro.js';

/**
 * The fixed stars over the sea: the bright-star catalogue in its real places (astro.ts). Size and
 * brightness follow the magnitude (few bright, many faint), the colour the B-V index; extinction dims
 * and reddens them toward the horizon, where they twinkle hardest and vanish in the haze. They fade in
 * with the sun's depression, thin out in moonlight and are hidden by the cloud deck, fog and rain.
 * Through the glasses more of them show, but they stay points.
 */

/** Stars sit this far out (inside the sky dome, within the camera's far plane). */
const R = 45_000;

const STAR_VERT = (cloud: string) => `${NOISE}${cloud}
attribute float aMag; attribute float aBV;
uniform mat3 uRot; uniform float uLim; uniform float uPx; uniform float uGain; uniform float uTime;
uniform float uExt; uniform float uHazeK; uniform vec3 uMoon; uniform float uMoonK;
varying vec3 vCol; varying float vA; varying float vSize; varying float vSig;
vec3 bvColour(float bv) {
  vec3 c = mix(vec3(0.66, 0.76, 1.0), vec3(0.9, 0.93, 1.0), smoothstep(-0.3, 0.1, bv));
  c = mix(c, vec3(1.0, 0.95, 0.86), smoothstep(0.1, 0.65, bv));
  c = mix(c, vec3(1.0, 0.8, 0.6), smoothstep(0.65, 1.6, bv));
  return c;
}
void main() {
  vec3 d = uRot * position;
  float s = max(d.y, 0.0);
  // Air mass (Kasten-Young-like): 1 overhead, about 38 at the horizon
  float X = 1.0 / (s + 0.025 * exp(-11.0 * s));
  float m = aMag + uExt * (X - 1.0);
  // The moon lifts the sky's glow: fewer faint stars, none right beside it
  float lim = uLim - uMoonK * (0.4 + 3.0 * pow(max(dot(d, uMoon), 0.0), 12.0));
  // Below the horizon or too faint: nothing to draw (most of the faint scatter, most of the time)
  if (d.y < 0.0 || m > lim + 0.3) { vA = 0.0; vSize = 0.0; gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float ph = fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  float amp = 0.08 + 0.55 * pow(1.0 - s, 5.0);
  float tw = 1.0 + amp * (0.6 * sin(uTime * 7.3 + ph) + 0.4 * sin(uTime * 17.9 + ph * 3.7));
  // Seen brightness grows much slower than the flux (a power of about 0.3); magnitude 1 = 1
  float p = pow(10.0, -0.12 * (m - 1.0)) * tw;
  float hz = exp(-s * uHazeK);
  float vis = smoothstep(lim + 0.3, lim - 0.5, m) * (1.0 - hz) * smoothstep(0.0, 0.035, d.y) * (1.0 - cloudAt(d)) * uGain;
  vA = clamp(p * 1.25, 0.0, 1.0) * vis;
  // Colour shows in the bright ones only; low down the air reddens them
  vec3 c = mix(vec3(0.92, 0.94, 1.0), bvColour(aBV), clamp(0.35 + 0.35 * p, 0.0, 0.85));
  vCol = c * mix(vec3(1.0), vec3(1.0, 0.78, 0.55), clamp((X - 1.0) / 12.0, 0.0, 1.0));
  // A point spread of about a pixel for the faint ones, a little wider for the bright (device pixels)
  vSig = uPx * (0.62 + 0.3 * clamp(p, 0.0, 2.6));
  vSize = vA < 0.004 ? 0.0 : ceil(vSig * 6.0) + 1.0;
  gl_PointSize = vSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + d * ${R.toFixed(1)}, 1.0);
}`;

const STAR_FRAG = `
varying vec3 vCol; varying float vA; varying float vSize; varying float vSig;
void main() {
  // A soft round point: Gaussian core in device pixels, a faint glow round the bright ones
  float r = length(gl_PointCoord - 0.5) * vSize;
  if (r > vSize * 0.5) discard;
  float a = (exp(-r * r / (2.0 * vSig * vSig)) + 0.06 * max(vA - 0.6, 0.0) * exp(-r / (1.5 * vSig))) * vA;
  gl_FragColor = vec4(vCol, a);
}`;

/** What the sky tells the stars each frame. */
export interface StarInput {
  /** Where and when (the ship's clock as local solar time). */
  place: SkyPlace; hour: number; t: number;
  /** Sun elevation (degrees) and the scene's daylight (0..1). */
  sunEl: number; light: number;
  /** Moon direction (scene) and how much of it shows (0..1). */
  moonDir: THREE.Vector3; moon: number;
  /** Overcast, rain and fog (0..1), haze steepness of the sky dome. */
  overcast: number; precip: number; fog: number; hazeK: number;
  /** Optic: horizontal field of view (degrees) and the canvas's pixel ratio. */
  fovDeg: number; dpr: number;
}

/** Faintest magnitude the sky shows with the sun this far below the horizon and this much light. */
export function limitingMag(sunEl: number, light: number): number {
  const bySun = -1 + Math.max(0, -sunEl - 3) * 0.45;
  const byLight = 5 - Math.max(0, light - 0.13) * 30;
  return Math.max(-2, Math.min(5, bySun, byLight));
}

export class StarField {
  /** The catalogue's stars, and the faint scatter (drawn only when the optic or the dark reaches past V 4.6). */
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly faint: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Scene vectors of the galactic pole and centre (Milky Way in the sky dome). */
  readonly galPole = new THREE.Vector3(0, 1, 0);
  readonly galCentre = new THREE.Vector3(1, 0, 0);
  private rot = new THREE.Matrix3();

  constructor(cloud: Record<string, THREE.IUniform>, cloudGlsl: string) {
    const geo = (c: { pos: Float32Array; mag: Float32Array; bv: Float32Array }) => new THREE.BufferGeometry()
      .setAttribute('position', new THREE.BufferAttribute(c.pos, 3))
      .setAttribute('aMag', new THREE.BufferAttribute(c.mag, 1))
      .setAttribute('aBV', new THREE.BufferAttribute(c.bv, 1));
    this.points = new THREE.Points(geo(starCatalog()), new THREE.ShaderMaterial({
      vertexShader: STAR_VERT(cloudGlsl), fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: {
        ...cloud,
        uRot: { value: this.rot }, uLim: { value: 5 }, uPx: { value: 1 }, uGain: { value: 0 }, uTime: { value: 0 },
        uExt: { value: 0.25 }, uHazeK: { value: 40 }, uMoon: { value: new THREE.Vector3(0, 1, 0) }, uMoonK: { value: 0 },
      },
    }));
    this.faint = new THREE.Points(geo(faintStars()), this.points.material);
    for (const p of [this.points, this.faint]) {
      p.frustumCulled = false;
      p.renderOrder = -1;
    }
  }

  /** Places the sky and sets the stars' visibility; returns how dark and clear the sky is for the Milky Way (0..1). */
  update(o: StarInput): number {
    const m = equToScene(o.place.lat, siderealDeg(o.place.month, o.hour), o.place.turn);
    this.rot.set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!);
    this.galPole.set(...GAL_POLE).applyMatrix3(this.rot);
    this.galCentre.set(...GAL_CENTRE).applyMatrix3(this.rot);
    // Glasses and periscope gather more light: fainter stars, a little bigger, still points
    const mag = Math.max(1, 55 / Math.max(1, o.fovDeg));
    const lim = limitingMag(o.sunEl, o.light) + 2.5 * Math.log10(mag);
    const clear = (1 - o.precip) * (1 - Math.min(1, o.fog * 1.5)) * (1 - THREE.MathUtils.smoothstep(o.overcast, 0.8, 0.97));
    const u = this.points.material.uniforms;
    u.uLim!.value = lim;
    u.uGain!.value = clear * Math.min(1.6, Math.pow(mag, 0.25));
    u.uPx!.value = o.dpr * (1 + 0.12 * Math.log2(mag));
    u.uTime!.value = o.t % 1000;
    // Extinction per air mass: clean maritime air 0.25 mag, more in haze
    u.uExt!.value = 0.25 + 0.3 * Math.min(1, o.precip + o.fog + o.overcast * 0.3);
    u.uHazeK!.value = o.hazeK * 1.4;
    (u.uMoon!.value as THREE.Vector3).copy(o.moonDir);
    u.uMoonK!.value = o.moon;
    this.points.visible = clear > 0.01 && lim > -1.6;
    this.faint.visible = this.points.visible && lim - 0.4 * o.moon > 4.5;
    // Milky Way: only well after twilight, on a clear night; the moon washes most of it out
    return clear * THREE.MathUtils.smoothstep(lim, 3.8, 4.8) * (1 - 0.6 * o.moon);
  }
}
