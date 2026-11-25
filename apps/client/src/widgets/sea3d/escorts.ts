import * as THREE from 'three';
import { add, box, cyl, navLights, smoke, wake } from './parts.js';
import { K, loftHull, mast, railing, whip, windowBand, hullNumber, type HullSpec } from './hullkit.js';
import { COLORS, MARK, base, boat, bridgeGlass, house, lattice, profileSolid, rbu, vlathe } from './warkit.js';

/**
 * F-12 (Westbund ASW frigate with helicopter) and the Ostpakt patrol ship: silhouettes that
 * match the recognition book's cues. F-12 after the long-hull frigates of the period (gun on
 * the forecastle, box launcher before the bridge, tall lattice mast, hangar and flight deck
 * aft); the patrol ship after a Krivak (ASW launcher on the forecastle, angled anti-ship
 * launchers amidships, two turrets aft, VDS port in the transom). Bow +z, waterline y = 0.
 */

/** Single gun turret with a sloped front on a ring at (z, y), barrels toward dir (+1 ahead, −1 astern). */
function gun(g: THREE.Object3D, y: number, z: number, dir: number, w: number, twin = false): void {
  const s = w / 3.6;
  vlathe(g, [[0.01, 0], [2 * s, 0], [2 * s, 0.5 * s], [0.01, 0.5 * s]], K.navyDark).position.set(0, y, z);
  const pts: [number, number][] = [[-3 * s, 0], [2.4 * s, 0], [2.4 * s, 0.7 * s], [1.1 * s, 2.5 * s], [-2.6 * s, 2.6 * s], [-3 * s, 2 * s]];
  const t = profileSolid(g, pts, w, K.navy);
  t.position.set(0, y + 0.4 * s, z);
  if (dir < 0) t.rotation.y = Math.PI;
  for (const x of twin ? [-0.55 * s, 0.55 * s] : [0]) {
    const b = cyl(g, 0.17 * s, 6.6 * s, x, y + 1.5 * s, z + dir * (2.2 * s + 3.3 * s), K.navyDark);
    b.rotation.x = dir * (Math.PI / 2 - 0.07);
  }
}

/** F-12 hull (also used by the own ship's close-range model, own-detail.ts). */
export const F12_HULL: HullSpec = {
  len: 136, beam: 14, freeboard: 6, draft: 5.6, sheerBow: 2.6, rake: 6, flare: 0.1, fullness: 0.15, transom: 0.78, bilge: 0.45, colors: COLORS,
};

