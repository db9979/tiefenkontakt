import * as THREE from 'three';
import type { ClassId } from '@tk/shared';
import { wake } from './parts.js';
import { K, lathe } from './hullkit.js';

/**
 * Surfaced submarines after the period's real hull forms (names stay fictional):
 * Project 9 after a Victor III (fat teardrop, low sail, hump aft of the sail, towed-array pod
 * on the upper rudder); Project 4 after a Kilo (fat beam, wide flat casing with flooding
 * holes, tall rounded sail well forward); Project 2 after a Type 206 (small, slim, tall narrow
 * sail, riding almost awash); Project 6 after a Gotland (sail planes, X-rudder); the Westbund
 * S-14 after a Los Angeles (long cylindrical hull, narrow sail with sail planes, cross stern).
 * About 42 % of the pressure hull shows above the water and the underside is modelled for the
 * underwater view.
 *
 * The shape helpers below (rev, foil, pod, rod, blades) are shared with the aircraft models.
 * Every part is built so that it reaches into the body it hangs from: nothing floats.
 */

export type P3 = [number, number, number];

/** Body of revolution along z from [radius, z] points ordered stern → bow (faces outward). */
export function rev(g: THREE.Object3D, pts: [number, number][], m: THREE.Material, seg = 20): THREE.Mesh {
  // hullkit's lathe maps profile z to world +z with outward faces when ordered stern → bow
  return lathe(g, pts, m, seg);
}

/** Symmetric section half-thickness (0…1) at chord fraction u (0 leading edge … 1 trailing edge). */
const thick = (u: number, round: number) => {
  const a = (Math.sqrt(u) * (1 - u)) / 0.3849;
  const e = Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
  return (1 - round) * a + round * e;
};
const U = [0, 0.015, 0.06, 0.14, 0.26, 0.4, 0.56, 0.72, 0.87, 1];

/** A station of a foil: span position s, leading/trailing edge z, half thickness t, offset o across the span. */
export interface Station { s: number; le: number; te: number; t: number; o?: number }

/** Mesh from positions and triangles; every triangle is turned to face away from its reference point. */
function build(pos: number[], tris: [number, number, number, P3][], m: THREE.Material): THREE.Mesh {
  const idx: number[] = [];
  const v = (i: number) => new THREE.Vector3(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
  for (const [a, b, c, ref] of tris) {
    const A = v(a);
    const n = new THREE.Vector3().crossVectors(v(b).sub(A), v(c).sub(A));
    const mid = A.add(v(b)).add(v(c)).divideScalar(3).sub(new THREE.Vector3(...ref));
    if (n.dot(mid) < 0) idx.push(a, c, b);
    else idx.push(a, b, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, m);
}

/**
 * Lofted symmetric foil (fin, rudder, plane, wing, sail, pylon) through stations along its span.
 * vertical: span along y, thickness along x; else span along x, thickness along y. round 0 gives
 * a sharp trailing edge, 1 an elliptic section (sails, fairings). Ends are capped.
 */
export function foil(g: THREE.Object3D, st: Station[], m: THREE.Material, vertical: boolean, round = 0): THREE.Mesh {
  const map = (s: number, z: number, d: number, o: number): P3 => (vertical ? [o + d, s, z] : [s, o + d, z]);
  const pos: number[] = [];
  const tris: [number, number, number, P3][] = [];
  const rings: number[][] = [];
  const ctr: P3[] = [];
  const outline: [number, number][] = [];
  for (let i = U.length - 1; i >= 1; i--) outline.push([U[i]!, 1]);
  outline.push([0, 0]);
  for (let i = 1; i < U.length; i++) outline.push([U[i]!, -1]);
  let vi = 0;
  const ring = (S: Station) => {
    const r: number[] = [];
    for (const [u, sd] of outline) {
      pos.push(...map(S.s, S.le + (S.te - S.le) * u, sd * S.t * thick(u, round), S.o ?? 0));
      r.push(vi++);
    }
    return r;
  };
  for (const S of st) {
    rings.push(ring(S));
    ctr.push(map(S.s, (S.le + S.te) / 2, 0, S.o ?? 0));
  }
  const n = outline.length;
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    const ref: P3 = [(ctr[i]![0] + ctr[i + 1]![0]) / 2, (ctr[i]![1] + ctr[i + 1]![1]) / 2, (ctr[i]![2] + ctr[i + 1]![2]) / 2];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      tris.push([a[k]!, a[k1]!, b[k1]!, ref], [a[k]!, b[k1]!, b[k]!, ref]);
    }
  }
  // End caps (own vertices for a crisp edge)
  for (const [e, inner] of [[0, 1], [st.length - 1, st.length - 2]] as const) {
    const r = ring(st[e]!);
    const c = vi++;
    pos.push(...ctr[e]!);
    for (let k = 0; k < n; k++) tris.push([c, r[k]!, r[(k + 1) % n]!, ctr[inner]!]);
  }
  const mesh = build(pos, tris, m);
  g.add(mesh);
  return mesh;
}

