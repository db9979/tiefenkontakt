import * as THREE from 'three';
import { C, Kit, P, facet } from './own-kit.js';

/**
 * Deck fittings and weapons for the own ship's close-range model (own-detail.ts): gun mounts,
 * the ASW box launcher, the missile bin, anchor gear with chain, bitts, fairleads, hatches,
 * ventilators, breakwater, jackstaff and railings. Generic naval detail, no particular ship.
 * Bow +z, port +x, waterline y = 0; every part stands on the deck surface the Deck describes.
 */

export interface Deck {
  /** Deck surface height (with camber) at (x, z). */
  y(x: number, z: number): number;
  /** Half breadth of the deck (inside the toe rail) at z. */
  half(z: number): number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Gun mount at (0, y, z): base ring, faceted gunhouse, blast bags, barrel(s) trained ahead. */
export function gunMount(k: Kit, y: number, z: number, w: number, twin: boolean): void {
  const s = w / (twin ? 4.6 : 4.2);
  const g = k.group(0, y, z);
  g.scale.setScalar(s);
  k.mark('grime', 0, z, 2.3 * s);
  k.mark('arc', 0, z, 3.4 * s);
  // Deck ring with its bolts, then the training base
  k.cyl(2.35, 0.08, 0, 0, 0, C.hazeD, P.paint, 28, 2.35, g);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    k.cyl(0.045, 0.07, Math.cos(a) * 2.22, 0.08, Math.sin(a) * 2.22, C.hazeD, P.paint, 5, 0.045, g);
  }
  k.cyl(2.05, 0.36, 0, 0.08, 0, C.hazeD, P.paint, 28, 2.0, g);
  // Plan at the foot, at the knuckle and at the roof: sloped front, chamfered and sloped rear
  const pts: [number, number][][] = twin
    ? [[[-1.9, -3.2], [1.9, -3.2], [2.3, -2.7], [2.3, 1.2], [1.9, 2.9], [-1.9, 2.9], [-2.3, 1.2], [-2.3, -2.7]],
      [[-1.9, -3.2], [1.9, -3.2], [2.3, -2.7], [2.3, 1.1], [1.9, 2.7], [-1.9, 2.7], [-2.3, 1.1], [-2.3, -2.7]],
      [[-1.6, -2.6], [1.6, -2.6], [2.0, -2.2], [2.05, 0.4], [1.6, 1.4], [-1.6, 1.4], [-2.05, 0.4], [-2.0, -2.2]]]
    : [[[-1.6, -3.1], [1.6, -3.1], [2.1, -2.6], [2.1, 0.9], [1.25, 2.7], [-1.25, 2.7], [-2.1, 0.9], [-2.1, -2.6]],
      [[-1.6, -3.1], [1.6, -3.1], [2.1, -2.6], [2.1, 0.7], [1.25, 2.45], [-1.25, 2.45], [-2.1, 0.7], [-2.1, -2.6]],
      [[-1.3, -2.5], [1.3, -2.5], [1.75, -2.05], [1.75, 0.1], [0.95, 1.25], [-0.95, 1.25], [-1.75, 0.1], [-1.75, -2.05]]];
  const hy = 0.44;
  const roof = twin ? 2.5 : 2.45;
  const house = k.mesh(facet([{ y: 0, pts: pts[0]! }, { y: twin ? 0.9 : 1.0, pts: pts[1]! }, { y: roof, pts: pts[2]! }]), C.gun, P.paint, g);
  house.position.y = hy;
  house.userData.ao = 0.2;
  // Gun ports on the sloped front, blast bags over them, tapered barrels with a muzzle swell, a few degrees up
  const ay = hy + 1.2;
  const slope = twin ? Math.atan2(1.3, 1.6) : Math.atan2(1.2, 1.45);
  const zPort = twin ? 2.7 - (0.3 / 1.6) * 1.3 : 2.45 - (0.2 / 1.45) * 1.2;
  for (const x of twin ? [-0.72, 0.72] : [0]) {
    const port = k.box(0.62, 0.95, 0.05, x, ay + 0.1, zPort + 0.01, C.dark, P.matte, g);
    port.rotation.x = -slope;
    const b = k.group(x, ay, zPort - 0.25, 0, -0.1, g);
    const bag = k.lathe([[0.56, 0], [0.54, 0.16], [0.43, 0.25], [0.48, 0.36], [0.36, 0.47], [0.4, 0.58], [0.27, 0.69], [0.19, 0.86]], 0, 0, 0, C.canvas, P.matte, 12, b);
    bag.rotation.x = Math.PI / 2;
    const len = twin ? 5.8 : 7;
    const br = k.mesh(new THREE.CylinderGeometry(0.21, 0.29, len, 12, 1, true), C.hazeL, P.paint, b);
    br.rotation.x = Math.PI / 2;
    br.position.z = 0.7 + len / 2;
    // Barrel collar just ahead of the blast bag
    const collar = k.mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.4, 12), C.gun, P.paint, b);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 0.95;
    const mz = k.mesh(new THREE.CylinderGeometry(0.27, 0.22, 0.6, 12), C.hazeL, P.paint, b);
    mz.rotation.x = Math.PI / 2;
    mz.position.z = 0.7 + len - 0.25;
    const bore = k.mesh(new THREE.CircleGeometry(0.11, 10), C.dark, P.matte, b);
    bore.position.z = 0.7 + len + 0.003;
  }
  // Side doors (outlines proud of the plating) and a grab rail along each roof edge
  const side = twin ? 2.3 : 2.05;
  for (const sx of [-1, 1]) {
    k.box(0.04, 1.4, 0.75, sx * (side + 0.02), hy + 0.85, -1.6, C.hazeD, P.paint, g);
    k.tube(V(sx * (side - 0.45), hy + roof + 0.12, -2.2), V(sx * (side - 0.45), hy + roof + 0.12, -0.6), 0.025, C.hazeL, P.paint, 4, g);
    for (const zz of [-2.1, -1.4, -0.7]) k.tube(V(sx * (side - 0.45), hy + roof, zz), V(sx * (side - 0.45), hy + roof + 0.13, zz), 0.02, C.hazeL, P.paint, 4, g);
  }
  // Roof: sight hoods with dark slits, hatch, vent; rear door and ladder rungs
  const ry = hy + roof;
  for (const sx of [-1, 1]) {
    k.box(0.5, 0.36, 0.75, sx * (twin ? 1.35 : 1.05), ry + 0.18, -0.2, C.gun, P.paint, g);
    k.box(0.36, 0.08, 0.02, sx * (twin ? 1.35 : 1.05), ry + 0.24, 0.17, C.dark, P.matte, g);
  }
  k.box(0.85, 0.07, 0.85, 0, ry + 0.035, -1.2, C.hazeL, P.paint, g);
  // Roof plate seams, the mount captain's cupola with vision slits, lifting eyes at the corners
  for (const zz of [-0.5, -2.0]) k.box(twin ? 3.9 : 3.2, 0.02, 0.05, 0, ry + 0.01, zz, C.hazeD, P.paint, g);
  const cx = twin ? 1.2 : 0.95;
  k.lathe([[0.42, 0], [0.42, 0.22], [0.36, 0.3], [0.01, 0.32]], cx, ry, -1.5, C.gun, P.paint, 12, g);
  k.box(0.5, 0.05, 0.1, cx, ry + 0.18, -1.1, C.dark, P.matte, g);
  for (const sx of [-1, 1]) for (const zz of [-2.0, 0]) {
    const eye = k.torus(0.08, 0.02, C.hazeD, P.paint, 4, 8, Math.PI * 2, g);
    eye.position.set(sx * (twin ? 1.75 : 1.45), ry + 0.08, zz);
    eye.rotation.y = Math.PI / 2;
  }
  k.cyl(0.13, 0.35, twin ? -1.2 : -0.9, ry, -2.0, C.gun, P.paint, 8, 0.13, g);
  k.lathe([[0.3, 0], [0.28, 0.08], [0.14, 0.17], [0.01, 0.19]], twin ? -1.2 : -0.9, ry + 0.35, -2.0, C.gun, P.paint, 10, g);
  // Rear: low door in the upright skirt, step bars, shell-ejection flap on the sloped back
  const rz = twin ? -3.22 : -3.12;
  k.box(0.8, 0.85, 0.05, -0.6, hy + 0.48, rz, C.hazeD, P.paint, g);
  for (let i = 0; i < 2; i++) k.tube(V(0.6, hy + 0.3 + i * 0.4, rz - 0.1), V(1.0, hy + 0.3 + i * 0.4, rz - 0.1), 0.02, C.hazeL, P.paint, 4, g);
  const flap = k.box(1.0, 0.7, 0.04, 0.3, hy + 1.65, (rz + (twin ? -2.6 : -2.5)) / 2 - 0.02, C.hazeD, P.paint, g);
  flap.rotation.x = Math.atan2(twin ? 0.6 : 0.6, twin ? 1.6 : 1.45);
}

