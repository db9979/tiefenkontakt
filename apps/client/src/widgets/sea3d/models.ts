import * as THREE from 'three';
import { CLASSES, type ClassId, type Sighting } from '@tk/shared';
import { FOAM, M, add, box, cyl, deckCap, hull, mat, navLights, smoke, wake } from './parts.js';
import { surfacedBoat } from './boats.js';
import { containerShip, ferry, tanker, trawler, tug, yacht } from './civil.js';
import { asw, corvette, vdsFrigate } from './warships.js';

/**
 * Low-poly ship models for the 3D sea view. Bow toward +z, waterline at y = 0.
 * Groups may carry userData.smoke (puffs animated by the scene), userData.radar
 * (a rotating antenna) and objects named 'wake' / 'bow' / 'feather' that follow the speed.
 * Silhouettes follow real ship types of the era (names in the game are fictional).
 */

/** Merchant hull colours seen in Cold War convoys: black, grey, rust brown, dark green. */
const HULLS = [0x26292b, 0x4a5156, 0x4a2e24, 0x2b3a31].map((c) => mat(c));
const FUNNELS = [0x1c1f21, 0x7a2a22, 0xb08a3a, 0x2a3f5a].map((c) => mat(c));

function merchant(g: THREE.Group): void {
  const v = Math.floor(Math.random() * 4);
  hull(g, 130, 20, 11, 2, HULLS[v]!, M.red);
  deckCap(g, 130, 20, 9, M.deck);
  // Raised forecastle with a bulwark, foremast
  box(g, 17, 2.4, 16, 0, 10.2, 55, HULLS[v]!);
  cyl(g, 0.45, 14, 0, 17, 52, M.black);
  for (const z of [-22, 2, 26, 46]) box(g, 13, 2.2, 16, 0, 10.6, z, M.cargo);
  // Derrick posts and booms between the holds
  for (const z of [-10, 14, 36]) {
    cyl(g, 0.5, 16, 0, 17, z, M.black);
    const boom = cyl(g, 0.25, 14, 0, 14, z + 5, M.black);
    boom.rotation.x = 0.9;
  }
  // Superstructure aft: two decks, bridge with wings and a window band, lifeboats, funnel with company colours
  box(g, 17, 8, 15, 0, 13.5, -44, M.white);
  box(g, 14, 3, 10, 0, 19, -42, M.white);
  box(g, 24, 0.8, 4, 0, 20.4, -38, M.white);
  box(g, 14.2, 1, 10.2, 0, 19.6, -42, M.glass);
  for (const x of [-9.2, 9.2]) box(g, 1.6, 1.6, 6, x, 14, -48, mat(0xd8732e));
  cyl(g, 0.3, 10, 0, 26, -44, M.black);
  cyl(g, 2.6, 9, 0, 21, -52, FUNNELS[v]!, 3);
  cyl(g, 2.65, 1.6, 0, 25, -52, M.black, 2.65);
  smoke(g, 0, 26, -52, 7);
  navLights(g, 130, 20, 25, -40, 10);
  wake(g, 200, 20, 64, -64);
}

/** Model of a ship class seen on the surface. */
export function shipModel(cls: ClassId): THREE.Group {
  const g = new THREE.Group();
  if (cls === 'merchant') merchant(g);
  else if (cls === 'ffg') asw(g);
  else if (cls === 'kor') corvette(g);
  else if (cls === 'ffv') vdsFrigate(g);
  else if (cls === 'fischer') trawler(g);
  else if (cls === 'tanker') tanker(g);
  else if (cls === 'container') containerShip(g);
  else if (cls === 'faehre') ferry(g);
  else if (cls === 'schlepper') tug(g);
  else if (cls === 'yacht') yacht(g);
  else surfacedBoat(g, cls);
  return g;
}

/** What a lookout actually sees of a submerged boat: a periscope with its feather, or a snorkel with exhaust haze. */
export function sightingModel(what: Sighting, cls: ClassId): THREE.Group {
  if (what === 'surfaced') return shipModel(CLASSES[cls].submarine ? cls : 'ssk');
  const g = new THREE.Group();
  const head = cyl(g, what === 'snorkel' ? 0.6 : 0.22, what === 'snorkel' ? 2.2 : 3.4, 0, 1.3, 0, M.black);
  head.name = 'head';
  // Feather: a narrow white V of spray streaming aft of the mast
  const f = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.35, 0.8), new THREE.Vector3(2.4, 0.3, -14), new THREE.Vector3(-2.4, 0.3, -14),
  ]), FOAM.clone());
  f.name = 'feather';
  g.add(f);
  add(g, new THREE.CylinderGeometry(0.4, 1.6, 0.6, 10, 1, true), FOAM, 0, 0.3, 0);
  if (what === 'snorkel') smoke(g, 0, 2.6, 0, 8, 0x6d7275);
  return g;
}
