import * as THREE from 'three';
import type { Hull } from './hullkit.js';
import { MARK, UNIT, base } from './warkit.js';
import { C, Kit, P, facet } from './own-kit.js';
import type { Deck } from './own-fittings.js';
import type { Lamp } from './own-lights.js';

/**
 * Aft and amidships detail for the own ship's close-range model (own-detail.ts): what the bridge
 * sees looking aft and from the wings — foremast fittings (yard whips, surface and navigation
 * radar, ESM, masthead light, platform rails, halyards), funnel exhausts, boats in davits,
 * life-raft canisters, torpedo tubes trained outboard, decoy launchers, hangar door and landing-control cab, flight-deck
 * markings and nets, quarterdeck gear and the ensign. Positions follow the generic models
 * (escorts.ts, warships.ts) of each class. Bow +z, port +x.
 */

export interface Aft {
  /** Foremast: z, the yard (height, half span), top platform height and half size, pole top. */
  mast: { z: number; yardY: number; yardHalf: number; top: number; plat: number; pole?: { z: number; top: number }; tripod?: number; raise?: number };
  funnel: { z: number; y: number; h: number; rake: number; rx: number; rz: number };
  boats?: { x: number; y: number; z: number; len: number; davit: number };
  /** Raft racks: [x, y, z] of the rack centre, canisters athwartships, 4 to a rack. */
  rafts: [number, number, number][];
  /** 01-deck roof edge rails: half width, height, z from, z to. */
  roofRail?: { half: number; y: number; z0: number; z1: number };
  /** Triple torpedo tubes (ffg, on the 01 deck): pivot x (port side), deck y, z. */
  tubes?: { z: number; x: number; y: number };
  /** Twin heavy tubes on turntables (kor, main deck): pivot x, turntable top y, z. */
  twin?: { z: number; x: number; y: number };
  /** Six-barrel decoy launchers, port side [x, deck y, z] (mirrored to starboard). */
  decoys: [number, number, number][];
  hangar?: { half: number; aft: number; floor: number; top: number };
  flight?: { y: number; z0: number; z1: number; spot: number; half: number };
  winch?: [number, number];
}