/**
 * Eight-cell ASW box launcher at (0, y, z) on a raised training base, cells cocked up toward the
 * bow: front covers, rear doors with hinges and cell numbers, stencils; a blast deflector abaft it.
 */
export function boxLauncher(k: Kit, d: Deck, y: number, z: number): void {
  k.mark('grime', 0, z, 1.8);
  const g = k.group(0, y, z);
  k.cyl(1.6, 0.1, 0, 0, 0, C.hazeD, P.paint, 24, 1.6, g);
  k.lathe([[1.35, 0.1], [1.35, 0.3], [1.12, 0.42], [1.05, 1.9], [1.22, 2.0], [1.22, 2.25], [0.01, 2.25]], 0, 0, 0, C.haze, P.paint, 20, g);
  for (let i = 0; i < 4; i++) k.box(0.05, 1.3, 0.3, Math.cos((i * Math.PI) / 2) * 1.08, 1.1, Math.sin((i * Math.PI) / 2) * 1.08, C.hazeD, P.paint, g).rotation.y = (-i * Math.PI) / 2;
  const py = 3.35;
  for (const sx of [-1, 1]) {
    k.box(0.3, 1.4, 1.7, sx * 1.95, py - 0.4, 0, C.haze, P.paint, g);
    k.box(1.1, 0.3, 1.7, sx * 1.5, 2.4, 0, C.haze, P.paint, g);
    k.cyl(0.34, 0.2, sx * 2.05, py, 0, C.hazeD, P.paint, 10, 0.34, g).rotation.z = Math.PI / 2;
  }
  const ln = k.group(0, py, 0.1, 0, -0.38, g);
  for (const sx of [-1, 1]) {
    const cx = sx * 0.88;
    k.box(1.55, 1.9, 4.6, cx, 0, 0, C.haze, P.paint, ln).userData.ao = 0.12;
    // Front: dark frame with four frangible cell covers
    k.box(1.45, 1.8, 0.04, cx, 0, 2.31, C.dark, P.matte, ln);
    for (const dx of [-0.36, 0.36]) for (const dy of [-0.44, 0.44]) k.box(0.62, 0.78, 0.05, cx + dx, dy, 2.33, C.white, P.paint, ln);
    // Rear: four doors with hinge pins along their tops, dogs, cell numbers
    k.box(1.45, 1.8, 0.04, cx, 0, -2.31, C.dark, P.matte, ln);
    let n = sx < 0 ? 1 : 5;
    for (const dy of [0.44, -0.44]) for (const dx of [-0.36, 0.36]) {
      k.box(0.64, 0.8, 0.06, cx + dx, dy, -2.34, C.hazeL, P.paint, ln);
      const hinge = k.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), C.steel, P.metal, ln);
      hinge.rotation.z = Math.PI / 2;
      hinge.position.set(cx + dx, dy + 0.42, -2.39);
      k.box(0.06, 0.1, 0.05, cx + dx + 0.28, dy - 0.25, -2.39, C.steel, P.metal, ln);
      const num = k.decal(`n${n++}`, 0.3, 0.3, ln);
      num.position.set(cx + dx - 0.1, dy - 0.05, -2.375);
      num.rotation.y = Math.PI;
    }
    // Stiffeners along the outer side and over the top, a stencil on top
    for (const zz of [-1.6, -0.5, 0.6, 1.7]) {
      k.box(0.07, 1.95, 0.14, cx + sx * 0.8, 0, zz, C.hazeD, P.paint, ln);
      k.box(1.6, 0.07, 0.14, cx, 0.98, zz, C.hazeD, P.paint, ln);
    }
    const st = k.decal('noStep', 1.3, 0.16, ln);
    st.rotation.set(-Math.PI / 2, 0, Math.PI);
    st.position.set(cx, 0.955, -1.05);
  }
  // Blast deflector abaft the launcher: inclined plate on stays, warning stencil
  const zb = z - 3.3;
  const yb = d.y(0, zb) - 0.05;
  const bd = k.group(0, yb, zb, 0, -0.15);
  k.box(4.6, 1.6, 0.06, 0, 0.8, 0, C.haze, P.paint, bd);
  k.box(4.7, 0.08, 0.14, 0, 1.6, 0, C.hazeL, P.paint, bd);
  const w = k.decal('blast', 2.6, 0.26, bd);
  w.position.set(0, 1.2, 0.035);
  for (const x of [-1.9, -0.6, 0.6, 1.9]) {
    k.tube(V(x, 1.5, -0.03), V(x, 0, -0.55), 0.05, C.hazeD, P.paint, 5, bd);
    k.box(0.25, 0.04, 0.25, x, 0.02, -0.55, C.hazeD, P.paint, bd);
  }
  k.mark('grime', 0, zb - 0.4, 1.2);
}

