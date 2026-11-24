import * as THREE from 'three';
import { addWake } from './wake.js';

/**
 * Building blocks for the low-poly ship models: materials, boxes and cylinders, hull and deck
 * outlines, funnel smoke, wake and navigation lights. Bow toward +z, waterline at y = 0,
 * port (left looking forward) is +x. Every part must rest on the deck or on another part.
 */

export const mat = (color: number, opts: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
export const M = {
  hullDark: mat(0x30363b), hullGrey: mat(0x5f686e), red: mat(0x5a2a24), deck: mat(0x4b4e4c), white: mat(0x9aa1a4),
  grey: mat(0x6c757a), black: mat(0x1c1f21), cargo: mat(0x5b4334), glass: mat(0x0c1214), sub: mat(0x1f2427),
};
export const FOAM = new THREE.MeshBasicMaterial({ color: 0xe6f0f2, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });

export function add(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}
export const box = (g: THREE.Object3D, w: number, h: number, l: number, x: number, y: number, z: number, m: THREE.Material) => add(g, new THREE.BoxGeometry(w, h, l), m, x, y, z);
export const cyl = (g: THREE.Object3D, r: number, h: number, x: number, y: number, z: number, m: THREE.Material, r2 = r) => add(g, new THREE.CylinderGeometry(r, r2, h, 10), m, x, y, z);

/** Hull from a top-view outline (pointed bow, square transom), extruded upward. */
export function hull(g: THREE.Object3D, len: number, beam: number, height: number, below: number, m: THREE.Material, boot?: THREE.Material): void {
  const s = new THREE.Shape();
  const L = len / 2;
  const B = beam / 2;
  s.moveTo(-B * 0.8, L);
  s.lineTo(-B, L * 0.1);
  s.quadraticCurveTo(-B, -L * 0.45, 0, -L);
  s.quadraticCurveTo(B, -L * 0.45, B, L * 0.1);
  s.lineTo(B * 0.8, L);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // extrusion becomes height; the shape's bow (−y) ends up at +z
  add(g, geo, m, 0, -below, 0);
  if (boot) {
    const bg = new THREE.ExtrudeGeometry(s, { depth: 1.2, bevelEnabled: false });
    bg.rotateX(-Math.PI / 2);
    bg.scale(1.01, 1, 1.005);
    add(g, bg, boot, 0, -0.6, 0);
  }
}

/** Deck following the hull outline (pointed bow), slightly inset. */
export function deckCap(g: THREE.Object3D, len: number, beam: number, y: number, m: THREE.Material): void {
  const s = new THREE.Shape();
  const L = len / 2 - 1;
  const B = beam / 2 - 0.4;
  s.moveTo(-B * 0.8, L);
  s.lineTo(-B, L * 0.1);
  s.quadraticCurveTo(-B, -L * 0.45, 0, -L);
  s.quadraticCurveTo(B, -L * 0.45, B, L * 0.1);
  s.lineTo(B * 0.8, L);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  add(g, geo, m, 0, y + 0.05, 0);
}

/** Funnel smoke: a chain of puffs the scene drifts and fades. */
export function smoke(g: THREE.Group, x: number, y: number, z: number, n: number, color = 0x3a3c3e): void {
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const p = add(g, new THREE.SphereGeometry(1, 7, 5), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false }), x, y, z);
    puffs.push(p);
  }
  g.userData.smoke = { puffs, origin: new THREE.Vector3(x, y, z) };
}

/** Stern wake and bow wave lying on the sea (see wake.ts); scaled by speed in the scene. */
export function wake(g: THREE.Group, len: number, beam: number, bowZ: number, sternZ: number): void {
  addWake(g, len, beam, bowZ, sternZ);
}

let glowTex: THREE.Texture | undefined;
/** Soft round glow for light points (shared texture). */
function glow(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (glowTex = new THREE.CanvasTexture(c));
}

/**
 * Navigation lights: masthead (white) over the bridge, sidelights red to port and green to
 * starboard, stern light (white). Screen-sized glows so they show for miles at night.
 * Bow is +z, so port (left looking forward) is +x.
 */
export function navLights(g: THREE.Group, len: number, beam: number, mastY: number, bridgeZ: number, deckY: number): void {
  const n = new THREE.Group();
  n.name = 'navlights';
  n.visible = false;
  const lamp = (color: number, x: number, y: number, z: number, size: number) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, transparent: true }));
    sp.scale.setScalar(size);
    sp.position.set(x, y, z);
    n.add(sp);
  };
  lamp(0xfff6e0, 0, mastY, bridgeZ, 0.009);
  lamp(0xff3b30, beam / 2, deckY + 2, bridgeZ, 0.007);
  lamp(0x3dff7a, -beam / 2, deckY + 2, bridgeZ, 0.007);
  lamp(0xfff6e0, 0, deckY + 1, -len / 2 + 2, 0.006);
  g.add(n);
}

