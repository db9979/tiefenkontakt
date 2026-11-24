import * as THREE from 'three';
import type { PlaneKind } from '@tk/shared';
import { K, std } from './hullkit.js';
import { rng } from './civilkit.js';
import { pick, seedOf } from './variety.js';
import { blades, foil, pod, rev, rod, type P3, type Ring, type Station } from './boats.js';

/**
 * Aircraft after period types (names fictional): a twin-jet narrow-body airliner with a
 * contrail, a high-wing light aircraft with struts, a long-range four-turboprop recon aircraft
 * with contra-rotating props and a nose probe, a four-turboprop maritime patrol aircraft with
 * the MAD boom in the tail and a chin radome, and a naval ASW helicopter whose rotors turn.
 * Fuselages are lofted round bodies, wings real tapered and swept foils; engines, struts,
 * pylons and gear all reach into what carries them. Nose toward +z. Night lights: red port
 * wingtip (+x), green starboard, white tail and a flashing red beacon (userData.strobe).
 */

const WHITE = std(0xdfe3e4, { roughness: 0.45 });
const WHITE_ = WHITE;
const GREY = std(0x9aa3a8, { roughness: 0.5 });
const LGREY = std(0xb4bcc0, { roughness: 0.55 });
const SILVER = std(0xa7adb0, { roughness: 0.4, metalness: 0.45 });
const DARK = std(0x4a5258, { roughness: 0.6 });
const NAVY = std(0x5d686e, { roughness: 0.7 });
const NAVY_ = NAVY;
const BLUE = std(0x2b4a78, { roughness: 0.5 });
const RED = std(0xb03a2e, { roughness: 0.5 });
const DISC = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });

let lampTex: THREE.Texture | undefined;
function lights(g: THREE.Group, tip: P3, tail: P3, beacon: P3): void {
  const n = new THREE.Group();
  n.name = 'navlights';
  n.visible = false;
  if (!lampTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 32, 32);
    lampTex = new THREE.CanvasTexture(c);
  }
  const lamp = (color: number, p: P3, size: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampTex, color, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, transparent: true }));
    s.scale.setScalar(size);
    s.position.set(...p);
    n.add(s);
    return s;
  };
  lamp(0xff3b30, tip, 0.006);
  lamp(0x3dff7a, [-tip[0], tip[1], tip[2]], 0.006);
  lamp(0xffffff, tail, 0.005);
  g.userData.strobe = lamp(0xff2a1a, beacon, 0.009);
  g.add(n);
}

type FR = [number, number, number][];

/** Round fuselage lofted through [z, radius, centre height] rings, so the tail can sweep up; returns the rings sorted by z. */
function fuselage(g: THREE.Group, rings: FR, m: THREE.Material): FR {
  const rs = [...rings].sort((a, b) => a[0] - b[0]);
  pod(g, rs.map(([z, r, y]) => ({ z, w: r, h: r, y })), m, 20);
  return rs;
}

/**
 * Flush panel (windows, windscreen) on a round fuselage at station z, angle th from the top
 * (+ toward port), a wide around the skin and l long: it lies on the skin, so nothing pokes out.
 */
function decal(g: THREE.Group, rs: FR, z: number, th: number, a: number, l: number, m: THREE.Material = K.glass): void {
  const i = Math.max(0, rs.findIndex((q) => q[0] >= z) - 1);
  const [z0, r0, y0] = rs[i]!;
  const [z1, r1, y1] = rs[Math.min(rs.length - 1, i + 1)]!;
  const f = z1 > z0 ? (z - z0) / (z1 - z0) : 0;
  const r = r0 + (r1 - r0) * f;
  const y = y0 + (y1 - y0) * f;
  const dr = z1 > z0 ? (r1 - r0) / (z1 - z0) : 0;
  const n = new THREE.Vector3(Math.sin(th), Math.cos(th), -dr).normalize();
  const t1 = new THREE.Vector3(Math.cos(th), -Math.sin(th), 0);
  const t2 = new THREE.Vector3().crossVectors(n, t1);
  const p = new THREE.Mesh(new THREE.BoxGeometry(a, l, 0.08), m);
  p.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t1, t2, n));
  p.position.set(r * Math.sin(th), y + r * Math.cos(th), z);
  g.add(p);
}

