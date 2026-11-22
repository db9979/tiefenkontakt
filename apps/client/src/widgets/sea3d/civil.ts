import * as THREE from 'three';
import { M, box, cyl, deckCap, hull, mat, navLights, smoke, wake } from './parts.js';

/**
 * Neutral civil ships after typical 1970s–80s types: a supertanker with the bridge aft and a
 * catwalk over the pipe deck, a container ship with stacked boxes and the bridge three
 * quarters aft, a RoRo ferry with tiers of white decks and twin funnels, a tug with the
 * wheelhouse forward and a towing arch aft, a sailing yacht and a stern trawler.
 * Bow toward +z, waterline at y = 0; every part rests on the deck or on another part.
 */

const WHITE = mat(0xd8dcdc);
const RED = mat(0x7a2a22);
const BOXES = [0x8a3b2c, 0x2f5d7c, 0x6c7a3a, 0xb08a3a, 0x5a5f63, 0x9a4f22].map((c) => mat(c));

/** Supertanker: deck at 14 m, bridge and funnel right aft. */
export function tanker(g: THREE.Group): void {
  const len = 240;
  const beam = 38;
  hull(g, len, beam, 16, 2, M.hullDark, RED);
  deckCap(g, len, beam, 14, mat(0x6b2f26));
  // Catwalk over the pipe deck, cargo manifold and hose crane midships, forecastle and foremast
  box(g, 2, 1.2, 190, 0, 14.6, 10, M.grey);
  for (const x of [-9, 9]) box(g, 6, 1.6, 4, x, 14.8, 0, M.grey);
  cyl(g, 0.6, 8, 0, 18, 6, M.grey);
  box(g, 0.5, 0.5, 12, 0, 21.5, 11, M.grey).rotation.x = 0.35;
  box(g, beam * 0.7, 2, 8, 0, 15, len / 2 - 8, M.hullDark);
  cyl(g, 0.5, 10, 0, 19, len / 2 - 12, M.black);
  // Accommodation block aft (14–28 m), bridge deck with wings (28–30 m), window band
  box(g, 30, 14, 18, 0, 21, -95, WHITE);
  box(g, 38, 2, 8, 0, 29, -90, WHITE);
  box(g, 30.2, 1, 0.4, 0, 29, -85.8, M.glass);
  cyl(g, 0.4, 8, 0, 32, -98, M.black);
  // Funnel on the poop deck behind the block (14–34 m)
  box(g, 7, 20, 9, 0, 24, -110, mat(0x1c1f21));
  smoke(g, 0, 35, -110, 8);
  navLights(g, len, beam, 38, -95, 14);
  wake(g, 320, beam, len / 2, -len / 2);
}

/** Container ship: deck at 11 m, bays of stacked boxes, bridge three quarters aft. */
export function containerShip(g: THREE.Group): void {
  const len = 200;
  const beam = 30;
  hull(g, len, beam, 13, 2, M.hullGrey, RED);
  deckCap(g, len, beam, 11, M.deck);
  // Bays: two or three tiers of 2.6 m boxes, colours by tier
  let i = 0;
  for (let z = -56; z <= 84; z += 14) {
    const tiers = z > 70 ? 2 : 3;
    // Narrower toward the bow, following the hull taper
    const frac = z <= 0 ? 1 : Math.max(0.3, 1 - (z / (len / 2)) ** 2);
    const w = beam * 0.86 * frac;
    for (let t = 0; t < tiers; t++) box(g, w, 2.6, 12, 0, 11 + 1.3 + t * 2.6, z, BOXES[(i + t * 2) % BOXES.length]!);
    i++;
  }
  // Superstructure (11–27 m), bridge with wings (27–29 m), funnel just aft on deck
  box(g, 22, 16, 12, 0, 19, -70, WHITE);
  box(g, 30, 2, 6, 0, 28, -67, WHITE);
  box(g, 22.2, 1, 0.4, 0, 28, -63.8, M.glass);
  cyl(g, 0.4, 7, 0, 32.5, -67, M.black);
  box(g, 7, 18, 8, 0, 20, -84, mat(0x2a3f5a));
  smoke(g, 0, 30, -84, 6);
  navLights(g, len, beam, 35, -70, 11);
  wake(g, 280, beam, len / 2, -len / 2);
}