export function aftLayout(cls: 'ffg' | 'ffv' | 'kor', h: Hull, top: (z: number) => number): Aft {
  if (cls === 'ffg') {
    const y0 = base(h, -44, 27);
    const l1 = y0 + 3;
    const l2 = l1 + 2.8;
    const mt = l2 + 15.5;
    return {
      mast: { z: 8.5, yardY: l2 + 15.5 * 0.62, yardHalf: 3.75, top: mt, plat: 1.1, pole: { z: 7.6, top: mt + 6.7 }, tripod: l2 },
      funnel: { z: -3, y: l1 - 0.3, h: 5.25, rake: 0.1, rx: 2.2, rz: 3.5 },
      boats: { x: 3.9, y: l1, z: -11, len: 6.4, davit: 4.9 },
      rafts: [[4.7, l1, -17.6], [-4.7, l1, -17.6], [4.7, l1, 1.6], [-4.7, l1, 1.6]],
      roofRail: { half: 5.45, y: l1, z0: -19.5, z1: 3.5 },
      // The generic tubes stand fore and aft in the narrow waterway beside the house: trained out they need the 01 deck
      tubes: { z: -3.7, x: 4.15, y: l1 },
      decoys: [[4.75, l1, 5.3], [4.75, l1, 7.5]],
      hangar: { half: 5.8, aft: -44, floor: y0, top: l1 + 3.4 },
      flight: { y: h.deckAt(-55), z0: -66, z1: -44.5, spot: -55, half: 0 },
      winch: [3.0, -63.8],
    };
  }
  if (cls === 'ffv') {
    const r1 = h.deckAt(26) + 2.4;
    const yf = h.deckAt(-40) + 2.4;
    return {
      mast: { z: 10.5, yardY: r1 + 10.5, yardHalf: 3.5, top: r1 + 15, plat: 0.95, pole: { z: 9.95, top: r1 + 15 + 5.6 }, tripod: r1 },
      funnel: { z: 2.5, y: r1 - 0.45, h: 6.8, rake: 0.08, rx: 2.6, rz: 4.0 },
      boats: { x: 3.7, y: r1, z: 2.6, len: 6.4, davit: 4.6 },
      rafts: [[4.2, r1, -9.2], [-4.2, r1, -9.2]],
      decoys: [[3.9, r1, -2.5], [3.9, r1, -4.7]],
      roofRail: { half: 4.65, y: r1, z0: -11.5, z1: 10 },
      hangar: { half: 4.3, aft: -28.5, floor: yf, top: yf + 4.2 },
      flight: { y: yf + 0.04, z0: -46.8, z1: -29, spot: -38.5, half: 5.3 },
    };
  }
  const r1 = top(17.5) + 2.3;
  return {
    // The pyramid mast ends below the bridge eye: a lattice topmast lifts the radar clear of it
    mast: { z: 0.8, yardY: r1 + 12, yardHalf: 2.6, top: r1 + 13.5, plat: 0.85, raise: 6 },
    funnel: { z: -6.3, y: r1 - 0.35, h: 3.05, rake: 0.1, rx: 1.8, rz: 2.6 },
    rafts: [[2.75, r1, -8.6], [-2.75, r1, -8.6]],
    twin: { z: -15.5, x: 2.6, y: base(h, -18.5, -12.5) + 0.4 },
    decoys: [[2.85, r1, -4.7]],
    roofRail: { half: 3.55, y: r1, z0: -9.8, z1: -1.5 },
  };
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Remove generic parts the detail replaces: boats with their davits, flight-deck paint. */
export function stripAft(g: THREE.Group, a: Aft): void {
  const box = new THREE.Box3();
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  const drop: THREE.Object3D[] = [];
  for (const o of g.children) {
    const m = o as THREE.Mesh;
    if (o.name || !m.isMesh) continue;
    box.setFromObject(o).getCenter(c);
    box.getSize(s);
    // The bare lattice foremast gives way to a tripod
    if (a.mast.tripod !== undefined && m.geometry === UNIT && Math.abs(c.z - a.mast.z) < 2.4 && c.y > a.mast.tripod && c.y < a.mast.top + 0.5) drop.push(o);
    if (m.material === MARK && a.flight && c.z < a.flight.z1 + 1) drop.push(o);
    // Generic torpedo tubes (fore and aft): rebuilt trained outboard
    const cg = m.geometry as THREE.CylinderGeometry;
    if (cg.type === 'CylinderGeometry' && ((cg.parameters.height === 3.2 && cg.parameters.radiusTop === 0.25) || (cg.parameters.height === 6.2 && cg.parameters.radiusTop === 0.33))) drop.push(o);
    const b = a.boats;
    if (b && Math.max(s.x, s.y, s.z) < b.len + 0.5 && Math.abs(Math.abs(c.x) - (b.x + b.davit) / 2) < 1.3 && c.y > b.y - 0.05 && c.y < b.y + 3.2 && Math.abs(c.z - b.z) < b.len / 2 + 0.6) drop.push(o);
  }
  for (const o of drop) o.removeFromParent();
}

/** Straight guard rail a→b: stanchions, top rail and a middle wire. */
export function rail(k: Kit, a: THREE.Vector3, b: THREE.Vector3, step = 1.8): void {
  const n = Math.max(1, Math.round(a.distanceTo(b) / step));
  for (let i = 0; i <= n; i++) {
    const p = new THREE.Vector3().lerpVectors(a, b, i / n);
    k.tube(p, V(p.x, p.y + 1.0, p.z), 0.022, C.rail, P.paint, 4);
  }
  for (const hgt of [1.0, 0.5]) k.tube(V(a.x, a.y + hgt, a.z), V(b.x, b.y + hgt, b.z), hgt > 0.9 ? 0.02 : 0.01, C.rail, P.paint, 4);
}

/** Foremast fittings; returns the yardarm ends (for the halyards). */
function mast(k: Kit, m: Aft['mast']): THREE.Vector3[] {
  if (m.tripod !== undefined) {
    // Tripod: a stout pole leg, two raked legs aft, ladder rungs and a platform at the yard
    k.tube(V(0, m.tripod, m.z), V(0, m.top, m.z), 0.42, C.haze, P.paint, 10, undefined, 0.3);
    for (const sx of [-1, 1]) k.tube(V(sx * 2.1, m.tripod, m.z - 2.6), V(0, m.top - 4, m.z - 0.25), 0.26, C.haze, P.paint, 8, undefined, 0.2);
    for (let y = m.tripod + 0.5; y < m.top - 0.3; y += 0.4) k.box(0.4, 0.03, 0.03, 0, y, m.z + 0.42, C.hazeL);
    k.box(2.6, 0.08, 1.6, 0, m.yardY - 0.35, m.z - 0.3, C.hazeD);
    rail(k, V(-1.3, m.yardY - 0.35, m.z - 1.1), V(1.3, m.yardY - 0.35, m.z - 1.1), 1.3);
  }
  // Whips standing up from the yard ends, a platform with rails at the top
  for (const sx of [-1, 1]) {
    k.tube(V(sx * m.yardHalf, m.yardY, m.z), V(sx * (m.yardHalf + 0.4), m.yardY + 4, m.z), 0.03, C.chain, P.metal, 4, undefined, 0.012);
    k.box(0.3, 0.3, 0.3, sx * (m.yardHalf - 0.3), m.yardY - 0.25, m.z, C.hazeD);
  }
  const t = m.top;
  const pl = m.plat + 0.25;
  const c = [V(-pl, t, m.z - pl), V(pl, t, m.z - pl), V(pl, t, m.z + pl), V(-pl, t, m.z + pl)];
  for (let i = 0; i < 4; i++) rail(k, c[i]!, c[(i + 1) % 4]!, 3);
  k.box(2 * pl, 0.08, 2 * pl, 0, t, m.z, C.hazeD);
  // Navigation radar on a bracket on the mast's forward face, below the yard
  const ny = m.yardY - 2.2;
  k.box(1.4, 0.08, 1.2, 0, ny, m.z + 1.3, C.hazeD);
  k.cyl(0.18, 0.4, 0, ny, m.z + 1.5, C.haze, P.paint, 8);
  const nr = k.group(0, ny + 0.5, m.z + 1.5, 0.5);
  k.box(2.1, 0.22, 0.14, 0, 0, 0, C.dark, P.matte, nr);
  // Surface-search slotted array (about 3 m) on a pedestal ahead of the top platform
  k.box(1.0, 0.08, 1.0, 0, t - 1.5, m.z + 1.5, C.hazeD);
  k.cyl(0.22, 0.5, 0, t - 1.5, m.z + 1.6, C.haze, P.paint, 8);
  const sr = k.group(0, t - 0.85, m.z + 1.6, -0.6);
  k.box(3.0, 0.32, 0.2, 0, 0, 0, C.hazeD, P.paint, sr);
  k.box(2.8, 0.1, 0.03, 0, 0, 0.11, C.dark, P.matte, sr);
  // ESM domes on the pole, masthead light at its top
  const p = m.pole;
  const pz = p?.z ?? m.z;
  const py = p ? p.top - 2.4 : t + 1.2;
  if (!p) k.cyl(0.08, 2.4, 0, t, pz, C.hazeD, P.paint, 6, 0.05);
  for (const sx of [-1, 1]) {
    k.box(0.9, 0.06, 0.06, sx * 0.45, py, pz, C.hazeD);
    k.cyl(0.16, 0.45, sx * 0.95, py - 0.22, pz, C.white, P.paint, 10);
    k.lathe([[0.16, 0], [0.12, 0.08], [0.01, 0.12]], sx * 0.95, py + 0.23, pz, C.white, P.paint, 10);
  }
  const ly = p ? p.top - 0.6 : t + 2.2;
  k.box(0.22, 0.3, 0.22, 0, ly, pz + 0.15, C.chain, P.metal);
  k.box(0.16, 0.16, 0.02, 0, ly + 0.02, pz + 0.27, C.white, P.glass);
  return [V(-m.yardHalf + 0.2, m.yardY, m.z), V(m.yardHalf - 0.2, m.yardY, m.z), V(0, ly + 0.02, pz + 0.32)];
}

/** Exhaust uptakes with caps and a grille over the funnel's black top; returns the pipe mouths. */
function funnel(k: Kit, f: Aft['funnel']): { p: THREE.Vector3; r: number }[] {
  const g = k.group(0, f.y, f.z, 0, -f.rake);
  const yt = f.h - 0.35;
  const pipes: { p: THREE.Vector3; r: number }[] = [];
  const tilt = new THREE.Euler(-f.rake, 0, 0, 'YXZ');
  for (const [x, z, r] of [[-0.55, -0.4, 0.34], [0.55, -0.4, 0.34], [0, 0.6, 0.26]] as const) {
    pipes.push({ p: V(x, yt + 1.3, z * (f.rz / 3.5)).applyEuler(tilt).add(V(0, f.y, f.z)), r });
    k.cyl(r, 1.3, x, yt - 0.2, z * (f.rz / 3.5), C.chain, P.metal, 12, r, g);
    k.lathe([[r + 0.04, 0], [r + 0.1, 0.12], [r + 0.1, 0.18], [r - 0.03, 0.18]], x, yt + 1.1, z * (f.rz / 3.5), C.dark, P.matte, 12, g);
  }
  for (let i = -3; i <= 3; i++) k.box(0.04, 0.05, f.rz * 0.9, (i * f.rx) / 4.5, yt + 0.12, 0, C.dark, P.matte, g);
  k.box(0.1, 0.5, 0.1, 0, f.h * 0.55, f.rz - 0.05, C.steel, P.metal, g);
  return pipes;
}

/** Motor whaler under a canvas cover in a pair of luffing davits, falls to its hooks, winch between. */
function boat(k: Kit, b: NonNullable<Aft['boats']>, sx: number): void {
  const x = sx * b.x;
  const len = b.len + 0.6;
  const y = b.y;
  for (const dz of [-len * 0.28, len * 0.28]) k.box(1.4, 0.55, 0.35, x, y + 0.27, b.z + dz, C.hazeD);
  const hull = new THREE.LatheGeometry([[0.01, -len / 2], [0.55, -len / 2 + 0.2], [0.95, -len / 2 + 1.2], [1.0, 0], [0.9, len / 2 - 1.4], [0.45, len / 2 - 0.35], [0.01, len / 2]]
    .map(([r, zz]) => new THREE.Vector2(r!, zz!)), 14);
  hull.rotateX(Math.PI / 2);
  hull.scale(1, 0.62, 1);
  const hm = k.mesh(hull, C.hazeL);
  hm.position.set(x, y + 1.05, b.z);
  // Rubbing strake and the canvas cover over the top
  const strake = k.mesh(new THREE.TorusGeometry(1, 0.06, 4, 24), C.dark, P.matte);
  strake.rotation.x = Math.PI / 2;
  strake.scale.set(0.98, (len / 2) * 0.86, 1);
  strake.position.set(x, y + 1.08, b.z);
  const cov = k.mesh(facet([{ y: 0, pts: [[-0.9, -len / 2 + 0.6], [0.9, -len / 2 + 0.6], [0.92, len / 2 - 1.6], [0.4, len / 2 - 0.5], [-0.4, len / 2 - 0.5], [-0.92, len / 2 - 1.6]] },
    { y: 0.45, pts: [[-0.15, -len / 2 + 0.8], [0.15, -len / 2 + 0.8], [0.15, len / 2 - 1.8], [0.08, len / 2 - 1.0], [-0.08, len / 2 - 1.0], [-0.15, len / 2 - 1.8]] }]), C.canvas, P.matte);
  cov.position.set(x, y + 1.08, b.z);
  // Davits: post, arm out over the boat, falls down to the hooks
  const dx = sx * b.davit;
  const head = y + 3.2;
  for (const dz of [-len * 0.36, len * 0.36]) {
    k.box(0.5, 0.1, 0.5, dx, y + 0.05, b.z + dz, C.hazeD);
    k.tube(V(dx, y, b.z + dz), V(dx, y + 2.6, b.z + dz), 0.14, C.haze, P.paint, 8, undefined, 0.11);
    k.tube(V(dx, y + 2.5, b.z + dz), V(x + sx * 0.2, head, b.z + dz), 0.1, C.haze, P.paint, 6);
    k.cyl(0.14, 0.12, x + sx * 0.2, head - 0.06, b.z + dz, C.chain, P.metal, 8);
    k.tube(V(x + sx * 0.2, head - 0.06, b.z + dz), V(x, y + 1.35, b.z + dz * 0.95), 0.015, C.chain, P.metal, 4);
  }
  k.box(0.7, 0.6, 0.9, dx + sx * 0.1, y + 0.3, b.z, C.hazeD);
  k.cyl(0.25, 0.6, dx + sx * 0.1, y + 0.6, b.z, C.chain, P.metal, 10).rotation.x = Math.PI / 2;
}

/** Rack of four white life-raft canisters (athwartships) in a dark cradle at (x, y, z). */
function rafts(k: Kit, x: number, y: number, z: number): void {
  for (const dz of [-1.35, 1.35]) k.box(1.7, 0.35, 0.08, x, y + 0.17, z + dz, C.hazeD);
  for (const ox of [-0.55, 0.55]) k.box(0.08, 0.12, 2.8, x + ox, y + 0.06, z, C.hazeD);
  for (let i = 0; i < 4; i++) {
    const zz = z - 1.0 + i * 0.66;
    const c = k.mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.5, 12), C.white);
    c.rotation.z = Math.PI / 2;
    c.position.set(x, y + 0.45, zz);
    for (const ox of [-0.4, 0.4]) {
      const band = k.mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 12), C.chain, P.metal);
      band.rotation.z = Math.PI / 2;
      band.position.set(x + ox, y + 0.45, zz);
    }
  }
}

