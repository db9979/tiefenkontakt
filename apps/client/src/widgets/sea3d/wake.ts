import * as THREE from 'three';
import { NOISE } from './shaders.js';
import { WAVES_GLSL, waveUniforms } from './waves.js';

/**
 * Wake and bow wave that lie on the moving sea. The foam pattern is fixed to the water (own
 * position added), so it stays behind while the ship drives on: the stern wash streams aft at
 * exactly the ship's speed. The stern wake is a churned band down the middle, widening and
 * fading aft, with the two Kelvin arms at 19.5° on its flanks; the bow wave hugs the hull and
 * peels off to both sides. Both follow the swell instead of floating as a flat plate.
 */

/** Shared by every wake: the sea (from waves.ts) plus time, light and grid law. */
export const wakeUniforms: Record<string, THREE.IUniform> = {
  ...waveUniforms(),
  uTime: { value: 0 },
  uLight: { value: 1 },
  uCell: { value: new THREE.Vector2(0, 1) },
};

const VERT = (bow: boolean) => `${WAVES_GLSL}
uniform vec2 uCell;
attribute vec3 aw;
varying vec3 vW; varying vec3 vPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float d = max(max(abs(wp.x), abs(wp.z)), 1.0);
  float cell = uCell.x * pow(d, uCell.y);
  wp.y = heightLod(wp.xz, cell) + 0.12;
  // Same crest sharpening as the ocean grid, so the foam stays on the water
  wp.xz += chopShift(wp.xz, cell);
  ${bow ? '// The bow wave climbs the stem and stands up along the hull\n  wp.y += (1.0 - aw.x) * (1.0 - aw.y) * aw.z;' : ''}
  vW = aw; vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = (bow: boolean) => `${NOISE}
uniform float uTime; uniform float uLight; uniform vec2 uOffR;
varying vec3 vW; varying vec3 vPos;
void main() {
  // vW: x across (0 centre/hull … 1 edge), y along (0 at the ship … 1 at the end), z churn width
  vec2 q = vPos.xz + uOffR;
  float grain = fbm(q * 0.25) * 0.6 + noise(q * 1.0 + uTime * 0.3) * 0.4;
  float a;
  ${bow
    ? `a = pow(1.0 - vW.x, 1.4) * pow(1.0 - vW.y, 0.7) * smoothstep(0.25, 0.65, grain + 0.2);`
    : `float churn = (1.0 - smoothstep(vW.z * 0.55, vW.z, vW.x)) * smoothstep(0.2, 0.6, grain + 0.25 * (1.0 - vW.y));
       float arm = smoothstep(0.84, 0.95, vW.x) * (1.0 - smoothstep(0.95, 1.0, vW.x))
         * (0.55 + 0.45 * sin(vW.y * 90.0)) * smoothstep(0.35, 0.7, grain);
       a = (churn * 0.9 + arm * 0.45) * pow(1.0 - vW.y, 1.3) * smoothstep(0.0, 0.03, vW.y + 0.01);`}
  vec3 col = mix(vec3(0.55, 0.72, 0.72), vec3(0.9, 0.94, 0.95), clamp(a * 1.4, 0.0, 1.0)) * (0.12 + 0.88 * uLight);
  // Far off the foam thins to a soft streak instead of a hard white line
  a *= mix(1.0, 0.45, smoothstep(300.0, 2500.0, length(vPos.xz)));
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
  #include <colorspace_fragment>
}`;

const mat = (bow: boolean) => new THREE.ShaderMaterial({
  vertexShader: VERT(bow), fragmentShader: FRAG(bow), uniforms: wakeUniforms,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  // The wake lies a hand's breadth above the water: lift it in the depth test, not in metres
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
});
const STERN_MAT = mat(false);
const BOW_MAT = mat(true);

/** Stern wake: a wedge from the transom aft over `len` metres, `beam` wide at the stern. */
function sternGeometry(len: number, beam: number): THREE.BufferGeometry {
  const nx = 8, nz = 40;
  const pos: number[] = [], aw: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    const v = j / nz;
    const z = -len * v;
    const half = beam * 0.45 + (len * 0.354 - beam * 0.45) * v;
    // Churned band: about the beam at the stern, spreading slowly
    const churn = Math.min(1, (beam * 0.55 + len * 0.05 * v) / half);
    for (let i = 0; i <= nx * 2; i++) {
      const u = i / nx - 1;
      pos.push(u * half, 0, z);
      aw.push(Math.abs(u), v, churn);
    }
  }
  const row = nx * 2 + 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < row - 1; i++) {
      const a = j * row + i;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aw', new THREE.Float32BufferAttribute(aw, 3));
  g.setIndex(idx);
  return g;
}

/** Bow wave: on each side a strip from the stem aft along the hull, spreading outward. */
function bowGeometry(beam: number): THREE.BufferGeometry {
  const nz = 12;
  const back = beam * 3.2;
  const pos: number[] = [], aw: number[] = [], idx: number[] = [];
  for (const s of [-1, 1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= nz; j++) {
      const v = j / nz;
      const z = -back * v;
      const hull = (beam / 2) * Math.min(1, Math.sqrt(v * 2.2));
      const out = hull + beam * (0.15 + 0.9 * v);
      pos.push(s * hull * 0.98, 0, z, s * out, 0, z);
      aw.push(0, v, beam * 0.16, 1, v, beam * 0.16);
    }
    for (let j = 0; j < nz; j++) {
      const a = base + j * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aw', new THREE.Float32BufferAttribute(aw, 3));
  g.setIndex(idx);
  return g;
}

/** Add the stern wake ('wake') and bow wave ('bow') to a model; the scene scales them with speed. */
export function addWake(g: THREE.Group, len: number, beam: number, bowZ: number, sternZ: number): void {
  const w = new THREE.Mesh(sternGeometry(len, beam), STERN_MAT);
  w.name = 'wake';
  w.position.z = sternZ;
  w.renderOrder = 1;
  const b = new THREE.Mesh(bowGeometry(beam), BOW_MAT);
  b.name = 'bow';
  b.position.z = bowZ;
  b.renderOrder = 1;
  g.add(w, b);
}
