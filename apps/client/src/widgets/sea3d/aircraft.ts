import * as THREE from 'three';
import type { PlaneKind } from '@tk/shared';
import { M, box, cyl, mat } from './parts.js';

/**
 * Aircraft after period types (names fictional): a twin-jet airliner with a contrail, a high-
 * wing light aircraft, a big four-turboprop long-range recon aircraft, a four-turboprop
 * maritime patrol aircraft with the MAD boom in the tail, and an ASW helicopter whose rotors
 * turn. Nose toward +z. Night lights: red port wingtip (+x), green starboard, white tail and a
 * flashing red beacon (userData.strobe).
 */

const WHITE = mat(0xdfe3e4);
const GREY = mat(0x8c969b);
const DARK = mat(0x4a5258);

function lights(g: THREE.Group, span: number, tailZ: number, topY: number): void {
  const n = new THREE.Group();
  n.name = 'navlights';
  n.visible = false;
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const lamp = (color: number, x: number, y: number, z: number, size: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, transparent: true }));
    s.scale.setScalar(size);
    s.position.set(x, y, z);
    n.add(s);
    return s;
  };
  lamp(0xff3b30, span / 2, 0, 0, 0.006);
  lamp(0x3dff7a, -span / 2, 0, 0, 0.006);
  lamp(0xffffff, 0, 0, tailZ, 0.005);
  g.userData.strobe = lamp(0xff2a1a, 0, topY, 0, 0.009);
  g.add(n);
}

/**
 * Swept wing pair; returns where the wing's centre line lies at a spanwise position x, so
 * engines and props can be hung exactly under it.
 */
function wing(g: THREE.Group, span: number, chord: number, y: number, z: number, sweep: number, m: THREE.Material): (x: number) => number {
  const zc = z - Math.abs(sweep) / 2;
  const a = sweep * 0.02;
  for (const side of [-1, 1]) {
    // Root at the fuselage centre line; rotating about the root keeps it attached
    const w = new THREE.Mesh(new THREE.BoxGeometry(span / 2, 0.4, chord), m);
    w.geometry.translate(side * span / 4, 0, 0);
    w.position.set(0, y, zc + Math.abs(sweep) / 2);
    w.rotation.y = side * a;
    g.add(w);
  }
  // A point at spanwise x on the rotated wing lies |x|·tan(a) further aft of the root
  return (x: number) => zc + Math.abs(sweep) / 2 - Math.abs(x) * Math.tan(a);
}

function fuselage(g: THREE.Group, len: number, r: number, m: THREE.Material): void {
  const f = cyl(g, r, len, 0, 0, 0, m, r * 0.9);
  f.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
  nose.scale.set(1, 1, 1.8);
  nose.position.z = len / 2;
  g.add(nose);
}

/** Turboprop nacelles hung under the wing line (top of the nacelle touches the wing), props in front. */
function props(g: THREE.Group, xs: number[], wingY: number, at: (x: number) => number, r: number): void {
  const disc = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
  for (const x of xs) {
    const z = at(x);
    const y = wingY - 0.2 - 0.8;
    const nac = cyl(g, 0.9, 5, x, y, z + 0.5, DARK);
    nac.rotation.x = Math.PI / 2;
    const p = new THREE.Mesh(new THREE.CircleGeometry(r, 16), disc);
    p.position.set(x, y, z + 3.1);
    g.add(p);
  }
}

function airliner(g: THREE.Group): void {
  fuselage(g, 38, 2, WHITE);
  const at = wing(g, 34, 6, -0.8, 0, 12, GREY);
  // Engines on short pylons: top of the nacelle meets the underside of the wing
  for (const x of [-6, 6]) {
    cyl(g, 1.1, 4, x, -2.1, at(x) + 1, GREY).rotation.x = Math.PI / 2;
  }
  box(g, 0.4, 7, 5, 0, 3.6, -18, WHITE);
  box(g, 12, 0.3, 3.5, 0, 0.6, -18, GREY);
  // Contrail: two long white streaks from the engines
  const trail = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const c = new THREE.Group();
  c.name = 'contrail';
  // Fresh and narrow behind the engines, older and spread out further back
  for (const x of [-6, 6]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 1500), trail);
    t.position.set(x, -2.1, -770);
    c.add(t);
  }
  const old = new THREE.Mesh(new THREE.BoxGeometry(40, 18, 3000), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
  old.position.set(0, -2.4, -3000);
  c.add(old);
  g.add(c);
  lights(g, 34, -20, 2.2);
}