/** Wing (or tailplane) pair from stations on one side (s ≥ 0), mirrored. */
function wings(g: THREE.Group, st: Station[], m: THREE.Material): void {
  for (const sx of [1, -1]) foil(g, st.map((S) => ({ ...S, s: S.s * sx })), m, false);
}

/** Leading edge, trailing edge, centre height and half thickness of a station list at span x. */
function at(st: Station[], x: number): Station {
  const a = Math.abs(x);
  for (let i = 0; i < st.length - 1; i++) {
    const p = st[i]!;
    const q = st[i + 1]!;
    if (a <= q.s || i === st.length - 2) {
      const f = (a - p.s) / (q.s - p.s);
      const l = (u: number, v: number) => u + (v - u) * f;
      return { s: a, le: l(p.le, q.le), te: l(p.te, q.te), t: l(p.t, q.t), o: l(p.o ?? 0, q.o ?? 0) };
    }
  }
  return st[0]!;
}

/** Spinning propeller (blades plus a faint disc) at z on a nacelle axis; registered for animateAircraft. */
function prop(g: THREE.Group, x: number, y: number, z: number, n: number, r: number, hub: number, chord: number, dir = 1, m: THREE.Material = K.black): void {
  const p = blades(n, hub * 0.5, r - hub * 0.5, chord, 0.6 * dir, m, 0.06);
  p.position.set(x, y, z);
  const d = new THREE.Mesh(new THREE.CircleGeometry(r, 20), DISC);
  p.add(d);
  g.add(p);
  ((g.userData.props ??= []) as { o: THREE.Object3D; d: number }[]).push({ o: p, d: dir });
}

/** Turbofan nacelle on a pylon under the wing: intake lip, dark fan face, exhaust cone. */
function jet(g: THREE.Group, x: number, y: number, z: number, wingY: number, wingLe: number, m: THREE.Material): void {
  const n = rev(g, [[0.05, -3.2], [0.32, -2.8], [0.58, -2.2], [0.72, -2.05], [0.95, -0.4], [0.99, 0.9], [0.92, 1.85], [0.74, 2.0], [0.7, 1.8], [0.001, 1.6]], m, 18);
  n.position.set(x, y, z);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.71, 16), K.black);
  fan.position.set(x, y, z + 1.65);
  g.add(fan);
  foil(g, [
    { s: y + 0.6, le: z + 1.2, te: z - 2.2, t: 0.16, o: x },
    { s: wingY, le: Math.min(wingLe - 0.3, z + 0.4), te: z - 2.6, t: 0.14, o: x },
  ], m, true);
}

/** Turboprop nacelle through the wing with spinner and one or two (contra-rotating) blade rows. */
function turboprop(g: THREE.Group, x: number, y: number, zf: number, back: number, r: number, propR: number, n: number, rows: number, m: THREE.Material): void {
  rev(g, [[0.05, zf - back], [r * 0.5, zf - back + 0.8], [r * 0.9, zf - back * 0.55], [r, zf - 2.2], [r * 0.95, zf - 0.6], [r * 0.85, zf]], m, 16).position.set(x, y, 0);
  const sl = rows > 1 ? 2.4 : 1.4;
  rev(g, [[r * 0.84, zf - 0.05], [r * 0.75, zf + sl * 0.45], [r * 0.5, zf + sl * 0.8], [0.001, zf + sl]], DARK, 14).position.set(x, y, 0);
  for (let i = 0; i < rows; i++) prop(g, x, y, zf + 0.35 + i * 0.95, n, propR, r * 0.8, propR * 0.13, i % 2 ? -1 : 1);
}