/** Round pop-up missile launcher bin let into the deck at (0, y, z): flange with bolts, split lid. */
export function missileBin(k: Kit, y: number, z: number, r: number): void {
  k.mark('grime', 0, z, r + 0.4);
  const g = k.group(0, y, z);
  k.lathe([[r + 0.18, 0], [r + 0.18, 0.12], [r + 0.05, 0.15], [r + 0.05, 0.72], [r + 0.1, 0.78], [r - 0.05, 0.86], [0.01, 0.9]], 0, 0, 0, C.haze, P.paint, 32, g);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    k.cyl(0.04, 0.06, Math.cos(a) * (r + 0.11), 0.12, Math.sin(a) * (r + 0.11), C.hazeD, P.paint, 5, 0.04, g);
  }
  k.box(2 * r - 0.1, 0.02, 0.05, 0, 0.9, 0, C.dark, P.matte, g);
  for (const sx of [-1, 1]) {
    k.box(0.25, 0.22, 0.6, sx * (r + 0.02), 0.75, 0, C.hazeD, P.paint, g);
    k.box(0.5, 0.06, 0.5, sx * r * 0.45, 0.91, sx * 0.5, C.hazeL, P.paint, g);
  }
}

/** Gypsy windlass / capstan at (x, z) with brake handwheel; returns the gypsy's chain point. */
export function capstan(k: Kit, d: Deck, x: number, z: number): THREE.Vector3 {
  const y = d.y(x, z) - 0.02;
  k.mark('grime', x, z, 0.9);
  k.cyl(0.62, 0.1, x, y, z, C.hazeD, P.paint, 18);
  k.lathe([[0.52, 0.1], [0.44, 0.2], [0.36, 0.42], [0.36, 0.5]], x, y, z, C.haze, P.paint, 16);
  k.cyl(0.42, 0.24, x, y + 0.5, z, C.chain, P.metal, 12);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    k.box(0.1, 0.22, 0.12, x + Math.cos(a) * 0.43, y + 0.62, z + Math.sin(a) * 0.43, C.chain, P.metal).rotation.y = -a;
  }
  k.lathe([[0.32, 0], [0.33, 0.06], [0.24, 0.17], [0.01, 0.22]], x, y + 0.74, z, C.steel, P.metal, 14);
  const bx = x + Math.sign(x) * 0.85;
  k.box(0.14, 0.8, 0.14, bx, y + 0.4, z - 0.15, C.haze);
  const wheel = k.torus(0.2, 0.025, C.chain, P.metal, 4, 12);
  wheel.position.set(bx, y + 0.83, z - 0.15);
  wheel.rotation.x = Math.PI / 2;
  return V(x, y + 0.62, z);
}

