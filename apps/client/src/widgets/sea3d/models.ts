import * as THREE from 'three';
import { CLASSES, type ClassId, type Sighting } from '@tk/shared';
import { FOAM, M, add, cyl, smoke } from './parts.js';
import { surfacedBoat } from './boats.js';
import { containerShip, ferry, tanker, tug } from './civil.js';
import { trawler, yacht } from './smallcraft.js';
import { bulkCarrier, cargoShip, roro } from './freighter.js';
import { look, type Look } from './variety.js';
import { asw, corvette, vdsFrigate } from './warships.js';

/**
 * Low-poly ship models for the 3D sea view. Bow toward +z, waterline at y = 0.
 * Groups may carry userData.smoke (puffs animated by the scene), userData.radar
 * (a rotating antenna) and objects named 'wake' / 'bow' / 'feather' that follow the speed.
 * Silhouettes follow real ship types of the era (names in the game are fictional).
 */

/**
 * Convoy merchantman: what kind of ship she is comes from her id. Mostly general cargo ships,
 * then feeders, bulk carriers, reefers, smaller tankers and Ro-Ro freighters; the recognition
 * book shows the textbook general cargo ship.
 */
function merchant(g: THREE.Group, lk: Look): void {
  if (!lk.varied) return cargoShip(g, lk);
  const x = lk.r();
  if (x < 0.4) cargoShip(g, lk);
  else if (x < 0.54) cargoShip(g, lk, 'feeder');
  else if (x < 0.68) bulkCarrier(g, lk);
  else if (x < 0.8) cargoShip(g, lk, 'reefer');
  else if (x < 0.9) roro(g, lk);
  else {
    // A product tanker: the big tanker's lines at about two thirds the size
    tanker(g, lk);
    g.scale.multiplyScalar(0.68);
  }
}

/** Model of a ship class seen on the surface. */
export function shipModel(cls: ClassId, id?: string | number): THREE.Group {
  const g = new THREE.Group();
  const lk = look(id);
  if (cls === 'merchant') merchant(g, lk);
  else if (cls === 'ffg') asw(g);
  else if (cls === 'kor') corvette(g);
  else if (cls === 'ffv') vdsFrigate(g);
  else if (cls === 'fischer') trawler(g, lk);
  else if (cls === 'tanker') tanker(g, lk);
  else if (cls === 'container') containerShip(g, lk);
  else if (cls === 'faehre') ferry(g, lk);
  else if (cls === 'schlepper') tug(g, lk);
  else if (cls === 'yacht') yacht(g, lk);
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