/** RoRo ferry: deck at 8 m, three white tiers, twin funnels. */
export function ferry(g: THREE.Group): void {
  const len = 150;
  const beam = 26;
  hull(g, len, beam, 10, 2, WHITE, mat(0x1f4f7a));
  deckCap(g, len, beam, 8, M.deck);
  box(g, 20, 6, 98, 0, 11, -13, WHITE);
  box(g, 18, 5, 84, 0, 16.5, -10, WHITE);
  box(g, 15, 4, 40, 0, 21, 8, WHITE);
  // Window bands on both tiers and the bridge front
  for (const x of [-1, 1]) {
    box(g, 0.2, 1, 92, x * 10.05, 11.5, -13, M.glass);
    box(g, 0.2, 1, 80, x * 9.05, 17, -10, M.glass);
  }
  box(g, 15.2, 1.2, 0.3, 0, 21.5, 28.1, M.glass);
  // Lifeboats on the first tier roof, mast on the top tier, twin funnels on the second tier roof
  for (let z = -30; z <= 30; z += 15) for (const x of [-1, 1]) box(g, 1.6, 1.6, 7, x * 9.5, 14.8, z, mat(0xd8732e));
  cyl(g, 0.4, 6, 0, 26, 20, M.black);
  for (const x of [-5, 5]) box(g, 3, 8, 6, x, 23, -25, mat(0x1f4f7a));
  smoke(g, 0, 27.5, -25, 5);
  navLights(g, len, beam, 29, 26, 8);
  wake(g, 230, beam, len / 2, -len / 2);
}

/** Tug: deck at 4 m, wheelhouse forward, twin funnels, towing winch and arch aft. */
export function tug(g: THREE.Group): void {
  const len = 40;
  const beam = 11;
  hull(g, len, beam, 6, 2, RED, M.black);
  deckCap(g, len, beam, 4, M.deck);
  box(g, beam * 0.8, 1.5, 8, 0, 4.75, 15, RED);
  box(g, 7, 4, 7, 0, 6, 8, WHITE);
  box(g, 7.6, 3, 6, 0, 9.5, 8, WHITE);
  box(g, 7.8, 1, 6.2, 0, 10.2, 8, M.glass);
  cyl(g, 0.25, 7, 0, 14.5, 8, M.black);
  for (const x of [-2, 2]) box(g, 1.3, 6, 1.6, x, 7, 1, mat(0xd8732e));
  box(g, 4, 1.6, 3, 0, 4.8, -6, M.grey);
  for (const x of [-3.5, 3.5]) box(g, 0.6, 3, 0.6, x, 5.5, -12, M.black);
  box(g, 7.6, 0.6, 0.6, 0, 7.2, -12, M.black);
  // Old tyres as fenders along the bow
  for (const z of [6, 10, 14]) for (const x of [-1, 1]) cyl(g, 0.6, 0.5, x * beam * 0.5, 2.6, z, M.black).rotation.z = Math.PI / 2;
  smoke(g, 0, 10.5, 1, 3);
  navLights(g, len, beam, 17, 8, 4);
  wake(g, 70, beam, len / 2, -len / 2);
}

/** Sailing yacht under sail: deck at 1 m, mast, main and jib. */
export function yacht(g: THREE.Group): void {
  const len = 14;
  const beam = 4;
  hull(g, len, beam, 2, 1, WHITE, mat(0x1f4f7a));
  deckCap(g, len, beam, 1, mat(0x9a7a52));
  box(g, 2.5, 0.8, 4, 0, 1.4, -0.5, WHITE);
  cyl(g, 0.12, 16, 0, 9, 1.5, M.grey);
  cyl(g, 0.08, 5.5, 0, 2.3, -1.2, M.grey).rotation.x = Math.PI / 2;
  const sail = new THREE.MeshLambertMaterial({ color: 0xf2f2ee, side: THREE.DoubleSide });
  const tri = (pts: number[][]) => {
    const m = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), sail);
    m.geometry.computeVertexNormals();
    g.add(m);
  };
  tri([[0, 2.4, 1.4], [0, 16.5, 1.4], [0, 2.4, -3.9]]);
  tri([[0, 15, 1.6], [0, 1.6, 6.3], [0, 1.6, 1.8]]);
  navLights(g, len, beam, 16.5, 1.5, 1);
  wake(g, 22, beam, len / 2, -len / 2);
}

/** Stern trawler: deck at 4.5 m, bridge forward, gallows and nets aft. */
export function trawler(g: THREE.Group): void {
  hull(g, 45, 10, 6, 1.5, RED, M.black);
  deckCap(g, 45, 10, 4.5, M.deck);
  box(g, 8, 5, 9, 0, 7, 10, WHITE);
  box(g, 8.2, 1, 9.2, 0, 8.6, 10, M.glass);
  cyl(g, 0.3, 10, 0, 14.5, 12, M.black);
  cyl(g, 1.1, 5, 0, 7, 4, M.black, 1.2);
  for (const x of [-3.5, 3.5]) box(g, 0.6, 6, 0.6, x, 7.5, -16, mat(0xb08a3a));
  box(g, 7.6, 0.6, 0.6, 0, 10.5, -16, mat(0xb08a3a));
  cyl(g, 1.4, 6, 0, 5.9, -10, mat(0x2b3a31)).rotation.z = Math.PI / 2;
  smoke(g, 0, 10, 4, 3);
  navLights(g, 45, 10, 14, 10, 4.5);
  wake(g, 70, 10, 22, -22);
}
