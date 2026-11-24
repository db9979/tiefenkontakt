import * as THREE from 'three';
import { fogAt, type MetCells, type Vec2 } from '@tk/shared';
import { NOISE, WAVES } from './shaders.js';
import { squallFlash } from './sky.js';

/**
 * Local weather in the 3D sea view, from the met cells: low fog banks as volumes you can
 * sail into (a white wall from outside), rain squalls as grey curtains under a dark cloud,
 * icebergs (white-blue, bulk under water) and ice floes riding the swell. The scene is
 * centred on the own ship: x = east, −z = north.
 */

const EARTH_R = 6_371_000;
const FOG_H = 90;
const CLOUD_Y = 700;
const CLOUD_H = 1500;
/** Volume walls continue this far below the sea surface (m). */
const SKIRT = 30;
/** Modelled floes around the eye (m); farther ice is painted into the ocean. */
const FLOE_R = 2400;
const FLOE_CELL = 150;
const FLOE_MAX = 2600;

const VOL_VERT = `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

/** Ray through a vertical cylinder (centre, radius) between heights y0..y0+h: the length inside, mean height. */
const VOL_FRAG = `${NOISE}
uniform vec3 uC; uniform float uR; uniform float uY0; uniform float uH; uniform float uK; uniform vec3 uColor;
uniform float uTime; uniform float uRain; uniform float uFade; uniform vec3 uFog; uniform float uFogDensity;
varying vec3 vW;
void main() {
  vec3 ro = cameraPosition; vec3 rd = normalize(vW - ro);
  vec2 oc = ro.xz - uC.xz; vec2 d = rd.xz;
  float a = dot(d, d); float b = dot(oc, d); float c = dot(oc, oc) - uR * uR;
  float disc = b * b - a * c;
  if (a < 1e-7 || disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = (-b - sq) / a; float t1 = (-b + sq) / a;
  float s0 = -1e9; float s1 = 1e9;
  if (abs(rd.y) > 1e-5) { float ta = (uY0 - ro.y) / rd.y; float tb = (uY0 + uH - ro.y) / rd.y; s0 = min(ta, tb); s1 = max(ta, tb); }
  float e0 = max(max(t0, s0), 0.0); float e1 = min(t1, s1);
  float len = max(0.0, e1 - e0);
  float ym = (ro.y + rd.y * (e0 + e1) * 0.5 - uY0) / uH;
  // Fog thins upward; rain hangs as a curtain that fades into the cloud base
  float w = uRain > 0.5 ? 1.0 - smoothstep(0.75, 1.0, ym) : clamp(1.2 - ym * 1.2, 0.0, 1.0);
  float n = uRain > 0.5
    ? 0.6 + 0.45 * noise(vec2((vW.x + vW.z) * 0.012, vW.y * 0.002 + uTime * 0.6)) + 0.25 * noise(vec2((vW.x - vW.z) * 0.05, vW.y * 0.004 + uTime))
    : 0.75 + 0.5 * fbm(vW.xz * 0.004 + vec2(uTime * 0.01, vW.y * 0.02));
  // Soft sides: fade where the ray only grazes the cylinder
  float tm = -b / a; vec2 cp = (oc + d * tm) / uR;
  float rim = smoothstep(0.0, uRain > 0.5 ? 0.45 : 0.2, 1.0 - dot(cp, cp));
  float alpha = (1.0 - exp(-len * w * uK)) * n * uFade * rim;
  // Seen through the air between: a far shower melts into the haze
  float tr = exp(-e0 * uFogDensity);
  gl_FragColor = vec4(mix(uFog, uColor, tr), clamp(alpha, 0.0, 0.97));
  #include <colorspace_fragment>
}`;

/** Shower cloud: a ray through an ellipsoid with a flat base; ragged, soft edges from noise. */
const CLOUD_FRAG = `${NOISE}
uniform vec3 uC; uniform vec3 uS; uniform float uK; uniform vec3 uColor; uniform vec3 uTop; uniform float uTime; uniform float uFlash; uniform vec3 uFog; uniform float uFogDensity;
varying vec3 vW;
void main() {
  vec3 ro = cameraPosition; vec3 rd = normalize(vW - ro);
  vec3 o = (ro - uC) / uS; vec3 d = rd / uS;
  float a = dot(d, d); float b = dot(o, d); float c = dot(o, o) - 1.0;
  float disc = b * b - a * c;
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = (-b - sq) / a; float t1 = (-b + sq) / a;
  // Flat base at a quarter below the centre
  float yb = uC.y - 0.25 * uS.y;
  if (abs(rd.y) > 1e-5) { float tb = (yb - ro.y) / rd.y; if (rd.y > 0.0) t0 = max(t0, tb); else t1 = min(t1, tb); }
  t0 = max(t0, 0.0);
  float len = max(0.0, t1 - t0);
  vec3 pm = ro + rd * (t0 + t1) * 0.5;
  float n = fbm(pm.xz * 0.0025 + pm.y * 0.003 + vec2(uTime * 0.002, 0.0));
  // Ragged rim: how close the ray passes to the edge, broken up by noise
  float tm = -b / a;
  float rim = 1.0 - dot(o + d * tm, o + d * tm);
  float alpha = (1.0 - exp(-len * uK)) * smoothstep(0.0, 0.55, rim + (n - 0.5) * 0.7);
  float hgt = clamp((pm.y - yb) / (1.25 * uS.y), 0.0, 1.0);
  // Lightning lights the cloud from inside, brightest low in the core
  vec3 col = mix(uColor, uTop, hgt * hgt) + vec3(0.75, 0.8, 1.0) * uFlash * (1.0 - hgt * 0.6) * (0.6 + 0.8 * n);
  col = mix(uFog, col, exp(-t0 * uFogDensity * 0.6));
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.97));
  #include <colorspace_fragment>
}`;

const FLOE_VERT = `${WAVES}
varying vec3 vW; varying vec3 vN;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 c = m * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 wp = m * vec4(position, 1.0);
  wp.y += height(c.xz);
  vN = normalize(mat3(m) * normal);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FLOE_FRAG = `
uniform vec3 uSun; uniform float uLight; uniform vec3 uFog; uniform float uFogDensity;
varying vec3 vW; varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  float diff = 0.6 + 0.4 * max(dot(n, normalize(uSun)), 0.0);
  vec3 col = (n.y > 0.6 ? vec3(0.9, 0.94, 0.96) : vec3(0.5, 0.72, 0.78)) * diff * (0.12 + 0.88 * uLight * uLight);
  float d = length(cameraPosition - vW);
  gl_FragColor = vec4(mix(col, uFog, 1.0 - exp(-d * uFogDensity)), 1.0);
  #include <colorspace_fragment>
}`;