function airliner(g: THREE.Group, r: () => number): void {
  // Narrow-body jet, 38 m (twin, or an older four-jet): round fuselage with upswept tail cone,
  // in the colours of one of a dozen airlines
  const body = pick(r, [WHITE, WHITE, SILVER, std(0xe9e4d8, { roughness: 0.45 })]);
  const tail = std(pick(r, [0x2b4a78, 0xb03a2e, 0x2a6a4a, 0xd8732e, 0x5a2a6a, 0xc9a640, 0x1c1f21, 0x2a8a9a]), { roughness: 0.5 });
  const belly = r() < 0.3 ? tail : GREY;
  const quad = r() < 0.3;
  const BLUE = tail;
  const F = fuselage(g, [[19.4, 0.05, -0.4], [19.1, 0.75, -0.32], [18.5, 1.22, -0.2], [17.5, 1.62, -0.08], [16, 1.9, 0], [13, 1.95, 0], [-9, 1.95, 0],
    [-12, 1.85, 0.15], [-15, 1.45, 0.55], [-17.5, 0.9, 0.95], [-19, 0.38, 1.25], [-19.4, 0.05, 1.3]], body);
  // Windscreen, window line and cheat line
  for (const sx of [-1, 1]) {
    decal(g, F, 17.6, sx * 0.3, 0.6, 0.45);
    decal(g, F, 17.35, sx * 0.85, 0.5, 0.5);
    decal(g, F, 2, sx * 1.3, 0.24, 23);
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 24), BLUE);
    c.position.set(sx * 1.93, -0.05, 2);
    g.add(c);
  }
  // Low swept wing with dihedral, wing-body fairing underneath
  const W: Station[] = [
    { s: 0, le: 4.2, te: -3.8, t: 0.42, o: -1.25 },
    { s: 5.6, le: 1.5, te: -3.3, t: 0.34, o: -0.76 },
    { s: 17, le: -4.0, te: -5.6, t: 0.11, o: 0.24 },
  ];
  wings(g, W, GREY);
  pod(g, [{ z: -6.5, w: 0.1, h: 0.1, y: -1.5 }, { z: -4.5, w: 1.5, h: 0.55, y: -1.55 }, { z: 3.5, w: 1.6, h: 0.6, y: -1.55 }, { z: 6, w: 0.1, h: 0.1, y: -1.45 }], belly, 14);
  // Engines on short pylons under the wing (nacelle top meets the pylon, pylon reaches into the wing)
  for (const x of quad ? [-4.6, 4.6, -9.6, 9.6] : [-5.6, 5.6]) {
    const w = at(W, x);
    jet(g, x, w.o! - w.t - 1.05, w.le + 0.35, w.o!, w.le, GREY);
  }
  // Fin with dorsal fillet in company blue, tailplanes with dihedral
  foil(g, [{ s: 1.1, le: -9.3, te: -17.6, t: 0.32 }, { s: 2.3, le: -11.6, te: -17.9, t: 0.28 }, { s: 8.6, le: -16.4, te: -19.3, t: 0.12 }], BLUE, true);
  wings(g, [{ s: 0, le: -14.6, te: -18.7, t: 0.22, o: 0.9 }, { s: 6.3, le: -18.3, te: -20, t: 0.08, o: 1.66 }], GREY);
  // Contrail: two long white streaks from the engines, older and spread out further back
  const trail = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const c = new THREE.Group();
  c.name = 'contrail';
  const ey = at(W, 5.6);
  for (const x of [-5.6, 5.6]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 1500), trail);
    t.position.set(x, ey.o! - ey.t - 1.05, -770);
    c.add(t);
  }
  const old = new THREE.Mesh(new THREE.BoxGeometry(40, 18, 3000), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
  old.position.set(0, -2.4, -3000);
  c.add(old);
  g.add(c);
  lights(g, [17, 0.24, -4.8], [0, 1.3, -19.5], [0, 2.0, -1]);
}

