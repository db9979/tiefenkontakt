import * as THREE from 'three';
import { NOISE } from './shaders.js';
import { WAVES_GLSL } from './waves.js';
import { wakeUniforms } from './wake.js';

/**
 * White water around the own ship as her bridge sees it (the generic wake is made to be seen
 * from afar): the bow wave breaking white at the stem and peeling off both sides at about 18°,
 * broken water between it and the hull, a skirt of foam along the whole waterline, and astern
 * the churned propeller wash with the two quarter waves opening from the transom corners. All
 * of it lies on the moving sea (same wave field as the ocean grid); the foam texture is fixed
 * to the water (own position added), so it streams aft as she drives through it, while the
 * shape of the waves stays with the hull. Strength and length follow the speed.
 */

const VERT = (stern: boolean) => `${WAVES_GLSL}
uniform vec2 uCell; uniform float uK; uniform float uLen; uniform float uB; uniform float uStern;
attribute vec3 aw;
varying vec3 vW; varying vec3 vPos;
void main() {
  ${stern
    ? `// Astern: u across (−1 … 1), v along (0 at the transom … 1 at the end), sized by speed
  float d = aw.y * uLen;
  float hw = uB * 0.6 + d * 0.4 + 1.0;
  vec4 wp = modelMatrix * vec4(aw.x * hw, 0.0, uStern + 0.8 - d, 1.0);
  vW = vec3(aw.x * hw, d, 0.0);`
    : `vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = aw;`}
  float r = max(max(abs(wp.x), abs(wp.z)), 1.0);
  float cell = uCell.x * pow(r, uCell.y);
  wp.y = heightLod(wp.xz, cell) + 0.1;
  wp.xz += chopShift(wp.xz, cell);
  ${stern
    ? '// The wash heaps up right behind the transom\n  wp.y += uK * 0.5 * exp(-d / 7.0) * (1.0 - smoothstep(0.0, uB * 0.5, vW.x));'
    : '// The bow wave stands up against the stem and the forward shoulders\n  wp.y += uK * 1.1 * exp(-max(aw.x, 0.0) / 1.5) * exp(-aw.y / 9.0);'}
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = (stern: boolean) => `${NOISE}
uniform float uTime; uniform float uLight; uniform vec2 uOffR; uniform vec3 uFog; uniform float uFogDensity;
uniform float uK; uniform float uKn; uniform float uLen; uniform float uB; uniform vec2 uFwd;
varying vec3 vW; varying vec3 vPos;
void main() {
  // Where the foam can be (before any noise, so open water costs nothing), and a darker trough
  float a, dark = 0.0, dense = 0.0;
  ${stern
    ? `float X = abs(vW.x), d = vW.y;
  // Churned wash about the beam wide, its edge wandering, very white near the transom and slowly calming astern
  float cw = (uB * 0.42 + d * 0.06) * (0.85 + 0.3 * noise(vec2(d * 0.04, vW.x > 0.0 ? 1.0 : 7.0)));
  float life = exp(-d / (12.0 + 3.0 * uKn));
  float churn = 1.0 - smoothstep(cw * 0.35, cw * 1.05, X);
  float wash = churn * (0.12 + 0.88 * life) * (0.25 + 0.75 * uK);
  // Quarter waves from the transom corners opening at 19.5°
  float xc = uB * 0.45 + d * 0.354;
  float ax = (X - xc) / (0.9 + d * 0.05);
  float arm = exp(-ax * ax) * exp(-d / (25.0 + 5.0 * uKn)) * 0.55 * uK;
  float end = 1.0 - smoothstep(0.7, 1.0, d / uLen);
  a = max(wash, arm) * end;
  dense = exp(-d / 12.0);`
    : `float off = vW.x, s = max(vW.y, 0.0);
  // Bow wave: a crest diverging from the stem (about 20°, opening wider right at the stem),
  // breaking white for the first few tens of metres, then thinning to lace
  float c = 0.4 + s * 0.36 + 1.2 * (1.0 - exp(-s / 6.0));
  float wc = 0.5 + s * 0.06 + 0.5 * uK;
  float reach = 8.0 + 36.0 * uK;
  float cx = (off - c) / wc;
  float crest = exp(-cx * cx) * exp(-s / reach) * (0.25 + 0.75 * uK);
  // Broken water against the hull just aft of the stem
  float broken = (1.0 - smoothstep(0.0, c * 0.6 + 0.8, off)) * exp(-s / (5.0 + 20.0 * uK)) * (0.15 + 0.85 * uK);
  // A thin skirt of foam along the whole waterline
  float skirt = exp(-max(off, 0.0) / (0.35 + 1.2 * uK)) * (0.14 + 0.5 * uK);
  // (the sheets of both sides end at the stem: fade in over the first metre)
  float f0 = smoothstep(0.0, 1.0, s + max(off, 0.0) * 0.3);
  crest *= f0;
  broken *= f0;
  skirt *= f0;
  a = max(crest, max(broken, skirt));
  // The trough behind the crest: darker water between it and the hull
  dark = smoothstep(0.8, 2.0, off) * (1.0 - smoothstep(c - 2.2 * wc, c - 0.6 * wc, off)) * smoothstep(2.0, 8.0, s) * exp(-s / reach) * uK;`}
  if (a < 0.006 && dark < 0.01) discard;
  // Foam fixed to the water, drawn out in streaks along the ship's track (two skewed layers, no grid)
  vec2 q = vPos.xz + uOffR;
  vec2 r = vec2(dot(q, vec2(-uFwd.y, uFwd.x)), dot(q, uFwd));
  vec2 r2 = mat2(0.8, 0.6, -0.6, 0.8) * r;
  float grain = fbm(vec2(r.x * 0.5, r.y * 0.14)) * 0.5 + fbm(r2 * vec2(1.3, 0.6) + 17.0) * 0.5;
  // Fine lace: ridged noise (thin filaments round dark cells) drawn out along the track, and a
  // finer speckle; both give way to the coarse grain where a pixel covers more than a few centimetres
  float fw = length(fwidth(q));
  float hk = 1.0 - smoothstep(0.2, 0.7, fw);
  vec2 rl = vec2(r.x * 2.6, r.y * 0.55) + vec2(0.0, uTime * 0.05);
  float l1 = 1.0 - abs(noise(rl) * 2.0 - 1.0);
  float l2 = 1.0 - abs(noise(rl * 2.2 + vec2(5.3, uTime * 0.25)) * 2.0 - 1.0);
  float lace = l1 * l1 * 0.6 + l2 * l2 * 0.4;
  float speck = noise(r2 * vec2(9.0, 4.0) + uTime * 0.5);
  float hi = mix(grain, lace * 0.7 + speck * 0.3, hk);
  float n = grain * 0.35 + hi * 0.65;
  // Alpha erosion: dense foam stays solid, thinner foam keeps only the highs of the pattern, so
  // it breaks into lace and specks instead of thinning into a smear; what is left is crisp
  #define ERODE(c, s) (smoothstep(-0.04, 0.14 + 0.25 * (1.0 - hk), n - 0.74 * (1.0 - clamp((c) * (s), 0.0, 1.0))) * min((c) * 1.35, 0.92) * (0.65 + 0.35 * hi))
  ${stern
    ? `// Astern the old wash keeps a faint veil under the lace as it calms
    a = max(ERODE(a, 0.9 + 0.5 * dense), a * 0.5 * smoothstep(0.2, 0.55, grain));`
    : `// Under the lace a faint veil of spent foam, patchy with the coarse grain
    a = max(max(ERODE(crest, 1.1), max(ERODE(broken, 1.3), ERODE(skirt, 1.8))), a * 0.45 * smoothstep(0.25, 0.6, grain));`}
  vec3 lit = vec3(0.1 + 0.9 * uLight);
  vec3 foam = mix(vec3(0.5, 0.7, 0.7), vec3(0.94, 0.97, 0.98), clamp(a * 1.6, 0.0, 1.0)) * lit;
  // Thin haze of foam would only veil the water: below a trace there is none
  float fa = clamp(a, 0.0, 0.95) * smoothstep(0.03, 0.14, a);
  float ta = dark * 0.3 * (1.0 - fa);
  vec3 col = (foam * fa + vec3(0.02, 0.07, 0.09) * lit * ta) / max(fa + ta, 0.001);
  float tr = exp(-length(cameraPosition - vPos) * uFogDensity);
  gl_FragColor = vec4(mix(uFog, col, tr), (fa + ta) * tr);
  #include <colorspace_fragment>
}`;

export interface OwnWake {
  update(kn: number, g: THREE.Object3D): void;
}

/**
 * Add the own ship's foam: `half(z)` is the waterline half beam, `stem` and `stern` the
 * waterline ends, `beam` the moulded beam.
 */
export function ownWake(g: THREE.Group, half: (z: number) => number, stem: number, stern: number, beam: number): OwnWake {
  const u: Record<string, THREE.IUniform> = {
    ...wakeUniforms,
    uK: { value: 0.5 }, uKn: { value: 15 }, uLen: { value: 200 }, uB: { value: beam }, uStern: { value: stern }, uFwd: { value: new THREE.Vector2(0, 1) },
  };
  const mat = (stern: boolean) => new THREE.ShaderMaterial({
    vertexShader: VERT(stern), fragmentShader: FRAG(stern), uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  });
  // Along both sides: stations from the transom to just ahead of the stem, finer forward
  const zs: number[] = [];
  for (let z = stern; z < stem - 30; z += 2.5) zs.push(z);
  for (let z = stem - 30; z < stem; z += 0.75) zs.push(z);
  zs.push(stem);
  const offs = [-1.2, -0.3, 0.2, 0.6, 1.1, 1.7, 2.5, 3.5, 4.8, 6.4, 8.4, 11, 14, 17.5, 21.5, 26];
  const pos: number[] = [];
  const aw: number[] = [];
  const idx: number[] = [];
  for (const sx of [-1, 1]) {
    const b0 = pos.length / 3;
    for (const z of zs) {
      const hb = half(z);
      for (const o of offs) {
        pos.push(sx * (hb + o), 0, z);
        aw.push(o, stem - z, 0);
      }
    }
    const row = offs.length;
    for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < row - 1; i++) {
      const a = b0 + j * row + i;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('aw', new THREE.Float32BufferAttribute(aw, 3));
  sg.setIndex(idx);
  const side = new THREE.Mesh(sg, mat(false));
  side.name = 'own-foam-side';
  // Astern: a grid stretched by the speed in the vertex shader
  const nx = 12;
  const nz = 48;
  const pa: number[] = [];
  const aa: number[] = [];
  const ia: number[] = [];
  for (let j = 0; j <= nz; j++) {
    const v = Math.pow(j / nz, 1.8);
    for (let i = 0; i <= nx * 2; i++) {
      pa.push(0, 0, 0);
      aa.push(i / nx - 1, v, 0);
    }
  }
  const row = nx * 2 + 1;
  for (let j = 0; j < nz; j++) for (let i = 0; i < row - 1; i++) {
    const a = j * row + i;
    ia.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pa, 3));
  tg.setAttribute('aw', new THREE.Float32BufferAttribute(aa, 3));
  tg.setIndex(ia);
  const aft = new THREE.Mesh(tg, mat(true));
  aft.name = 'own-foam-stern';
  for (const m of [side, aft]) {
    m.frustumCulled = false;
    m.renderOrder = 1;
    g.add(m);
  }
  const fwd = new THREE.Vector3();
  return {
    update(kn: number, ship: THREE.Object3D) {
      const k = THREE.MathUtils.smoothstep(Math.abs(kn), 1.5, 27);
      u.uK!.value = k;
      u.uKn!.value = Math.abs(kn);
      u.uLen!.value = 60 + 14 * Math.abs(kn);
      fwd.setFromMatrixColumn(ship.matrixWorld, 2);
      (u.uFwd!.value as THREE.Vector2).set(fwd.x, fwd.z).normalize();
      side.visible = aft.visible = kn > 0.5;
    },
  };
}
