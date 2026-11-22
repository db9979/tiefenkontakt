import * as THREE from 'three';
import { add, box, cyl, navLights, smoke, wake } from './parts.js';
import { K, lathe, loftHull, mast, railing, std, whip, windowBand, hullNumber, type Hull } from './hullkit.js';

/**
 * Escort silhouettes after the period's real types (game names stay fictional):
 * F-12 like a long-hull ASW frigate with one long deckhouse, a tall mast amidships and a
 * twin hangar aft; F-30 like a 1960s/70s frigate with a twin turret, a big round funnel and
 * a VDS gantry on the quarterdeck; K-7 like a small Soviet-style ASW corvette with rocket
 * launchers forward and a pyramid mast. Every part stands on the deck or on another part.
 */

/** Base height for a fitting spanning z0..z1: the lower deck point, slightly sunk (never floats). */
export const onDeck = (h: Hull, z0: number, z1: number) => Math.min(h.deckAt(z0), h.deckAt(z1)) - 0.15;

/** Long-hull ASW frigate with helicopter (F-12), after the long-hull frigates of the period. */
export function asw(g: THREE.Group): void {
  const h = loftHull(g, {
    len: 136, beam: 14, freeboard: 6, draft: 4.6, sheerBow: 2.6, rake: 6, flare: 0.1, fullness: 0.15, transom: 0.78, bilge: 0.45,
    colors: { top: 0x6b767c, boot: 0x1a1d1f, bottom: 0x5a2a24 },
  });
  const N = K.navy;
  // Foredeck: single-arm missile launcher with its magazine drum, anchor gear, breakwater
  const zl = 47;
  const yl = h.deckAt(zl);
  lathe(g, [[0.01, 0], [1.9, 0], [1.9, 1.1], [1.4, 1.5], [0.01, 1.5]], N).position.set(0, yl - 0.1, zl);
  cyl(g, 0.6, 1.4, 0, yl + 2, zl, N);
  const arm = box(g, 0.7, 0.7, 4.2, 0, yl + 2.6, zl + 0.8, K.navyDark);
  arm.rotation.x = -0.35;
  box(g, 9, 0.9, 0.3, 0, h.deckAt(56) + 0.3, 56, N).rotation.x = 0.4;
  for (const sx of [-1, 1]) cyl(g, 0.35, 0.6, sx * 2.2, h.deckAt(60) + 0.25, 60, K.black);
  // Deckhouse in three levels: hangar/main deck house (5 m), upper deck house (3.4 m), bridge on top
  const base = onDeck(h, -42, 30);
  const l1 = base + 5;
  const l2 = l1 + 3.4;
  const l3 = l2 + 3;
  box(g, 11.4, 5.15, 72, 0, base + 2.5, -6, N);
  box(g, 10.2, 3.4, 64, 0, l1 + 1.7, -6, N);
  box(g, 9.4, 3, 11, 0, l2 + 1.5, 22, N);
  windowBand(g, 8.8, 1, 0, l2 + 2, 27.52, 'z+');
  for (const sx of [-1, 1]) {
    windowBand(g, 9, 1, sx * 4.71, l2 + 2, 22, sx > 0 ? 'x+' : 'x-');
    windowBand(g, 30, 0.6, sx * 5.11, l1 + 2.2, 4, sx > 0 ? 'x+' : 'x-');
  }
  // Bridge wings and the fire-control dome on the bridge roof
  box(g, 13.6, 0.35, 3, 0, l2 + 0.2, 25.5, N);
  cyl(g, 0.5, 1.1, 0, l3 + 0.55, 21, N);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10), K.white);
  dome.position.set(0, l3 + 1.1 + 1.1, 21);
  g.add(dome);
  // Tall mast on the upper deck house with yards and the turning air-search radar
  const m = mast(g, 0, l2, 12, 18, 0.75, [{ at: 0.55, span: 8 }, { at: 0.8, span: 5 }]);
  const radar = box(m, 6, 1.4, 0.3, 0, 18.7, 0, K.black);
  g.userData.radar = radar;
  for (const z of [4, -4]) whip(g, 4.9, l2, z, 7);
  // Low stack aft of the mast, with a dark cap
  box(g, 4.4, 4.2, 5.6, 0, l2 + 2.1, -4, N);
  box(g, 4.6, 0.5, 5.8, 0, l2 + 4.2, -4, K.black);
  smoke(g, 0, l2 + 4.8, -4, 5, 0x4a4c4e);
  // Gun on the upper deck house, close-in weapon on the hangar roof
  lathe(g, [[0.01, 0], [1.6, 0], [1.4, 1.2], [0.9, 1.7], [0.01, 1.8]], K.navyDark).position.set(0, l2, -18);
  const barrel = cyl(g, 0.14, 5, 0, l2 + 1.1, -15.2, N);
  barrel.rotation.x = Math.PI / 2 - 0.15;
  lathe(g, [[0.01, 0], [0.9, 0], [0.9, 1.4], [0.7, 2.4], [0.01, 2.6]], K.white).position.set(0, l1, -40);
  for (const sx of [-1, 1]) for (const z of [20, 12, -26, -32]) cyl(g, 0.45, 1.6, sx * 5.2, l1 + 0.45, z, K.white).rotation.x = Math.PI / 2;
  // Triple torpedo tubes on deck, life rafts in canisters along the deckhouse
  for (const sx of [-1, 1]) {
    // Triple tubes stacked on a stand, inboard of the deck edge
    const tz = 34;
    const tx = sx * (h.halfBeamAt(tz, h.deckAt(tz)) - 1.4);
    for (let i = 0; i < 3; i++) cyl(g, 0.25, 3.2, tx, h.deckAt(tz) + 0.25 + i * 0.5, tz, K.navyDark).rotation.x = Math.PI / 2;
  }
  // Twin hangar doors on the aft face, flight deck with markings and safety nets
  for (const sx of [-1, 1]) windowBand(g, 4.6, 4.4, sx * 2.7, base + 2.4, -42.02, 'z-');
  const fz0 = -44;
  const fz1 = -66;
  const fy = h.deckAt(-55) + 0.05;
  const mk = new THREE.MeshBasicMaterial({ color: 0xd9d9d0 });
  box(g, 0.35, 0.03, 18, 0, fy, (fz0 + fz1) / 2, mk);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.5, 32), mk);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, fy + 0.01, -54);
  g.add(ring);
  railing(g, h, -66, 40);
  hullNumber(g, h, 'F 212', 44, h.deckAt(44) - 2.6, 2.6);
  navLights(g, 136, 14, l2 + 18, 12, h.deckAt(0));
  wake(g, 190, 14, 68, -68);
}

