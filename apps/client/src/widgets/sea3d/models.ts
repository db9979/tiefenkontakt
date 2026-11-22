import * as THREE from 'three';
import type { ClassId, Sighting } from '@tk/shared';

/**
 * Low-poly ship models for the 3D sea view. Bow toward +z, waterline at y = 0.
 * Groups may carry userData.smoke (puffs animated by the scene), userData.radar
 * (a rotating antenna) and objects named 'wake' / 'bow' / 'feather' that follow the speed.
 */

const mat = (color: number, opts: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
const M = {
  hullDark: mat(0x30363b), hullGrey: mat(0x5f686e), red: mat(0x5a2a24), deck: mat(0x4b4e4c), white: mat(0x9aa1a4),
  grey: mat(0x6c757a), black: mat(0x1c1f21), cargo: mat(0x5b4334), glass: mat(0x0c1214), sub: mat(0x1f2427),
};
const FOAM = new THREE.MeshBasicMaterial({ color: 0xe6f0f2, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });

function add(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}
const box = (g: THREE.Object3D, w: number, h: number, l: number, x: number, y: number, z: number, m: THREE.Material) => add(g, new THREE.BoxGeometry(w, h, l), m, x, y, z);
const cyl = (g: THREE.Object3D, r: number, h: number, x: number, y: number, z: number, m: THREE.Material, r2 = r) => add(g, new THREE.CylinderGeometry(r, r2, h, 10), m, x, y, z);

/** Hull from a top-view outline (pointed bow, square transom), extruded upward. */
function hull(g: THREE.Object3D, len: number, beam: number, height: number, below: number, m: THREE.Material, boot?: THREE.Material): void {
  const s = new THREE.Shape();
  const L = len / 2;
  const B = beam / 2;
  s.moveTo(-B * 0.8, L);
  s.lineTo(-B, L * 0.1);
  s.quadraticCurveTo(-B, -L * 0.45, 0, -L);
  s.quadraticCurveTo(B, -L * 0.45, B, L * 0.1);
  s.lineTo(B * 0.8, L);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // extrusion becomes height; the shape's bow (−y) ends up at +z
  add(g, geo, m, 0, -below, 0);
  if (boot) {
    const bg = new THREE.ExtrudeGeometry(s, { depth: 1.2, bevelEnabled: false });
    bg.rotateX(-Math.PI / 2);
    bg.scale(1.01, 1, 1.005);
    add(g, bg, boot, 0, -0.6, 0);
  }
}

/** Deck following the hull outline (pointed bow), slightly inset. */
function deckCap(g: THREE.Object3D, len: number, beam: number, y: number, m: THREE.Material): void {
  const s = new THREE.Shape();
  const L = len / 2 - 1;
  const B = beam / 2 - 0.4;
  s.moveTo(-B * 0.8, L);
  s.lineTo(-B, L * 0.1);
  s.quadraticCurveTo(-B, -L * 0.45, 0, -L);
  s.quadraticCurveTo(B, -L * 0.45, B, L * 0.1);
  s.lineTo(B * 0.8, L);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  add(g, geo, m, 0, y + 0.05, 0);
}

/** Funnel smoke: a chain of puffs the scene drifts and fades. */
function smoke(g: THREE.Group, x: number, y: number, z: number, n: number, color = 0x3a3c3e): void {
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const p = add(g, new THREE.SphereGeometry(1, 7, 5), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false }), x, y, z);
    puffs.push(p);
  }
  g.userData.smoke = { puffs, origin: new THREE.Vector3(x, y, z) };
}

/** Stern wake wedge and bow wave; scaled by speed in the scene. */
function wake(g: THREE.Group, len: number, beam: number, bowZ: number, sternZ: number): void {
  const w = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-beam * 0.45, 0.25, 0), new THREE.Vector3(beam * 0.45, 0.25, 0), new THREE.Vector3(len * 0.32, 0.25, -len),
    new THREE.Vector3(-beam * 0.45, 0.25, 0), new THREE.Vector3(len * 0.32, 0.25, -len), new THREE.Vector3(-len * 0.32, 0.25, -len),
  ]), FOAM);
  w.name = 'wake';
  w.position.z = sternZ;
  const b = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(beam * 0.8, 0.4, -beam * 1.6), new THREE.Vector3(-beam * 0.8, 0.4, -beam * 1.6),
  ]), FOAM);
  b.name = 'bow';
  b.position.z = bowZ;
  g.add(w, b);
}