/** A cross-section ring of a pod: at z, half width w, half height h, centre height y, superellipse exponent n. */
export interface Ring { z: number; w: number; h: number; y?: number; n?: number }

/** Lofted body through superellipse rings ordered along z (fuselages, casings, fairings, sponsons). */
export function pod(g: THREE.Object3D, rs: Ring[], m: THREE.Material, seg = 16): THREE.Mesh {
  const pos: number[] = [];
  const tris: [number, number, number, P3][] = [];
  const rings: number[][] = [];
  let vi = 0;
  for (const R of rs) {
    const e = 2 / (R.n ?? 2);
    const r: number[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(R.w * Math.sign(c) * Math.abs(c) ** e, (R.y ?? 0) + R.h * Math.sign(s) * Math.abs(s) ** e, R.z);
      r.push(vi++);
    }
    rings.push(r);
  }
  const cen = (i: number): P3 => [0, rs[i]!.y ?? 0, rs[i]!.z];
  for (let i = 0; i < rs.length - 1; i++) {
    const ref: P3 = [0, ((rs[i]!.y ?? 0) + (rs[i + 1]!.y ?? 0)) / 2, (rs[i]!.z + rs[i + 1]!.z) / 2];
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      tris.push([rings[i]![k]!, rings[i]![k1]!, rings[i + 1]![k1]!, ref], [rings[i]![k]!, rings[i + 1]![k1]!, rings[i + 1]![k]!, ref]);
    }
  }
  for (const [e, inner] of [[0, 1], [rs.length - 1, rs.length - 2]] as const) {
    if (rs[e]!.w < 0.02) continue;
    const c = vi++;
    pos.push(...cen(e));
    for (let k = 0; k < seg; k++) tris.push([c, rings[e]![k]!, rings[e]![(k + 1) % seg]!, cen(inner)]);
  }
  const mesh = build(pos, tris, m);
  g.add(mesh);
  return mesh;
}

/** Round strut from a to b (both ends should lie inside what it joins). */
export function rod(g: THREE.Object3D, a: P3, b: P3, r: number, m: THREE.Material, seg = 6): THREE.Mesh {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), m);
  mesh.position.copy(A).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.add(mesh);
  return mesh;
}

/** Propeller blades turning about z, roots at radius rIn (inside the hub), pitched by `pitch`. */
export function blades(n: number, rIn: number, len: number, chord: number, pitch: number, m: THREE.Material, th = 0.08, phase = 0): THREE.Group {
  const grp = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const geo = new THREE.BoxGeometry(chord, len, th);
    // Blade tapers toward the tip
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) if (p.getY(k) > 0) p.setX(k, p.getX(k) * 0.55);
    geo.translate(0, rIn + len / 2, 0);
    geo.rotateY(pitch);
    geo.rotateZ(phase + (i / n) * Math.PI * 2);
    grp.add(new THREE.Mesh(geo, m));
  }
  return grp;
}

// ---------------------------------------------------------------------------------------------
// Submarines

interface SubSpec {
  len: number;
  r: number;
  /** Length of the elliptic bow, of the tail cone, radius at the cone's end, cone fullness exponent. */
  bow: number;
  tail: number;
  tip: number;
  p: number;
}

const S = K.sub;

