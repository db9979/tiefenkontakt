import * as THREE from 'three';

/**
 * The own ship darkened at night, as her bridge sees her: no white working lights, only the
 * navigation lights (masthead and stern white, red to port, green to starboard), dim red
 * lamps on the bridge wings and over ladders, red floodlights over the flight deck and the
 * faintly lit cards of the pelorus and gyro repeater. Each lamp is a small unlit lens and a
 * soft additive glow sized in metres. What the lamps light is drawn, not computed: each lamp
 * lays a dim red pool on the deck below it and a scallop down the wall it hangs on (additive
 * quads with a soft falloff, one draw call per pass); two weak real point lights only add a
 * faint red cast over the bridge and the flight deck. Painted steel near the eye is shaded down
 * at night (moonlight would leave it pale where the darkened bridge should read dark).
 */

export type LampKind = 'nav' | 'red' | 'flood' | 'card';
export interface Lamp {
  p: THREE.Vector3;
  color: number;
  kind: LampKind;
  /** Layer 1: drawn in the bridge's near pass. */
  near?: boolean;
}

let glowTex: THREE.Texture | undefined;
function glow(): THREE.Texture {
  if (glowTex) return glowTex;
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, n, n);
  return (glowTex = new THREE.CanvasTexture(c));
}

/**
 * Light a lamp throws on a surface: a quad p + a·u + b·v (a in −1…1, b in b0…1) lying on the
 * surface. 'pool': round falloff from p (b0 = 0 gives the half on the v side, for a lamp over a
 * wall foot). 'wash': a scallop down a wall from the lamp, which sits at the top edge (b = 1).
 */