function lightPlane(g: THREE.Group, r: () => number): void {
  const RED = std(pick(r, [0xb03a2e, 0x2b4a78, 0x2a6a4a, 0xd8732e, 0xc9a640, 0x1c1f21]), { roughness: 0.5 });
  const WHITE = pick(r, [WHITE_, WHITE_, std(0xe9e4d8, { roughness: 0.45 }), std(0xc8d4dc, { roughness: 0.45 })]);
  // High-wing four-seater, 8.3 m: cowling, cabin, slim tail cone
  pod(g, [
    { z: -4.45, w: 0.02, h: 0.05, y: 0.42 }, { z: -4.3, w: 0.08, h: 0.2, y: 0.4 }, { z: -3, w: 0.22, h: 0.35, y: 0.32 }, { z: -1.5, w: 0.42, h: 0.55, y: 0.25 },
    { z: -0.6, w: 0.55, h: 0.7, y: 0.2 }, { z: 0.6, w: 0.56, h: 0.73, y: 0.17 }, { z: 1.15, w: 0.56, h: 0.72, y: 0.16 }, { z: 1.7, w: 0.54, h: 0.56, y: 0.02 }, { z: 2.3, w: 0.5, h: 0.5, y: 0 },
    { z: 2.75, w: 0.42, h: 0.42, y: -0.05 },
  ].map((r): Ring => ({ ...r, n: 2.6 })), WHITE, 16);
  const ws = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.55), K.glass);
  ws.position.set(0, 0.7, 1.43);
  ws.rotation.x = 0.5;
  g.add(ws);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 1.7), K.glass);
    w.position.set(sx * 0.52, 0.55, 0.1);
    g.add(w);
  }
  // Wing on the cabin roof; struts from the lower fuselage into the wing
  const W: Station[] = [{ s: 0, le: 1.5, te: -0.1, t: 0.085, o: 0.95 }, { s: 2.6, le: 1.5, te: -0.1, t: 0.085, o: 1.03 }, { s: 5.5, le: 1.35, te: 0.25, t: 0.05, o: 1.12 }];
  wings(g, W, WHITE);
  for (const sx of [-1, 1]) rod(g, [sx * 0.45, -0.25, 0.75], [sx * 2.55, 1.02, 0.75], 0.045, GREY);
  // Fixed tricycle gear: legs from inside the fuselage to the wheel hubs
  const wheel = new THREE.CylinderGeometry(0.22, 0.22, 0.13, 12);
  wheel.rotateZ(Math.PI / 2);
  for (const [a, b] of [[[0.4, -0.35, -0.1], [1.2, -1.12, -0.1]], [[-0.4, -0.35, -0.1], [-1.2, -1.12, -0.1]], [[0, -0.3, 2.0], [0, -1.15, 2.2]]] as [P3, P3][]) {
    rod(g, a, b, 0.04, GREY);
    const w = new THREE.Mesh(wheel, K.rubber);
    w.position.set(...b);
    g.add(w);
  }
  // Fin and stabiliser
  foil(g, [{ s: 0.3, le: -2.9, te: -4.35, t: 0.07 }, { s: 0.55, le: -3.4, te: -4.45, t: 0.06 }, { s: 1.6, le: -4.0, te: -4.6, t: 0.04 }], RED, true);
  wings(g, [{ s: 0, le: -3.3, te: -4.35, t: 0.05, o: 0.36 }, { s: 1.7, le: -3.6, te: -4.3, t: 0.03, o: 0.36 }], WHITE);
  // Spinner and two-blade propeller
  rev(g, [[0.42, 2.7], [0.36, 2.95], [0.22, 3.2], [0.001, 3.4]], RED, 12);
  prop(g, 0, -0.05, 3.0, 2, 0.95, 0.3, 0.15);
  lights(g, [5.5, 1.12, 0.8], [0, 0.55, -4.5], [0, 1.6, -4.25]);
}