/**
 * Triple torpedo tubes on a pedestal each side, trained outboard about 40° from the beam
 * (muzzles out and forward, as kept ready at sea): stacked tubes in two frames, breech
 * caps, muzzle covers, a training handwheel and the firing-gear box.
 */
function tubes(k: Kit, t: NonNullable<Aft['tubes']>): void {
  for (const sx of [-1, 1]) {
    const g = k.group(sx * t.x, t.y, t.z, sx * 0.87);
    k.cyl(0.55, 0.08, 0, 0, 0, C.hazeD, P.paint, 16, 0.55, g);
    k.cyl(0.3, 0.42, 0, 0.08, 0, C.haze, P.paint, 12, 0.24, g);
    k.cyl(0.5, 0.07, 0, 0.5, 0, C.hazeD, P.paint, 16, 0.5, g);
    for (const dz of [-0.95, 0.95]) {
      k.box(0.66, 1.62, 0.1, 0, 0.57 + 0.81, dz, C.haze, P.paint, g);
      k.box(0.7, 0.06, 0.16, 0, 0.57 + 1.62, dz, C.hazeD, P.paint, g);
    }
    for (let i = 0; i < 3; i++) {
      const y = 0.83 + i * 0.5;
      const tb = k.mesh(new THREE.CylinderGeometry(0.25, 0.25, 3.2, 14, 1, true), C.haze, P.paint, g);
      tb.rotation.x = Math.PI / 2;
      tb.position.set(0, y, 0);
      const back = k.mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 14), C.chain, P.metal, g);
      back.rotation.x = Math.PI / 2;
      back.position.set(0, y, -1.7);
      const lid = k.mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.06, 14), C.hazeD, P.paint, g);
      lid.rotation.x = Math.PI / 2;
      lid.position.set(0, y, 1.62);
      k.box(0.05, 0.12, 0.06, sx * 0.2, y + 0.2, 1.62, C.chain, P.metal, g);
    }
    k.box(0.35, 0.4, 0.3, -sx * 0.45, 1.3, -1.45, C.hazeD, P.paint, g);
    const hw = k.torus(0.16, 0.02, C.chain, P.metal, 4, 12, Math.PI * 2, g);
    hw.rotation.y = Math.PI / 2;
    hw.position.set(-sx * 0.42, 0.75, -0.6);
  }
}