/** Small deterministic hash 0..1. */
function hash(a: number, b: number, c = 0): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function volume(rain: boolean, air: Record<string, THREE.IUniform>): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> {
  const g = new THREE.CylinderGeometry(1, 1, 1, 48, 1, false).translate(0, 0.5, 0);
  return new THREE.Mesh(g, new THREE.ShaderMaterial({
    vertexShader: VOL_VERT, fragmentShader: VOL_FRAG, transparent: true, depthWrite: false,
    uniforms: {
      uC: { value: new THREE.Vector3() }, uR: { value: 1 }, uY0: { value: 0 }, uH: { value: 1 }, uK: { value: 0.004 },
      uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uRain: { value: rain ? 1 : 0 }, uFade: { value: 1 }, uFog: air.uFog!, uFogDensity: air.uFogDensity!,
    },
  }));
}

/** Iceberg: a lumpy dome or tabular block above water and a wider bulk below (bow +z irrelevant). */
function bergMesh(id: number, r: number, h: number, draft: number): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col: number[] = [];
  const tabular = hash(id, 1) > 0.5;
  const top = new THREE.Color(0xf2f8fb), shade = new THREE.Color(0xb3d7e6), under = new THREE.Color(0x4f9fb0);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Smooth lumps and gullies (neighbouring vertices move together), a little fine roughness
    const n = 0.5 + 0.3 * Math.sin(x * 3.1 + id) * Math.sin(z * 2.6 + id * 1.7) + 0.2 * Math.sin(y * 5 + x * 2 + id);
    const lump = 1 + (n - 0.5) * 0.4 + (hash(Math.round(x * 9), Math.round(y * 9), Math.round(z * 9) + id) - 0.5) * 0.05;
    if (y >= 0) {
      const yy = tabular ? Math.min(1, y * 2.2) : Math.pow(y, 0.8);
      pos.setXYZ(i, x * r * lump * (tabular ? 1 : 1 - y * 0.3), yy * h * (0.85 + n * 0.3), z * r * lump);
      const c = top.clone().lerp(shade, n * 0.6 + (1 - y) * 0.25);
      col.push(c.r, c.g, c.b);
    } else {
      pos.setXYZ(i, x * r * 1.45 * lump, y * draft, z * r * 1.45 * lump);
      const c = shade.clone().lerp(under, Math.min(1, -y * 3));
      col.push(c.r, c.g, c.b);
    }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.55, metalness: 0, flatShading: true, emissive: new THREE.Color(0x3a6070), emissiveIntensity: 0.5,
  }));
  m.rotation.y = hash(id, 2) * Math.PI * 2;
  return m;
}

