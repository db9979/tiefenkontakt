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
  alpha: number;
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
  private ships = new Map<string, { g: THREE.Group; cls: ClassId }>();

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
    this.scene.add(this.hemi, this.sun);
  }

  static supported(): boolean {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  }

  render(o: { bearing: number; fovDeg: number; t: number; sea: number; light: number; targets: PeriscopeTarget[] }): void {
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
    this.sky.material.uniforms.uHorizon!.value = new THREE.Color(0x8fa3ab).multiplyScalar(0.2 + 0.8 * o.light);
    this.sky.material.uniforms.uTop!.value = new THREE.Color(0x3d5560).multiplyScalar(0.15 + 0.85 * o.light);
    this.hemi.intensity = 0.2 + 1.0 * o.light;
    this.sun.intensity = 1.2 * o.light;
    this.scene.fog = new THREE.FogExp2(haze, 0.000022 * (1 + o.sea * 0.2));

    const seen = new Set<string>();
    for (const tg of o.targets) {
      seen.add(tg.label);
      let s = this.ships.get(tg.label);
      if (!s || s.cls !== tg.cls) {
        if (s) this.scene.remove(s.g);
        s = { g: shipModel(tg.cls), cls: tg.cls };
        this.ships.set(tg.label, s);
        this.scene.add(s.g);
      }
      const b = (tg.bearing * Math.PI) / 180;
      const drop = (tg.range * tg.range) / (2 * EARTH_R) - EYE * 0.5;
      const bob = Math.sin(o.t * 0.5 + tg.label.length) * amp * 0.4;
      s.g.position.set(Math.sin(b) * tg.range, bob - drop, -Math.cos(b) * tg.range);
      s.g.rotation.y = (-(tg.course ?? tg.bearing + 90) * Math.PI) / 180;
      s.g.rotation.z = Math.sin(o.t * 0.45 + tg.range) * 0.02 * (1 + o.sea * 0.5);
      s.g.visible = tg.alpha > 0.05;
    }
    for (const [label, s] of this.ships) {
      if (!seen.has(label)) {
        this.scene.remove(s.g);
        this.ships.delete(label);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