/** Twin heavy tubes on the corvette's turntables, trained outboard (muzzles out and forward). */
function twinTubes(k: Kit, t: NonNullable<Aft['twin']>): void {
  for (const sx of [-1, 1]) {
    const g = k.group(sx * t.x, t.y, t.z, sx * 0.55);
    for (const dz of [-1.8, 0.4, 2.4]) k.box(1.5, 0.42, 0.14, 0, 0.21, dz, C.hazeD, P.paint, g);
    for (const dx of [-0.36, 0.36]) {
      const tb = k.mesh(new THREE.CylinderGeometry(0.33, 0.33, 6.2, 16, 1, true), C.haze, P.paint, g);
      tb.rotation.x = Math.PI / 2;
      tb.position.set(dx, 0.75, 0);
      for (const bz of [-2.2, 0, 2.2]) {
        const band = k.mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 16), C.hazeD, P.paint, g);
        band.rotation.x = Math.PI / 2;
        band.position.set(dx, 0.75, bz);
      }
      const door = k.mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 16), C.hazeD, P.paint, g);
      door.rotation.x = Math.PI / 2;
      door.position.set(dx, 0.75, 3.12);
      const dome = k.lathe([[0.34, 0], [0.3, 0.18], [0.12, 0.3], [0.01, 0.32]], dx, 0.75, -3.1, C.chain, P.metal, 16, g);
      dome.rotation.x = -Math.PI / 2;
    }
  }
}

