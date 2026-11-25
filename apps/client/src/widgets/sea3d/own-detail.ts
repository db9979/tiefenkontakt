import * as THREE from 'three';
import { K, loftHull, type HullSpec } from './hullkit.js';
import { WALL } from './warkit.js';
import { F12_HULL } from './escorts.js';
import { F30_HULL, K7_FORECASTLE, K7_HULL } from './warships.js';
import { C, Kit, P } from './own-kit.js';
import { openBridge } from './own-bridge.js';
import { aftDetail, aftLayout, stripAft } from './own-aft.js';
import { deckTile, foredeckTexture } from './own-deck-tex.js';
import * as F from './own-fittings.js';

/**
 * Close-range detail for the OWN ship in the bridge view (only there: ships seen at range keep
 * their cheap models). Replaces the generic hull, deck, railings and everything forward of the
 * foremost deckhouse with a finer hull (flare and knuckle forward, toe rail, camber), a
 * textured non-skid foredeck, anchor gear with chain, bitts, fairleads, hatches, vents, a
 * breakwater, jackstaff, guard rails, the class's forward weapons, and the lookout platform
 * the eye stands on. Sizes follow each class's hull (escorts.ts, warships.ts). Bow +z.
 */

export type OwnDetailCls = 'ffg' | 'kor' | 'ffv';

interface Layout {
  spec: HullSpec;
  fc?: { z0: number; rise: number };
  /** Front of the foremost deckhouse: fittings forward of it are replaced. */
  house: number;
  /** Half width of that deckhouse. */
  houseHalf: number;
  gun?: { z: number; w: number; twin: boolean };
  asw?: number;
  bin?: { z: number; r: number };
  breakwater?: { z: number; h: number };
  windlass: number;
  hawse: number;
  rails: [number, number][];
  bitts: number[];
  /** Half widths of the wheelhouse and of the bridge wings. */
  hw: number;
  wing: number;
}