/** Pressure hull (true body of revolution) on the axis y = 0; returns the radius at z. */
function subHull(b: THREE.Group, s: SubSpec): (z: number) => number {
  const L = s.len / 2;
  const zb = L - s.bow;
  const zt = -L + s.tail;
  const R = (z: number) => {
    if (z > zb) {
      const x = Math.min(1, (z - zb) / s.bow);
      return s.r * Math.pow(1 - x ** 2.2, 1 / 2.2);
    }
    if (z >= zt) return s.r;
    const u = Math.min(1, (zt - z) / s.tail);
    return s.tip + (s.r - s.tip) * (1 - u ** s.p);
  };
  const pts: [number, number][] = [[0.001, -L], [s.tip, -L]];
  for (let i = 1; i <= 14; i++) {
    const z = -L + (s.tail * i) / 14;
    pts.push([R(z), z]);
  }
  for (let i = 0; i <= 12; i++) {
    const z = zb + s.bow * Math.sin((i / 12) * (Math.PI / 2));
    pts.push([i === 12 ? 0.001 : R(z), z]);
  }
  rev(b, pts, S, 28);
  return R;
}

/** Casing (outer deck) on top of the hull from z0 to z1: flat top `rise` above the hull, ends blended down. */
function casing(b: THREE.Group, R: (z: number) => number, z0: number, z1: number, wf: number, rise: number): (z: number) => number {
  const rs: Ring[] = [];
  const top = (z: number) => {
    const f = Math.min(1, (z - z0) / 3, (z1 - z) / 3);
    return R(z) + rise * Math.max(0, f);
  };
  for (let i = 0; i <= 20; i++) {
    const z = z0 + ((z1 - z0) * i) / 20;
    const r = R(z);
    rs.push({ z, w: r * wf, y: r * 0.5, h: top(z) - r * 0.5, n: 4 });
  }
  pod(b, rs, S, 16);
  return top;
}

/** Sail (fin) standing in the casing: rounded foil sections with a raked, rounded front and a rounded top. */
function sail(b: THREE.Group, o: { base: number; top: number; le: number; te: number; t: number; lean: number; fillet: number; rake?: number }): void {
  const h = o.top - o.base;
  const st: Station[] = [];
  for (const f of [0, 0.12, 0.3, 0.55, 0.8, 0.92, 0.98, 1]) {
    const fil = Math.max(0, 1 - f / 0.12) * o.fillet;
    const cap = f > 0.9 ? (f - 0.9) / 0.1 : 0;
    st.push({
      s: o.base + h * f,
      le: o.le - o.lean * f ** 2 + fil * 1.5 - cap * 0.8,
      te: o.te - fil * 1.5 + cap * 0.4 + (o.rake ?? 0) * f,
      t: o.t * (1 + fil * 0.4) * (1 - 0.55 * cap ** 2),
    });
  }
  foil(b, st, S, true, 0.35);
  // Bridge cockpit and windows at the top front, periscope and mast heads standing in the top
  const zf = o.le - o.lean * 0.9;
  const bw = new THREE.Mesh(new THREE.BoxGeometry(o.t * 1.1, 0.5, 1.6), K.glass);
  bw.position.set(0, o.top - 0.27, zf - 1.2);
  b.add(bw);
  const zm = (o.le - o.lean + o.te + (o.rake ?? 0)) / 2;
  rod(b, [0.25, o.top - 1, zm + 0.8], [0.25, o.top + 1.6, zm + 0.8], 0.14, K.black);
  rod(b, [-0.3, o.top - 1, zm], [-0.3, o.top + 1.1, zm], 0.2, K.black);
  rod(b, [0, o.top - 1, zm - 1.2], [0, o.top + 0.7, zm - 1.2], 0.32, K.black);
}

/** Stern fins on the axis (cross or X), from inside the cone out to `span`; returns the group. */
function sternFins(b: THREE.Group, R: (z: number) => number, le: number, chord: number, span: number, x: boolean, rudder = span): THREE.Group {
  const grp = new THREE.Group();
  const root = R(le - chord / 2) * 0.5;
  const fin = (sp: number, vertical: boolean, sign: number) =>
    foil(grp, [
      { s: sign * root, le, te: le - chord, t: 0.32 },
      { s: sign * sp, le: le - chord * 0.3, te: le - chord * 1.02, t: 0.2 },
    ], S, vertical);
  fin(rudder, true, 1);
  fin(span, true, -1);
  fin(span, false, 1);
  fin(span, false, -1);
  if (x) grp.rotation.z = Math.PI / 4;
  b.add(grp);
  return grp;
}

