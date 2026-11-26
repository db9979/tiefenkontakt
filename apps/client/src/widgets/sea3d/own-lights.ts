import * as THREE from 'three';

/**
 * The own ship darkened at night, as her bridge sees her: no white working lights, only the
 * navigation lights (masthead and stern white, red to port, green to starboard), dim red
 * lamps on the bridge wings and over ladders, red floodlights over the flight deck and the
 * faintly lit cards of the pelorus and gyro repeater. Each lamp is a small unlit lens and a
 * soft additive glow sized in metres; at most two real (red) point lights light the decks.
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

/** Glow size (m) and lens radius per kind. */
const SIZE: Record<LampKind, [number, number]> = { nav: [1.5, 0.09], red: [0.4, 0], flood: [1.1, 0.08], card: [0.3, 0] };

export interface OwnLights {
  update(light: number): void;
}

/** Lamps and up to two red point lights (near: also on the bridge pass); hidden by day. */
export function ownLights(g: THREE.Group, lamps: Lamp[], pools: { p: THREE.Vector3; near: boolean; range: number }[]): OwnLights {
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
      lights.forEach((pl, i) => (pl.intensity = n * (i ? 2.2 : 1.1)));
    },
  };
}