const LAYOUT: Record<OwnDetailCls, Layout> = {
  ffg: { spec: F12_HULL, house: 27, houseHalf: 5.6, gun: { z: 43, w: 4.2, twin: false }, asw: 31, breakwater: { z: 52, h: 1.05 }, windlass: 57.5, hawse: 61, rails: [[-44, 66.6]], bitts: [48, 37, 21], hw: 4.6, wing: 7.0 },
  ffv: { spec: F30_HULL, house: 26, houseHalf: 4.8, gun: { z: 33, w: 4.6, twin: true }, breakwater: { z: 39.6, h: 1.1 }, windlass: 45.5, hawse: 49, rails: [[-56, -47.5], [-28, 55.2]], bitts: [43, 29.5, 18], hw: 4.7, wing: 6.25 },
  kor: { spec: K7_HULL, fc: K7_FORECASTLE, house: 17.5, houseHalf: 3.7, bin: { z: 22, r: 1.9 }, windlass: 28.4, hawse: 31, rails: [[-35.5, -12.5], [-12, 34.8]], bitts: [26, 13], hw: 3.3, wing: 5.0 },
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Drop the generic hull, deck, rails and everything forward of zCut (named parts stay). */
function strip(g: THREE.Group, zCut: number): void {
  g.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const drop: THREE.Object3D[] = [];
  for (const c of g.children) {
    const m = c as THREE.Mesh;
    if (c.name === 'hull' || c.name === 'deck') drop.push(c);
    else if (c.name || c === g.userData.radar) continue;
    else if ((c as THREE.LineSegments).isLineSegments) drop.push(c);
    else if (m.isMesh && (m.material === WALL || (m.material === K.deck && m.geometry.type === 'BufferGeometry'))) drop.push(c);
    else if (box.setFromObject(c).min.z > zCut) drop.push(c);
  }
  for (const o of drop) o.removeFromParent();
}

/**
 * Turn the generic model of an own class into the close-range one; eye and eyeZ are the
 * bridge eye (height, and z in the model). Returns the triangles added.
 */
export function ownDetail(g: THREE.Group, cls: OwnDetailCls, eye: number, eyeZ: number): number {
  const lay = LAYOUT[cls];
  const s = lay.spec;
  const L = s.len / 2;
  const h = loftHull(new THREE.Group(), s);
  strip(g, lay.house + 0.4);
  const k = new Kit();
  const fc = lay.fc;
  const top = (z: number) => h.deckAt(z) + (fc && z >= fc.z0 ? fc.rise : 0);
  // Forward part (0 aft … 1 from the deckhouse on): stronger flare, the knuckle, camber
  const fwd = (z: number) => smooth(lay.house - 8, lay.house + 6, z);
  const outer = (z: number) => h.halfBeamAt(z, h.deckAt(z)) * (1 + 0.14 * fwd(z));
  const inner = (z: number) => Math.max(0, outer(z) - 0.07);
  const camber = (z: number) => (s.beam / 60) * smooth(lay.house - 12, lay.house - 4, z);
  const deckY = (x: number, z: number) => {
    const w = inner(z);
    const f = w > 0.05 ? Math.min(1, Math.abs(x) / w) : 1;
    return top(z) + camber(z) * (1 - f * f);
  };
  const d: F.Deck = { y: deckY, half: inner };
  // Topsides: flared from the waterline to the knuckle, near upright above it
  const knuckle = (z: number) => top(z) - Math.min(0.35 + 0.95 * fwd(z), top(z) * 0.45);
  const width = (z: number, y: number) => {
    if (y <= 0) return h.halfBeamAt(z, y);
    const wl = h.halfBeamAt(z, 0);
    const wo = outer(z);
    const dt = top(z);
    const yk = knuckle(z);
    const wk = wo - 0.04 * (dt - yk);
    if (y <= yk) return wl + (wk - wl) * Math.pow(y / yk, 1.6);
    return wk + (wo - wk) * Math.min(1, (y - yk) / Math.max(0.01, dt - yk));
  };
  const hawseZ = lay.hawse + 1.3;
  const hawseY = top(hawseZ) - 1.5;
  buildHull(k, s, top, width, knuckle, outer, inner, fc?.z0, lay.house - 10, hawseZ, hawseY);
  const zA = lay.house - 4;
  // Weapons forward
  if (lay.gun) F.gunMount(k, deckY(0, lay.gun.z) - 0.04, lay.gun.z, lay.gun.w, lay.gun.twin);
  if (lay.asw !== undefined) F.boxLauncher(k, d, deckY(0, lay.asw) - 0.04, lay.asw);
  if (lay.bin) F.missileBin(k, deckY(0, lay.bin.z) - 0.45, lay.bin.z, lay.bin.r);
  if (lay.breakwater) F.breakwater(k, d, lay.breakwater.z, Math.min(inner(lay.breakwater.z) - 1.1, 3.8), lay.breakwater.h);
  // Anchor gear: hawse pipes, stoppers, gypsies, chain down the navel pipes
  for (const sx of [-1, 1]) {
    const gx = sx * 1.15;
    const gyp = F.capstan(k, d, gx, lay.windlass);
    const pipe = F.deckPipe(k, d, sx * Math.max(1.2, inner(lay.hawse) - 0.85), lay.hawse, 0.3);
    const lead = new THREE.Vector3(gx, gyp.y, lay.windlass + 0.42);
    F.stopper(k, d, pipe, lead, 0.5);
    F.chain(k, pipe, lead, 0.03);
    const navel = F.deckPipe(k, d, gx, lay.windlass - 1.15, 0.2);
    F.chain(k, new THREE.Vector3(gx, gyp.y, lay.windlass - 0.42), navel, 0);
    k.mark('rust', (pipe.x + gx) / 2, (pipe.z + lay.windlass) / 2, 0.5);
    anchor(k, sx, width, hawseZ, hawseY);
  }
  const wy = deckY(0, lay.windlass - 1.6);
  k.box(0.45, 1.05, 0.32, 0, wy + 0.52, lay.windlass - 1.6, C.haze);
  k.box(0.32, 0.22, 0.02, 0, wy + 0.85, lay.windlass - 1.43, C.dark, P.matte);
  F.jackstaff(k, d, L - 0.9);
  for (const gx of [-0.85, 0.85]) if (inner(lay.hawse + 3) > 1.3) F.gooseneck(k, d, gx, lay.hawse + 3);
  // Mooring gear along both sides
  for (const z of lay.bitts) for (const sx of [-1, 1]) {
    F.bitts(k, d, sx * (inner(z) - 0.75), z);
    F.fairlead(k, d, sx * (inner(z + 1.6) - 0.22), z + 1.6);
  }
  // Hatches, vents and lockers between the weapons and the deckhouse
  const zw = lay.gun?.z ?? lay.bin?.z ?? lay.house + 5;
  const zh = lay.asw !== undefined ? (lay.asw + zw) / 2 + 0.5 : lay.house + 2.6;
  F.hatch(k, d, inner(zh) * 0.5, zh, 1.1, 1.4);
  F.scuttle(k, d, -inner(zh) * 0.5, zh + 0.6);
  for (const sx of [-1, 1]) F.mushroom(k, d, sx * (lay.houseHalf - 1.2), lay.house + 0.9);
  for (const sx of lay.houseHalf > 4 ? [-1, 1] : [1]) {
    const x = sx * (lay.houseHalf - 2.6);
    k.box(1.4, 0.9, 0.7, x, deckY(x, lay.house) + 0.43, lay.house + 0.4, C.hazeL);
    k.box(1.42, 0.03, 0.72, x, deckY(x, lay.house) + 0.7, lay.house + 0.4, C.hazeD);
  }
  const ring = k.torus(0.36, 0.07, C.orange, P.matte, 6, 16);
  ring.position.set(-(lay.houseHalf - 1.4), deckY(0, lay.house) + 1.55, lay.house + 0.08);
  // Rails: closer stanchions where the bridge looks down on them, wider aft
  const zr = lay.house - 10;
  for (const [z0, z1] of lay.rails) {
    const e = Math.min(z1, L - 1.1);
    if (z0 < zr && e > zr) {
      F.rails(k, d, z0, zr, Infinity, 2.6);
      F.rails(k, d, zr, e, lay.hawse - 1.8, 1.6);
    } else F.rails(k, d, z0, e, lay.hawse - 1.8, e < zr ? 2.6 : 1.6);
  }
  const dk = deck(g, k, s, inner, deckY, zA, fc?.z0, lay.gun ? [lay.gun.z + 2, lay.gun.z + 2 + (lay.gun.twin ? 6.5 : 7.7)] : undefined);
  // The bridge the eye stands on (its near parts in a second pass), then aft and amidships
  const kn = new Kit();
  const ends = openBridge(k, kn, dk.tile, g, { eye, ze: eyeZ, hw: lay.hw, wing: lay.wing, roof: roofBelow(g, eye, eyeZ) });
  const aft = aftLayout(cls, h, top);
  stripAft(g, aft);
  g.add(aftDetail(k, g, d, aft, L, ends));
  // Funnel smoke seen from close by: rounder puffs
  for (const p of (g.userData.smoke as { puffs?: THREE.Mesh[] } | undefined)?.puffs ?? []) p.geometry = new THREE.SphereGeometry(1, 16, 12);
  return k.bake(g, 0) + kn.bake(g, 1) + dk.tris;
}

/** Hull rings (keel to toe rail, both sides) from the stern to the stem; boot-top and knuckle as creases. */
function buildHull(k: Kit, s: HullSpec, top: (z: number) => number, width: (z: number, y: number) => number, knuckle: (z: number) => number,
  outer: (z: number) => number, inner: (z: number) => number, fcZ0: number | undefined, zFine: number, hawseZ: number, hawseY: number): void {
  const L = s.len / 2;
  const dr = s.draft;
  const zs = stations(L, zFine, fcZ0);
  const cTop = new THREE.Color(C.haze);
  const cBoot = new THREE.Color(C.boot);
  const cBot = new THREE.Color(C.bottom);
  const cRust = new THREE.Color(C.rust);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const rings: number[][] = [];
  const rnd = (i: number) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  const rake = s.rake ?? 6;
  zs.forEach((z, i) => {
    const t = (z + L) / s.len;
    const dt = top(z);
    const yk = knuckle(z);
    const hb = top(z) + dr;
    type Row = [number, number, THREE.Color];
    const rows: Row[] = [[-dr, width(z, -dr), cBot], [-0.72 * dr, width(z, -0.72 * dr), cBot], [-0.42 * dr, width(z, -0.42 * dr), cBot], [-0.4, width(z, -0.4), cBot],
      [-0.4, width(z, -0.4), cBoot], [0, width(z, 0), cBoot], [0.6, width(z, 0.6), cBoot], [0.6, width(z, 0.6), cTop]];
    if (yk * 0.55 > 0.7) rows.push([yk * 0.55, width(z, yk * 0.55), cTop]);
    rows.push([yk, width(z, yk), cTop], [yk, width(z, yk), cTop], [dt, outer(z), cTop], [dt + 0.15, outer(z), cTop], [dt + 0.15, inner(z), cTop], [dt, inner(z), cTop]);
    const streak = rnd(i * 7.1) > 0.92 ? 0.25 : 0;
    const shade = 1 - 0.05 * rnd(i * 3.3);
    const ring: number[] = [];
    const vert = (sx: number, [y, w, c]: Row) => {
      const hf = Math.min(1, (y + dr) / hb);
      const zz = t > 0.9 ? z - rake * (1 - hf) * smooth(0.9, 1, t) : z;
      pos.push(sx * w, y, zz);
      let cc = c;
      if (c === cTop) {
        // Rust running down from the hawse pipe, faint streaks from scuppers elsewhere
        const kh = Math.max(0, 1 - Math.abs(zz - hawseZ) / 0.9) * (y < hawseY && y > hawseY - 4 ? 1 - (hawseY - y) / 4 : 0);
        const ks = streak * Math.max(0, (y - 0.6) / Math.max(1, dt - 0.6));
        cc = c.clone().lerp(cRust, Math.min(0.8, kh * 0.8 + ks)).multiplyScalar(shade);
      }
      col.push(cc.r, cc.g, cc.b);
      ring.push(pos.length / 3 - 1);
    };
    for (const r of [...rows].reverse()) vert(-1, r);
    for (const r of rows) vert(1, r);
    rings.push(ring);
  });
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    for (let j = 0; j < a.length - 1; j++) idx.push(a[j]!, a[j + 1]!, b[j]!, a[j + 1]!, b[j + 1]!, b[j]!);
  }
  // Transom: a fan, both ways round
  const st = rings[0]!;
  const c = pos.length / 3;
  pos.push(0, top(-L) * 0.4 - dr * 0.3, -L);
  col.push(cTop.r, cTop.g, cTop.b);
  for (let j = 0; j < st.length - 1; j++) idx.push(c, st[j]!, st[j + 1]!, c, st[j + 1]!, st[j]!);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  k.mesh(geo, C.haze);
}