let glowTex: THREE.Texture | undefined;
/** Soft round glow for light points (shared texture). */
function glow(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (glowTex = new THREE.CanvasTexture(c));
}

/**
 * Navigation lights: masthead (white) over the bridge, sidelights red to port and green to
 * starboard, stern light (white). Screen-sized glows so they show for miles at night.
 * Bow is +z, so port (left looking forward) is +x.
 */
function navLights(g: THREE.Group, len: number, beam: number, mastY: number, bridgeZ: number, deckY: number): void {
  const n = new THREE.Group();
  n.name = 'navlights';
  n.visible = false;
  const lamp = (color: number, x: number, y: number, z: number, size: number) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, transparent: true }));
    sp.scale.setScalar(size);
    sp.position.set(x, y, z);
    n.add(sp);
  };
  lamp(0xfff6e0, 0, mastY, bridgeZ, 0.009);
  lamp(0xff3b30, beam / 2, deckY + 2, bridgeZ, 0.007);
  lamp(0x3dff7a, -beam / 2, deckY + 2, bridgeZ, 0.007);
  lamp(0xfff6e0, 0, deckY + 1, -len / 2 + 2, 0.006);
  g.add(n);
}

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

function warship(g: THREE.Group, len: number, beam: number, frigate: boolean): void {
  const k = len / 125;
  hull(g, len, beam, 7.5, 1.5, M.hullGrey, M.black);
  deckCap(g, len, beam, 6, M.deck);
  // Gun forward, bridge, mast with a turning radar, funnel, hangar aft
  cyl(g, 2.2 * k, 2.4, 0, 7.6, 40 * k, M.grey, 2.6 * k);
  const barrel = cyl(g, 0.25, 6 * k, 0, 8.2, 44 * k, M.grey);
  barrel.rotation.x = Math.PI / 2 - 0.15;
  box(g, beam * 0.75, 7, 20 * k, 0, 9.5, 18 * k, M.grey);
  box(g, beam * 0.7, 3, 8 * k, 0, 14.5, 22 * k, M.grey);
  box(g, beam * 0.72, 0.9, 1, 0, 15, 26 * k, M.glass);
  cyl(g, 0.45, 18 * k, 0, 24 * k, 12 * k, M.black, 0.7);
  box(g, 7 * k, 0.4, 0.4, 0, 28 * k, 12 * k, M.black);
  const radar = box(g, 5 * k, 1.6, 0.4, 0, 32 * k, 12 * k, M.black);
  g.userData.radar = radar;
  box(g, beam * 0.55, 7, 9 * k, 0, 9.5, -4 * k, M.grey).rotation.x = -0.12;
  smoke(g, 0, 14, -6 * k, 5, 0x4a4c4e);
  // ASW rocket launcher (box with cells) between gun and bridge; hull number area; boats
  box(g, 4 * k, 2.2, 6 * k, 0, 7.4, 30 * k, M.grey);
  box(g, 3.4 * k, 0.4, 5.4 * k, 0, 8.6, 30 * k, M.black);
  for (const x of [-1, 1]) box(g, 1.2, 1.2, 5 * k, x * beam * 0.42, 10, 4 * k, mat(0xd8732e));
  if (frigate) {
    box(g, beam * 0.8, 6, 16 * k, 0, 9, -26 * k, M.grey);
    box(g, beam * 0.86, 0.3, 22 * k, 0, 6.6, -48 * k, M.deck);
    // Point-defence missile launcher on the hangar roof, flight deck marking
    box(g, 2.5, 1.4, 3, 0, 12.7, -30 * k, M.grey);
    box(g, 0.4, 0.05, 18 * k, 0, 6.8, -48 * k, mat(0xd9d9d0));
  } else box(g, beam * 0.5, 3, 10 * k, 0, 8, -24 * k, M.grey);
  navLights(g, len, beam, 34 * k, 12 * k, 7);
  wake(g, frigate ? 190 : 140, beam, len / 2, -len / 2);
}