function recon(g: THREE.Group): void {
  // Long-range recon: long thin fuselage, 35° swept wings, four turboprops with contra-props, tall fin
  const F = fuselage(g, [[23.4, 0.05, -0.2], [22.7, 0.7, -0.1], [21.3, 1.2, 0], [19.5, 1.42, 0], [-14, 1.45, 0], [-18, 1.3, 0.1], [-21, 0.95, 0.25],
    [-22.8, 0.6, 0.35], [-23.4, 0.3, 0.35], [-23.6, 0.05, 0.35]], SILVER);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), K.glass);
  nose.position.set(0, -0.15, 23.0);
  g.add(nose);
  const turret = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), K.glass);
  turret.position.set(0, 0.35, -23.2);
  g.add(turret);
  for (const sx of [-1, 1]) {
    decal(g, F, 20.6, sx * 0.3, 0.55, 0.6);
    decal(g, F, 20.4, sx * 0.85, 0.5, 0.6);
  }
  // Refuelling probe over the nose, rooted in the fuselage
  rod(g, [0, 0.9, 20.5], [0, 1.0, 26], 0.08, DARK);
  // Big ventral search radome
  pod(g, [{ z: -4.5, w: 0.05, h: 0.05, y: -1.3 }, { z: -3, w: 1.1, h: 0.6, y: -1.35 }, { z: 1, w: 1.3, h: 0.75, y: -1.35 }, { z: 5, w: 1.0, h: 0.5, y: -1.3 }, { z: 6, w: 0.05, h: 0.05, y: -1.2 }], DARK, 14);
  const W: Station[] = [{ s: 0, le: 5.5, te: -2.5, t: 0.45, o: -0.4 }, { s: 12, le: -3.2, te: -8.4, t: 0.3, o: -0.65 }, { s: 25, le: -12, te: -14.6, t: 0.13, o: -0.9 }];
  wings(g, W, SILVER);
  for (const sx of [-1, 1]) {
    for (const [x, back] of [[7, 13], [14.5, 8]] as const) {
      const w = at(W, x);
      turboprop(g, sx * x, w.o! - 0.15, w.le + 3.6, back, 0.95, 2.8, 4, 2, SILVER);
    }
  }
  foil(g, [{ s: 0.8, le: -13, te: -21.5, t: 0.35 }, { s: 1.6, le: -15.5, te: -21.8, t: 0.3 }, { s: 8.4, le: -20.8, te: -24.3, t: 0.14 }], SILVER, true);
  wings(g, [{ s: 0, le: -16.5, te: -21.5, t: 0.25, o: 0.5 }, { s: 7.3, le: -21.3, te: -23.8, t: 0.08, o: 0.5 }], SILVER);
  lights(g, [25, -0.9, -13.3], [0, 0.35, -23.8], [0, 1.5, 2]);
}

function mpa(g: THREE.Group): void {
  // Maritime patrol: low straight wing, four turboprops, chin radome, MAD boom out of the tail
  const F = fuselage(g, [[17.2, 0.05, -0.35], [16.6, 0.75, -0.2], [15.4, 1.35, -0.05], [13.8, 1.65, 0], [12, 1.7, 0], [-8, 1.7, 0], [-11, 1.55, 0.15],
    [-13.5, 1.1, 0.45], [-15, 0.6, 0.7], [-15.6, 0.36, 0.78]], LGREY);
  rev(g, [[0.05, -20.8], [0.22, -20.4], [0.3, -19.5], [0.34, -16.5], [0.4, -15.2]], LGREY, 10).position.y = 0.78;
  pod(g, [{ z: 11.6, w: 0.05, h: 0.05, y: -1.5 }, { z: 12.3, w: 0.6, h: 0.35, y: -1.55 }, { z: 13.8, w: 0.95, h: 0.55, y: -1.55 }, { z: 15.6, w: 0.7, h: 0.4, y: -1.5 }, { z: 16.3, w: 0.05, h: 0.05, y: -1.4 }], DARK, 14);
  for (const sx of [-1, 1]) {
    decal(g, F, 15.6, sx * 0.3, 0.55, 0.55);
    decal(g, F, 15.4, sx * 0.85, 0.55, 0.6);
  }
  const W: Station[] = [{ s: 0, le: 4.4, te: -1.6, t: 0.42, o: -1.0 }, { s: 15.2, le: 2.2, te: 0, t: 0.13, o: 0.6 }];
  wings(g, W, LGREY);
  for (const sx of [-1, 1]) {
    for (const x of [4.9, 10]) {
      const w = at(W, x);
      turboprop(g, sx * x, w.o! + 0.1, w.le + 2.4, 7.5, 0.8, 2.05, 4, 1, LGREY);
    }
  }
  foil(g, [{ s: 0.9, le: -6.5, te: -15.2, t: 0.3 }, { s: 2.0, le: -11.5, te: -15.6, t: 0.28 }, { s: 7.6, le: -14.6, te: -17.0, t: 0.14 }], LGREY, true);
  wings(g, [{ s: 0, le: -12.5, te: -16.0, t: 0.22, o: 0.8 }, { s: 6.4, le: -14.8, te: -16.6, t: 0.08, o: 1.57 }], LGREY);
  lights(g, [15.2, 0.6, 1.1], [0, 0.78, -20.9], [0, 1.8, 2]);
}

/**
 * Glazing that lies on a pod's skin: the part of the lofted surface between z0…z1 and ring
 * angles a0…a1 (radians, 0 = starboard side +x… π/2 = top), lifted a hair off the skin.
 */