/**
 * Six-barrel decoy launcher (chaff/flares): base plate, pedestal, a 2 × 3 block of barrels at
 * 45° elevation trained outboard (fore or aft of the beam by `swing`), dark muzzles.
 */
function decoy(k: Kit, x: number, y: number, z: number, sx: number, swing: number): void {
  k.box(0.95, 0.05, 0.95, x, y + 0.025, z, C.hazeD);
  k.box(0.42, 0.45, 0.42, x, y + 0.27, z, C.haze);
  const g = k.group(x, y + 0.62, z, sx * (Math.PI / 2 - swing), -0.78);
  k.box(0.56, 0.36, 0.12, 0, 0, -0.33, C.hazeD, P.paint, g);
  for (const ox of [-0.29, 0.29]) k.box(0.04, 0.4, 0.75, ox, 0, 0.02, C.haze, P.paint, g);
  for (const by of [-0.085, 0.085]) for (const bx of [-0.17, 0, 0.17]) {
    const b = k.mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 10), C.haze, P.paint, g);
    b.rotation.x = Math.PI / 2;
    b.position.set(bx, by, 0.05);
    const mz = k.mesh(new THREE.CircleGeometry(0.055, 10), C.dark, P.matte, g);
    mz.position.set(bx, by, 0.452);
  }
  k.box(0.5, 0.025, 0.6, 0, 0.19, 0.05, C.hazeD, P.paint, g);
}