function lightPlane(g: THREE.Group): void {
  fuselage(g, 7.5, 0.6, WHITE);
  // High wing resting on the cabin roof, with struts down to the fuselage
  box(g, 11, 0.15, 1.5, 0, 0.65, 0.6, WHITE);
  for (const x of [-1.6, 1.6]) box(g, 0.06, 0.9, 0.06, x, 0.2, 0.6, GREY).rotation.z = x > 0 ? 0.9 : -0.9;
  box(g, 0.12, 1.4, 1, 0, 0.8, -3.6, mat(0xb03a2e));
  box(g, 3.4, 0.1, 0.8, 0, 0.2, -3.6, WHITE);
  lights(g, 11, -4, 1.2);
}

function recon(g: THREE.Group): void {
  // Long-range recon: long fuselage, long swept wings with four big turboprops, tall fin
  fuselage(g, 46, 1.9, GREY);
  const at = wing(g, 50, 6, -0.4, 2, 20, GREY);
  props(g, [-17, -8, 8, 17], -0.4, at, 2.8);
  box(g, 0.4, 9, 6, 0, 4.6, -20, GREY);
  box(g, 15, 0.3, 4, 0, 1, -20, GREY);
  lights(g, 50, -23, 2);
}

function mpa(g: THREE.Group): void {
  // Patrol aircraft: low wing, four turboprops, MAD boom sticking out of the tail
  fuselage(g, 32, 1.7, WHITE);
  const at = wing(g, 30, 4.5, -1, 1, 4, WHITE);
  props(g, [-9.5, -4.5, 4.5, 9.5], -1, at, 2);
  box(g, 0.4, 6, 4, 0, 3.4, -14, WHITE);
  box(g, 12, 0.3, 3, 0, 0.6, -14, WHITE);
  cyl(g, 0.25, 5, 0, 0, -18.5, GREY).rotation.x = Math.PI / 2;
  lights(g, 30, -21, 1.8);
}

function helo(g: THREE.Group): void {
  // ASW helicopter: cabin pod, tail boom with tail rotor, main rotor turning above
  const pod = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), M.hullGrey);
  pod.scale.set(1, 1, 2.4);
  g.add(pod);
  const boom = cyl(g, 0.45, 8, 0, 0.4, -6.5, M.hullGrey, 0.25);
  boom.rotation.x = Math.PI / 2;
  box(g, 0.2, 2, 1.2, 0, 1.2, -10.5, M.hullGrey);
  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  for (const a of [0, Math.PI / 2]) box(rotor, 13, 0.08, 0.5, 0, 0, 0, M.black).rotation.y = a;
  rotor.position.set(0, 2.1, 0);
  g.add(rotor);
  cyl(g, 0.15, 0.6, 0, 1.8, 0, M.black);
  const tail = new THREE.Group();
  tail.name = 'tailrotor';
  box(tail, 0.06, 2.2, 0.25, 0, 0, 0, M.black);
  tail.position.set(0.3, 1.2, -10.5);
  g.add(tail);
  lights(g, 3.4, -10.5, 2.4);
}

export function aircraftModel(kind: PlaneKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'airliner') airliner(g);
  else if (kind === 'light') lightPlane(g);
  else if (kind === 'recon') recon(g);
  else if (kind === 'mpa') mpa(g);
  else helo(g);
  return g;
}

/** Turn rotors and flash the beacon. */
export function animateAircraft(g: THREE.Group, t: number, night: boolean): void {
  const r = g.getObjectByName('rotor');
  if (r) r.rotation.y = t * 30;
  const tr = g.getObjectByName('tailrotor');
  if (tr) tr.rotation.x = t * 60;
  const s = g.userData.strobe as THREE.Sprite | undefined;
  if (s) s.visible = night && t % 1.2 < 0.12;
}
