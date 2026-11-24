import * as THREE from 'three';
import { inSquall, type MetCells, type Vec2 } from '@tk/shared';
import { NOISE } from './shaders.js';

/**
 * Sky and precipitation of the 3D sea view. The cloud deck lies on a plane about 1.8 km up,
 * fixed to the map (own position added) and drifting downwind; its cover follows the weather:
 * a few fair-weather clouds in a calm, a broken deck in a stiff breeze, overcast under and near
 * rain squalls. Clouds are lit from the sun side (bright tops, grey bases, silver lining), the
 * sky has a sun halo, a dusk glow on the sun's side only and a haze band at the horizon that
 * widens in rain and fog. Stars only show through gaps. Rain falls in streaks slanted by the
 * wind and the ship's own speed; in cold water it snows. Showers with thunder flash.
 */

const CLOUD_H = 1800;
/** Metres per cloud noise unit. */
const CLOUD_SCALE = 2500;
/** The cloud noise repeats every 1024 units (hash period), twice that for the warp. */
const CLOUD_WRAP = 2048;

export const CLOUD_GLSL = `
uniform vec2 uCloudOff; uniform float uCover;
float cloudThr() { return mix(0.8, 0.12, uCover); }
float cloudDens(vec2 p) {
  vec2 w = vec2(fbm(p * 0.5 + vec2(3.1, 1.7)), fbm(p * 0.5 + vec2(7.7, 4.2)));
  float n = fbm(p + w * 1.4);
  float t = cloudThr();
  return smoothstep(t - 0.05, t + 0.16, n);
}
vec2 cloudUv(vec3 d) { return d.xz / max(d.y, 0.02) * ${(CLOUD_H / CLOUD_SCALE).toFixed(4)} + uCloudOff; }
/** Cover seen in direction d; low down only the mean (the pattern would flicker), a little denser. */
float cloudAt(vec3 d) {
  if (d.y <= 0.0) return 0.0;
  float far = smoothstep(0.03, 0.22, d.y);
  float mean = clamp(uCover * 1.25, 0.0, 1.0);
  return mix(mean, cloudDens(cloudUv(d)), far);
}`;