/** Hangar door slats, landing-control cab; flight deck: dark non-skid, edge lines, yellow circle, deck-lock grid, nets. */
function flightDeck(k: Kit, d: Deck, hg: NonNullable<Aft['hangar']>, f: NonNullable<Aft['flight']>): void {
  const zA = hg.aft - 0.06;
  for (let y = hg.floor + 0.3; y < hg.floor + 4.9; y += 0.32) k.box(8.8, 0.03, 0.03, 0, y, zA, C.hazeD);
  for (const sx of [-1, 1]) k.box(0.18, 5, 0.12, sx * 4.55, hg.floor + 2.5, zA, C.haze);
  const cab = k.group(-sx1(hg) * (hg.half - 1.0), hg.top, hg.aft + 0.9);
  k.box(1.8, 1.4, 1.6, 0, 0.7, 0, C.haze, P.paint, cab);
  k.box(1.6, 0.5, 0.03, 0, 0.95, -0.81, C.glass, P.glass, cab);
  k.box(0.03, 0.5, 1.4, -0.91, 0.95, 0, C.glass, P.glass, cab);
  k.box(2.0, 0.06, 1.8, 0, 1.43, -0.05, C.hazeL, P.paint, cab);
  // Flight deck surface: dark non-skid between the edges
  const half = (z: number) => (f.half || d.half(z)) - 0.12;
  const pts: [number, number][] = [];
  for (let z = f.z0; z <= f.z1 + 0.01; z += (f.z1 - f.z0) / 6) pts.push([half(z), z]);
  for (let z = f.z1; z >= f.z0 - 0.01; z -= (f.z1 - f.z0) / 6) pts.push([-half(z), z]);
  const dk = k.mesh(facet([{ y: f.y + 0.02, pts }, { y: f.y + 0.035, pts }]), 0x2f3335, P.matte);
  dk.userData.ao = 0;
  const y = f.y + 0.04;
  for (const sx of [-1, 1]) for (let z = f.z0 + 0.5; z < f.z1; z += 2) {
    const z2 = Math.min(z + 2, f.z1);
    k.tube(V(sx * (half(z) - 0.25), y, z), V(sx * (half(z2) - 0.25), y, z2), 0.06, C.white, P.matte, 4);
  }
  k.box(0.3, 0.012, f.z1 - f.z0 - 1, 0, y, (f.z0 + f.z1) / 2, C.white, P.matte);
  const ring = k.mesh(new THREE.RingGeometry(3.25, 3.45, 40), C.yellow, P.matte);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, y + 0.005, f.spot);
  k.box(4.2, 0.012, 0.3, 0, y + 0.004, f.spot, C.white, P.matte);
  // Deck-lock grid
  k.cyl(0.95, 0.02, 0, y - 0.005, f.spot, C.dark, P.matte, 16);
  for (let i = -3; i <= 3; i++) {
    k.box(1.8, 0.03, 0.04, 0, y + 0.01, f.spot + i * 0.25, C.steel, P.metal);
    k.box(0.04, 0.03, 1.8, i * 0.25, y + 0.01, f.spot, C.steel, P.metal);
  }
  // Safety nets: frames hinged at the deck edge, folded out and down
  for (const sx of [-1, 1]) {
    const zc = (f.z0 + f.z1) / 2;
    const net = k.group(sx * (half(zc) + 0.15), f.y - 0.05, zc, 0, 0);
    net.rotation.z = sx * -0.25;
    const L = f.z1 - f.z0 - 1.5;
    k.box(1.3, 0.03, L, sx * 0.65, 0, 0, C.dark, P.matte, net);
    for (let zz = -L / 2; zz <= L / 2; zz += 2) k.box(1.35, 0.06, 0.05, sx * 0.65, 0.02, zz, C.hazeD, P.paint, net);
  }
}
const sx1 = (hg: NonNullable<Aft['hangar']>) => (hg.half > 5 ? 1 : -1);