export interface LightPool {
  p: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  kind: 'pool' | 'wash';
  /** Brightness (linear, before the night fade). */
  k: number;
  b0?: number;
  /** The side it is seen from (default up): the quad is one-sided. */
  n?: THREE.Vector3;
  color?: number;
  near?: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
let poolTex: THREE.Texture | undefined;
/** Atlas: left half a round pool, right half a wall scallop (bright under the lamp, fanning down). */
function poolTexture(): THREE.Texture {
  if (poolTex) return poolTex;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = n * 2;
  c.height = n;
  const x = c.getContext('2d')!;
  const img = x.createImageData(n * 2, n);
  const sm = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n * 2; i++) {
    const wash = i >= n;
    const dx = ((i % n) + 0.5) / (n / 2) - 1;
    let a: number;
    if (!wash) {
      // Pool: light falling off about with the square of the distance, soft to nothing at the rim
      const r = Math.hypot(dx, (j + 0.5) / (n / 2) - 1);
      a = (1 / (1 + (r / 0.32) ** 2)) * (1 - sm(0.55, 1, r));
    } else {
      // Scallop: the lamp at the top edge throws a cone down the wall (about 50° either side),
      // brightest just under it, widening and fading as it goes down
      const dy = (j + 0.5) / n;
      const r = Math.hypot(dx * 0.8, dy);
      const ang = Math.atan2(Math.abs(dx), dy * 1.6 + 0.06);
      a = (1 / (1 + (r / 0.22) ** 2)) * (1 - sm(0.5, 0.95, ang)) * (1 - sm(0.7, 1, r)) * (1 - sm(0.85, 1, Math.abs(dx)));
    }
    const o = (j * n * 2 + i) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
    img.data[o + 3] = Math.round(255 * Math.min(1, a));
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return (poolTex = t);
}

/** All pools of one pass in one mesh. */
function poolMesh(list: LightPool[], layer: number, mat: THREE.Material): THREE.Mesh | undefined {
  if (!list.length) return undefined;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const q = new THREE.Vector3();
  for (const l of list) {
    const b0 = l.b0 ?? -1;
    c.set(l.color ?? 0xff2010).multiplyScalar(l.k);
    const i0 = pos.length / 3;
    for (const [a, b] of [[-1, b0], [1, b0], [-1, 1], [1, 1]] as const) {
      q.copy(l.p).addScaledVector(l.u, a).addScaledVector(l.v, b);
      pos.push(q.x, q.y, q.z);
      // Texture space: pool in u 0…0.5, scallop in 0.5…1 with the lamp at the top (v = 1)
      const s = (a + 1) / 4;
      if (l.kind === 'pool') uv.push(s, (b + 1) / 2);
      else uv.push(0.5 + s, (b + 1) / 2);
      col.push(c.r, c.g, c.b);
    }
    // Wound to face n
    if (q.crossVectors(l.u, l.v).dot(l.n ?? UP) >= 0) idx.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
    else idx.push(i0, i0 + 2, i0 + 1, i0 + 2, i0 + 3, i0 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, mat);
  m.name = `own-pools-${layer}`;
  m.layers.set(layer);
  m.renderOrder = 1;
  return m;
}

/** Glow size (m) and lens radius per kind. */
const SIZE: Record<LampKind, [number, number]> = { nav: [1.5, 0.09], red: [0.4, 0], flood: [1.1, 0.08], card: [0.3, 0] };

export interface OwnLights {
  update(light: number): void;
}

/**
 * Lamps, the pools of light they throw and up to two weak red point lights (near: also on the
 * bridge pass); hidden by day. `dim`: materials shaded down at night.
 */
export function ownLights(g: THREE.Group, lamps: Lamp[], pools: { p: THREE.Vector3; near: boolean; range: number }[], patches: LightPool[] = [],
  dim: THREE.MeshStandardMaterial[] = []): OwnLights {
  const root = new THREE.Group();
  root.name = 'own-night';
  root.visible = false;
  const mats: { m: THREE.Material & { opacity: number }; k: number }[] = [];
  const lens = new Map<string, THREE.MeshBasicMaterial>();
  for (const l of lamps) {
    const [size, r] = SIZE[l.kind];
    const layer = l.near ? 1 : 0;
    const sm = new THREE.SpriteMaterial({ map: glow(), color: l.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    const sp = new THREE.Sprite(sm);
    sp.scale.setScalar(size);
    sp.position.copy(l.p);
    sp.layers.set(layer);
    sp.renderOrder = 3;
    root.add(sp);
    mats.push({ m: sm, k: l.kind === 'card' ? 0.5 : l.kind === 'red' ? 0.75 : 1 });
    if (r > 0) {
      const key = `${l.color}`;
      let lm = lens.get(key);
      if (!lm) {
        lm = new THREE.MeshBasicMaterial({ color: l.color, fog: false });
        lens.set(key, lm);
      }
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 6), lm);
      m.position.copy(l.p);
      m.layers.set(layer);
      root.add(m);
    }
  }
  const pm = new THREE.MeshBasicMaterial({
    map: poolTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  for (const layer of [0, 1]) {
    const m = poolMesh(patches.filter((p) => !!p.near === !!layer), layer, pm);
    if (m) root.add(m);
  }
  const lights = pools.slice(0, 2).map((p) => {
    const pl = new THREE.PointLight(0xff2412, 0, p.range, 2);
    pl.position.copy(p.p);
    if (p.near) pl.layers.enable(1);
    // Always in the scene (intensity 0 by day): no shader recompiles when night falls
    g.add(pl);
    return pl;
  });
  g.add(root);
  return {
    update(light: number) {
      const n = THREE.MathUtils.clamp((0.42 - light) / 0.2, 0, 1);
      root.visible = n > 0;
      for (const { m, k } of mats) m.opacity = n * k;
      pm.opacity = n;
      // Only a faint red cast: the pools carry the light
      lights.forEach((pl, i) => (pl.intensity = n * (i ? 1.2 : 0.3)));
      for (const m of dim) m.color.setScalar(1 - 0.55 * n);
    },
  };
}
