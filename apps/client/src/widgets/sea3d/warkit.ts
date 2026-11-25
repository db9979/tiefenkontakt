import * as THREE from 'three';
import { add, box, cyl } from './parts.js';
import { K, lathe, std, windowBand, type Hull } from './hullkit.js';

/**
 * Shared building blocks for the warship models (warships.ts, escorts.ts): deck bases, struts,
 * upright lathes, chamfered deckhouses, profile solids (turrets), bridge glass, lattice masts,
 * ship's boats, a raised forecastle and the RBU rocket launcher. Bow +z, waterline y = 0.
 */
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const UP = V(0, 1, 0);
export const UNIT = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
export const WALL = std(0x6b767c, { side: THREE.DoubleSide });
export const DARK2 = std(0x24292c, { side: THREE.DoubleSide });
export const YELLOW = std(0xd8a12e, { roughness: 0.6 });
export const MARK = new THREE.MeshBasicMaterial({ color: 0xd9d9d0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
export const COLORS = { top: 0x6b767c, boot: 0x1a1d1f, bottom: 0x5a2a24 };

/** Lowest deck point between z0 and z1 (sampled), slightly sunk: a base that never floats. */
export function base(h: Hull, z0: number, z1: number): number {
  let m = Infinity;
  for (let i = 0; i <= 8; i++) m = Math.min(m, h.deckAt(z0 + ((z1 - z0) * i) / 8));
  return m - 0.15;
}

/** Thin round bar from a to b. */
export function strut(g: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const s = new THREE.Mesh(UNIT, m);
  s.scale.set(r, d.length(), r);
  s.position.copy(a).addScaledVector(d, 0.5);
  s.quaternion.setFromUnitVectors(UP, d.normalize());
  g.add(s);
  return s;
}

/** Body of revolution about the vertical axis from [radius, y] points, base at y = 0. */
export function vlathe(g: THREE.Object3D, profile: [number, number][], m: THREE.Material, seg = 16): THREE.Mesh {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), seg);
  return add(g, geo, m, 0, 0, 0);
}

/** Deckhouse from y up by hgt between z0 (aft) and z1 (front), front corners chamfered by ch. */
export function house(g: THREE.Object3D, w: number, hgt: number, z0: number, z1: number, y: number, m: THREE.Material, ch = 0): THREE.Mesh {
  const a = w / 2;
  const pts: [number, number][] = ch > 0
    ? [[-a, z0], [a, z0], [a, z1 - ch], [a - ch, z1], [-a + ch, z1], [-a, z1 - ch]]
    : [[-a, z0], [a, z0], [a, z1], [-a, z1]];
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: hgt, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return add(g, geo, m, 0, y, 0);
}

/** Solid from a side profile of [z, y] points, extruded across the width (turrets, gunhouses). */
export function profileSolid(g: THREE.Object3D, pts: [number, number][], w: number, m: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))), { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(-Math.PI / 2);
  return add(g, geo, m, 0, 0, 0);
}

/** Bridge windows across a chamfered front (front face plus both chamfers). */
export function bridgeGlass(g: THREE.Object3D, w: number, ch: number, y: number, zf: number, hgt: number): void {
  windowBand(g, w - 2 * ch - 0.2, hgt, 0, y, zf + 0.03, 'z+');
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(ch * Math.SQRT2 - 0.2, hgt), K.glass);
    p.position.set(sx * (w / 2 - ch / 2 + 0.02), y, zf - ch / 2 + 0.02);
    p.rotation.y = (sx * Math.PI) / 4;
    g.add(p);
  }
}

/** Four-legged lattice tower from y0, tapering from w0 to w1, braced in bays. */
export function lattice(g: THREE.Object3D, y0: number, z: number, hgt: number, w0: number, w1: number, bays: number, m: THREE.Material): void {
  const ring = (k: number) => {
    const f = k / bays;
    const a = (w0 + (w1 - w0) * f) / 2;
    const y = y0 + hgt * f;
    return [V(a, y, z + a), V(-a, y, z + a), V(-a, y, z - a), V(a, y, z - a)];
  };
  for (let k = 0; k < bays; k++) {
    const lo = ring(k);
    const hi = ring(k + 1);
    for (let i = 0; i < 4; i++) {
      strut(g, lo[i]!, hi[i]!, 0.13, m);
      strut(g, hi[i]!, hi[(i + 1) % 4]!, 0.07, m);
      strut(g, lo[i]!, hi[(i + 1) % 4]!, 0.05, m);
    }
  }
}