/** Long-hull ASW frigate with helicopter (F-12): 136 m, flush deck, articulated superstructure. */
export function asw(g: THREE.Group): void {
  const h = loftHull(g, F12_HULL);
  const N = K.navy;
  const D = K.navyDark;
  // Forecastle: anchor gear, breakwater and the gun
  for (const sx of [-1, 1]) cyl(g, 0.35, 0.6, sx * 2.2, h.deckAt(60) + 0.25, 60, K.black);
  const yb = base(h, 53, 56);
  for (const sx of [-1, 1]) box(g, 5, 1.1, 0.25, sx * 2.2, yb + 0.55, 54.5, N).rotation.y = sx * 0.45;
  gun(g, base(h, 40, 46), 43, 1, 4.2);
  // Eight-cell box launcher before the bridge, raised toward the bow
  const zl = 31;
  const yl = base(h, zl - 2.5, zl + 2.5);
  cyl(g, 1.1, 1.2, 0, yl + 0.6, zl, D);
  const ln = new THREE.Group();
  ln.position.set(0, yl + 2.2, zl);
  ln.rotation.x = -0.28;
  box(ln, 3.4, 2, 4.6, 0, 0, 0, N);
  for (let i = 0; i < 4; i++) for (const y of [-0.45, 0.45]) box(ln, 0.65, 0.7, 0.1, -1.2 + i * 0.8, y, 2.31, K.black);
  g.add(ln);
  // Superstructure in steps: long 01 house (narrower than the hull, walkways outboard),
  // bridge block forward, a separate after house with the director, hangar right aft
  const y0 = base(h, -44, 27);
  const l1 = y0 + 3;
  const l2 = l1 + 2.8;
  const l3 = l2 + 2.7;
  house(g, 11.2, 3, -20, 27, y0, N, 1.8);
  house(g, 10, 2.8, 12, 25.5, l1, N, 1.6);
  house(g, 9.2, 2.7, 15.5, 24, l2, N, 1.5);
  bridgeGlass(g, 9.2, 1.5, l2 + 1.75, 24, 0.95);
  box(g, 13.4, 0.35, 2.4, 0, l2 + 0.18, 22.6, N);
  for (const sx of [-1, 1]) {
    windowBand(g, 6, 0.95, sx * 4.62, l2 + 1.75, 19.5, sx > 0 ? 'x+' : 'x-');
    for (const z of [-14, -8, 0, 6, 16]) windowBand(g, 2.4, 0.5, sx * 5.62, y0 + 2, z, sx > 0 ? 'x+' : 'x-');
  }
  // Fire-control dome on the bridge roof
  cyl(g, 0.5, 1.1, 0, l3 + 0.55, 19.5, N);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 10), K.white);
  dome.position.set(0, l3 + 2.1, 19.5);
  g.add(dome);
  for (const sx of [-1, 1]) whip(g, sx * 4.2, l3, 16.5, 5);
  // Tall lattice mast on the 02 deck behind the bridge, air-search antenna turning on its top platform, pole above
  const zm = 8.5;
  house(g, 7, 2.8, 4, 12, l1, N, 0.8);
  const mH = 15.5;
  lattice(g, l2, zm, mH, 3.4, 1.1, 6, D);
  const mt = l2 + mH;
  box(g, 7.5, 0.18, 0.2, 0, l2 + mH * 0.62, zm, D);
  box(g, 2.2, 0.2, 2.2, 0, mt + 0.1, zm, D);
  cyl(g, 0.3, 0.7, 0, mt + 0.5, zm, D);
  const radar = new THREE.Group();
  radar.position.set(0, mt + 1.5, zm);
  box(radar, 6.2, 1.3, 0.3, 0, 0, 0, K.black);
  box(radar, 0.4, 0.4, 1.2, 0, -0.5, 0.6, K.black);
  g.add(radar);
  g.userData.radar = radar;
  mast(g, 0, mt + 0.2, zm - 0.9, 6.5, 0.22, [{ at: 0.5, span: 4 }], D);
  // Funnel aft of the mast on the 01 deck: raked, oval, dark cap
  const fz = -3;
  const fun = [vlathe(g, [[0.01, 0], [2.2, 0], [2.2, 3.2], [2.0, 5.2], [0.01, 5.25]], N, 16), vlathe(g, [[2.1, 4.4], [1.95, 5.22], [0.01, 5.35]], K.black, 16)];
  for (const f of fun) {
    f.scale.set(1, 1, 1.6);
    f.position.set(0, l1 - 0.3, fz);
    f.rotation.x = -0.1;
  }
  smoke(g, 0, l1 + 5.3, fz - 0.8, 5, 0x4a4c4e);
  for (const sx of [-1, 1]) boat(g, sx * 3.9, l1, -11, 6.4, sx * 4.9);
  // After house: director, life rafts; triple torpedo tubes on deck abreast it
  house(g, 9.4, 2.6, -36, -18, l1, N, 1.2);
  vlathe(g, [[0.01, 0], [1, 0], [1, 0.9], [0.75, 1.4], [0.01, 1.45]], N, 12).position.set(0, l1 + 2.6, -21);
  cyl(g, 0.65, 0.15, 0, l1 + 3.5, -19.9, K.white).rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) for (const z of [-26, -31]) cyl(g, 0.42, 1.5, sx * 3.9, l1 + 3.02, z, K.white).rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const tz = -6;
    const tx = sx * (h.halfBeamAt(tz, h.deckAt(tz)) - 1.3);
    for (let i = 0; i < 3; i++) cyl(g, 0.25, 3.2, tx, h.deckAt(tz) + 0.25 + i * 0.5, tz, D).rotation.x = Math.PI / 2;
  }
  // Hangar: taller than the 01 house, close-in weapon on its roof, wide door aft
  const yh = l1 + 3.4;
  house(g, 11.6, yh - y0, -44, -20, y0, N);
  windowBand(g, 9, 4.8, 0, y0 + 2.6, -44.02, 'z-');
  vlathe(g, [[0.01, 0], [0.9, 0], [0.9, 1.4], [0.7, 2.4], [0.01, 2.6]], K.white).position.set(0, yh, -38);
  whip(g, 5.2, yh, -24, 7);
  // Flight deck with markings and safety nets
  const fy = h.deckAt(-55) + 0.05;
  box(g, 0.35, 0.03, 18, 0, fy, -55, MARK);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.5, 32), MARK);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, fy + 0.02, -55);
  g.add(ring);
  railing(g, h, -66, 40);
  hullNumber(g, h, 'F 212', 52, h.deckAt(52) - 2.6, 2.6);
  navLights(g, 136, 14, mt + 5, 12, h.deckAt(0));
  wake(g, 190, 14, 68, -68);
}

