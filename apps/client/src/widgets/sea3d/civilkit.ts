import * as THREE from 'three';
import { K, type Hull } from './hullkit.js';

/**
 * Helpers for the merchant and civil ship models. A Kit collects every solid fitting of one
 * ship into a single vertex-coloured mesh (few draw calls, shared material) plus one line set
 * for rigging. Hull-aware helpers set fittings onto the deck (deckAt) and inside the deck
 * edge (halfBeamAt), so nothing floats. Bow +z, waterline y = 0, port = +x.
 */

export type V3 = [number, number, number];

const VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12, side: THREE.DoubleSide });
const RIG = new THREE.LineBasicMaterial({ color: 0x2c3134 });
const UP = new THREE.Vector3(0, 1, 0);

export const C = {
  white: 0xd9dcda, cream: 0xcfc7b0, buff: 0xb4945a, deck: 0x4b4e4c, rust: 0x6b2f26, red: 0x7a2a22, orange: 0xd8732e,
  steel: 0x8b9499, grey: 0x6c757a, dark: 0x1c1f21, black: 0x151719, green: 0x3f5a46, wood: 0x9a7a52, blue: 0x1f4f7a, glass: 0x0c1214,
};

export class Kit {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private lines: number[] = [];
  constructor(readonly g: THREE.Object3D) {}

  /** Bake any geometry with a colour and transform into the batch. */
  geo(geo: THREE.BufferGeometry, c: number, m?: THREE.Matrix4): void {
    const gg = geo.index ? geo.toNonIndexed() : geo;
    if (m) gg.applyMatrix4(m);
    if (!gg.getAttribute('normal')) gg.computeVertexNormals();
    const p = gg.getAttribute('position');
    const n = gg.getAttribute('normal');
    const cc = new THREE.Color(c);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(cc.r, cc.g, cc.b);
    }
  }

  private at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  }

  box(w: number, h: number, l: number, x: number, y: number, z: number, c: number, rx = 0, ry = 0): void {
    this.geo(new THREE.BoxGeometry(w, h, l), c, this.at(x, y, z, rx, ry));
  }

  /** Box standing on y0 (its bottom face at y0). */
  block(w: number, h: number, l: number, x: number, y0: number, z: number, c: number): void {
    this.box(w, h, l, x, y0 + h / 2, z, c);
  }

  /** Vertical cylinder centred at (x, y, z); rx / rz tip it over. */
  cyl(r: number, h: number, x: number, y: number, z: number, c: number, r2 = r, seg = 10, rx = 0, rz = 0): void {
    this.geo(new THREE.CylinderGeometry(r2, r, h, seg), c, this.at(x, y, z, rx, 0, rz));
  }

  /** Round bar from a to b. */
  rod(a: V3, b: V3, r: number, c: number, seg = 6, r2 = r): void {
    const va = new THREE.Vector3(...a);
    const d = new THREE.Vector3(...b).sub(va);
    const len = d.length();
    const m = new THREE.Matrix4().compose(va.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1));
    this.geo(new THREE.CylinderGeometry(r2, r, len, seg, 1, false), c, m);
  }

  ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number, c: number): void {
    const geo = new THREE.SphereGeometry(1, 10, 6);
    geo.scale(rx, ry, rz);
    this.geo(geo, c, this.at(x, y, z));
  }

  /** Prism from a top-view polygon [x, z], y0 … y1; the top is shifted by shear·Δy in z and scaled by taper. */
  prism(pts: [number, number][], y0: number, y1: number, c: number, shear = 0, taper = 1, capTop = c): void {
    const n = pts.length;
    const cx = pts.reduce((s, p) => s + p[0], 0) / n;
    const cz = pts.reduce((s, p) => s + p[1], 0) / n;
    const top = pts.map(([x, z]): [number, number] => [cx + (x - cx) * taper, cz + (z - cz) * taper + shear * (y1 - y0)]);
    const p: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ax, az] = pts[i]!;
      const [bx, bz] = pts[j]!;
      const [tx, tz] = top[i]!;
      const [ux, uz] = top[j]!;
      p.push(ax, y0, az, bx, y0, bz, ux, y1, uz, ax, y0, az, ux, y1, uz, tx, y1, tz);
    }
    this.raw(p, c);
    const tri = THREE.ShapeUtils.triangulateShape(top.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const q: number[] = [];
    for (const t of tri) for (const i of t) q.push(top[i]![0], y1, top[i]![1]);
    this.raw(q, capTop);
  }

  /** Triangles from a flat position list (flat normals). */
  raw(p: number[], c: number): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.computeVertexNormals();
    this.geo(geo, c);
  }

  /** Quad strip between two rows of points. */
  strip(a: V3[], b: V3[], c: number): void {
    const p: number[] = [];
    for (let i = 0; i < a.length - 1; i++) p.push(...a[i]!, ...a[i + 1]!, ...b[i + 1]!, ...a[i]!, ...b[i + 1]!, ...b[i]!);
    this.raw(p, c);
  }

  line(a: V3, b: V3): void {
    this.lines.push(...a, ...b);
  }

  /** Add the batched mesh and lines to the group. */
  done(): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const mesh = new THREE.Mesh(geo, VC);
    mesh.name = 'fittings';
    this.g.add(mesh);
    if (this.lines.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(this.lines, 3));
      this.g.add(new THREE.LineSegments(lg, RIG));
    }
    return mesh;
  }

  /** Triangle count so far (for budgeting while building). */
  get tris(): number {
    return this.pos.length / 9;
  }
}