const SKY_VERT = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = `${NOISE}${CLOUD_GLSL}
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uHaze; uniform vec3 uSun; uniform vec3 uMoon; uniform vec3 uSunCol;
uniform float uLight; uniform float uSunUp; uniform float uDusk; uniform float uOvercast; uniform float uHazeK; uniform float uFlash;
uniform vec2 uWindDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float lit = 0.05 + 0.95 * uLight * uLight;
  vec3 sd = normalize(uSun);
  float s = max(dot(d, sd), 0.0);
  // Blue overhead, pale toward the horizon
  vec3 col = mix(uHorizon, uTop, pow(clamp(h * 2.4, 0.0, 1.0), 0.55));
  // Dusk: a warm band low on the sun's side, fading round to the far side
  float az = dot(normalize(d.xz + 1e-5), normalize(sd.xz + 1e-5)) * 0.5 + 0.5;
  vec3 glow = (mix(vec3(1.0, 0.38, 0.12), vec3(1.0, 0.7, 0.35), pow(az, 12.0) * (1.0 - h)) * pow(1.0 - h, 7.0) * pow(az, 3.0) * 1.5
    + vec3(0.9, 0.45, 0.3) * pow(1.0 - h, 3.0) * pow(az, 1.5) * 0.15) * uDusk * (1.0 - 0.75 * uOvercast) * (lit + 0.3);
  col += glow;
  // Halo round the sun (forward scattering), then the disc
  float clear = 1.0 - 0.85 * uOvercast;
  col += uSunCol * (pow(s, 6.0) * 0.18 + pow(s, 60.0) * 0.35) * uSunUp * clear;
  col += vec3(1.0, 0.92, 0.78) * smoothstep(0.99975, 0.9999, s) * 5.0 * uSunUp * (1.0 - uOvercast * 0.95);
  float m = max(dot(d, normalize(uMoon)), 0.0);
  col += vec3(0.85, 0.88, 0.95) * (smoothstep(0.99955, 0.9997, m) + pow(m, 200.0) * 0.08) * (1.0 - uSunUp) * (1.0 - uOvercast);
  // High cirrus: thin streaks along the wind in fair weather
  if (d.y > 0.0) {
    vec2 p = d.xz / max(d.y, 0.05) * 0.25 + uCloudOff * 0.37;
    vec2 q = vec2(dot(p, uWindDir), dot(p, vec2(-uWindDir.y, uWindDir.x)));
    float ci = smoothstep(0.55, 0.85, fbm(q * vec2(0.5, 5.0))) * smoothstep(0.05, 0.4, d.y) * (1.0 - uCover);
    col = mix(col, vec3(0.92, 0.94, 0.96) * lit, ci * 0.35);
  }
  // Cumulus / stratus deck, lit from the sun side
  float c = cloudAt(d);
  if (c > 0.0) {
    float toward = d.y > 0.03 ? cloudDens(cloudUv(d) + normalize(sd.xz + 1e-5) * 0.12) : c;
    float shade = clamp(0.62 + (c - toward) * 1.6 * (1.0 - 0.75 * uOvercast) - uOvercast * 0.35, 0.0, 1.0);
    vec3 base = mix(vec3(0.5, 0.54, 0.57), vec3(0.3, 0.33, 0.36), uOvercast);
    vec3 top = mix(vec3(0.97, 0.97, 0.96), vec3(0.62, 0.66, 0.69), uOvercast);
    vec3 cc = mix(base, top, shade);
    // Dusk lights the cloud undersides on the sun's side
    cc = mix(cc, cc * vec3(1.35, 0.85, 0.6), uDusk * pow(az, 2.0) * 0.8 * (1.0 - uOvercast));
    // Silver lining where thin cloud covers the sun
    cc += uSunCol * pow(s, 14.0) * (1.0 - c) * 1.2 * uSunUp;
    cc *= lit;
    cc += vec3(0.55, 0.6, 0.75) * uFlash;
    col = mix(col, cc, c);
  }
  // Haze toward the horizon: a thin band in clear air, a wall in rain and fog
  float hz = exp(-h * uHazeK);
  col = mix(col, uHaze, d.y < 0.0 ? 1.0 : hz) + glow * hz * 0.8;
  col += vec3(0.35, 0.38, 0.45) * uFlash * hz;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const STAR_VERT = `uniform float uPx; varying vec3 vDir; void main() { vDir = normalize(position); gl_PointSize = uPx; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;
const STAR_FRAG = `${NOISE}${CLOUD_GLSL}
uniform float uStars; varying vec3 vDir;
void main() {
  float a = uStars * (1.0 - cloudAt(normalize(vDir))) * smoothstep(0.02, 0.15, vDir.y);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0), a);
}`;

/** Drops or flakes in a box around the eye; the box offset wraps, so they never run out. */
const PRECIP_VERT = (snow: boolean) => `
attribute float aEnd;
uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uOff; uniform vec3 uVel; uniform float uStreak; uniform float uTime;
varying float vFade;
void main() {
  vec3 p = mod(position * uBox + uOff - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  ${snow ? 'p.x += sin(uTime * 1.3 + position.y * 40.0) * 0.5; p.z += cos(uTime * 1.1 + position.x * 40.0) * 0.5;' : ''}
  vec3 wp = uCam + p - uVel * uStreak * aEnd;
  float d = length(p);
  vFade = smoothstep(0.8, 3.0, d) * (1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, d));
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  ${snow ? 'gl_PointSize = clamp(110.0 / -mv.z, 1.5, 6.0);' : ''}
}`;
const PRECIP_FRAG = (snow: boolean) => `
uniform vec3 uColor; uniform float uOpacity; varying float vFade;
void main() {
  ${snow ? 'if (length(gl_PointCoord - 0.5) > 0.5) discard;' : ''}
  gl_FragColor = vec4(uColor, uOpacity * vFade);
}`;

function precip(snow: boolean): THREE.LineSegments | THREE.Points {
  const n = snow ? 4000 : 5000;
  const pos: number[] = [], end: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    pos.push(x, y, z);
    end.push(0);
    if (!snow) { pos.push(x, y, z); end.push(1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.Float32BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: PRECIP_VERT(snow), fragmentShader: PRECIP_FRAG(snow), transparent: true, depthWrite: false,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uBox: { value: snow ? new THREE.Vector3(60, 40, 60) : new THREE.Vector3(50, 36, 50) },
      uOff: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uStreak: { value: 0.1 }, uTime: { value: 0 },
      uColor: { value: new THREE.Color() }, uOpacity: { value: 0 },
    },
  });
  const o = snow ? new THREE.Points(g, mat) : new THREE.LineSegments(g, mat);
  o.frustumCulled = false;
  o.visible = false;
  return o;
}

const frac = (x: number) => x - Math.floor(x);
const wrap = (x: number, p: number) => x - Math.floor(x / p) * p;

/** Lightning in a shower cloud (0..1): about one double flash a minute, not every shower has thunder. */
export function squallFlash(id: number, t: number): number {
  if (id % 3 === 0) return 0;
  const slot = Math.floor(t / 1.5);
  if (frac(Math.sin(slot * 12.9898 + id * 78.233) * 43758.5453) < 0.975) return 0;
  const f = t / 1.5 - slot;
  return f < 0.05 ? 1 : f > 0.1 && f < 0.15 ? 0.75 : f < 0.3 ? 0.12 * (1 - f / 0.3) : 0;
}