/** Anchor chain from a to b: oval links, each turned a quarter to the last, sagging a little. */
export function chain(k: Kit, a: THREE.Vector3, b: THREE.Vector3, sag = 0.05): void {
  const len = a.distanceTo(b);
  const n = Math.max(2, Math.round(len / 0.19));
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const twist = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const p = new THREE.Vector3().lerpVectors(a, b, f);
    p.y -= sag * 4 * f * (1 - f);
    const link = k.torus(0.07, 0.022, C.chain, P.metal, 3, 8);
    link.scale.set(1, 1.5, 1);
    link.position.copy(p);
    twist.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i % 2 ? Math.PI / 2 : 0);
    link.quaternion.copy(q).multiply(twist);
  }
}

/** Deck end of a hawse or chain pipe at (x, z): raised lip, dark mouth; returns its centre. */
export function deckPipe(k: Kit, d: Deck, x: number, z: number, r: number): THREE.Vector3 {
  const y = d.y(x, z) - 0.02;
  k.mark('rust', x, z, r * 2.6);
  k.lathe([[r - 0.06, 0.16], [r + 0.12, 0.02], [r + 0.16, 0], [r + 0.16, 0.06], [r + 0.04, 0.2], [r - 0.06, 0.2]], x, y, z, C.hazeD, P.paint, 14);
  const m = k.mesh(new THREE.CircleGeometry(r - 0.04, 12), C.dark, P.matte);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + 0.12, z);
  return V(x, y + 0.15, z);
}