/** Lowest deck height over z0…z1, slightly sunk: a fitting standing there never floats. */
export function base(h: Hull, z0: number, z1: number): number {
  let y = Infinity;
  for (let i = 0; i <= 8; i++) y = Math.min(y, h.deckAt(z0 + ((z1 - z0) * i) / 8));
  return y - 0.15;
}

/** Narrowest half breadth of the deck over z0…z1 (for fittings that must stay inboard). */
export function narrowest(h: Hull, z0: number, z1: number): number {
  let w = Infinity;
  for (let i = 0; i <= 8; i++) {
    const z = z0 + ((z1 - z0) * i) / 8;
    w = Math.min(w, h.halfBeamAt(z, h.deckAt(z)));
  }
  return w;
}

/**
 * Solid following the hull outline between z0 and z1: sides at the deck edge minus inset,
 * bottom yb(z), top yt(z). For raised forecastles / poops (flush with the hull side) and for
 * ferry tiers that follow the taper of the bow.
 */
export function loftBlock(k: Kit, h: Hull, z0: number, z1: number, inset: number, yb: (z: number) => number, yt: (z: number) => number, cSide: number, cTop = cSide, n = Math.max(4, Math.ceil(Math.abs(z1 - z0) / 3))): void {
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) zs.push(z0 + ((z1 - z0) * i) / n);
  const w = (z: number) => Math.max(0.05, h.halfBeamAt(z, h.deckAt(z)) - inset);
  for (const sx of [-1, 1]) {
    k.strip(zs.map((z): V3 => [sx * w(z), yb(z), z]), zs.map((z): V3 => [sx * w(z), yt(z), z]), cSide);
  }
  k.strip(zs.map((z): V3 => [-w(z), yt(z), z]), zs.map((z): V3 => [w(z), yt(z), z]), cTop);
  for (const z of [z0, z1]) {
    const x = w(z);
    if (x > 0.1) k.strip([[-x, yb(z), z], [x, yb(z), z]], [[-x, yt(z), z], [x, yt(z), z]], cSide);
  }
}

/** Raised deck (forecastle or poop) of height hgt, flush with the hull side, following the sheer. */
export function raisedDeck(k: Kit, h: Hull, z0: number, z1: number, hgt: number, cSide: number, cTop = C.deck): void {
  loftBlock(k, h, z0, z1, 0.03, (z) => h.deckAt(z) - 0.2, (z) => h.deckAt(z) + hgt, cSide, cTop);
}

