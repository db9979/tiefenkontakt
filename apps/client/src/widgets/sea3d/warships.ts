import * as THREE from 'three';
import { M, box, cyl, deckCap, hull, mat, navLights, smoke, wake } from './parts.js';

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

/** Long-hull ASW frigate with helicopter (F-12). Deck at 6 m. */
export function asw(g: THREE.Group): void {
  const len = 130;
  const beam = 14;
  hull(g, len, beam, 7.5, 1.5, M.hullGrey, M.black);
  deckCap(g, len, beam, 6, M.deck);
  // Single-arm missile launcher on the foredeck
  cyl(g, 1.6, 1.2, 0, 6.6, 46, M.grey, 1.9);
  box(g, 0.9, 0.9, 4, 0, 7.8, 46.5, M.grey).rotation.x = -0.3;
  // One long deckhouse from the bridge to the twin hangar (6–13 m)
  box(g, beam * 0.8, 7, 70, 0, 9.5, -5, M.grey);
  // Bridge on its front, window band, fire-control dome on top
  box(g, beam * 0.72, 3, 10, 0, 14.5, 24, M.grey);
  box(g, beam * 0.74, 0.9, 0.4, 0, 15, 29.1, M.glass);
  add3(g, 1.2, 17.2, 25);
  // Tall mast stepped on the deckhouse roof, yard and turning air-search radar
  cyl(g, 0.3, 17, 0, 21.5, 14, M.black, 0.7);
  box(g, 7, 0.4, 0.4, 0, 26, 14, M.black);
  const radar = box(g, 5, 1.6, 0.4, 0, 30.8, 14, M.black);
  g.userData.radar = radar;
  // Low stack aft of the mast, gun on the roof, rafts in canisters on deck
  box(g, 4, 5, 5, 0, 15.5, -6, M.grey);
  smoke(g, 0, 18.5, -6, 5, 0x4a4c4e);
  cyl(g, 1.3, 1.4, 0, 13.7, -16, M.grey, 1.5);
  barrels(g, 1, 14.2, -16, 5);
  for (const x of [-1, 1]) cyl(g, 0.6, 2, x * beam * 0.42, 6.6, 30, ORANGE).rotation.x = Math.PI / 2;
  // Flight deck behind the hangar, with marking
  box(g, beam * 0.86, 0.3, 24, 0, 6.15, -52, M.deck);
  box(g, 0.4, 0.05, 20, 0, 6.33, -52, mat(0xd9d9d0));
  navLights(g, len, beam, 31, 14, 6);
  wake(g, 190, beam, len / 2, -len / 2);
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