/** Ensign staff at the stern with the (fictional) ensign flying aft, bitts and the stern light (returned). */
function quarterdeck(k: Kit, d: Deck, L: number, winch?: [number, number]): THREE.Vector3 {
  const z = -L + 0.6;
  const y = d.y(0, z);
  k.cyl(0.1, 0.35, 0, y - 0.05, z, C.hazeD, P.paint, 8);
  k.tube(V(0, y, z), V(0, y + 4.2, z - 0.6), 0.05, C.wood, P.matte, 6, undefined, 0.03);
  const flag = k.decal('ensign', 1.7, 1.1, undefined, 8);
  const pos = flag.geometry.attributes.position!;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) + 0.85) * 2.6) * 0.12 * (pos.getX(i) + 0.85));
  flag.geometry.computeVertexNormals();
  flag.rotation.y = Math.PI / 2;
  flag.position.set(0, y + 3.55, z - 0.55 - 0.85);
  k.box(0.18, 0.18, 0.12, 0, y + 0.6, z - 0.1, C.chain, P.metal);
  for (const sx of [-1, 1]) {
    const bz = -L + 3.2;
    const bx = sx * (d.half(bz) - 0.8);
    const by = d.y(bx, bz);
    k.box(0.45, 0.08, 1.2, bx, by + 0.04, bz, C.hazeD);
    for (const dz of [-0.35, 0.35]) k.cyl(0.14, 0.45, bx, by + 0.08, bz + dz, C.haze, P.paint, 10);
  }
  if (winch) {
    const [wx, wz] = winch;
    const wy = d.y(wx, wz);
    for (const ox of [-0.85, 0.85]) k.box(0.12, 1.5, 1.4, wx + ox, wy + 0.75, wz, C.haze);
    const drum = k.mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.5, 18), C.chain, P.metal);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(wx, wy + 1.2, wz);
    k.box(0.9, 0.5, 0.6, -wx * 0.15, wy + 0.25, -L + 0.9, C.hazeD);
    k.cyl(0.18, 0.7, -wx * 0.15, wy + 0.5, -L + 0.9, C.steel, P.metal, 10).rotation.z = Math.PI / 2;
  }
  return V(0, y + 0.6, z - 0.2);
}

export interface AftOut {
  lines: THREE.LineSegments;
  /** Exhaust pipe mouths (smoke), darkened-ship lamps, the spot for a red light over the after decks. */
  pipes: { p: THREE.Vector3; r: number }[];
  lamps: Lamp[];
  pool: { p: THREE.Vector3; range: number };
}