/** Bulwark (thin wall at the deck edge) on both sides from z0 to z1, standing on the deck plus lift. */
export function bulwark(k: Kit, h: Hull, z0: number, z1: number, hgt: number, c: number, lift = 0, n = 8): void {
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) zs.push(z0 + ((z1 - z0) * i) / n);
  for (const sx of [-1, 1]) {
    const x = (z: number) => sx * Math.max(0.05, h.halfBeamAt(z, h.deckAt(z)) - 0.06);
    k.strip(zs.map((z): V3 => [x(z), h.deckAt(z) + lift - 0.1, z]), zs.map((z): V3 => [x(z), h.deckAt(z) + lift + hgt, z]), c);
  }
}

/** Top-view outline of a funnel: a stadium w wide and l long centred at (x, z). */
export function stadium(x: number, z: number, w: number, l: number, n = 5): [number, number][] {
  const r = w / 2;
  const s = Math.max(0, l / 2 - r);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    pts.push([x + r * Math.cos(a), z + s + r * Math.sin(a)]);
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    pts.push([x + r * Math.cos(a), z - s + r * Math.sin(a)]);
  }
  return pts;
}

/** Raked funnel standing on y0: body colour, a company band, a black top. Returns the top centre. */
export function funnel(k: Kit, x: number, y0: number, z: number, w: number, l: number, hgt: number, body: number, band?: number, rake = -0.18): V3 {
  const pts = stadium(x, z, w, l);
  const seg = (f0: number, f1: number, c: number) => {
    const shifted = pts.map(([px, pz]): [number, number] => [px, pz + rake * hgt * f0]);
    k.prism(shifted, y0 + hgt * f0, y0 + hgt * f1, c, rake, 1, f1 === 1 ? C.black : c);
  };
  if (band !== undefined) {
    seg(0, 0.55, body);
    seg(0.55, 0.78, band);
    seg(0.78, 0.9, body);
  } else seg(0, 0.9, body);
  seg(0.9, 1, C.black);
  return [x, y0 + hgt, z + rake * hgt];
}

/**
 * Enclosed lifeboat stowed on a deck at height y beside a house, under a pair of gravity
 * davits that stand on the same deck inboard of it. side = +1 port, −1 starboard.
 */
export function lifeboat(k: Kit, x: number, y: number, z: number, len: number, side: number, c = C.orange): void {
  const w = len * 0.3;
  const hb = len * 0.22;
  for (const dz of [-0.3, 0.3]) k.block(w * 0.7, 0.4, 0.5, x, y, z + dz * len, C.steel);
  k.ellipsoid(x, y + 0.4 + hb / 2, z, w / 2, hb / 2, len / 2, c);
  k.box(w * 0.75, hb * 0.18, len * 0.82, x, y + 0.4 + hb * 0.88, z, C.white);
  for (const dz of [-0.36, 0.36]) {
    const zz = z + dz * len;
    const xi = x - side * w * 0.75;
    const top: V3 = [x + side * w * 0.1, y + 0.4 + hb + 1.1, zz];
    k.rod([xi, y, zz], [xi, y + hb * 0.9, zz], 0.12, C.white);
    k.rod([xi, y + hb * 0.9, zz], top, 0.1, C.white);
    k.line(top, [x, y + 0.4 + hb, zz]);
  }
}

/** Pole mast standing on y0 with a crosstree and an optional radar platform; returns the top. */
export function pole(k: Kit, x: number, y0: number, z: number, hgt: number, r: number, c = C.dark, yards: number[] = [0.8], span = 4): V3 {
  k.cyl(r, hgt, x, y0 + hgt / 2, z, c, r * 0.45, 8);
  for (const f of yards) k.box(span, 0.2, 0.2, x, y0 + hgt * f, z, c);
  return [x, y0 + hgt, z];
}

/** Turning radar antenna on a pedestal at (x, y, z); registered as the group's radar. */
export function radar(g: THREE.Object3D, k: Kit, x: number, y: number, z: number, span = 3.5): void {
  k.cyl(0.25, 0.6, x, y + 0.3, z, C.dark, 0.25, 6);
  const a = new THREE.Mesh(new THREE.BoxGeometry(span, 0.3, 0.35), K.black);
  a.position.set(x, y + 0.75, z);
  g.add(a);
  g.userData.radar = a;
}