// ---- Local helpers for the F-30 and K-7 ---------------------------------------------------

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const UNIT = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
const WALL = std(0x6b767c, { side: THREE.DoubleSide });
const DARK2 = std(0x24292c, { side: THREE.DoubleSide });
const YELLOW = std(0xd8a12e, { roughness: 0.6 });
const MARK = new THREE.MeshBasicMaterial({ color: 0xd9d9d0 });
const COLORS = { top: 0x6b767c, boot: 0x1a1d1f, bottom: 0x5a2a24 };

/** Lowest deck point between z0 and z1 (sampled), slightly sunk: a base that never floats. */
function base(h: Hull, z0: number, z1: number): number {
  let m = Infinity;
  for (let i = 0; i <= 8; i++) m = Math.min(m, h.deckAt(z0 + ((z1 - z0) * i) / 8));
  return m - 0.15;
}

/** Thin round bar from a to b. */
function strut(g: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const s = new THREE.Mesh(UNIT, m);
  s.scale.set(r, d.length(), r);
  s.position.copy(a).addScaledVector(d, 0.5);
  s.quaternion.setFromUnitVectors(UP, d.normalize());
  g.add(s);
  return s;
}

/** Body of revolution about the vertical axis from [radius, y] points, base at y = 0. */
function vlathe(g: THREE.Object3D, profile: [number, number][], m: THREE.Material, seg = 16): THREE.Mesh {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), seg);
  return add(g, geo, m, 0, 0, 0);
}

/** Deckhouse from y up by hgt between z0 (aft) and z1 (front), front corners chamfered by ch. */
function house(g: THREE.Object3D, w: number, hgt: number, z0: number, z1: number, y: number, m: THREE.Material, ch = 0): THREE.Mesh {
  const a = w / 2;
  const pts: [number, number][] = ch > 0
    ? [[-a, z0], [a, z0], [a, z1 - ch], [a - ch, z1], [-a + ch, z1], [-a, z1 - ch]]
    : [[-a, z0], [a, z0], [a, z1], [-a, z1]];
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: hgt, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return add(g, geo, m, 0, y, 0);
}

