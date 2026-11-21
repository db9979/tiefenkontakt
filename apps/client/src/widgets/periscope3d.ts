import * as THREE from 'three';
import type { ClassId } from '@tk/shared';

/**
 * 3D periscope view: shader ocean with swell, sky gradient, haze, simple ship
 * models positioned from (filtered) bearing/range, sunk below the horizon by
 * earth curvature. The 2D reticle is drawn on top by the station.
 */

const EARTH_R = 6_371_000;
/** Periscope head above the water at periscope depth (m). */
const EYE = 4;

export interface PeriscopeTarget {
  label: string;
  cls: ClassId;
  bearing: number;
  range: number;
  course?: number;
  speedKn?: number;
  alpha: number;
}

/** A detonation seen through the optic (from a hit/sunk report): water column, smoke, fire. */
export interface PeriscopeEffect {
  id: string;
  bearing: number;
  range: number;
  age: number;
}

const DEFAULT_KN: Partial<Record<ClassId, number>> = { merchant: 9, ffg: 14 };

/** White foam: a wake wedge behind the stern and a small bow wave. */
function wakeMesh(len: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xdfeef0, transparent: true, opacity: 0.45, depthWrite: false });
  const wake = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-6, 0.3, 0), new THREE.Vector3(6, 0.3, 0), new THREE.Vector3(len * 0.35, 0.3, len),
    new THREE.Vector3(-6, 0.3, 0), new THREE.Vector3(len * 0.35, 0.3, len), new THREE.Vector3(-len * 0.35, 0.3, len),
  ]), mat);
  wake.name = 'wake';
  const bow = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(9, 0.5, 14), new THREE.Vector3(-9, 0.5, 14),
  ]), mat);
  bow.name = 'bow';
  g.add(wake, bow);
  return g;
}

const OCEAN_VERT = `
uniform float uTime; uniform float uAmp;
varying vec3 vPos; varying vec3 vNormal;
float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + uTime * s); }
void main() {
  vec3 p = position;
  vec2 xz = (modelMatrix * vec4(p, 1.0)).xz;
  float h = uAmp * (0.55 * wave(xz, normalize(vec2(0.8, 0.6)), 0.045, 1.1)
            + 0.30 * wave(xz, normalize(vec2(-0.4, 0.9)), 0.09, 1.7)
            + 0.15 * wave(xz, normalize(vec2(0.95, -0.3)), 0.21, 2.6));
  p.z += h;
  float e = 0.5;
  float hx = uAmp * 0.55 * wave(xz + vec2(e, 0.0), normalize(vec2(0.8, 0.6)), 0.045, 1.1) - uAmp * 0.55 * wave(xz, normalize(vec2(0.8, 0.6)), 0.045, 1.1);
  float hz = uAmp * 0.30 * wave(xz + vec2(0.0, e), normalize(vec2(-0.4, 0.9)), 0.09, 1.7) - uAmp * 0.30 * wave(xz, normalize(vec2(-0.4, 0.9)), 0.09, 1.7);
  vNormal = normalize(vec3(-hx / e, 1.0, -hz / e));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const OCEAN_FRAG = `
uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSun; uniform vec3 uFog; uniform float uFogDensity; uniform float uLight;
varying vec3 vPos; varying vec3 vNormal;
void main() {
  vec3 view = normalize(cameraPosition - vPos);
  vec3 n = normalize(vNormal);
  float fres = pow(1.0 - max(dot(n, view), 0.0), 4.0);
  vec3 col = mix(uDeep, uSky, clamp(fres * 0.55, 0.0, 1.0));
  vec3 r = reflect(-view, n);
  float spec = pow(max(dot(r, normalize(uSun)), 0.0), 220.0) * uLight;
  col += vec3(1.0, 0.95, 0.85) * spec * 0.8;
  float d = length(cameraPosition - vPos);
  float fog = 1.0 - exp(-pow(d * uFogDensity, 2.0));
  gl_FragColor = vec4(mix(col * uLight, uFog, fog), 1.0);
  #include <colorspace_fragment>
}`;

const SKY_FRAG = `
uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
void main() { float h = clamp(vDir.y * 4.0, 0.0, 1.0); gl_FragColor = vec4(mix(uHorizon, uTop, h), 1.0);
  #include <colorspace_fragment>
}`;
const SKY_VERT = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;

function shipModel(cls: ClassId): THREE.Group {
  const g = new THREE.Group();
  const grey = new THREE.MeshLambertMaterial({ color: cls === 'merchant' ? 0x4a5258 : 0x5a6268, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2e3438, flatShading: true });
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, m = grey) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    b.position.set(x, y, z);
    g.add(b);
  };
  if (cls === 'merchant') {
    box(20, 9, 130, 0, 3, 0, dark);
    box(16, 12, 16, 0, 13, -48);
    box(5, 10, 5, 0, 24, -46, dark);
    for (const z of [-15, 15, 40]) box(1, 18, 1, 0, 17, z, dark);
    box(18, 6, 70, 0, 10, 10, new THREE.MeshLambertMaterial({ color: 0x6b4a3a, flatShading: true }));
  } else if (cls === 'ffg') {
    box(14, 7, 125, 0, 2.5, 0, dark);
    box(11, 9, 40, 0, 10, -5);
    box(6, 6, 10, 0, 17, 0);
    box(1, 20, 1, 0, 28, 2, dark);
    box(8, 1, 1, 0, 34, 2, dark);
    box(3, 3, 8, 0, 8, 48, dark);
  } else {
    box(4, 3, 60, 0, 0.5, 0, dark);
    box(3, 6, 8, 0, 4, 5, dark);
  }
  return g;
}

export class Periscope3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 1, 60_000);
  private ocean: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private hemi = new THREE.HemisphereLight(0xb8c8d0, 0x1a2a30, 1.2);
  private sun = new THREE.DirectionalLight(0xffffff, 1.2);
  private ships = new Map<string, { g: THREE.Group; cls: ClassId; bearing: number }>();
  private sinking: { g: THREE.Group; since: number; y0: number }[] = [];
  private effects = new Map<string, THREE.Group>();
  private stars: THREE.Points;
  private rain: THREE.LineSegments;
  private fire = new THREE.PointLight(0xff7a30, 0, 6000, 1.2);

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x24343b);
    this.camera.rotation.order = 'YXZ';
    this.ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(40_000, 40_000, 320, 320),
      new THREE.ShaderMaterial({
        vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG,
        uniforms: {
          uTime: { value: 0 }, uAmp: { value: 1 }, uDeep: { value: new THREE.Color(0x14303a) }, uSky: { value: new THREE.Color(0x52676f) },
          uSun: { value: new THREE.Vector3(0.3, 0.5, -0.8) }, uFog: { value: new THREE.Color(0x4b5f67) }, uFogDensity: { value: 0.00006 }, uLight: { value: 1 },
        },
      }),
    );
    this.ocean.rotation.x = -Math.PI / 2;
    this.scene.add(this.ocean);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(50_000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
        uniforms: { uTop: { value: new THREE.Color(0x24343b) }, uHorizon: { value: new THREE.Color(0x56707a) } },
      }),
    );
    this.scene.add(this.sky);
    this.sun.position.set(3, 5, -8);
    this.scene.add(this.hemi, this.sun, this.fire);
    // Stars on the upper sky dome (visible only at night)
    const sp: number[] = [];
    for (let i = 0; i < 900; i++) {
      const az = Math.random() * Math.PI * 2;
      const el = Math.asin(Math.random() * 0.95 + 0.02);
      sp.push(Math.cos(el) * Math.sin(az) * 45_000, Math.sin(el) * 45_000, -Math.cos(el) * Math.cos(az) * 45_000);
    }
    this.stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)),
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    this.scene.add(this.stars);
    // Rain: short streaks in a box around the optic, moved every frame
    const rp: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const x = (Math.random() - 0.5) * 120;
      const y = Math.random() * 40;
      const z = -Math.random() * 120;
      rp.push(x, y, z, x + 0.15, y - 2.2, z);
    }
    this.rain = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)),
      new THREE.LineBasicMaterial({ color: 0xb8c8cc, transparent: true, opacity: 0.35, fog: false }));
    this.rain.visible = false;
    this.camera.add(this.rain);
    this.scene.add(this.camera);
  }

  private effectGroup(): THREE.Group {
    const g = new THREE.Group();
    const water = new THREE.Mesh(new THREE.ConeGeometry(14, 90, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xeef6f7, transparent: true, opacity: 0.9 }));
    water.name = 'water';
    water.position.y = 45;
    g.add(water);
    for (let i = 0; i < 7; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2a2c2e, transparent: true, opacity: 0.75 }));
      puff.name = `smoke${i}`;
      g.add(puff);
    }
    return g;
  }

  /** Detonations: a water column that collapses, then a smoke column drifting up and away. */
  private updateEffects(list: PeriscopeEffect[], light: number): void {
    const seen = new Set<string>();
    let glow = 0;
    for (const e of list) {
      seen.add(e.id);
      let g = this.effects.get(e.id);
      if (!g) {
        g = this.effectGroup();
        this.effects.set(e.id, g);
        this.scene.add(g);
        // The ship nearest to the blast in bearing starts to sink once it drops out of the picture
        for (const s of this.ships.values()) if (Math.abs(((s.bearing - e.bearing + 540) % 360) - 180) < 4) (s.g.userData as { doomed?: number }).doomed = e.age;
      }
      const b = (e.bearing * Math.PI) / 180;
      const drop = (e.range * e.range) / (2 * EARTH_R);
      g.position.set(Math.sin(b) * e.range, -drop, -Math.cos(b) * e.range);
      const water = g.getObjectByName('water') as THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
      const rise = Math.min(1, e.age / 2.5);
      const fall = Math.max(0, 1 - Math.max(0, e.age - 4) / 6);
      water.scale.set(1 + e.age * 0.25, Math.max(0.01, rise * fall), 1 + e.age * 0.25);
      water.position.y = 45 * rise * fall;
      water.material.opacity = 0.9 * fall;
      for (let i = 0; i < 7; i++) {
        const puff = g.getObjectByName(`smoke${i}`) as THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>;
        const a = Math.max(0, e.age - 2 - i * 1.5);
        puff.visible = a > 0;
        const r = 8 + a * 2.5 + i * 2;
        puff.scale.setScalar(r);
        puff.position.set(a * 3 + i * 2, 15 + a * 6 + i * 10, Math.sin(i) * 6);
        puff.material.opacity = Math.max(0, 0.75 - a / 120);
      }
      if (e.age < 90) glow = Math.max(glow, (1 - light) * (1 - e.age / 90));
      if (glow > 0) this.fire.position.copy(g.position).setY(20);
    }
    this.fire.intensity = glow * 4;
    for (const [id, g] of this.effects) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.effects.delete(id);
      }
    }
  }

  static supported(): boolean {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  }

  render(o: { bearing: number; fovDeg: number; t: number; sea: number; light: number; targets: PeriscopeTarget[]; rain?: boolean; hour?: number; effects?: PeriscopeEffect[] }): void {
    const w = this.canvas.clientWidth || 400;
    const h = this.canvas.clientHeight || 400;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
    }
    const aspect = w / h;
    this.camera.aspect = aspect;
    const hf = (o.fovDeg * Math.PI) / 180;
    this.camera.fov = (2 * Math.atan(Math.tan(hf / 2) / aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    // Slow swell: the boat (and the optic) heave, pitch and roll
    // Wave amplitude (m) by sea state: SS3 ≈ 1.4 m significant wave height
    const amp = 0.12 + o.sea * 0.2;
    this.camera.position.set(0, EYE + Math.sin(o.t * 0.55) * amp * 0.4, 0);
    this.camera.rotation.y = (-o.bearing * Math.PI) / 180;
    this.camera.rotation.x = Math.sin(o.t * 0.31) * 0.002 * (1 + o.sea);
    this.camera.rotation.z = Math.sin(o.t * 0.4) * 0.004 * (1 + o.sea * 0.6);

    const u = this.ocean.material.uniforms;
    u.uTime!.value = o.t;
    u.uAmp!.value = amp;
    u.uLight!.value = o.light;
    u.uFogDensity!.value = 0.000022 * (1 + o.sea * 0.2);
    const haze = new THREE.Color(0x7f939b).multiplyScalar(0.25 + 0.75 * o.light);
    u.uFog!.value = haze;
    // Dusk and dawn tint the horizon orange; the sun stands low in the west or east
    const dusk = o.light > 0.15 && o.light < 0.9 ? 1 - Math.abs(o.light - 0.5) * 2 : 0;
    const horizon = new THREE.Color(0x8fa3ab).lerp(new THREE.Color(0xd08a5a), dusk * 0.7).multiplyScalar(0.2 + 0.8 * o.light);
    this.sky.material.uniforms.uHorizon!.value = o.rain ? horizon.clone().lerp(new THREE.Color(0x5c666a), 0.6) : horizon;
    this.sky.material.uniforms.uTop!.value = new THREE.Color(0x3d5560).multiplyScalar((0.15 + 0.85 * o.light) * (o.rain ? 0.7 : 1));
    const hour = o.hour ?? 12;
    const sunAz = ((hour - 6) / 12) * Math.PI; // east at 6 h, south at noon, west at 18 h
    const sunEl = Math.max(0.03, Math.sin(((hour - 6) / 12) * Math.PI) * 0.8);
    this.sun.position.set(Math.cos(sunAz) * 10, sunEl * 10, Math.sin(sunAz) * 10);
    u.uSun!.value = this.sun.position.clone().normalize();
    this.sun.color = new THREE.Color(0xffffff).lerp(new THREE.Color(0xffb070), dusk);
    this.hemi.intensity = 0.2 + 1.0 * o.light;
    this.sun.intensity = 1.2 * o.light * (o.rain ? 0.4 : 1);
    (this.stars.material as THREE.PointsMaterial).opacity = o.rain ? 0 : Math.max(0, 1 - o.light * 3) * 0.9;
    const fogDensity = 0.000022 * (1 + o.sea * 0.2) * (o.rain ? 2.2 : 1);
    u.uFogDensity!.value = fogDensity;
    this.scene.fog = new THREE.FogExp2(haze, fogDensity);
    this.rain.visible = !!o.rain;
    if (o.rain) this.rain.position.y = -((o.t * 22) % 30);
    this.updateEffects(o.effects ?? [], o.light);

    const seen = new Set<string>();
    for (const tg of o.targets) {
      seen.add(tg.label);
      let s = this.ships.get(tg.label);
      if (!s || s.cls !== tg.cls) {
        if (s) this.scene.remove(s.g);
        const g = shipModel(tg.cls);
        if (tg.cls !== 'ssk' && tg.cls !== 'ssn') g.add(wakeMesh(180));
        s = { g, cls: tg.cls, bearing: tg.bearing };
        this.ships.set(tg.label, s);
        this.scene.add(s.g);
      }
      s.bearing = tg.bearing;
      // Wake length and bow wave follow the speed
      const kn = tg.speedKn ?? DEFAULT_KN[tg.cls] ?? 0;
      const wake = s.g.getObjectByName('wake');
      if (wake) {
        // Wake trails astern (−z), the bow wave spreads aft from the stem (+z)
        wake.scale.set(1, 1, Math.max(0.05, kn / 10));
        wake.rotation.y = Math.PI;
        wake.position.z = -60;
        const bow = s.g.getObjectByName('bow');
        if (bow) {
          bow.rotation.y = Math.PI;
          bow.position.set(0, 0, 66);
        }
      }
      const b = (tg.bearing * Math.PI) / 180;
      const drop = (tg.range * tg.range) / (2 * EARTH_R) - EYE * 0.5;
      const bob = Math.sin(o.t * 0.5 + tg.label.length) * amp * 0.4;
      s.g.position.set(Math.sin(b) * tg.range, bob - drop, -Math.cos(b) * tg.range);
      // Models are built bow toward +z; turn them so the bow points along the course (north = −z)
      s.g.rotation.y = Math.PI - ((tg.course ?? tg.bearing + 90) * Math.PI) / 180;
      s.g.rotation.z = Math.sin(o.t * 0.45 + tg.range) * 0.02 * (1 + o.sea * 0.5);
      s.g.visible = tg.alpha > 0.05;
    }
    for (const [label, s] of this.ships) {
      if (!seen.has(label)) {
        this.ships.delete(label);
        // A ship hit shortly before it vanished goes down by the bow instead of popping away
        if ((s.g.userData as { doomed?: number }).doomed !== undefined) this.sinking.push({ g: s.g, since: o.t, y0: s.g.position.y });
        else this.scene.remove(s.g);
      }
    }
    this.sinking = this.sinking.filter((k) => {
      const a = o.t - k.since;
      k.g.rotation.x = Math.min(0.35, a * 0.01);
      k.g.position.y = k.y0 - a * 0.35;
      if (a > 90) this.scene.remove(k.g);
      return a <= 90;
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
