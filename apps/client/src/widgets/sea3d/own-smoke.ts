import * as THREE from 'three';

/**
 * Funnel exhaust of the own ship seen from her bridge: a thin plume of camera-facing soft puffs
 * (one instanced draw call). Each exhaust pipe sends a stream of puffs that leave the pipe
 * dark and narrow, rise with the hot gas, then go with the apparent wind, widening, paling and
 * fading. A gas-turbine/diesel frigate shows little at cruise: the plume is faint and only
 * thickens at high speed. Unlit: brightness follows the scene light.
 */

const PER = 22;
/** Seconds a puff lives. */
const LIFE = 7;

let puffTex: THREE.Texture | undefined;
/** Soft cloudy blob: a few overlapping soft discs under a radial fade, transparent at the rim. */
function puffTexture(): THREE.Texture {
  if (puffTex) return puffTex;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d')!;
  let seed = 7;
  const r = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * n * 0.16;
    const px = n / 2 + Math.cos(a) * d;
    const py = n / 2 + Math.sin(a) * d;
    const rr = n * (0.2 + r() * 0.14);
    const g = x.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, n, n);
  }
  // Fade to nothing well inside the square, so no puff shows an edge
  x.globalCompositeOperation = 'destination-in';
  const f = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  f.addColorStop(0, 'rgba(255,255,255,1)');
  f.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  f.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = f;
  x.fillRect(0, 0, n, n);
  return (puffTex = new THREE.CanvasTexture(c));
}

const VERT = `
attribute vec4 iPos; // xyz centre, w size
attribute vec3 iLook; // alpha, rotation, shade (0 fresh … 1 old)
varying vec2 vUv; varying float vA; varying float vS;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
  float c = cos(iLook.y), s = sin(iLook.y);
  mv.xy += mat2(c, s, -s, c) * position.xy * iPos.w;
  // A puff drifting over the eye fades instead of filling the view
  vA = iLook.x * smoothstep(2.0, 6.0, -mv.z);
  vUv = uv; vS = iLook.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform sampler2D uMap; uniform vec3 uDark; uniform vec3 uPale; uniform float uBright;
varying vec2 vUv; varying float vA; varying float vS;
void main() {
  float a = texture2D(uMap, vUv).a * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uDark, uPale, vS) * uBright, a);
  #include <colorspace_fragment>
}`;

export interface OwnSmoke {
  mesh: THREE.Mesh;
  update(t: number, kn: number, light: number, air: THREE.Vector3): void;
}

/** Plume from the given exhaust pipes (pipe mouths in ship coordinates, radius each). */
export function ownSmoke(g: THREE.Group, pipes: { p: THREE.Vector3; r: number }[]): OwnSmoke {
  const n = pipes.length * PER;
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position!);
  geo.setAttribute('uv', base.attributes.uv!);
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const look = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  look.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', pos);
  geo.setAttribute('iLook', look);
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    uniforms: { uMap: { value: puffTexture() }, uDark: { value: new THREE.Color(0x34302c) }, uPale: { value: new THREE.Color(0x9a9c9c) }, uBright: { value: 1 } },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'own-smoke';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  g.add(mesh);
  const update = (t: number, kn: number, light: number, air: THREE.Vector3) => {
    // Little at cruise, a visible haze at full power
    const k = 0.07 + 0.3 * THREE.MathUtils.smoothstep(kn, 12, 30);
    mat.uniforms.uBright!.value = 0.1 + 0.9 * light;
    let i = 0;
    pipes.forEach((pp, e) => {
      for (let j = 0; j < PER; j++, i++) {
        const ph = (t / LIFE + j / PER + e * 0.37) % 1;
        const age = ph * LIFE;
        // Hot gas shoots up, then the apparent wind takes it; a slow meander on top
        const rise = 2.6 * (1 - Math.exp(-age / 0.7)) + 0.35 * age;
        const carry = Math.max(0, age - 0.15) * 0.92;
        const w = Math.sin(t * 0.6 + j * 2.3 + e) * 0.5 * age;
        const x = pp.p.x + air.x * carry + w;
        const y = pp.p.y + rise + air.y * carry + Math.sin(t * 0.9 + j * 1.7) * 0.15 * age;
        const z = pp.p.z + air.z * carry + Math.cos(t * 0.5 + j * 3.1 + e) * 0.3 * age;
        pos.setXYZW(i, x, y, z, pp.r * 4 + age * 2.6 + age * age * 0.15);
        // Fades in just above the pipe, out as it spreads
        const a = k * Math.min(1, age / 0.8) * Math.pow(1 - ph, 1.6);
        look.setXYZ(i, a, j * 1.9 + e + age * 0.12 * (j % 2 ? 1 : -1), Math.min(1, age / 3.5));
      }
    });
    pos.needsUpdate = true;
    look.needsUpdate = true;
  };
  return { mesh, update };
}