/**
 * Derrick (cargo boom) with its heel at the foot of a post: the boom rises toward the hatch
 * (dir = +1 forward, −1 aft) and a topping lift runs from the post head to the boom tip.
 */
export function derrick(k: Kit, x: number, yHeel: number, z: number, postTop: number, dir: number, len: number, elev = 0.62, c = C.dark): void {
  const tip: V3 = [x * 0.6, yHeel + Math.sin(elev) * len, z + dir * Math.cos(elev) * len];
  k.rod([x, yHeel, z], tip, 0.22, c, 6, 0.14);
  k.line([x, postTop, z], tip);
  k.line(tip, [tip[0], yHeel - 1.5, tip[2]]);
}

/** Hatch: a coaming standing on the deck and a cover with stiffening ribs, centred at z. */
export function hatch(k: Kit, h: Hull, z: number, l: number, w: number, coaming: number, c: number, cover = C.green): number {
  const y0 = base(h, z - l / 2, z + l / 2);
  const top = Math.max(h.deckAt(z - l / 2), h.deckAt(z + l / 2)) + coaming;
  k.block(w, top - y0, l, 0, y0, z, c);
  k.block(w - 0.4, 0.35, l - 0.4, 0, top, z, cover);
  for (let i = 1; i < 4; i++) k.block(w - 0.3, 0.12, 0.3, 0, top + 0.35, z - l / 2 + (l * i) / 4, cover);
  return top + 0.35;
}

/** Mooring bitts and a windlass pair on a deck at y around z (for forecastles). */
export function windlass(k: Kit, y: number, z: number, sep: number): void {
  for (const sx of [-1, 1]) {
    k.cyl(0.7, 0.9, sx * sep, y + 0.45, z, C.dark, 0.7, 8, 0, Math.PI / 2);
    k.block(0.6, 0.8, 1.6, sx * sep * 0.4, y, z, C.dark);
  }
}

/** Row of n windows (dark panes) on a face: along 'x' on a z-facing face at z, along 'z' on an x-facing face at x. */
export function winRow(k: Kit, along: 'x' | 'z', x: number, y: number, z: number, span: number, n: number, w = 1, hgt = 0.9): void {
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : (i / (n - 1) - 0.5) * span;
    if (along === 'x') k.box(w, hgt, 0.3, x + f, y, z, C.glass);
    else k.box(0.3, hgt, w, x, y, z + f, C.glass);
    // Remember the pane: at night some of them glow (cabin lights, see models.ts)
    ((k.g.userData.windows ??= []) as number[]).push(along === 'x' ? x + f : x + Math.sign(x) * 0.25, y, along === 'x' ? z + 0.25 : z + f);
  }
}

const names = new Map<string, THREE.MeshBasicMaterial>();

/** Ship's name painted on both bows at station z, its centre at height y, letters hgt tall (one cached decal per name). */
export function shipName(g: THREE.Object3D, h: Hull, name: string, z: number, y: number, hgt: number, color = '#e4e6e3'): void {
  let m = names.get(name + color);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 64;
    const x = c.getContext('2d')!;
    x.fillStyle = color;
    x.font = 'bold 50px Helvetica, Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(name, 256, 34);
    m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    names.set(name + color, m);
  }
  const w = hgt * 8;
  // Follow the taper of the bow so the decal lies flat on the plating
  const yaw = Math.atan2(h.halfBeamAt(z - w / 2, y) - h.halfBeamAt(z + w / 2, y), w);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), m);
    p.position.set(sx * (h.halfBeamAt(z, y) + 0.12), y, z);
    p.rotation.y = sx > 0 ? Math.PI / 2 - yaw : -Math.PI / 2 + yaw;
    p.renderOrder = 2;
    p.userData.keep = true;
    g.add(p);
  }
}

/** Seeded random numbers (one stream per model so its variety stays fixed while it exists). */
export function rng(seed = Math.random() * 1e9): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