/** Solid from a side profile of [z, y] points, extruded across the width (turrets, gunhouses). */
function profileSolid(g: THREE.Object3D, pts: [number, number][], w: number, m: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))), { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(-Math.PI / 2);
  return add(g, geo, m, 0, 0, 0);
}

/** Bridge windows across a chamfered front (front face plus both chamfers). */
function bridgeGlass(g: THREE.Object3D, w: number, ch: number, y: number, zf: number, hgt: number): void {
  windowBand(g, w - 2 * ch - 0.2, hgt, 0, y, zf + 0.03, 'z+');
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(ch * Math.SQRT2 - 0.2, hgt), K.glass);
    p.position.set(sx * (w / 2 - ch / 2 + 0.02), y, zf - ch / 2 + 0.02);
    p.rotation.y = (sx * Math.PI) / 4;
    g.add(p);
  }
}

/** Four-legged lattice tower from y0, tapering from w0 to w1, braced in bays. */
function lattice(g: THREE.Object3D, y0: number, z: number, hgt: number, w0: number, w1: number, bays: number, m: THREE.Material): void {
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
function boat(g: THREE.Object3D, x: number, y: number, z: number, len: number, davitX: number): void {
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
function forecastle(g: THREE.Object3D, h: Hull, z0: number, rise: number): Hull {
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

/** Frigate with variable-depth sonar (F-30), after the Leander class: 113 m, flush deck with strong sheer forward. */
export function vdsFrigate(g: THREE.Group): void {
  const L = 113;
  const B = 12.5;
  const h = loftHull(g, { len: L, beam: B, freeboard: 5, draft: 4.5, sheerBow: 3.2, sheerStern: 0.3, rake: 7, flare: 0.12, fullness: 0.12, transom: 0.72, bilge: 0.45, colors: COLORS });
  const N = K.navy;
  const D = K.navyDark;
  // Forecastle: V breakwater, capstans and the twin 4.5-inch gunhouse on its ring
  const yb = base(h, 38, 41.5);
  for (const sx of [-1, 1]) box(g, 4.6, 1.25, 0.22, sx * 2.05, yb + 0.62, 40.6, N).rotation.y = sx * 0.45;
  for (const sx of [-1, 1]) cyl(g, 0.45, 0.7, sx * 1.3, h.deckAt(47) + 0.2, 47, K.black);
  const zt = 33;
  const yt = base(h, zt - 3.2, zt + 3);
  vlathe(g, [[0.01, 0], [2.5, 0], [2.5, 0.55], [0.01, 0.55]], D).position.set(0, yt, zt);
  profileSolid(g, [[-3.2, 0], [2.8, 0], [2.8, 0.9], [1.8, 2.5], [-2.6, 2.65], [-3.2, 2.1]], 4.6, N).position.set(0, yt + 0.5, zt);
  for (const sx of [-1, 1]) {
    cyl(g, 0.33, 0.7, sx * 0.7, yt + 1.85, zt + 2.6, K.black).rotation.x = Math.PI / 2 - 0.06;
    cyl(g, 0.14, 5.6, sx * 0.7, yt + 2.0, zt + 2.2 + 2.8, D).rotation.x = Math.PI / 2 - 0.06;
  }
  // Superstructure: long 01 house, 02 bridge block, enclosed bridge with wings
  const y0 = base(h, -47, 26);
  const r1 = h.deckAt(26) + 2.4;
  const r2 = r1 + 2.5;
  const r3 = r2 + 2.3;
  house(g, 9.6, r1 - y0, -12, 26, y0, N, 1.6);
  house(g, 8.4, 2.5, 13, 24.5, r1, N, 1.4);
  house(g, 9.4, 2.3, 15.5, 23.5, r2, N, 1.6);
  bridgeGlass(g, 9.4, 1.6, r2 + 1.45, 23.5, 0.9);
  for (const sx of [-1, 1]) {
    windowBand(g, 5, 0.9, sx * 4.72, r2 + 1.45, 18.6, sx > 0 ? 'x+' : 'x-');
    for (const z of [-4, 0, 8, 12]) windowBand(g, 2.2, 0.4, sx * 4.82, r1 - 1, z, sx > 0 ? 'x+' : 'x-');
    box(g, 1.3, 1, 2.4, sx * 5.35, r2 + 0.5, 21.6, N);
  }
  box(g, 12, 0.3, 2.6, 0, r2 + 0.05, 21.6, D);
  // Fire-control director with its dish on the bridge roof
  vlathe(g, [[0.01, 0], [1.1, 0], [1.1, 0.8], [0.8, 1.3], [0.01, 1.4]], N, 12).position.set(0, r3, 20);
  cyl(g, 0.7, 0.15, 0, r3 + 1.1, 21.1, K.white).rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) whip(g, sx * 4.2, r3, 16.2, 5);
  // Lattice foremast behind the bridge: platform, surface radar, pole with yards
  const zf = 10.5;
  lattice(g, r1, zf, 15, 2.8, 0.9, 5, D);
  const mt = r1 + 15;
  box(g, 7, 0.16, 0.2, 0, r1 + 10.5, zf, D);
  box(g, 1.9, 0.18, 1.9, 0, mt + 0.09, zf, D);
  cyl(g, 0.25, 0.6, 0, mt + 0.45, zf + 0.4, D);
  box(g, 2.4, 0.5, 0.25, 0, mt + 1, zf + 0.4, K.black);
  mast(g, 0, mt + 0.1, zf - 0.55, 5.5, 0.2, [{ at: 0.45, span: 4.2 }], D);
  // One big rounded funnel, raked, with a black cap
  const fz = 2.5;
  const fun = [vlathe(g, [[0.01, 0], [2.6, 0], [2.65, 1.8], [2.55, 5.2], [2.3, 6.7], [0.01, 6.8]], N, 18),
    vlathe(g, [[2.47, 6.0], [2.36, 6.72], [0.01, 6.88]], K.black, 18)];
  for (const f of fun) {
    f.scale.set(1, 1, 1.55);
    f.position.set(0, r1 - 0.45, fz);
    f.rotation.x = -0.08;
  }
  smoke(g, 0, r1 + 6.6, fz - 0.7, 6, 0x4a4c4e);
  for (const sx of [-1, 1]) boat(g, sx * 3.7, r1, 2.6, 6.4, sx * 4.6);
  // Short lattice mainmast with the turning bedstead air-search antenna
  const zm = -6.5;
  lattice(g, r1, zm, 5.5, 2.2, 1.2, 2, D);
  box(g, 1.4, 0.16, 1.4, 0, r1 + 5.58, zm, D);
  cyl(g, 0.35, 0.8, 0, r1 + 6, zm, D);
  const radar = new THREE.Group();
  radar.position.set(0, r1 + 6.4 + 1.7, zm);
  for (const y of [-1.6, 1.6, 0]) box(radar, 7.6, 0.14, 0.14, 0, y, 0, K.black);
  for (const x of [-3.75, -1.25, 1.25, 3.75]) box(radar, 0.14, 3.3, 0.14, x, 0, 0, K.black);
  box(radar, 0.5, 0.5, 1.4, 0, -1.6, 0.6, K.black);
  g.add(radar);
  g.userData.radar = radar;
  // Hangar (taller than the 01 house) with door, Seacat launcher and director on its roof
  const yf = h.deckAt(-40) + 2.4;
  const yh = yf + 4.2;
  house(g, 8.6, yh - y0, -28.5, -12, y0, N);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.8), D);
  door.position.set(0, yf + 1.9, -28.53);
  door.rotation.y = Math.PI;
  g.add(door);
  cyl(g, 0.5, 0.8, 0, yh + 0.4, -25, D);
  box(g, 2.4, 0.3, 0.5, 0, yh + 0.95, -25, D);
  for (const x of [-1, -0.4, 0.4, 1]) cyl(g, 0.12, 1.5, x, yh + 1.25, -25, K.white).rotation.x = Math.PI / 2 - 0.3;
  vlathe(g, [[0.01, 0], [0.8, 0], [0.8, 0.7], [0.5, 1.1], [0.01, 1.15]], N, 12).position.set(0, yh, -15);
  for (const sx of [-1, 1]) for (const z of [-19, -22]) cyl(g, 0.4, 1.4, sx * 3.6, yh + 0.38, z, K.white).rotation.x = Math.PI / 2;
  whip(g, 3.9, yh, -13, 7);
  // Flight deck at 01 level over the after part, with markings and safety nets
  box(g, 11, yf - y0, 18.5, 0, (yf + y0) / 2, -37.75, N);
  box(g, 10.8, 0.04, 18.3, 0, yf + 0.02, -37.75, K.deck);
  box(g, 0.3, 0.03, 16, 0, yf + 0.05, -37.75, MARK);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.1, 3.4, 32), MARK);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, yf + 0.06, -38.5);
  g.add(ring);
  for (const sx of [-1, 1]) box(g, 1, 0.05, 18.5, sx * 5.95, yf - 0.1, -37.75, K.black).rotation.z = sx * -0.2;
  // Quarterdeck: VDS winch, A-frame gantry and the yellow towed body in its cradle
  const yq = base(h, -56, -47.5);
  for (const sx of [-1, 1]) box(g, 0.35, 1.4, 1.3, sx * 1.9, yq + 0.7, -48.7, D);
  cyl(g, 0.8, 3.4, 0, yq + 1.3, -48.7, K.black).rotation.z = Math.PI / 2;
  const at = yq + 6.4;
  for (const sx of [-1, 1]) {
    box(g, 1, 0.3, 1, sx * 3, yq + 0.15, -52.8, D);
    strut(g, V(sx * 3, yq, -52.8), V(sx * 2.7, at, -54.6), 0.28, N);
  }
  box(g, 6.1, 0.6, 0.6, 0, at, -54.6, N);
  for (const z of [-53.1, -55.3]) box(g, 1.4, 0.6, 0.4, 0, yq + 0.3, z, D);
  const fish = lathe(g, [[0.01, -1.7], [0.35, -1.4], [0.55, -0.8], [0.55, 1.0], [0.3, 1.55], [0.01, 1.7]], YELLOW, 12);
  const yfish = yq + 0.6 + 0.5;
  fish.position.set(0, yfish, -54.2);
  box(g, 2.2, 0.06, 0.5, 0, yfish, -55.5, YELLOW);
  box(g, 0.06, 0.6, 0.5, 0, yfish + 0.5, -55.5, YELLOW);
  strut(g, V(0, yfish + 0.5, -54.6), V(0, at - 0.3, -54.6), 0.05, K.black);
  railing(g, h, -56, -47.5);
  railing(g, h, -28, 52);
  hullNumber(g, h, 'F 230', 44, h.deckAt(44) - 2.8, 2.6);
  navLights(g, L, B, mt + 5.6, 19, h.deckAt(19));
  wake(g, 165, B, L / 2, -L / 2);
}