/** All aft detail; `ends` are the flag-locker points the halyards run down to. */
export function aftDetail(k: Kit, g: THREE.Group, d: Deck, a: Aft, L: number, ends: THREE.Vector3[]): AftOut {
  const m = a.mast;
  if (m.raise) {
    const y0 = m.top - m.raise;
    const r = 0.75;
    const legs = [V(r, 0, r), V(-r, 0, r), V(-r, 0, -r), V(r, 0, -r)];
    for (let i = 0; i < 4; i++) {
      const lg = legs[i]!;
      const nx = legs[(i + 1) % 4]!;
      k.tube(V(lg.x, y0 - 0.2, m.z + lg.z), V(lg.x * 0.6, m.top, m.z + lg.z * 0.6), 0.09, C.hazeD, P.paint, 5);
      for (let j = 0; j < 3; j++) {
        const f0 = j / 3;
        const f1 = (j + 1) / 3;
        const s0 = 1 - 0.4 * f0;
        const s1 = 1 - 0.4 * f1;
        k.tube(V(lg.x * s0, y0 + m.raise * f0, m.z + lg.z * s0), V(nx.x * s1, y0 + m.raise * f1, m.z + nx.z * s1), 0.04, C.hazeD, P.paint, 4);
      }
    }
    k.box(2.4, 0.15, 0.15, 0, m.yardY, m.z, C.hazeD);
    const radar = g.userData.radar as THREE.Object3D | undefined;
    if (radar) radar.position.y += m.raise;
    k.cyl(0.3, 0.8, 0, m.top, m.z, C.hazeD, P.paint, 8);
  }
  const yard = mast(k, a.mast);
  const pipes = funnel(k, a.funnel);
  if (a.boats) for (const sx of [-1, 1]) boat(k, a.boats, sx);
  for (const [x, y, z] of a.rafts) rafts(k, x, y, z);
  if (a.hangar) for (const sx of [-1, 1]) {
    k.box(0.5, 0.08, 3.0, sx * (a.hangar.half + 0.25), a.hangar.top - 2.2, a.hangar.aft + 6, C.hazeD);
    rafts(k, sx * (a.hangar.half + 0.85), a.hangar.top - 2.2, a.hangar.aft + 6);
  }
  if (a.roofRail) for (const sx of [-1, 1]) rail(k, V(sx * a.roofRail.half, a.roofRail.y, a.roofRail.z0), V(sx * a.roofRail.half, a.roofRail.y, a.roofRail.z1));
  if (a.tubes) tubes(k, a.tubes);
  if (a.twin) twinTubes(k, a.twin);
  a.decoys.forEach(([x, y, z], i) => {
    for (const sx of [-1, 1]) decoy(k, sx * x, y, z, sx, a.decoys.length > 1 ? (i ? -0.35 : 0.35) : 0.2);
  });
  if (a.hangar && a.flight) flightDeck(k, d, a.hangar, a.flight);
  const stern = quarterdeck(k, d, L, a.winch);
  // Darkened ship: masthead and stern lights, red lamps over the ladders, red floods on the flight deck
  const lamps: Lamp[] = [{ p: yard[2]!, color: 0xfff2dc, kind: 'nav' }, { p: stern, color: 0xfff2dc, kind: 'nav' }];
  const rr = a.roofRail;
  if (rr) for (const sx of [-1, 1]) {
    // On top of the rail's end stanchion, shining down onto the ladder head
    const p = V(sx * rr.half, rr.y + 0.98, rr.z0 - 0.06);
    k.box(0.12, 0.09, 0.14, p.x, rr.y + 1.04, rr.z0, C.chain, P.metal);
    lamps.push({ p, color: 0xff1a0a, kind: 'red' });
  }
  let pool = { p: V(0, (rr?.y ?? d.y(0, 0)) + 3, (rr?.z0 ?? 0) - 2), range: 12 };
  const hg = a.hangar;
  if (hg && a.flight) {
    for (const sx of [-1, 1]) {
      const p = V(sx * (hg.half - 0.7), hg.top - 0.5, hg.aft - 0.2);
      k.box(0.3, 0.2, 0.22, p.x, p.y + 0.05, hg.aft - 0.11, C.chain, P.metal);
      lamps.push({ p, color: 0xff2010, kind: 'flood' });
    }
    pool = { p: V(0, a.flight.y + 4.5, hg.aft - 3), range: 20 };
  }
  // Signal halyards: yardarm down to the flag lockers, three a side
  const pts: number[] = [];
  ends.forEach((e, i) => {
    const y = yard[e.x < 0 ? 0 : 1] ?? yard[i]!;
    for (const o of [-0.5, 0, 0.5]) pts.push(y.x, y.y, y.z, e.x + o, e.y, e.z);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1c2022 }));
  lines.name = 'own-halyards';
  return { lines, pipes, lamps, pool };
}
