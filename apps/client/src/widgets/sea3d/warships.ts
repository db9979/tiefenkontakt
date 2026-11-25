import * as THREE from 'three';
import { add, box, cyl, navLights, smoke, wake } from './parts.js';
import { K, lathe, loftHull, mast, railing, whip, windowBand, hullNumber, type HullSpec } from './hullkit.js';
import { COLORS, DARK2, MARK, V, YELLOW, base, boat, bridgeGlass, forecastle, house, lattice, profileSolid, rbu, strut, vlathe } from './warkit.js';

/**
 * Escort silhouettes after the period's real types (game names stay fictional):
 * F-30 like a 1960s/70s frigate with a twin turret, a big round funnel and a VDS gantry on
 * the quarterdeck; K-7 like a small Soviet-style ASW corvette with rocket launchers forward
 * and a pyramid mast (F-12 and the patrol ship in escorts.ts). Every part stands on the deck
 * or on another part.
 */

/** Hulls of F-30 and K-7 (also used by the own ship's close-range model, own-detail.ts). */
export const F30_HULL: HullSpec = { len: 113, beam: 12.5, freeboard: 5, draft: 5.6, sheerBow: 3.2, sheerStern: 0.3, rake: 7, flare: 0.12, fullness: 0.12, transom: 0.72, bilge: 0.45, colors: COLORS };
export const K7_HULL: HullSpec = { len: 72, beam: 10, freeboard: 3.1, draft: 3.7, sheerBow: 2.6, sheerStern: 0.2, rake: 7, flare: 0.17, fullness: 0.1, transom: 0.74, bilge: 0.4, colors: COLORS };
/** K-7's raised forecastle: from z0 forward, rise above the main deck. */
export const K7_FORECASTLE = { z0: -12, rise: 2.1 };

/** Frigate with variable-depth sonar (F-30), after the Leander class: 113 m, flush deck with strong sheer forward. */
export function vdsFrigate(g: THREE.Group): void {
  const L = 113;
  const B = 12.5;
  const h = loftHull(g, F30_HULL);
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

/** ASW corvette (K-7), after the Soviet Grisha class: 72 m with a raised forecastle. */
export function corvette(g: THREE.Group): void {
  const L = 72;
  const B = 10;
  const h = loftHull(g, K7_HULL);
  const fc = forecastle(g, h, K7_FORECASTLE.z0, K7_FORECASTLE.rise);
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

