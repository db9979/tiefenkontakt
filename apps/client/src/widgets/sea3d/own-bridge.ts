import * as THREE from 'three';
import { C, Kit, P, facet } from './own-kit.js';
import { bridgeDeckTexture, drains, nonSkidBump } from './own-deck-tex.js';
import type { Lamp, LightPool } from './own-lights.js';

/**
 * The bridge the eye stands on (own ship, close-range model): a closed wheelhouse with a sloped
 * window band, sun brow and clear-view screens, solid plating down to the deckhouse below, and
 * on its roof the open bridge: deck, a closed 1.2 m bulwark with wooden capping all round,
 * wings out to the full beam, pelorus and gyro repeater, signal lamps, flag lockers and the
 * sidelight screens; underfoot painted non-skid with welded seams, a waterway with drain holes
 * along the bulwark and teak gratings where the lookouts stand. The parts around the eye go into `near` (drawn in a second pass with a
 * short near plane, so nothing is cut open by the camera's clipping); the rest into `far`.
 * Bow +z; eye at (0, eye, ze).
 */

export interface BridgeSpec {
  eye: number;
  ze: number;
  /** Half width of the wheelhouse, half width of the wings (≈ half beam). */
  hw: number;
  wing: number;
  /** Roof of the generic bridge block below (the new structure stands on it). */
  roof: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Eye height above the open-bridge deck. */
const EYE_OVER_DECK = 1.65;
const BULWARK = 1.1;

/**
 * Builds the bridge; returns where the flag-locker halyards end (port, starboard), the
 * darkened-ship lamps with the pools of light they throw, the spot for a faint red light over
 * the deck and the paint of the bulwark (shaded down at night).
 */
export function openBridge(far: Kit, near: Kit, g: THREE.Group, b: BridgeSpec): {
  ends: THREE.Vector3[]; lamps: Lamp[]; patches: LightPool[]; pool: THREE.Vector3; shade: THREE.MeshStandardMaterial;
} {
  const lamps: Lamp[] = [];
  const patches: LightPool[] = [];
  // The bulwark's own paint: its inboard faces stand in its shadow, dark at night
  const shade = P.paint.clone();
  const yF = b.eye - EYE_OVER_DECK;
  const yW = yF - 2.6;
  const zf = b.ze + 0.25;
  const ch = 1.0;
  const plan = (front: number, rear = b.ze - 6.0): [number, number][] =>
    [[-b.hw, rear], [b.hw, rear], [b.hw, front - ch], [b.hw - ch, front], [-b.hw + ch, front], [-b.hw, front - ch]];
  // Plating from the generic bridge roof up to the wheelhouse deck, a row of scuttles on it
  if (yW > b.roof + 0.3) {
    far.mesh(facet([{ y: b.roof - 0.05, pts: plan(b.ze) }, { y: yW, pts: plan(b.ze) }]), C.haze).userData.ao = 0.15;
    for (const sx of [-1, 1]) for (let z = b.ze - 5; z < b.ze - 1; z += 1.2) {
      const s = far.mesh(new THREE.CircleGeometry(0.17, 10), C.glass, P.glass);
      s.position.set(sx * (b.hw + 0.01), yW - 1.2, z);
      s.rotation.y = (sx * Math.PI) / 2;
    }
  }
  // Wheelhouse: upright skirt to the sill, window band leaning out at the top
  const sill = yW + 0.95;
  const winTop = yF - 0.35;
  far.mesh(facet([{ y: yW, pts: plan(b.ze) }, { y: sill, pts: plan(b.ze) }, { y: winTop, pts: plan(zf) }, { y: yF, pts: plan(zf) }]), C.haze).userData.ao = 0.1;
  const lean = Math.atan2(zf - b.ze, winTop - sill);
  const hgt = winTop - sill - 0.12;
  const yc = (sill + winTop) / 2;
  const zc = (b.ze + zf) / 2 + 0.03;
  const span = 2 * (b.hw - ch);
  const n = Math.max(4, Math.round(span / 1.05));
  const pitch = span / n;
  for (let i = 0; i < n; i++) {
    const x = -span / 2 + (i + 0.5) * pitch;
    const pane = far.box(pitch - 0.12, hgt, 0.03, x, yc, zc, C.glass, P.glass);
    pane.rotation.x = -lean;
    // Clear-view screens on the middle panes, wipers on the next ones out
    const mid = Math.abs(x) < pitch * 1.6;
    const grp = far.group(x, yc, zc + 0.02, 0, -lean);
    if (mid) {
      far.mesh(new THREE.CircleGeometry(0.35, 14), C.hazeD, P.glass, grp).position.z = 0.01;
      far.cyl(0.05, 0.06, 0, 0, 0.02, C.steel, P.metal, 8, 0.05, grp).rotation.x = Math.PI / 2;
    } else if (Math.abs(x) < pitch * 2.6) {
      far.box(0.03, 0.75, 0.02, 0.1, -0.1, 0.02, C.dark, P.matte, grp).rotation.z = 0.5;
    }
  }
  // Two panes on each chamfered corner
  for (const sx of [-1, 1]) for (const f of [-0.5, 0.5]) {
    const pane = far.box(0.55, hgt, 0.03, sx * (b.hw - ch / 2) - sx * f * 0.5, yc, zc - ch / 2 + f * 0.5, C.glass, P.glass);
    pane.rotation.set(-lean, (sx * Math.PI) / 4, 0, 'YXZ');
  }
  // Sun brow over the windows
  const brow = far.box(span + 0.4, 0.05, 0.6, 0, winTop + 0.12, zf + 0.25, C.hazeL);
  brow.rotation.x = 0.12;
  // Brackets under the wings
  for (const sx of [-1, 1]) for (const z of [b.ze - 4.6, b.ze - 2.4, b.ze - 0.2]) far.tube(V(sx * (b.wing - 0.4), yF - 0.25, z), V(sx * b.hw, yW + 0.6, z), 0.07, C.hazeD, P.paint, 6);

  // --- Open bridge (near pass) ---
  const z0 = b.ze - 5.6;
  const deckPts: [number, number][] = [[-b.wing, z0], [b.wing, z0], [b.wing, zf], [-b.wing, zf]];
  const slab = near.mesh(facet([{ y: yF - 0.25, pts: deckPts }, { y: yF - 0.01, pts: deckPts }]), C.hazeD);
  slab.userData.ao = 0;
  const pel = [-1, 1].map((sx) => [sx * (b.hw + 0.7), b.ze - 0.3] as [number, number]);
  g.add(floor(b, z0, zf, yF, pel));
  // Teak gratings where the lookouts stand at the pelorus and the gyro repeater
  for (const [px, pz] of pel) {
    for (const ox of [-0.38, 0.38]) near.box(0.06, 0.035, 1.0, px + ox, yF + 0.0175, pz, C.wood, P.matte);
    for (let i = 0; i < 9; i++) near.box(1.0, 0.025, 0.075, px, yF + 0.047, pz - 0.44 + i * 0.11, 0x5f5547, P.matte).userData.ao = 0.1;
  }
  // Bulwark all round (front, wing ends, after edge either side of the ladder well) with capping and stiffeners
  const wall = (a: THREE.Vector3, c: THREE.Vector3, inward: THREE.Vector3) => {
    const len = a.distanceTo(c);
    const grp = near.group((a.x + c.x) / 2, yF, (a.z + c.z) / 2, Math.atan2(c.x - a.x, c.z - a.z));
    // Local z runs along the wall, local x across it; `inward` picks the side the eye is on
    const side = Math.sign(inward.x * Math.cos(grp.rotation.y) - inward.z * Math.sin(grp.rotation.y)) || 1;
    near.box(0.06, BULWARK, len + 0.06, 0, BULWARK / 2, 0, C.haze, shade, grp).userData.ao = 0.25;
    near.box(0.13, 0.07, len + 0.13, side * 0.02, BULWARK + 0.035, 0, C.wood, P.matte, grp);
    for (let s = -len / 2 + 0.35; s < len / 2; s += 0.7) near.box(0.08, BULWARK - 0.15, 0.05, side * 0.07, (BULWARK - 0.15) / 2, s, C.hazeD, shade, grp);
    // Waterway: a low flat bar inboard of the bulwark foot, drain holes through the plating
    near.box(0.015, 0.05, len - 0.3, side * 0.2, 0.025, 0, C.hazeD, P.paint, grp).userData.ao = 0;
    for (const f of drains(len)) near.box(0.012, 0.07, 0.2, side * 0.032, 0.035, (f - 0.5) * len, C.dark, P.matte, grp).userData.ao = 0;
  };
  wall(V(-b.wing, 0, zf - 0.03), V(b.wing, 0, zf - 0.03), V(0, 0, -1));
  for (const sx of [-1, 1]) {
    wall(V(sx * (b.wing - 0.03), 0, z0), V(sx * (b.wing - 0.03), 0, zf), V(-sx, 0, 0));
    wall(V(sx * b.hw, 0, z0 + 0.03), V(sx * b.wing, 0, z0 + 0.03), V(0, 0, 1));
  }
  // Over the wheelhouse the after edge stays open toward the mast: a guard rail there, well clear of the eye
  for (let x = -b.hw; x <= b.hw + 0.01; x += b.hw / 3) near.tube(V(x, yF, z0 + 0.05), V(x, yF + 1.0, z0 + 0.05), 0.025, C.rail, P.paint, 5);
  for (const hgt of [0.5, 1.0]) near.tube(V(-b.hw, yF + hgt, z0 + 0.05), V(b.hw, yF + hgt, z0 + 0.05), 0.022, C.rail, P.paint, 5);
  // Pelorus to port, gyro bearing repeater to starboard, on pedestals just behind the bulwark
  for (const sx of [-1, 1]) {
    const px = sx * (b.hw + 0.7);
    const pz = b.ze - 0.3;
    near.cyl(0.2, 0.05, px, yF, pz, C.hazeD, P.paint, 12);
    near.cyl(0.08, 0.95, px, yF, pz, C.haze, P.paint, 10, 0.06);
    near.lathe([[0.04, 0], [0.2, 0.03], [0.24, 0.12], [0.22, 0.17]], px, yF + 0.95, pz, C.chain, P.metal, 14);
    near.cyl(0.2, 0.02, px, yF + 1.1, pz, C.glass, P.glass, 14);
    if (sx < 0) near.box(0.03, 0.14, 0.45, px, yF + 1.2, pz, C.chain, P.metal);
  }
  // Signal lamps on the wings' forward corners, sidelight screens at the wing ends
  for (const sx of [-1, 1]) {
    const lx = sx * (b.wing - 0.55);
    const yc2 = yF + BULWARK + 0.07;
    near.cyl(0.07, 0.25, lx, yc2, zf - 0.1, C.chain, P.metal, 8);
    const y = near.group(lx, yc2 + 0.45, zf - 0.1);
    near.box(0.62, 0.06, 0.06, 0, -0.2, 0, C.chain, P.metal, y);
    for (const ex of [-0.28, 0.28]) near.box(0.04, 0.36, 0.06, ex, -0.02, 0, C.chain, P.metal, y);
    const body = near.mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.55, 14), C.hazeD, P.paint, y);
    body.rotation.x = Math.PI / 2;
    const lens = near.mesh(new THREE.CircleGeometry(0.2, 14), C.glass, P.glass, y);
    lens.position.z = 0.28;
    for (let i = -2; i <= 2; i++) near.box(0.4, 0.025, 0.02, 0, i * 0.075, 0.29, C.dark, P.matte, y);
    const sz = b.ze - 0.4;
    near.box(0.06, 0.75, 1.0, sx * (b.wing + 0.35), yF + 0.55, sz, C.dark, P.matte);
    near.box(0.4, 0.06, 1.0, sx * (b.wing + 0.18), yF + 0.15, sz, C.hazeD);
    near.box(0.28, 0.32, 0.28, sx * (b.wing + 0.18), yF + 0.6, sz + 0.2, sx > 0 ? C.red : C.green, P.glass);
    lamps.push({ p: V(sx * (b.wing + 0.18), yF + 0.62, sz + 0.36), color: sx > 0 ? 0xff2a1a : 0x2aff7a, kind: 'nav', near: true });
    // Dim red deck lamps under the capping: one forward, one on the wing end
    for (const [lx2, lz2, ry] of [[sx * (b.hw + 1.5), zf - 0.13, 0], [sx * (b.wing - 0.13), (z0 + zf) / 2 + 0.6, Math.PI / 2]] as const) {
      const lg = near.group(lx2, yF + BULWARK - 0.16, lz2, ry);
      near.box(0.16, 0.09, 0.07, 0, 0, 0, C.chain, P.metal, lg);
      lamps.push({ p: V(lx2 - (ry ? sx * 0.06 : 0), yF + BULWARK - 0.2, lz2 - (ry ? 0 : 0.06)), color: 0xff1a0a, kind: 'red', near: true });
      // It lights the wall under it and a half pool on the deck at the wall's foot
      const inb = ry ? V(-sx, 0, 0) : V(0, 0, -1);
      const along = ry ? V(0, 0, 1) : V(1, 0, 0);
      const wx = ry ? sx * (b.wing - 0.068) : lx2;
      const wz = ry ? lz2 : zf - 0.068;
      const hTop = BULWARK - 0.24;
      patches.push({ p: V(wx, yF + hTop / 2, wz), u: along.clone().multiplyScalar(0.62), v: V(0, hTop / 2, 0), n: inb, kind: 'wash', k: 0.38, near: true });
      patches.push({ p: V(wx, yF + 0.006, wz), u: along.clone().multiplyScalar(1.5), v: inb.clone().multiplyScalar(1.7), b0: 0, kind: 'pool', k: 0.32, near: true });
    }
    // The compass cards glow faintly under their glass
    lamps.push({ p: V(sx * (b.hw + 0.7), yF + 1.13, b.ze - 0.3), color: 0xff5a2a, kind: 'card', near: true });
  }
  // Over the ladder well: a hooded lamp low on the rail post, lighting the treads
  near.box(0.14, 0.08, 0.1, 0, yF + 0.42, z0 + 0.03, C.chain, P.metal);
  lamps.push({ p: V(0, yF + 0.36, z0 - 0.02), color: 0xff1a0a, kind: 'red', near: true });
  patches.push({ p: V(0, yF + 0.006, z0 + 0.02), u: V(0.9, 0, 0), v: V(0, 0, 0.9), b0: 0, kind: 'pool', k: 0.3, near: true });
  // Flag lockers in the wings' after corners: pigeonholes with rolled flags facing inboard, canvas cover on top
  const ends: THREE.Vector3[] = [];
  const flagCols = [0xb0261e, 0xd6b23a, 0x1f3a6b, 0xe2e4e0, 0x2c2c2c, 0x2f6b3a];
  for (const sx of [-1, 1]) {
    const lx = sx * (b.wing - 0.45);
    const lz = z0 + 1.25;
    const grp = near.group(lx, yF, lz, (-sx * Math.PI) / 2);
    near.box(1.9, 0.95, 0.6, 0, 0.475, 0, C.haze, shade, grp);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
      near.box(0.26, 0.22, 0.02, -0.8 + c * 0.32, 0.2 + r * 0.29, 0.305, C.dark, P.matte, grp);
      const roll = near.mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 6), flagCols[(r * 6 + c * 5 + (sx > 0 ? 2 : 0)) % 6]!, P.matte, grp);
      roll.rotation.x = Math.PI / 2;
      roll.position.set(-0.8 + c * 0.32, 0.17 + r * 0.29, 0.31);
    }
    near.box(2.0, 0.05, 0.7, 0, 0.98, 0, C.canvas, P.matte, grp).rotation.x = -0.1;
    ends.push(V(lx, yF + 1.0, lz));
  }
  return { ends, lamps, patches, pool: V(0, yF + 2.4, (z0 + zf) / 2), shade };
}