/** Hub on the end of the tail cone with one or two blade rows. */
function screw(b: THREE.Group, zEnd: number, hub: number, n: number, radius: number, rows = 1): void {
  rev(b, [[0.05, zEnd - hub * 3.2], [hub * 0.9, zEnd - hub * 2.2], [hub, zEnd - hub], [hub * 1.05, zEnd + 0.6]], K.black, 12);
  for (let i = 0; i < rows; i++) {
    const bl = blades(n, hub * 0.6, radius - hub * 0.6, radius * 0.42, 0.55, K.black, 0.1, (i * Math.PI) / n);
    bl.position.z = zEnd - hub * (0.7 + i * 1.1);
    b.add(bl);
  }
}

/** Bow or sail planes: a pair of horizontal foils from x = ±root out to ±span at height y. */
function planes(b: THREE.Group, root: number, span: number, le: number, chord: number, y: number, t = 0.22): void {
  for (const sx of [-1, 1]) foil(b, [
    { s: sx * root, le, te: le - chord, t, o: y },
    { s: sx * span, le: le - chord * 0.25, te: le - chord * 0.95, t: t * 0.6, o: y },
  ], S, false);
}

/** Victor III type: teardrop, low sail, hump aft of it, pod on the rudder, tandem screws. */
function ssn(b: THREE.Group): void {
  const s: SubSpec = { len: 100, r: 5.3, bow: 14, tail: 44, tip: 0.5, p: 1.7 };
  const R = subHull(b, s);
  const top = R(0);
  // Hump aft of the sail: a fairing on the upper hull rising 1.4 m, blended into the cone
  const hump: Ring[] = [];
  for (let i = 0; i <= 14; i++) {
    const z = 12 - (40 * i) / 14;
    const r = R(z);
    const bump = 1.4 * Math.sin((i / 14) * Math.PI) ** 0.7;
    hump.push({ z, w: r * 0.8, y: r * 0.45, h: r * 0.55 + bump, n: 2.4 });
  }
  pod(b, hump, S, 18);
  sail(b, { base: top - 1.2, top: top + 3.9, le: 22, te: 8, t: 1.55, lean: 3.4, fillet: 1, rake: 1.6 });
  // Retractable bow planes, low on the bow
  planes(b, R(39) * 0.6, R(39) + 2.4, 40.5, 2.6, -1.2);
  // Cross stern: rudder fin carrying the towed-array pod, horizontal planes with end plates
  const le = -38;
  const fins = sternFins(b, R, le, 6, 6.4, false, 6.6);
  rev(fins, [[0.05, -47.5], [0.6, -46.6], [0.95, -44], [1.0, -40], [0.75, -37.2], [0.05, -36.2]], S, 14).position.y = 6.6;
  for (const sx of [-1, 1]) foil(fins, [
    { s: -1.3, le: le - 1.6, te: le - 6.3, t: 0.15, o: sx * 6.3 },
    { s: 1.3, le: le - 1.8, te: le - 6.2, t: 0.15, o: sx * 6.3 },
  ], S, true);
  screw(b, -50, 0.6, 4, 2.4, 2);
}

/** Kilo type: fat hull, wide flat casing with flooding holes, tall sail with rounded front. */
function ssk(b: THREE.Group): void {
  const s: SubSpec = { len: 72, r: 4.9, bow: 7.5, tail: 20, tip: 0.45, p: 1.5 };
  const R = subHull(b, s);
  const deck = casing(b, R, -27, 35.6, 0.74, 0.55);
  sail(b, { base: R(10) - 0.4, top: deck(10) + 5.4, le: 15.5, te: 2, t: 1.7, lean: 3.6, fillet: 0.8 });
  // Flooding holes: dark slits in rows along the lower casing sides
  const slit = new THREE.BoxGeometry(0.3, 0.42, 1.1);
  for (let z = -22; z < 31; z += 1.6) {
    if (z > 1 && z < 16) continue;
    const r = R(z);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(slit, K.black);
      m.position.set(sx * r * 0.735, r * 0.5 + 1.1, z);
      b.add(m);
    }
  }
  planes(b, R(30) * 0.6, R(30) + 2.1, 31, 2.4, 1.1);
  sternFins(b, R, -26, 5, 5.4, false);
  screw(b, -36, 0.55, 6, 2.1);
}