/** Station positions: coarse aft, fine forward, a step at the forecastle break. */
function stations(L: number, zFine: number, fcZ0?: number): number[] {
  const zs: number[] = [];
  for (let z = -L; z < zFine; z += 2) zs.push(z);
  for (let z = zFine; z < L - 0.01; z += 0.7) zs.push(z);
  zs.push(L);
  if (fcZ0 === undefined) return zs;
  return [...zs.filter((z) => Math.abs(z - fcZ0) > 0.3), fcZ0 - 0.02, fcZ0 + 0.02].sort((a, b) => a - b);
}

/** Stowed anchor in its hawse on side sx: lip, shank and flukes against the plating. */
function anchor(k: Kit, sx: number, width: (z: number, y: number) => number, z: number, y: number): void {
  const p = new THREE.Vector3(sx * width(z, y), y, z);
  const e = 0.05;
  const n = new THREE.Vector3(sx * (width(z, y) - width(z, y - e)) / e, 0, 0);
  // Normal from the surface tangents along y and z
  const ty = new THREE.Vector3(sx * (width(z, y + e) - width(z, y - e)), 2 * e, 0);
  const tz = new THREE.Vector3(sx * (width(z + e, y) - width(z - e, y)), 0, 2 * e);
  n.crossVectors(ty, tz).normalize();
  if (n.x * sx < 0) n.negate();
  const g = new THREE.Group();
  k.root.add(g);
  g.position.copy(p);
  g.lookAt(p.clone().add(n));
  k.mesh(new THREE.CylinderGeometry(0.44, 0.48, 0.22, 14), C.hazeD, P.paint, g).rotation.x = Math.PI / 2;
  const mouth = k.mesh(new THREE.CircleGeometry(0.32, 12), C.dark, P.matte, g);
  mouth.position.z = 0.115;
  k.tube(new THREE.Vector3(0, 0, 0.16), new THREE.Vector3(0, -0.75, 0.2), 0.08, C.chain, P.metal, 6, g);
  k.box(0.55, 0.3, 0.26, 0, -0.85, 0.2, C.chain, P.metal, g);
  for (const fx of [-1, 1]) {
    const f = k.box(0.24, 0.85, 0.1, fx * 0.32, -0.62, 0.22, C.chain, P.metal, g);
    f.rotation.z = fx * 0.35;
  }
}