function skin(g: THREE.Group, rs: Ring[], z0: number, z1: number, a0: number, a1: number, m: THREE.Material, nz = 6, na = 10): void {
  const ring = (z: number): Ring => {
    const i = Math.max(0, Math.min(rs.length - 2, rs.findIndex((q) => q.z >= z) - 1));
    const p = rs[i]!, q = rs[i + 1]!;
    const f = Math.max(0, Math.min(1, (z - p.z) / (q.z - p.z)));
    const l = (u: number, v: number) => u + (v - u) * f;
    return { z, w: l(p.w, q.w), h: l(p.h, q.h), y: l(p.y ?? 0, q.y ?? 0), n: l(p.n ?? 2, q.n ?? 2) };
  };
  const pos: number[] = [];
  const pt = (z: number, a: number): P3 => {
    const R = ring(z);
    const e = 2 / (R.n ?? 2);
    const c = Math.cos(a), s = Math.sin(a);
    const k = 1 + 0.015 / Math.min(R.w, R.h);
    return [k * R.w * Math.sign(c) * Math.abs(c) ** e, (R.y ?? 0) + k * R.h * Math.sign(s) * Math.abs(s) ** e, z];
  };
  for (let i = 0; i < nz; i++) {
    for (let j = 0; j < na; j++) {
      const za = z0 + ((z1 - z0) * i) / nz, zb = z0 + ((z1 - z0) * (i + 1)) / nz;
      const aa = a0 + ((a1 - a0) * j) / na, ab = a0 + ((a1 - a0) * (j + 1)) / na;
      pos.push(...pt(za, aa), ...pt(zb, ab), ...pt(zb, aa), ...pt(za, aa), ...pt(za, ab), ...pt(zb, ab));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, m));
}