/** Ship's boat on two chocks with a pair of davits outboard of it at davitX. */
export function boat(g: THREE.Object3D, x: number, y: number, z: number, len: number, davitX: number): void {
  for (const dz of [-len * 0.25, len * 0.25]) box(g, 1.2, 0.5, 0.35, x, y + 0.25, z + dz, K.navyDark);
  const b = lathe(g, [[0.01, -len / 2], [0.5, -len / 2 + 0.3], [0.8, -len / 2 + 1.3], [0.8, len / 2 - 1.6], [0.35, len / 2 - 0.25], [0.01, len / 2]], K.white, 10);
  b.scale.y = 0.75;
  b.position.set(x, y + 0.45 + 0.8 * 0.75, z);
  const top = y + 2.6;
  for (const dz of [-len * 0.35, len * 0.35]) {
    cyl(g, 0.12, 2.6, davitX, y + 1.3, z + dz, K.navy);
    box(g, Math.abs(davitX - x) + 0.2, 0.2, 0.2, (davitX + x) / 2, top, z + dz, K.navy);
    cyl(g, 0.03, top - (y + 1.6), x, (top + y + 1.6) / 2, z + dz, K.black);
  }
}

/**
 * Raised forecastle: lifts the deck by `rise` from z0 forward, with vertical topsides on the
 * hull's deck edge, a new deck and an aft bulkhead. Returns a Hull for the new deck.
 */
export function forecastle(g: THREE.Object3D, h: Hull, z0: number, rise: number): Hull {
  const L = h.spec.len / 2;
  const pos: number[] = [];
  const idx: number[] = [];
  const dpos: number[] = [];
  const didx: number[] = [];
  const zs: number[] = [];
  for (let z = z0; z < L; z += 1) zs.push(z);
  zs.push(L);
  zs.forEach((z, i) => {
    const y = h.deckAt(z);
    const w = h.halfBeamAt(z, y);
    pos.push(w, y - 0.05, z, w, y + rise, z, -w, y - 0.05, z, -w, y + rise, z);
    dpos.push(-w * 0.995, y + rise + 0.02, z, w * 0.995, y + rise + 0.02, z);
    if (i < zs.length - 1) {
      const a = i * 4;
      idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5, a + 2, a + 3, a + 6, a + 3, a + 7, a + 6);
      didx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
  });
  // Aft bulkhead
  const n = pos.length / 3;
  const w0 = h.halfBeamAt(z0, h.deckAt(z0));
  const y0 = h.deckAt(z0);
  pos.push(-w0, y0 - 0.05, z0, w0, y0 - 0.05, z0, w0, y0 + rise, z0, -w0, y0 + rise, z0);
  idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, WALL));
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  dgeo.setIndex(didx);
  dgeo.computeVertexNormals();
  g.add(new THREE.Mesh(dgeo, K.deck));
  return {
    spec: h.spec,
    deckAt: (z) => h.deckAt(z) + (z >= z0 ? rise : 0),
    halfBeamAt: (z, y) => h.halfBeamAt(z, Math.min(y, h.deckAt(z))),
  };
}
/** RBU-6000 style ASW rocket launcher: pedestal, cradle and a ring of 12 barrels, trained ahead. */
export function rbu(g: THREE.Object3D, x: number, y: number, z: number): void {
  cyl(g, 0.65, 0.6, x, y + 0.3, z, K.navyDark);
  for (const sx of [-1, 1]) box(g, 0.15, 1.1, 0.9, x + sx * 0.68, y + 1.05, z, K.navyDark);
  const b = new THREE.Group();
  b.position.set(x, y + 1.35, z);
  b.rotation.x = -0.55;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const t = add(b, new THREE.CylinderGeometry(0.11, 0.11, 1.8, 6, 1, true), K.navy, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.1);
    t.rotation.x = Math.PI / 2;
  }
  g.add(b);
}