/**
 * The open-bridge deck: one painted non-skid texture over the whole deck (seams, waterway,
 * drain stains, worn paths) with a fine bump of aggregate tiled over it (second UV set).
 */
function floor(b: BridgeSpec, z0: number, zf: number, yF: number, spots: [number, number][]): THREE.Mesh {
  const D = zf - z0;
  const geo = new THREE.PlaneGeometry(2 * b.wing, D, 8, 4);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  const uv1 = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (p.getX(i) + b.wing) / (2 * b.wing), (p.getZ(i) + D / 2) / D);
    uv1[i * 2] = p.getX(i) / 0.9;
    uv1[i * 2 + 1] = p.getZ(i) / 0.9;
  }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  const bump = nonSkidBump(41);
  bump.channel = 1;
  const mat = new THREE.MeshStandardMaterial({
    map: bridgeDeckTexture({ wing: b.wing, hw: b.hw, z0, zf, spots, seed: Math.round(b.wing * 97) }),
    bumpMap: bump, bumpScale: 1.2, roughness: 0.9, metalness: 0.05,
  });
  const fm = new THREE.Mesh(geo, mat);
  fm.position.set(0, yF, (z0 + zf) / 2);
  fm.name = 'own-bridge-deck';
  fm.layers.set(1);
  return fm;
}