/** An irregular floe outline (jittered radius), 0.7 m thick, top at y = 0.35. */
function floeGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.75 + 0.45 * hash(i, 7);
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false });
  g.rotateX(-Math.PI / 2).translate(0, -0.35, 0);
  return g;
}

interface FloeSet { mesh: THREE.InstancedMesh; at: Vec2; fieldId: number }

export class WeatherFx {
  private fogs = new Map<number, THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>>();
  private squalls = new Map<number, { curtain: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>; cloud: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> }>();
  private bergs = new Map<number, THREE.Mesh>();
  private floes = new Map<number, FloeSet>();
  private floeMat: THREE.ShaderMaterial;

  constructor(private scene: THREE.Scene, private ocean: THREE.ShaderMaterial) {
    const u = ocean.uniforms;
    this.floeMat = new THREE.ShaderMaterial({
      vertexShader: FLOE_VERT, fragmentShader: FLOE_FRAG,
      uniforms: { uAmp: u.uAmp!, uChop: u.uChop!, uWa: u.uWa!, uWd: u.uWd!, uPh: u.uPh!, uSun: u.uSun!, uLight: u.uLight!, uFog: u.uFog!, uFogDensity: u.uFogDensity! },
    });
    u.uIce = { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) };
  }

  /** Place everything for this frame; returns the fog density at the eye (0..1). */
  update(met: MetCells | undefined, own: Vec2 | undefined, t: number, light: number): number {
    const m = own ? met : undefined;
    const rel = (x: number, y: number) => ({ x: x - own!.x, z: -(y - own!.y), drop: ((x - own!.x) ** 2 + (y - own!.y) ** 2) / (2 * EARTH_R) });
    const lit = 0.06 + 0.94 * light * light;
    // Fog banks
    this.sync(this.fogs, m?.fog ?? [], () => volume(false, this.ocean.uniforms), (mesh, f) => {
      const p = rel(f.x, f.y);
      const u = mesh.material.uniforms;
      // Walls reach below the waves so the sea surface (not the wall) is what the eye sees downward
      mesh.position.set(p.x, -p.drop - SKIRT, p.z);
      mesh.scale.set(f.r, FOG_H + SKIRT, f.r);
      u.uC!.value.set(p.x, 0, p.z); u.uR!.value = f.r; u.uY0!.value = -p.drop; u.uH!.value = FOG_H;
      u.uK!.value = 0.0042 * f.d; u.uTime!.value = t;
      (u.uColor!.value as THREE.Color).setHex(0xc4cdd1).multiplyScalar(lit);
      const inside = Math.hypot(p.x, p.z) < f.r;
      mesh.material.side = inside ? THREE.BackSide : THREE.FrontSide;
      mesh.visible = Math.hypot(p.x, p.z) - f.r < 30_000;
    });
    // Rain squalls: curtain and cloud
    this.sync(this.squalls, m?.squalls ?? [], (s) => {
      const curtain = volume(true, this.ocean.uniforms);
      // The shower cloud: a dark-based heap with ragged edges
      const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
        vertexShader: VOL_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
        uniforms: { uC: { value: new THREE.Vector3() }, uS: { value: new THREE.Vector3() }, uK: { value: 0.0012 }, uColor: { value: new THREE.Color() }, uTop: { value: new THREE.Color() }, uTime: { value: 0 }, uFlash: { value: 0 }, uFog: this.ocean.uniforms.uFog!, uFogDensity: this.ocean.uniforms.uFogDensity! },
      }));
      this.scene.add(cloud);
      return { curtain, cloud };
    }, (o, s) => {
      const p = rel(s.x, s.y);
      const u = o.curtain.material.uniforms;
      o.curtain.position.set(p.x, -p.drop - SKIRT, p.z);
      o.curtain.scale.set(s.r, CLOUD_Y + SKIRT, s.r);
      u.uC!.value.set(p.x, 0, p.z); u.uR!.value = s.r; u.uY0!.value = -p.drop; u.uH!.value = CLOUD_Y; u.uK!.value = 0.0006; u.uTime!.value = t;
      (u.uColor!.value as THREE.Color).setHex(0x6d777c).multiplyScalar(lit);
      o.curtain.material.side = Math.hypot(p.x, p.z) < s.r ? THREE.BackSide : THREE.FrontSide;
      const cu = o.cloud.material.uniforms;
      // Centre a quarter of the height above the base, which sits just below the curtain top
      const cy = CLOUD_Y - 60 + CLOUD_H * 0.25 - p.drop;
      o.cloud.position.set(p.x, cy, p.z);
      o.cloud.scale.set(s.r * 1.4, CLOUD_H, s.r * 1.4);
      cu.uC!.value.set(p.x, cy, p.z); (cu.uS!.value as THREE.Vector3).set(s.r * 1.4, CLOUD_H, s.r * 1.4); cu.uTime!.value = t;
      cu.uFlash!.value = squallFlash(s.id, t);
      (cu.uColor!.value as THREE.Color).setHex(0x434b50).multiplyScalar(lit);
      (cu.uTop!.value as THREE.Color).setHex(0xa3adb2).multiplyScalar(lit);
      o.cloud.material.side = Math.hypot(p.x, p.z) < s.r * 1.4 ? THREE.BackSide : THREE.FrontSide;
      o.curtain.visible = o.cloud.visible = Math.hypot(p.x, p.z) - s.r < 35_000;
      // Under the shower the sky goes overcast and the haze closes in (sky.ts): the walls only hint at it
      const inside = Math.hypot(p.x, p.z) < s.r;
      u.uFade!.value = inside ? 0.2 : 1;
      if (inside) o.cloud.visible = false;
    }, (o) => this.scene.remove(o.cloud), (o) => o.curtain);
    // Icebergs
    this.sync(this.bergs, m?.bergs ?? [], (b) => bergMesh(b.id, b.r, b.h, b.draft), (mesh, b) => {
      const p = rel(b.x, b.y);
      mesh.position.set(p.x, -p.drop + Math.sin(t * 0.2 + b.id) * 0.3, p.z);
      mesh.visible = Math.hypot(p.x, p.z) < 30_000;
    });
    // Floes: painted pack ice in the ocean shader, modelled floes close by
    const ice = this.ocean.uniforms.uIce!.value as THREE.Vector4[];
    const fields = m?.floes ?? [];
    ice.forEach((v, i) => {
      const f = fields[i];
      if (!f) return v.set(0, 0, 0, 0);
      const p = rel(f.x, f.y);
      v.set(p.x, p.z, f.r, f.cover);
    });
    const near = new Set<number>();
    for (const f of fields) {
      const p = rel(f.x, f.y);
      if (Math.hypot(p.x, p.z) > f.r + FLOE_R + 1000) continue;
      near.add(f.id);
      let set = this.floes.get(f.id);
      // Rebuild the instances when the eye has moved well inside the modelled window
      const local = { x: own!.x - f.x, y: own!.y - f.y };
      if (!set || Math.hypot(local.x - set.at.x, local.y - set.at.y) > 600) {
        if (set) { this.scene.remove(set.mesh); set.mesh.dispose(); }
        set = { mesh: this.buildFloes(f.id, f.r, f.cover, local), at: local, fieldId: f.id };
        this.floes.set(f.id, set);
        this.scene.add(set.mesh);
      }
      set.mesh.position.set(p.x, 0.12, p.z);
    }
    for (const [id, set] of this.floes) {
      if (near.has(id)) continue;
      this.scene.remove(set.mesh);
      set.mesh.dispose();
      this.floes.delete(id);
    }
    return own ? fogAt(m, own) : 0;
  }

  /** Floes in field coordinates (they drift with the field) in a window around the eye. */
  private buildFloes(id: number, r: number, cover: number, at: Vec2): THREE.InstancedMesh {
    const geo = floeGeometry();
    const mesh = new THREE.InstancedMesh(geo, this.floeMat, FLOE_MAX);
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), mat = new THREE.Matrix4();
    let n = 0;
    const c0x = Math.floor((at.x - FLOE_R) / FLOE_CELL), c1x = Math.floor((at.x + FLOE_R) / FLOE_CELL);
    const c0y = Math.floor((at.y - FLOE_R) / FLOE_CELL), c1y = Math.floor((at.y + FLOE_R) / FLOE_CELL);
    for (let cx = c0x; cx <= c1x && n < FLOE_MAX; cx++) {
      for (let cy = c0y; cy <= c1y && n < FLOE_MAX; cy++) {
        const x0 = cx * FLOE_CELL, y0 = cy * FLOE_CELL;
        const d = Math.hypot(x0, y0);
        const k = Math.min(1, Math.max(0, (r - d) / 2000 + 0.5)) * cover;
        if (k <= 0.02 || Math.hypot(x0 - at.x, y0 - at.y) > FLOE_R) continue;
        const count = Math.floor(k * 12 + hash(cx, cy, id));
        for (let j = 0; j < count && n < FLOE_MAX; j++) {
          const x = x0 + hash(cx, cy, j * 3 + 1) * FLOE_CELL, y = y0 + hash(cx, cy, j * 3 + 2) * FLOE_CELL;
          const size = 3 + 16 * hash(cx, cy, j * 3 + 3) ** 3;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(cx, j, cy) * Math.PI * 2);
          s.set(size * (0.7 + 0.6 * hash(j, cx, cy)), 1, size);
          p.set(x, 0, -y);
          mesh.setMatrixAt(n++, mat.compose(p, q, s));
        }
      }
    }
    mesh.count = n;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  private sync<C extends { id: number }, O>(
    map: Map<number, O>, cells: readonly C[], make: (c: C) => O, place: (o: O, c: C) => void,
    drop?: (o: O) => void, obj: (o: O) => THREE.Object3D = (o) => o as unknown as THREE.Object3D,
  ): void {
    const seen = new Set<number>();
    for (const c of cells) {
      seen.add(c.id);
      let o = map.get(c.id);
      if (!o) {
        o = make(c);
        map.set(c.id, o);
        this.scene.add(obj(o));
      }
      place(o, c);
    }
    for (const [id, o] of map) {
      if (seen.has(id)) continue;
      this.scene.remove(obj(o));
      drop?.(o);
      map.delete(id);
    }
  }
}