/** Inclined quadruple anti-ship missile launcher on deck at (x, z): 2×2 tubes in a frame, raised toward the bow. */
function ssm(g: THREE.Object3D, x: number, y: number, z: number): void {
  box(g, 2.2, 2.2, 2.6, x, y + 1.1, z - 1.6, K.navyDark);
  const grp = new THREE.Group();
  grp.position.set(x, y + 3.3, z);
  grp.rotation.x = -0.28;
  box(grp, 2.5, 2.3, 7.6, 0, 0, 0, K.navy);
  for (const dx of [-0.6, 0.6]) for (const dy of [-0.55, 0.55]) {
    const t = cyl(grp, 0.48, 0.15, dx, dy, 3.82, K.black);
    t.rotation.x = Math.PI / 2;
  }
  // Ribs along the tube bundle so the boxes read from the side
  for (const zz of [-2.6, 0, 2.6]) box(grp, 2.6, 2.4, 0.25, 0, 0, zz, K.navyDark);
  g.add(grp);
}

/** Ostpakt patrol ship (Krivak type): 123 m, slim; ASW launcher forward, SSM launchers amidships, two turrets aft, VDS in the stern. */
export function patrolShip(g: THREE.Group): void {
  const L = 123;
  const B = 12.6;
  const h = loftHull(g, { len: L, beam: B, freeboard: 5, draft: 4.8, sheerBow: 3.4, sheerStern: 0.4, rake: 8, flare: 0.12, fullness: 0.1, transom: 0.75, bilge: 0.45, colors: COLORS });
  const N = K.navy;
  const D = K.navyDark;
  // Forecastle: capstans and the big quadruple ASW launcher with its blast shield
  for (const sx of [-1, 1]) cyl(g, 0.45, 0.7, sx * 1.3, h.deckAt(54) + 0.2, 54, K.black);
  const zl = 44;
  const yl = base(h, zl - 4, zl + 4);
  box(g, 3.8, 1.2, 5, 0, yl + 0.6, zl - 0.5, D);
  const launcher = new THREE.Group();
  launcher.position.set(0, yl + 2.4, zl);
  launcher.rotation.x = -0.12;
  for (const sx of [-1, 1]) for (const sy of [-0.6, 0.6]) {
    const tube = add(launcher, new THREE.CylinderGeometry(0.58, 0.58, 8, 10), N, sx * 0.68, sy, 0);
    tube.rotation.x = Math.PI / 2;
  }
  box(launcher, 3, 2.6, 0.5, 0, 0, -3.4, D);
  g.add(launcher);
  box(g, 6, 2, 0.3, 0, yl + 1, zl - 5.3, N);
  // 01 house: wide forward, narrow amidships (the SSM launchers stand outboard of it)
  const y0 = base(h, -16, 34);
  const r1 = h.deckAt(30) + 2.5;
  house(g, 9.4, r1 - y0, 6, 34, y0, N, 1.8);
  house(g, 5.6, r1 - y0, -16, 6, y0, N);
  for (const sx of [-1, 1]) rbu(g, sx * 2.2, r1, 30.5);
  // Bridge block, director on its roof
  const r2 = r1 + 2.4;
  const r3 = r2 + 2.3;
  house(g, 8.4, 2.4, 14, 27.5, r1, N, 1.5);
  house(g, 8.2, 2.3, 17, 26, r2, N, 1.5);
  bridgeGlass(g, 8.2, 1.5, r2 + 1.45, 26, 0.9);
  for (const sx of [-1, 1]) windowBand(g, 4.5, 0.9, sx * 4.12, r2 + 1.45, 21.5, sx > 0 ? 'x+' : 'x-');
  box(g, 11, 0.3, 2.4, 0, r2 + 0.05, 24.6, D);
  vlathe(g, [[0.01, 0], [1.1, 0], [1.1, 0.8], [0.8, 1.3], [0.01, 1.4]], N, 12).position.set(0, r3, 21.5);
  cyl(g, 0.8, 0.15, 0, r3 + 1.1, 22.6, K.white).rotation.x = Math.PI / 2;
  // Pyramid lattice mast behind the bridge with the turning air-search antenna
  const zm = 11;
  const mH = 15.2;
  lattice(g, r1, zm, mH, 3.6, 1.0, 5, D);
  const mt = r1 + mH;
  box(g, 6.5, 0.16, 0.2, 0, r1 + mH * 0.7, zm, D);
  box(g, 1.8, 0.18, 1.8, 0, mt + 0.09, zm, D);
  cyl(g, 0.3, 0.6, 0, mt + 0.45, zm, D);
  const radar = new THREE.Group();
  radar.position.set(0, mt + 1.3, zm);
  for (const y of [-0.5, 0.5]) box(radar, 5.6, 0.14, 0.14, 0, y, 0, K.black);
  for (const x of [-2.7, -0.9, 0.9, 2.7]) box(radar, 0.14, 1.1, 0.14, x, 0, 0, K.black);
  g.add(radar);
  g.userData.radar = radar;
  for (const sx of [-1, 1]) whip(g, sx * 3.8, r3, 18, 5);
  // Broad low funnel on the narrow house, SSM launchers abreast it
  const fz = -1;
  const fun = [vlathe(g, [[0.01, 0], [2.4, 0], [2.4, 2.4], [2.2, 3.4], [0.01, 3.45]], N, 16), vlathe(g, [[2.3, 2.9], [2.15, 3.42], [0.01, 3.52]], K.black, 16)];
  for (const f of fun) {
    f.scale.set(1.05, 1, 1.9);
    f.position.set(0, r1 - 0.3, fz);
  }
  smoke(g, 0, r1 + 3.4, fz - 1, 6, 0x4a4c4e);
  for (const sx of [-1, 1]) ssm(g, sx * 4.3, base(h, -7, 6), 0);
  for (const sx of [-1, 1]) boat(g, sx * 2.0, r1, -10, 5.6, sx * 2.55);
  // After house with a director, turret on its roof firing over the lower turret on the quarterdeck
  const ya0 = base(h, -40, -20);
  const ya = h.deckAt(-30) + 2.6;
  house(g, 8, ya - ya0, -36, -20, ya0, N, 1);
  vlathe(g, [[0.01, 0], [1, 0], [1, 0.8], [0.75, 1.3], [0.01, 1.35]], N, 12).position.set(0, ya, -21.8);
  gun(g, ya, -29.5, -1, 3.4, true);
  gun(g, base(h, -46, -40), -43, -1, 3.4, true);
  // Stern: low VDS housing over the transom port, dark door in the transom
  const yq = base(h, -61, -52);
  house(g, 5.6, 1.6, -61.2, -53, yq, D, 0.6);
  const port = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.4), K.black);
  port.rotation.y = Math.PI;
  port.position.set(0, h.deckAt(-L / 2) - 2.0, -L / 2 - 0.06);
  g.add(port);
  railing(g, h, -61, -40);
  railing(g, h, -16, 52);
  hullNumber(g, h, '711', 50, h.deckAt(50) - 2.8, 2.6);
  navLights(g, L, B, mt + 2.5, 22, h.deckAt(22));
  wake(g, 175, B, L / 2, -L / 2);
}
