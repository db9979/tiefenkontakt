import * as THREE from 'three';
import { M, box, cyl, deckCap, hull, mat, navLights, smoke, wake } from './parts.js';
import { K, lathe, loftHull, mast, railing, whip, windowBand, hullNumber, type Hull } from './hullkit.js';

/**
 * Escort silhouettes after the period's real types (game names stay fictional):
 * F-12 like a long-hull ASW frigate with one long deckhouse, a tall mast amidships and a
 * twin hangar aft; F-30 like a 1960s/70s frigate with a twin turret, a big round funnel and
 * a VDS gantry on the quarterdeck; K-7 like a small Soviet-style ASW corvette with rocket
 * launchers forward and a pyramid mast. Every part stands on the deck or on another part.
 */

const ORANGE = mat(0xd8732e);

function barrels(g: THREE.Group, n: number, y: number, z: number, len: number): void {
  for (let i = 0; i < n; i++) {
    const b = cyl(g, 0.16, len, n > 1 ? (i - (n - 1) / 2) * 0.8 : 0, y, z + len / 2, M.grey);
    b.rotation.x = Math.PI / 2 - 0.12;
  }
}

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

/** Small sphere (radar dome) resting at height y. */
function add3(g: THREE.Group, r: number, y: number, z: number): void {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), M.grey);
  m.position.set(0, y, z);
  g.add(m);
}

/** Frigate with variable-depth sonar (F-30). Deck at 6 m. */
export function vdsFrigate(g: THREE.Group): void {
  const len = 115;
  const beam = 12.5;
  hull(g, len, beam, 7.5, 1.5, M.hullGrey, M.black);
  deckCap(g, len, beam, 6, M.deck);
  // Twin gun turret forward
  box(g, 3.6, 2.4, 4.5, 0, 7.2, 36, M.grey);
  barrels(g, 2, 7.6, 38.2, 6);
  // Deckhouse (6–10 m) with the bridge block on its front (6–13 m) and the bridge on top (13–16 m)
  box(g, 9, 4, 40, 0, 8, 6, M.grey);
  box(g, 9, 7, 8, 0, 9.5, 22, M.grey);
  box(g, 8, 3, 6, 0, 14.5, 22, M.grey);
  box(g, 8.2, 0.9, 0.4, 0, 15, 25.1, M.glass);
  // Lattice mast on the deckhouse with a big bedstead radar on top
  cyl(g, 0.35, 20, 0, 20, 10, M.black, 0.8);
  const radar = box(g, 7, 2, 0.4, 0, 30.6, 10, M.black);
  g.userData.radar = radar;
  // Big round funnel on the deckhouse roof
  const f = cyl(g, 2.4, 7, 0, 13.5, -2, M.grey, 2.6);
  f.scale.z = 1.4;
  cyl(g, 2.45, 0.8, 0, 16.6, -2, M.black).scale.z = 1.4;
  smoke(g, 0, 17.5, -2, 5, 0x4a4c4e);
  for (const x of [-1, 1]) box(g, 1.2, 1.2, 5, x * beam * 0.4, 6.6, 0, ORANGE);
  // Small hangar and flight deck, VDS winch house and A-frame gantry on the quarterdeck
  box(g, 7, 4.5, 9, 0, 8.25, -19, M.grey);
  box(g, beam * 0.82, 0.3, 16, 0, 6.15, -31.5, M.deck);
  box(g, 6, 2.6, 5, 0, 7.3, -45, M.grey);
  for (const x of [-3.5, 3.5]) box(g, 0.8, 8, 0.8, x, 10, -53, M.grey);
  box(g, 7.8, 0.8, 0.8, 0, 14.2, -53, M.grey);
  cyl(g, 0.08, 6.8, 0, 10.8, -53, M.black);
  box(g, 2.4, 1.4, 3.6, 0, 6.7, -53, mat(0xd8a12e));
  navLights(g, len, beam, 29, 22, 6);
  wake(g, 170, beam, len / 2, -len / 2);
}

/** ASW corvette (K-7). Deck at 4.5 m. */
export function corvette(g: THREE.Group): void {
  const len = 72;
  const beam = 10;
  hull(g, len, beam, 6, 1.5, M.hullGrey, M.black);
  deckCap(g, len, beam, 4.5, M.deck);
  // Missile bin and two ASW rocket launchers forward
  cyl(g, 1.3, 1, 0, 5, 28, M.grey);
  for (const x of [-2, 2]) {
    box(g, 1.6, 1.4, 2, x, 5.2, 20, M.grey);
    box(g, 1.4, 0.8, 2.2, x, 6.3, 20.3, M.black).rotation.x = -0.4;
  }
  // Superstructure (4.5–10 m), bridge on top (10–12.6 m), pyramid mast with radar
  box(g, 7, 5.5, 22, 0, 7.25, 7, M.grey);
  box(g, 6, 2.6, 6, 0, 11.3, 14, M.grey);
  box(g, 6.2, 0.8, 0.3, 0, 11.8, 17.1, M.glass);
  cyl(g, 0.3, 10, 0, 15, 6, M.grey, 1.8);
  const radar = box(g, 4, 1, 0.3, 0, 20.4, 6, M.black);
  g.userData.radar = radar;
  // Funnel on deck aft of the superstructure, torpedo tubes on the sides, twin gun aft
  box(g, 3, 5, 4, 0, 7, -8, M.grey);
  smoke(g, 0, 10, -8, 4, 0x4a4c4e);
  for (const x of [-1, 1]) cyl(g, 0.45, 7, x * 3.3, 5.0, -14, M.grey).rotation.x = Math.PI / 2;
  box(g, 2.8, 1.8, 3.4, 0, 5.4, -24, M.grey);
  barrels(g, 2, 5.8, -22.3, 3.5);
  // Depth-charge racks on the stern
  for (const x of [-1, 1]) box(g, 1, 0.8, 4, x * 3, 4.9, -32, M.black);
  navLights(g, len, beam, 20, 14, 4.5);
  wake(g, 120, beam, len / 2, -len / 2);
}