/** Chain stopper between pipe and gypsy, on the line a→b at fraction f. */
export function stopper(k: Kit, d: Deck, a: THREE.Vector3, b: THREE.Vector3, f: number): void {
  const p = new THREE.Vector3().lerpVectors(a, b, f);
  const y = d.y(p.x, p.z) - 0.02;
  const g = k.group(p.x, y, p.z, Math.atan2(b.x - a.x, b.z - a.z));
  k.box(0.55, 0.1, 0.8, 0, 0.05, 0, C.hazeD, P.paint, g);
  for (const sx of [-1, 1]) k.box(0.07, 0.3, 0.7, sx * 0.2, 0.22, 0, C.haze, P.paint, g);
  const bar = k.mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), C.steel, P.metal, g);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 0.36, 0.15);
}

/** Double bitts (mooring bollards) on a base plate at (x, z), along the ship. */
export function bitts(k: Kit, d: Deck, x: number, z: number): void {
  const y = d.y(x, z) - 0.02;
  k.mark('grime', x, z, 0.8);
  k.box(0.5, 0.08, 1.35, x, y + 0.04, z, C.hazeD);
  for (const dz of [-0.4, 0.4]) {
    k.cyl(0.15, 0.5, x, y + 0.08, z + dz, C.haze, P.paint, 12);
    k.cyl(0.2, 0.05, x, y + 0.58, z + dz, C.steel, P.metal, 12);
  }
}

/** Roller fairlead at the deck edge (x, z). */
export function fairlead(k: Kit, d: Deck, x: number, z: number): void {
  const y = d.y(x, z) - 0.02;
  k.mark('grime', x, z, 0.5);
  k.box(0.32, 0.06, 0.75, x, y + 0.03, z, C.hazeD);
  for (const dz of [-0.3, 0.3]) {
    k.box(0.28, 0.34, 0.06, x, y + 0.2, z + dz, C.haze);
    k.cyl(0.09, 0.3, x, y + 0.06, z + dz * 0.5, C.steel, P.metal, 8);
  }
}

/** Raised hatch with dogs and hinges (w across, l along). */
export function hatch(k: Kit, d: Deck, x: number, z: number, w: number, l: number): void {
  const y = d.y(x, z) - 0.03;
  k.mark('grime', x, z, Math.max(w, l) * 0.7);
  k.box(w, 0.32, l, x, y + 0.16, z, C.hazeD);
  k.box(w + 0.08, 0.07, l + 0.08, x, y + 0.355, z, C.haze);
  for (const sx of [-1, 1]) for (const f of [-0.3, 0.3]) k.box(0.05, 0.13, 0.06, x + sx * (w / 2 + 0.05), y + 0.3, z + f * l, C.steel, P.metal);
  for (const f of [-0.3, 0.3]) k.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6), C.hazeD, P.paint).position.set(x + f * w, y + 0.35, z - l / 2 - 0.04);
}

/** Round scuttle (escape hatch) with handwheel. */
export function scuttle(k: Kit, d: Deck, x: number, z: number): void {
  const y = d.y(x, z) - 0.03;
  k.mark('grime', x, z, 0.6);
  k.cyl(0.42, 0.32, x, y, z, C.hazeD, P.paint, 16);
  k.cyl(0.47, 0.06, x, y + 0.32, z, C.haze, P.paint, 16);
  const w = k.torus(0.16, 0.022, C.steel, P.metal, 4, 10);
  w.rotation.x = Math.PI / 2;
  w.position.set(x, y + 0.45, z);
  k.box(0.2, 0.1, 0.15, x, y + 0.33, z - 0.48, C.hazeD);
}

/** Mushroom ventilator. */
export function mushroom(k: Kit, d: Deck, x: number, z: number, r = 0.15): void {
  const y = d.y(x, z) - 0.03;
  k.mark('grime', x, z, 0.4);
  k.cyl(r, 0.6, x, y, z, C.haze, P.paint, 10);
  k.lathe([[r * 2.2, 0], [r * 2.1, 0.07], [r * 1.1, r * 1.2], [0.01, r * 1.3]], x, y + 0.6, z, C.haze, P.paint, 12);
  k.cyl(r * 2.2, 0.06, x, y + 0.54, z, C.dark, P.matte, 12);
}