/** Frigate with a variable-depth sonar: no hangar, a big gantry and towed body on the quarterdeck. */
function vdsFrigate(g: THREE.Group): void {
  warship(g, 130, 15, false);
  // Stern gantry (A-frame) with the yellow towed body hanging from it
  for (const x of [-4, 4]) box(g, 0.8, 7, 0.8, x, 10, -60, M.grey).rotation.x = 0.3;
  box(g, 9, 0.8, 0.8, 0, 13.3, -61, M.grey);
  box(g, 2.6, 1.4, 4, 0, 8, -63, mat(0xd8a12e));
  // Bow sonar dome hint: a second, taller mast with the long-range radar
  cyl(g, 0.4, 12, 0, 22, -10, M.black, 0.6);
  box(g, 6, 1.2, 0.4, 0, 28, -10, M.black);
}

/** Stern trawler: high bow, bridge forward, gallows and nets aft, lots of lights. */
function trawler(g: THREE.Group): void {
  const red = mat(0x7a2a22);
  hull(g, 45, 10, 6, 1.5, red, M.black);
  deckCap(g, 45, 10, 5, M.deck);
  box(g, 8, 5, 9, 0, 8, 10, M.white);
  box(g, 8.2, 1, 9.2, 0, 10, 10, M.glass);
  cyl(g, 0.3, 10, 0, 14, 12, M.black);
  cyl(g, 1.1, 4, 0, 10, 4, M.black, 1.2);
  // Gallows and net drum on the aft deck
  for (const x of [-3.5, 3.5]) box(g, 0.6, 6, 0.6, x, 8, -16, mat(0xb08a3a));
  box(g, 7.6, 0.6, 0.6, 0, 11, -16, mat(0xb08a3a));
  cyl(g, 1.4, 6, 0, 6.5, -10, mat(0x2b3a31)).rotation.z = Math.PI / 2;
  smoke(g, 0, 12, 4, 3);
  navLights(g, 45, 10, 14, 10, 6);
  wake(g, 70, 10, 22, -22);
}

function surfacedBoat(g: THREE.Group, len: number): void {
  const r = Math.max(3, len / 17);
  const body = cyl(g, r, len, 0, -r * 0.55, 0, M.sub);
  body.rotation.x = Math.PI / 2;
  const bow = add(g, new THREE.SphereGeometry(r, 12, 8), M.sub, 0, -r * 0.55, len / 2);
  bow.scale.set(1, 1, 1.6);
  // Tapered stern, cruciform rudders, flat casing on top
  const tail = add(g, new THREE.ConeGeometry(r, len * 0.18, 12), M.sub, 0, -r * 0.55, -len / 2 - len * 0.09);
  tail.rotation.x = -Math.PI / 2;
  box(g, 0.4, r * 2.2, len * 0.06, 0, -r * 0.55, -len * 0.56, M.sub);
  box(g, r * 2.4, 0.4, len * 0.06, 0, -r * 0.55, -len * 0.56, M.sub);
  box(g, r * 0.9, 0.4, len * 0.7, 0, r * 0.4, 0.05 * len, M.sub);
  // Sail with fairwater planes and the mast heads on top
  box(g, 3, 7.5, 11, 0, 4, len * 0.12, M.sub);
  box(g, 7, 0.5, 2, 0, 5, len * 0.16, M.sub);
  for (const x of [-0.6, 0.6]) cyl(g, 0.18, 2.4, x, 8.8, len * 0.13, M.black);
  wake(g, 90, 8, len / 2 + 4, -len / 2);
}

/** Model of a ship class seen on the surface. */
export function shipModel(cls: ClassId): THREE.Group {
  const g = new THREE.Group();
  if (cls === 'merchant') merchant(g);
  else if (cls === 'ffg') warship(g, 125, 14, true);
  else if (cls === 'kor') warship(g, 90, 11, false);
  else if (cls === 'ffv') vdsFrigate(g);
  else if (cls === 'fischer') trawler(g);
  else surfacedBoat(g, cls === 'ssn' ? 100 : cls === 'ssc' ? 45 : cls === 'ssa' ? 60 : 70);
  return g;
}

/** What a lookout actually sees of a submerged boat: a periscope with its feather, or a snorkel with exhaust haze. */
export function sightingModel(what: Sighting, cls: ClassId): THREE.Group {
  if (what === 'surfaced') return shipModel(cls === 'merchant' || cls === 'ffg' || cls === 'kor' || cls === 'ffv' || cls === 'fischer' ? 'ssk' : cls);
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