/** Type 206 type: small slim hull, tall narrow sail. */
function ssc(b: THREE.Group): void {
  const s: SubSpec = { len: 48, r: 2.35, bow: 4.2, tail: 12, tip: 0.25, p: 1.6 };
  const R = subHull(b, s);
  const deck = casing(b, R, -16, 23.2, 0.55, 0.35);
  sail(b, { base: R(5) - 0.3, top: deck(5) + 4.2, le: 8.2, te: 1.9, t: 0.72, lean: 1.2, fillet: 0.5 });
  planes(b, R(19) * 0.6, R(19) + 1.1, 19.6, 1.3, 0.2, 0.14);
  sternFins(b, R, -17.5, 3.2, 3.2, false);
  screw(b, -24, 0.3, 5, 1.2);
}

/** Gotland type: sail planes, X-rudder. */
function ssa(b: THREE.Group): void {
  const s: SubSpec = { len: 60, r: 3.1, bow: 5.5, tail: 15, tip: 0.3, p: 1.6 };
  const R = subHull(b, s);
  const deck = casing(b, R, -20, 29, 0.6, 0.35);
  const top = deck(10) + 3.8;
  sail(b, { base: R(10) - 0.4, top, le: 14, te: 5, t: 1.0, lean: 1.6, fillet: 0.6 });
  // Sail planes through the sail, forward and a little above mid height
  planes(b, 0, 4.5, 12.9, 2.3, top - 2.2, 0.18);
  sternFins(b, R, -21.5, 4.2, 4.4, true);
  screw(b, -30, 0.36, 7, 1.5);
}

/** Los Angeles type (S-14): long cylindrical hull, narrow sail well forward with sail planes, cross stern, few flood slots. */
function ssw(b: THREE.Group): void {
  const s: SubSpec = { len: 85, r: 4.3, bow: 9, tail: 24, tip: 0.4, p: 1.6 };
  const R = subHull(b, s);
  // Narrow walkway along the top of the hull
  casing(b, R, -20, 34, 0.32, 0.22);
  const top = 7.7;
  sail(b, { base: R(24) - 0.6, top, le: 29, te: 20, t: 0.85, lean: 0.8, fillet: 0.45 });
  // Sail planes at mid height, spanning the beam
  planes(b, 0, 5, 27.6, 2.6, R(24) + (top - R(24)) * 0.55, 0.17);
  // A few flood slots low on the bow and under the sail
  const slit = new THREE.BoxGeometry(0.25, 0.32, 1.0);
  for (const z of [30, 31.6, 33.2, 34.8, 18, 16.4]) {
    const r = R(z);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(slit, K.black);
      m.position.set(sx * r * 0.93, r * 0.36, z);
      m.rotation.z = sx * -0.37;
      b.add(m);
    }
  }
  sternFins(b, R, -31, 4.4, 5, false);
  screw(b, -42.5, 0.42, 7, 1.9);
}

export function surfacedBoat(g: THREE.Group, cls: ClassId): void {
  const b = new THREE.Group();
  const r = cls === 'ssn' ? 5.3 : cls === 'ssc' ? 2.35 : cls === 'ssa' ? 3.1 : cls === 'ssw' ? 4.3 : 4.9;
  // Hull axis 16 % of the radius under water (≈ 42 % of the hull above), trimmed a little by the
  // stern; the small coastal boat rides much deeper, almost awash
  b.position.y = (cls === 'ssc' ? -0.7 : -0.16) * r;
  b.rotation.x = -0.012;
  if (cls === 'ssn') ssn(b);
  else if (cls === 'ssc') ssc(b);
  else if (cls === 'ssa') ssa(b);
  else if (cls === 'ssw') ssw(b);
  else ssk(b);
  g.add(b);
  const len = cls === 'ssn' ? 100 : cls === 'ssc' ? 48 : cls === 'ssa' ? 60 : cls === 'ssw' ? 85 : 72;
  wake(g, len * 0.9, r * 1.7, len / 2 + 2, -len / 2);
}
