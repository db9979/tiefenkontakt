import * as THREE from 'three';
import { NOISE } from './shaders.js';

/**
 * Heat shimmer over the own ship's exhaust pipes at higher power: a few camera-facing quads
 * along the first seconds of the plume that bend what lies behind them. Just before they are
 * drawn (after everything opaque, in the main pass only: layer 0) a window of the frame around
 * them is copied into a small texture; each quad samples that copy with a wavering offset that
 * fades to nothing at its rim, so where the effect ends the picture is untouched. If the plume
 * is off screen nothing is copied.
 */

const PER = 4;
/** Seconds of plume the shimmer follows (the gas is hot only just above the pipe). */
const SPAN = 1.6;

const VERT = `
attribute vec4 iPos; // xyz centre, w size (m)
attribute float iA;
uniform float uPxPerRad;
varying vec2 vUv; varying float vA; varying float vAmp;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
  mv.xy += position.xy * vec2(iPos.w * 0.75, iPos.w);
  vUv = uv;
  vA = iA * smoothstep(4.0, 10.0, -mv.z);
  // Bend in pixels, as a share of the quad's size on screen (the same look at any zoom)
  vAmp = 0.018 * iPos.w / max(-mv.z, 0.1) * uPxPerRad;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `${NOISE}
uniform sampler2D uFrame; uniform vec4 uWin; uniform float uTime;
varying vec2 vUv; varying float vA; varying float vAmp;
void main() {
  vec2 c = (vUv - 0.5) * vec2(1.0, 0.85);
  float m = (1.0 - smoothstep(0.1, 0.5, length(c))) * vA;
  if (m < 0.01) discard;
  // Rising, wavering cells of hot air
  vec2 p = vec2(vUv.x * 3.0, vUv.y * 4.0 - uTime * 2.6);
  vec2 off = vec2(noise(p) - 0.5, noise(p * 1.7 + 5.3) - 0.5) * 2.0 * m * vAmp;
  vec2 st = (gl_FragCoord.xy + off - uWin.xy) * uWin.zw;
  if (st.x < 0.0 || st.y < 0.0 || st.x > 1.0 || st.y > 1.0) discard;
  // The copy is already the finished picture: no colour-space conversion
  gl_FragColor = vec4(texture2D(uFrame, st).rgb, 1.0);
}`;

export interface OwnShimmer {
  update(t: number, kn: number, air: THREE.Vector3): void;
}

/** Shimmer over the given exhaust pipes (pipe mouths in ship coordinates, radius each). */
export function ownShimmer(g: THREE.Group, pipes: { p: THREE.Vector3; r: number }[]): OwnShimmer {
  const n = pipes.length * PER;
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position!);
  geo.setAttribute('uv', base.attributes.uv!);
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  pos.setUsage(THREE.DynamicDrawUsage);
  alpha.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', pos);
  geo.setAttribute('iA', alpha);
  geo.instanceCount = n;
  const win = new THREE.Vector4();
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    uniforms: { uFrame: { value: null }, uWin: { value: win }, uTime: { value: 0 }, uPxPerRad: { value: 1000 } },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'own-shimmer';
  mesh.frustumCulled = false;
  // After the foam and pools, before the smoke (which stays crisp over it)
  mesh.renderOrder = 1.5;
  mesh.visible = false;
  g.add(mesh);
  let tex: THREE.FramebufferTexture | undefined;
  const buf = new THREE.Vector2();
  const ctr = new THREE.Vector3();
  const at = new THREE.Vector2();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const cam = camera as THREE.PerspectiveCamera;
    renderer.getDrawingBufferSize(buf);
    mat.uniforms.uPxPerRad!.value = buf.y / 2 / Math.tan((cam.fov * Math.PI) / 360);
    // Window of the frame around the plume (a square up to 512 px), clamped into the picture
    const size = Math.min(512, buf.x, buf.y);
    if (!tex || tex.image.width !== size) {
      tex?.dispose();
      tex = new THREE.FramebufferTexture(size, size);
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      mat.uniforms.uFrame!.value = tex;
    }
    ctr.copy(mesh.userData.ctr as THREE.Vector3).applyMatrix4(g.matrixWorld).project(cam);
    const far = ctr.z > 1 || Math.abs(ctr.x) > 1.5 || Math.abs(ctr.y) > 1.5;
    if (far) {
      // Off screen: nothing to bend, every fragment falls outside the (empty) window
      win.set(-1e6, -1e6, 1 / size, 1 / size);
      return;
    }
    at.set(Math.round((ctr.x * 0.5 + 0.5) * buf.x - size / 2), Math.round((ctr.y * 0.5 + 0.5) * buf.y - size / 2));
    at.x = THREE.MathUtils.clamp(at.x, 0, buf.x - size);
    at.y = THREE.MathUtils.clamp(at.y, 0, buf.y - size);
    renderer.copyFramebufferToTexture(tex, at);
    win.set(at.x, at.y, 1 / size, 1 / size);
  };
  const sum = new THREE.Vector3();
  mesh.userData.ctr = sum;
  return {
    update(t: number, kn: number, air: THREE.Vector3) {
      // Nothing at cruise; a faint shimmer from about 16 kn, clear at full power
      const k = THREE.MathUtils.smoothstep(kn, 16, 28);
      mesh.visible = k > 0.01;
      if (!mesh.visible) return;
      mat.uniforms.uTime!.value = t;
      sum.set(0, 0, 0);
      let i = 0;
      pipes.forEach((pp, e) => {
        for (let j = 0; j < PER; j++, i++) {
          const ph = (t / SPAN + j / PER + e * 0.29) % 1;
          const age = ph * SPAN;
          // The same rise and drift as the smoke's first second or two
          const rise = 2.6 * (1 - Math.exp(-age / 0.7)) + 0.35 * age + pp.r;
          const carry = Math.max(0, age - 0.15) * 0.92;
          const x = pp.p.x + air.x * carry;
          const y = pp.p.y + rise + air.y * carry;
          const z = pp.p.z + air.z * carry;
          const s = pp.r * 3.2 + age * 1.6;
          pos.setXYZW(i, x, y, z, s);
          alpha.setX(i, k * Math.sin(Math.PI * ph));
          sum.x += x;
          sum.y += y;
          sum.z += z;
        }
      });
      sum.divideScalar(n);
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    },
  };
}