/** Non-skid deck: textured foredeck from zA to the stem, tiled grain aft of it. */
function deck(g: THREE.Group, k: Kit, s: HullSpec, inner: (z: number) => number, deckY: (x: number, z: number) => number, zA: number, fcZ0?: number, gap?: [number, number]): { tris: number; tile: THREE.Material } {
  const L = s.len / 2;
  const zs = stations(L, zA - 6, fcZ0);
  const W = s.beam * 1.3;
  const nx = 10;
  let tris = 0;
  const part = (list: number[], uv: (x: number, z: number) => [number, number], mat: THREE.Material, name: string) => {
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    list.forEach((z, i) => {
      const w = inner(z);
      for (let j = 0; j <= nx; j++) {
        const x = -w + (2 * w * j) / nx;
        pos.push(x, deckY(x, z) + 0.01, z);
        uvs.push(...uv(x, z));
        if (i < list.length - 1) {
          const a = i * (nx + 1) + j;
          if (j < nx) idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    g.add(m);
    tris += idx.length / 3;
  };
  const fore = foredeckTexture({ W, z0: zA, z1: L, half: inner, marks: k.marks, seed: Math.round(s.len * 7), gap });
  const tile = deckTile(Math.round(s.len * 3));
  part(zs.filter((z) => z >= zA), (x, z) => [x / W + 0.5, (z - zA) / (L - zA)], new THREE.MeshStandardMaterial({ map: fore, roughness: 0.93, metalness: 0.04 }), 'own-foredeck');
  const tileMat = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.93, metalness: 0.04 });
  part(zs.filter((z, i) => z <= zA || (zs[i - 1] ?? -Infinity) < zA), (x, z) => [x / 3, z / 3], tileMat, 'own-deck');
  return { tris, tile: tileMat };
}

/** Height of the generic bridge roof under the eye (the new bridge structure stands on it). */
function roofBelow(g: THREE.Group, eye: number, ze: number): number {
  g.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, eye - 2.4, ze - 1), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(g.children.filter((o) => (o as THREE.Mesh).isMesh && !o.name), false)[0];
  return hit ? hit.point.y : eye - 7;
}