/** RBU-6000 style ASW rocket launcher: pedestal, cradle and a ring of 12 barrels, trained ahead. */
function rbu(g: THREE.Object3D, x: number, y: number, z: number): void {
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

/** ASW corvette (K-7), after the Soviet Grisha class: 72 m with a raised forecastle. */
export function corvette(g: THREE.Group): void {
  const L = 72;
  const B = 10;
  const h = loftHull(g, { len: L, beam: B, freeboard: 3.1, draft: 3.7, sheerBow: 2.6, sheerStern: 0.2, rake: 7, flare: 0.17, fullness: 0.1, transom: 0.74, bilge: 0.4, colors: COLORS });
  const fc = forecastle(g, h, -12, 2.1);
  const N = K.navy;
  const D = K.navyDark;
  // Foredeck: windlass and the round pop-up missile bin
  for (const sx of [-1, 1]) cyl(g, 0.4, 0.6, sx * 1.1, fc.deckAt(29) + 0.15, 29, K.black);
  vlathe(g, [[0.01, 0], [1.9, 0], [1.9, 0.55], [1.7, 0.8], [0.01, 0.85]], D, 18).position.set(0, base(fc, 20, 24), 22);
  // 01 house with the two rocket launchers on its forward roof
  const y1 = base(fc, -10, 17.5);
  const r1 = fc.deckAt(17.5) + 2.3;
  house(g, 7.4, r1 - y1, -10, 17.5, y1, N, 1.4);
  for (const sx of [-1, 1]) rbu(g, sx * 1.9, r1, 14.3);
  // Bridge, fire-control director on its roof, life rafts on the 01 roof
  const r2 = r1 + 2.4;
  house(g, 6.6, 2.4, 3.5, 12, r1, N, 1.2);
  bridgeGlass(g, 6.6, 1.2, r1 + 1.6, 12, 0.85);
  for (const sx of [-1, 1]) windowBand(g, 4.5, 0.85, sx * 3.32, r1 + 1.6, 8, sx > 0 ? 'x+' : 'x-');
  for (const sx of [-1, 1]) cyl(g, 0.4, 1.4, sx * 3, r1 + 0.38, -2.5, K.white).rotation.x = Math.PI / 2;
  vlathe(g, [[0.01, 0], [1, 0], [1, 0.9], [0.85, 1.4], [0.01, 1.5]], N, 12).position.set(0, r2, 7.5);
  box(g, 1.4, 1, 0.2, 0, r2 + 1, 8.6, K.black);
  for (const sx of [-1, 1]) whip(g, sx * 2.9, r2, 4.2, 5);
  // Pyramid mast behind the bridge, curved air-search antenna turning on top
  const zm = 0.8;
  const tower = add(g, new THREE.CylinderGeometry(0.6, 1.8, 7.5, 4), N, 0, r1 + 3.75, zm);
  tower.rotation.y = Math.PI / 4;
  box(g, 5.5, 0.15, 0.15, 0, r1 + 5.5, zm, D);
  const mt = r1 + 7.5;
  box(g, 1.7, 0.2, 1.7, 0, mt + 0.1, zm, D);
  cyl(g, 0.3, 0.8, 0, mt + 0.5, zm, D);
  const radar = new THREE.Group();
  radar.position.set(0, mt + 1.6, zm);
  add(radar, new THREE.CylinderGeometry(2.6, 2.6, 1.4, 10, 1, true, -0.6, 1.2), DARK2, 0, 0, -2.2);
  box(radar, 0.15, 0.15, 1.4, 0, -0.5, 0.15, K.black);
  g.add(radar);
  g.userData.radar = radar;
  // Broad low funnel on the after end of the 01 house
  const fz = -6.3;
  const fun = [vlathe(g, [[0.01, 0], [1.8, 0], [1.8, 2.6], [1.55, 3.0], [0.01, 3.05]], N, 16),
    vlathe(g, [[1.84, 2.4], [1.6, 3.02], [0.01, 3.12]], K.black, 16)];
  for (const f of fun) {
    f.scale.set(1, 1, 1.45);
    f.position.set(0, r1 - 0.35, fz);
    f.rotation.x = -0.1;
  }
  smoke(g, 0, r1 + 3, fz - 0.5, 5, 0x4a4c4e);
  // Main deck aft: twin torpedo tubes each side on turntables
  const yt = base(h, -18.5, -12.5);
  for (const sx of [-1, 1]) {
    cyl(g, 0.8, 0.4, sx * 2.6, yt + 0.2, -15.5, D);
    for (const dx of [-0.36, 0.36]) {
      const t = cyl(g, 0.33, 6.2, sx * 2.6 + dx, yt + 0.75, -15.5, N);
      t.rotation.order = 'YXZ';
      t.rotation.set(Math.PI / 2, sx * 0.18, 0);
    }
  }
  // Aft deckhouse: gun director and the twin 57 mm turret trained aft
  const ya0 = base(h, -27, -19.5);
  const ya = h.deckAt(-23) + 2.1;
  house(g, 6.2, ya - ya0, -27, -19.5, ya0, N, 0.8);
  cyl(g, 0.45, 0.6, 0, ya + 0.3, -20.6, D);
  box(g, 1.3, 1, 1.3, 0, ya + 1.1, -20.6, N);
  cyl(g, 0.55, 0.12, 0, ya + 1.1, -21.3, K.white).rotation.x = Math.PI / 2;
  vlathe(g, [[0.01, 0], [1.55, 0], [1.55, 0.7], [1.3, 1.45], [0.7, 1.75], [0.01, 1.75]], N, 14).position.set(0, ya, -24.6);
  for (const sx of [-1, 1]) cyl(g, 0.11, 3.6, sx * 0.35, ya + 1.0, -26.9, D).rotation.x = Math.PI / 2 + 0.08;
  // Depth-charge rails at the stern
  const yr = base(h, -35.6, -29.5);
  for (const sx of [-1, 1]) {
    box(g, 0.5, 0.4, 6.1, sx * 2.6, yr + 0.2, -32.55, K.black);
    for (const z of [-30.4, -31.8, -33.2, -34.6]) cyl(g, 0.3, 0.7, sx * 2.6, yr + 0.68, z, D).rotation.z = Math.PI / 2;
  }
  railing(g, fc, -12, 33);
  railing(g, h, -35.5, -12.5);
  // Number flush with the widest (aft) end of its plate, where the bow is fullest
  hullNumber(g, { ...fc, halfBeamAt: (z, y) => fc.halfBeamAt(z - 2.3, y) }, 'K 701', 23, fc.deckAt(23) - 2, 1.8);
  navLights(g, L, B, mt + 2.4, 8, fc.deckAt(8));
  wake(g, 115, B, L / 2, -L / 2);
}