/** Gooseneck ventilator (pipe bent down, mouth aft). */
export function gooseneck(k: Kit, d: Deck, x: number, z: number): void {
  const y = d.y(x, z) - 0.03;
  k.mark('grime', x, z, 0.35);
  k.cyl(0.1, 0.55, x, y, z, C.haze, P.paint, 8);
  const t = k.torus(0.17, 0.1, C.haze, P.paint, 6, 8, Math.PI);
  t.position.set(x, y + 0.55, z - 0.17);
  t.rotation.y = Math.PI / 2;
  k.cyl(0.1, 0.25, x, y + 0.3, z - 0.34, C.haze, P.paint, 8);
  k.cyl(0.08, 0.02, x, y + 0.29, z - 0.34, C.dark, P.matte, 8);
}

/** V breakwater (apex ahead at zb + 1.7) with brackets aft, a cap bar and limber holes at its foot. */
export function breakwater(k: Kit, d: Deck, zb: number, span: number, h: number): void {
  const apex = 1.7;
  const len = Math.hypot(span, apex);
  for (const sx of [-1, 1]) {
    const mx = (sx * span) / 2;
    const mz = zb + apex / 2;
    const g = k.group(mx, d.y(mx, mz) - 0.05, mz, Math.atan2(sx * span, -apex));
    k.box(0.05, h, len + 0.05, 0, h / 2, 0, C.haze, P.paint, g);
    k.box(0.14, 0.05, len + 0.05, sx * 0.03, h, 0, C.hazeL, P.paint, g);
    const nb = Math.max(2, Math.floor(len / 0.8));
    for (let i = 0; i <= nb; i++) {
      const zz = -len / 2 + (i / nb) * len;
      k.box(0.45, h * 0.8, 0.04, sx * 0.25, h * 0.4, zz, C.hazeD, P.paint, g);
      if (i % 2) k.box(0.06, 0.13, 0.28, -sx * 0.03, 0.07, zz, C.dark, P.matte, g);
      k.mark('grime', sx * (span * i) / nb, zb + apex - (apex * i) / nb, 0.45);
    }
  }
}

/** Jackstaff in its socket at the stem. */
export function jackstaff(k: Kit, d: Deck, z: number): void {
  const y = d.y(0, z);
  k.cyl(0.09, 0.35, 0, y - 0.05, z, C.hazeD, P.paint, 8);
  k.cyl(0.05, 3.3, 0, y + 0.25, z, C.hazeL, P.paint, 6, 0.025);
  k.mesh(new THREE.SphereGeometry(0.06, 6, 4), C.hazeL).position.set(0, y + 3.58, z);
  // The jack, furled round the staff
  k.cyl(0.07, 0.9, 0.06, y + 2.5, z, 0x1f3a6b, P.matte, 8, 0.05);
}

/**
 * Guard rails on both sides from z0 to z1: stanchions, a top rail and two wires; ahead of
 * chainFrom the spans are sagging chains (they come down for anchor work).
 */
export function rails(k: Kit, d: Deck, z0: number, z1: number, chainFrom: number, step: number, inset = 0.12): void {
  for (const sx of [-1, 1]) {
    let prev: THREE.Vector3 | undefined;
    const n = Math.max(1, Math.round((z1 - z0) / step));
    for (let i = 0; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n;
      const x = sx * Math.max(0.3, d.half(z) - inset);
      const y = d.y(x, z) - 0.02;
      const p = V(x, y, z);
      k.box(0.1, 0.04, 0.1, x, y + 0.02, z, C.hazeD);
      k.tube(p, V(x, y + 1.05, z), 0.022, C.rail, P.paint, 5);
      if (prev) {
        const chainSpan = z > chainFrom;
        for (const [hgt, r] of [[1.0, 0.018], [0.66, 0.009], [0.33, 0.009]] as const) {
          const a = V(prev.x, prev.y + hgt, prev.z);
          const b = V(x, y + hgt, z);
          if (chainSpan && hgt < 0.4) continue;
          if (!chainSpan) {
            k.tube(a, b, r, C.rail, P.paint, 4);
            continue;
          }
          // Chain: three sagging pieces
          let q = a;
          for (let j = 1; j <= 3; j++) {
            const f = j / 3;
            const nxt = new THREE.Vector3().lerpVectors(a, b, f);
            nxt.y -= 0.14 * 4 * f * (1 - f);
            k.tube(q, nxt, 0.016, C.chain, P.metal, 4);
            q = nxt;
          }
        }
      }
      prev = p;
    }
  }
}