export interface SkyInput {
  t: number; light: number; hour: number; sea: number; rain: boolean;
  /** Fog density at the eye (0..1). */
  inFog: number;
  met?: MetCells; own: Vec2; ownKn: number; ownHeading: number; camera: THREE.Camera;
}

/** What the rest of the scene takes from the sky. */
export interface SkyLight {
  sunDir: THREE.Vector3; moonDir: THREE.Vector3; sunUp: number; sunColor: THREE.Color;
  /** Fog colour, and what the sea mirrors at a grazing look. */
  haze: THREE.Color; reflect: THREE.Color; reflectTop: THREE.Color;
  dusk: number; overcast: number; precip: number; flash: number; fogDensity: number;
}

export class SkyFx {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private rain = precip(false);
  private snow = precip(true);
  private cloud: Record<string, THREE.IUniform> = { uCloudOff: { value: new THREE.Vector2() }, uCover: { value: 0.3 } };
  private last = -1;
  private precipK = 0;
  private overK = -1;
  private off = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(50_000, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          ...this.cloud,
          uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() },
          uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
          uLight: { value: 1 }, uSunUp: { value: 1 }, uDusk: { value: 0 }, uOvercast: { value: 0 }, uHazeK: { value: 40 },
          uFlash: { value: 0 }, uWindDir: { value: new THREE.Vector2(1, 0) },
        },
      }),
    );
    const sp: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const az = Math.random() * Math.PI * 2;
      const el = Math.asin(Math.random() * 0.95 + 0.02);
      sp.push(Math.cos(el) * Math.sin(az) * 45_000, Math.sin(el) * 45_000, -Math.cos(el) * Math.cos(az) * 45_000);
    }
    this.stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)),
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false,
        uniforms: { ...this.cloud, uStars: { value: 0 }, uPx: { value: 1.6 } },
      }));
    this.stars.frustumCulled = false;
    scene.add(this.mesh, this.stars, this.rain, this.snow);
  }

  update(o: SkyInput): SkyLight {
    const dt = this.last < 0 ? 0 : Math.min(2, Math.max(0, o.t - this.last));
    this.last = o.t;
    const met = o.met;
    // Scene: x = east, z = −north
    const wind = met?.wind ?? { x: 5, y: 2 };
    const wsx = wind.x, wsz = -wind.y;
    const wspd = Math.hypot(wsx, wsz) || 1;
    // Cloud cover: fair-weather cumulus in a calm, more with the wind, overcast near showers
    let near = 0;
    for (const s of met?.squalls ?? []) {
      const d = Math.hypot(s.x - o.own.x, s.y - o.own.y) - s.r;
      near = Math.max(near, 1 - Math.max(0, d) / 18_000);
    }
    const wet = o.rain || inSquall(met, o.own) ? 1 : 0;
    const overTarget = Math.min(1, Math.max(0.12 + (o.sea - 1) * 0.11, near * 0.85, wet * 0.95, o.inFog * 0.9));
    if (this.overK < 0) { this.overK = overTarget; this.precipK = wet; }
    this.overK += (overTarget - this.overK) * Math.min(1, dt * 0.05);
    this.precipK += (wet - this.precipK) * Math.min(1, dt * 0.3);
    const over = this.overK;
    const pr = this.precipK;
    // Clouds fixed to the map, drifting with the wind aloft
    const cu = this.cloud.uCloudOff!.value as THREE.Vector2;
    cu.set(wrap((o.own.x - wsx * 1.5 * o.t) / CLOUD_SCALE, CLOUD_WRAP), wrap((-o.own.y - wsz * 1.5 * o.t) / CLOUD_SCALE, CLOUD_WRAP));
    this.cloud.uCover!.value = Math.min(1, over * 1.05);

    const light = o.light;
    const lit = 0.06 + 0.94 * light * light;
    const dusk = light > 0.15 && light < 0.9 ? 1 - Math.abs(light - 0.5) * 2 : 0;
    const sunAz = ((o.hour - 6) / 12) * Math.PI;
    const sunEl = Math.sin(((o.hour - 6) / 12) * Math.PI) * 0.8;
    const sunDir = new THREE.Vector3(Math.cos(sunAz), sunEl, Math.sin(sunAz)).normalize();
    const moonDir = new THREE.Vector3(-Math.cos(sunAz), 0.35, -Math.sin(sunAz)).normalize();
    const sunUp = Math.max(0, Math.min(1, sunEl * 6 + 0.2)) * (1 - 0.95 * over) * (1 - 0.8 * o.inFog);
    const sunColor = new THREE.Color(0xfff4e0).lerp(new THREE.Color(0xffa060), dusk);

    let flash = 0;
    for (const s of met?.squalls ?? []) {
      const d = Math.hypot(s.x - o.own.x, s.y - o.own.y);
      flash = Math.max(flash, squallFlash(s.id, o.t) * Math.max(0, 1 - d / 25_000));
    }
    flash *= 0.25 + 0.75 * (1 - light);

    const grey = new THREE.Color(0x8a9399);
    const horizon = new THREE.Color(0xb4c4cb).lerp(new THREE.Color(0xd9a07a), dusk * 0.6).lerp(grey, over * 0.8).multiplyScalar(lit);
    const top = new THREE.Color(0x3f6f92).lerp(new THREE.Color(0x66717a), over).multiplyScalar(lit * (1 - 0.3 * pr));
    const haze = new THREE.Color(0x93a5ad).lerp(new THREE.Color(0x737d82), pr * 0.7).lerp(new THREE.Color(0xc4cdd1), o.inFog)
      .lerp(new THREE.Color(0xc89a80), dusk * 0.25 * (1 - over)).multiplyScalar(lit);
    const su = this.mesh.material.uniforms;
    (su.uTop!.value as THREE.Color).copy(top);
    (su.uHorizon!.value as THREE.Color).copy(horizon);
    (su.uHaze!.value as THREE.Color).copy(haze);
    (su.uSunCol!.value as THREE.Color).copy(sunColor);
    (su.uSun!.value as THREE.Vector3).copy(sunDir);
    (su.uMoon!.value as THREE.Vector3).copy(moonDir);
    (su.uWindDir!.value as THREE.Vector2).set(wsx / wspd, wsz / wspd);
    su.uLight!.value = light;
    su.uSunUp!.value = sunUp;
    su.uDusk!.value = dusk;
    su.uOvercast!.value = over;
    su.uHazeK!.value = THREE.MathUtils.lerp(THREE.MathUtils.lerp(45, 14, Math.max(pr, over * 0.5)), 2, o.inFog);
    su.uFlash!.value = flash;
    this.stars.material.uniforms.uStars!.value = Math.max(0, 1 - light * 3) * 0.9;
    this.stars.material.uniforms.uPx!.value = Math.min(2, window.devicePixelRatio || 1) * 1.2;

    // Precipitation around the eye: drops fall at 8 m/s, flakes at 1.2; both drift with the wind
    // and stream past the moving ship
    const snowy = (met?.floes.length ?? 0) + (met?.bergs.length ?? 0) > 0;
    const h = (o.ownHeading * Math.PI) / 180;
    const ship = o.ownKn * 0.514;
    const cam = o.camera.getWorldPosition(new THREE.Vector3());
    for (const [obj, on, fall, drift] of [[this.rain, !snowy, 8, 0.6], [this.snow, snowy, 1.2, 0.8]] as const) {
      const u = (obj.material as THREE.ShaderMaterial).uniforms;
      obj.visible = on && pr > 0.02;
      if (!obj.visible) continue;
      const vel = (u.uVel!.value as THREE.Vector3).set(wsx * drift - Math.sin(h) * ship, -fall, wsz * drift + Math.cos(h) * ship);
      const box = u.uBox!.value as THREE.Vector3;
      this.off.addScaledVector(vel, dt);
      this.off.set(wrap(this.off.x, box.x), wrap(this.off.y, box.y), wrap(this.off.z, box.z));
      (u.uOff!.value as THREE.Vector3).copy(this.off);
      (u.uCam!.value as THREE.Vector3).copy(cam);
      u.uTime!.value = o.t % 1000;
      (u.uColor!.value as THREE.Color).setHex(snowy ? 0xf4f8fa : 0xb4c3ca).multiplyScalar(0.15 + 0.85 * lit + flash);
      u.uOpacity!.value = pr * (snowy ? 0.85 : 0.32);
    }

    // Haze thickens with rain and overcast; a fog bank closes in to a few hundred metres
    const fogDensity = THREE.MathUtils.lerp(0.000022 * (1 + o.sea * 0.2) * (1 + 4 * pr + 0.6 * over), 0.0019, o.inFog);
    const reflect = horizon.clone().lerp(top, 0.25).lerp(haze, 0.3);
    const reflectTop = top.clone().lerp(horizon, 0.25);
    return { sunDir, moonDir, sunUp, sunColor, haze, reflect, reflectTop, dusk, overcast: over, precip: pr, flash, fogDensity };
  }
}
