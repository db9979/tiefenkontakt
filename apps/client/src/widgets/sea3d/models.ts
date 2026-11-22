import * as THREE from 'three';
import { CLASSES, type ClassId, type Sighting } from '@tk/shared';
import { FOAM, M, add, cyl, navLights, smoke, wake } from './parts.js';
import { loftHull } from './hullkit.js';
import { C, Kit, base, bulwark, derrick, funnel, hatch, lifeboat, narrowest, pole, radar, raisedDeck, rng, shipName, windlass, winRow } from './civilkit.js';
import { surfacedBoat } from './boats.js';
import { containerShip, ferry, tanker, trawler, tug, yacht } from './civil.js';
import { asw, corvette, vdsFrigate } from './warships.js';

/**
 * Low-poly ship models for the 3D sea view. Bow toward +z, waterline at y = 0.
 * Groups may carry userData.smoke (puffs animated by the scene), userData.radar
 * (a rotating antenna) and objects named 'wake' / 'bow' / 'feather' that follow the speed.
 * Silhouettes follow real ship types of the era (names in the game are fictional).
 */

/** Merchant liveries seen in Cold War convoys: hull (black, grey, rust brown, dark green) and funnel body / band. */
const HULLS = [0x26292b, 0x4a5156, 0x4a2e24, 0x2b3a31];
const FUNNELS: [number, number | undefined][] = [[0x1c1f21, 0xb03a2e], [0xb03a2e, 0xd9dcda], [0xb4945a, undefined], [0x2a3f5a, 0xd9dcda], [0xd9dcda, 0x2a5a8a]];
const HOUSES = [C.white, C.white, C.cream];
const NAMES = ['NORDLAND', 'ELBSTROM', 'HANSA TRADER', 'BALTIC STAR', 'MARIA K', 'SKAGEN', 'WESERLAND', 'KAP ARKONA', 'HELLAS', 'ANNA K'];

/**
 * General-cargo freighter of the 1960s/70s (~130 m): raised forecastle and poop, five hatches
 * worked by goalpost derrick posts and booms, accommodation three quarters aft with the bridge
 * on top, a raked funnel in company colours and lifeboats in gravity davits on the boat deck.
 */
function merchant(g: THREE.Group): void {
  const r = rng();
  const hullC = HULLS[Math.floor(r() * HULLS.length)]!;
  const [fBody, fBand] = FUNNELS[Math.floor(r() * FUNNELS.length)]!;
  const house = HOUSES[Math.floor(r() * HOUSES.length)]!;
  const posts = r() < 0.5 ? C.buff : C.white;
  const h = loftHull(g, {
    len: 130, beam: 19, freeboard: 7, draft: 7.5, sheerBow: 2.2, sheerStern: 0.8, rake: 7, flare: 0.08, fullness: 0.55,
    transom: 0.4, bilge: 0.8, colors: { top: hullC, boot: 0x7a2a22, bottom: 0x5a2a24 }, boot: [-0.6, 0.9],
  });
  const k = new Kit(g);
  // Raised forecastle with bulwark, windlass and a light foremast; raised poop aft
  raisedDeck(k, h, 51, 65, 2.4, hullC);
  bulwark(k, h, 51, 64.6, 1.0, hullC, 2.4);
  const yF = h.deckAt(58) + 2.4;
  windlass(k, yF, 59, 2.2);
  pole(k, 0, h.deckAt(54) + 2.3, 54, 13, 0.35, posts, [0.75], 3.5);
  raisedDeck(k, h, -65, -57, 2.2, hullC);
  bulwark(k, h, -64.5, -57, 1.0, hullC, 2.2);
  // Five hatches; goalpost derrick masts between them with booms resting toward the holds
  const hw = 10.5;
  for (const [z, l] of [[44, 9], [27.5, 13], [10, 13], [-9, 13], [-51, 8]] as const) hatch(k, h, z, l, hw, 1.3, hullC);
  for (const z of [36.5, 18.6, 1.5]) {
    const y0 = base(h, z - 1, z + 1);
    const top = y0 + 14;
    k.block(9, 1.4, 2, 0, y0, z, posts);
    for (const sx of [-1, 1]) {
      k.cyl(0.42, top - y0, sx * 3.6, (y0 + top) / 2, z, posts, 0.32, 8);
      derrick(k, sx * 3.6, y0 + 1.6, z + 1, top - 0.5, 1, 12, 0.4);
      derrick(k, sx * 3.6, y0 + 1.6, z - 1, top - 0.5, -1, 12, 0.4);
    }
    k.box(8.2, 0.7, 0.9, 0, top - 0.35, z, posts);
    pole(k, 0, top, z, 5, 0.2, posts, []);
  }
  {
    const z = -43.5;
    const y0 = base(h, z - 1, z + 1);
    for (const sx of [-1, 1]) {
      k.cyl(0.4, 12, sx * 3.4, y0 + 6, z, posts, 0.3, 8);
      derrick(k, sx * 3.4, y0 + 1.5, z - 0.5, y0 + 11.5, -1, 9, 0.4);
    }
    k.box(7.6, 0.6, 0.8, 0, y0 + 11.7, z, posts);
  }
  // Accommodation 3/4 aft: main deck house, boat deck, bridge deck with wheelhouse and wings
  const z0 = -40;
  const z1 = -19;
  const y1 = base(h, z0, z1);
  const half = narrowest(h, z0, z1) - 0.5;
  k.block(half * 2, 3, z1 - z0, 0, y1, (z0 + z1) / 2, house);
  const y2 = y1 + 3;
  k.block(12, 2.8, 18, 0, y2, -29, house);
  const y3 = y2 + 2.8;
  k.block(11, 2.8, 6, 0, y3, -23, house);
  const y4 = y3 + 2.8;
  k.block(11.4, 0.3, 6.4, 0, y4, -23, C.dark);
  k.block(half * 2, 1.1, 2, 0, y3, -21, house);
  winRow(k, 'x', 0, y3 + 1.7, -19.97, 9, 7, 1.0, 1.0);
  winRow(k, 'x', 0, y2 + 1.5, -19.97, 9, 6, 0.8, 0.7);
  winRow(k, 'x', 0, y1 + 1.6, -18.97, half * 2 - 3, 8, 0.8, 0.7);
  for (const sx of [-1, 1]) {
    winRow(k, 'z', sx * (half + 0.03), y1 + 1.6, -29.5, 16, 7, 0.8, 0.7);
    winRow(k, 'z', sx * 6.03, y2 + 1.5, -29, 14, 6, 0.8, 0.7);
    winRow(k, 'z', sx * 5.53, y3 + 1.7, -23, 3.5, 3, 0.9, 0.9);
    lifeboat(k, sx * (6 + 1.6), y2, -31, 7, sx);
  }
  const top = funnel(k, 0, y2 + 2.8, -32, 4.4, 7.4, 9.5, fBody, fBand);
  pole(k, 0, y4 + 0.3, -24, 5, 0.22, C.dark, [0.6], 2.4);
  radar(g, k, 0, y4 + 0.3, -21.6, 3);
  k.done();
  shipName(g, h, NAMES[Math.floor(r() * NAMES.length)]!, 56.5, h.deckAt(56) + 0.9, 1.5);
  smoke(g, top[0], top[1] + 0.5, top[2], 7);
  navLights(g, 130, 19, y4 + 5.3, -24, h.deckAt(0));
  wake(g, 200, 19, 65, -65);
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