function helo(g: THREE.Group, r: () => number): void {
  // Light navy grey, dark sea grey or olive
  const NAVY = pick(r, [NAVY_, NAVY_, std(0x4f5a61, { roughness: 0.7 }), std(0x6f7a72, { roughness: 0.7 })]);
  // Naval ASW helicopter: boat-hull cabin, engine housing, five-blade rotor, tail pylon with tail rotor, sponsons
  const cabin: Ring[] = [
    { z: -9.4, w: 0.02, h: 0.1, y: 1.6 }, { z: -9.0, w: 0.28, h: 0.45, y: 1.6 }, { z: -8.2, w: 0.3, h: 0.45, y: 1.55 }, { z: -6, w: 0.45, h: 0.6, y: 1.3, n: 2.6 },
    { z: -4, w: 0.8, h: 0.95, y: 0.95, n: 3 }, { z: -2.5, w: 1.1, h: 1.35, y: 0.65, n: 3.2 }, { z: 0, w: 1.15, h: 1.5, y: 0.55, n: 3.5 }, { z: 4.5, w: 1.15, h: 1.45, y: 0.55, n: 3.5 },
    { z: 6, w: 1.1, h: 1.25, y: 0.45, n: 3 }, { z: 7.1, w: 0.9, h: 0.95, y: 0.3, n: 2.5 }, { z: 7.6, w: 0.3, h: 0.4, y: 0.2 },
  ];
  pod(g, cabin, NAVY, 18);
  // Windscreen panes in the nose skin either side of a centre post, cockpit side windows, cabin windows
  for (const sx of [-1, 1]) {
    const [a0, a1] = sx > 0 ? [0.62, 1.5] : [1.64, 2.52];
    skin(g, cabin, 6.08, 7.3, a0, a1, K.glass);
    skin(g, cabin, 5.0, 6.0, sx > 0 ? 0.1 : Math.PI - 0.62, sx > 0 ? 0.62 : Math.PI - 0.1, K.glass, 4, 4);
    skin(g, cabin, 2.6, 4.2, sx > 0 ? 0.25 : Math.PI - 0.55, sx > 0 ? 0.55 : Math.PI - 0.25, K.glass, 2, 3);
  }
  pod(g, [{ z: -3.8, w: 0.05, h: 0.05, y: 2.0 }, { z: -3.2, w: 0.35, h: 0.3, y: 2.0 }, { z: -1.5, w: 0.8, h: 0.55, y: 2.0, n: 3 }, { z: 2.6, w: 0.75, h: 0.55, y: 2.0, n: 3 }, { z: 3.4, w: 0.05, h: 0.05, y: 2.0 }], NAVY, 14);
  for (const sx of [-1, 1]) {
    // Sponson with the main wheel below it
    const sp = pod(g, [{ z: -1.9, w: 0.08, h: 0.08, y: -0.45 }, { z: -1.2, w: 0.45, h: 0.35, y: -0.45 }, { z: 0.6, w: 0.38, h: 0.3, y: -0.45 }, { z: 1.2, w: 0.05, h: 0.05, y: -0.45 }], NAVY, 12);
    sp.position.x = sx * 1.3;
    rod(g, [sx * 1.4, -0.6, -0.5], [sx * 1.4, -1.25, -0.5], 0.08, K.black);
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12), K.rubber);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(sx * 1.4, -1.25, -0.5);
    g.add(wh);
  }
  rod(g, [0, 1.0, -6.6], [0, 0.1, -6.9], 0.06, K.black);
  const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 10), K.rubber);
  tw.rotation.z = Math.PI / 2;
  tw.position.set(0, 0.1, -6.9);
  g.add(tw);
  // Rotor mast out of the engine housing; the turning rotor head sits on top
  rod(g, [0, 2.3, 0.4], [0, 3.3, 0.4], 0.2, K.black, 8);
  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.35, 10), K.black);
  rotor.add(hub);
  for (let i = 0; i < 5; i++) {
    const geo = new THREE.BoxGeometry(0.5, 0.08, 9.2);
    geo.translate(0, 0, 4.7);
    geo.rotateY((i / 5) * Math.PI * 2);
    rotor.add(new THREE.Mesh(geo, K.black));
  }
  rotor.position.set(0, 3.3, 0.4);
  g.add(rotor);
  // Tail pylon (fin), stabiliser and the tail rotor on the pylon's side
  foil(g, [{ s: 1.4, le: -7.8, te: -9.2, t: 0.2 }, { s: 2.0, le: -8.2, te: -9.5, t: 0.2 }, { s: 3.9, le: -9.0, te: -10.1, t: 0.14 }], NAVY, true);
  foil(g, [{ s: 0, le: -9.0, te: -9.75, t: 0.07, o: 3.5 }, { s: -1.8, le: -9.15, te: -9.75, t: 0.05, o: 3.5 }], NAVY, false);
  rod(g, [0.05, 3.1, -9.5], [0.42, 3.1, -9.5], 0.13, K.black, 8);
  const tail = new THREE.Group();
  tail.name = 'tailrotor';
  for (let i = 0; i < 5; i++) {
    const geo = new THREE.BoxGeometry(0.05, 1.55, 0.2);
    geo.translate(0, 0.85, 0);
    geo.rotateX((i / 5) * Math.PI * 2);
    tail.add(new THREE.Mesh(geo, K.black));
  }
  tail.position.set(0.42, 3.1, -9.5);
  g.add(tail);
  lights(g, [1.75, -0.45, -0.4], [0, 3.85, -10.1], [0, 2.6, -1.6]);
}

/** An aircraft; with an id the civil ones wear their own livery (and the airliner may have four engines). */
export function aircraftModel(kind: PlaneKind, id?: string): THREE.Group {
  const g = new THREE.Group();
  const r = rng(id === undefined ? 1 : seedOf(id));
  if (kind === 'airliner') airliner(g, r);
  else if (kind === 'light') lightPlane(g, r);
  else if (kind === 'recon') recon(g);
  else if (kind === 'mpa') mpa(g);
  else helo(g, id === undefined ? rng(1) : r);
  if (id !== undefined && kind === 'airliner') g.scale.setScalar(0.9 + r() * 0.4);
  return g;
}

/** Turn rotors and propellers and flash the beacon. */
export function animateAircraft(g: THREE.Group, t: number, night: boolean): void {
  const r = g.getObjectByName('rotor');
  if (r) r.rotation.y = t * 30;
  const tr = g.getObjectByName('tailrotor');
  if (tr) tr.rotation.x = t * 60;
  for (const p of (g.userData.props ?? []) as { o: THREE.Object3D; d: number }[]) p.o.rotation.z = t * 40 * p.d;
  const s = g.userData.strobe as THREE.Sprite | undefined;
  if (s) s.visible = night && t % 1.2 < 0.12;
}
