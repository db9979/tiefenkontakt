import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Close-range kit for the own ship seen from her bridge (own-detail.ts): a handful of surface
 * materials whose shades ride in vertex colours, so all painted steel bakes into one draw call;
 * every part is darkened toward its foot (cheap contact shadow) and jittered a little in shade
 * (paint that was touched up at different times). Parts also leave marks on the deck texture
 * (grime around fittings, rust at the hawse pipes, painted lines).
 */

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, ...o });
export const P = {
  /** Haze-grey paint, also the hull. */
  paint: std({ roughness: 0.72, metalness: 0.16 }),
  /** Worn or bare steel: chain, gypsies, bollard heads. */
  metal: std({ roughness: 0.55, metalness: 0.3 }),
  /** Canvas, rubber, openings. */
  matte: std({ roughness: 0.96, metalness: 0 }),
  /** Window glass. */
  glass: std({ roughness: 0.12, metalness: 0.55 }),
};

/** Shades. */
export const C = {
  haze: 0x7d868b, hazeL: 0x8d969a, hazeD: 0x626b70, deck: 0x5c6164, rail: 0x9aa2a6, chain: 0x3d3b39, steel: 0x7f8587, gun: 0x6f787d,
  dark: 0x101314, canvas: 0x2f3538, orange: 0xd0602a, white: 0xd6dada, rust: 0x6a3d27, boot: 0x1b1e20, bottom: 0x5a2a24, wood: 0x4a3c2e, glass: 0x10181c, yellow: 0xc9a02c, red: 0x8a1c16, green: 0x1d6b2e,
};

export type MarkKind = 'grime' | 'rust' | 'arc' | 'line' | 'wear';
/** Something to paint on the deck texture at (x, z) in ship metres. */
export interface DeckMark { kind: MarkKind; x: number; z: number; r: number; x1?: number; z1?: number }

const UP = new THREE.Vector3(0, 1, 0);

/** Stencils, cell numbers and flags on one canvas (x, y, w, h in pixels of a 1024 × 512 atlas). */
const ATLAS: Record<string, [number, number, number, number]> = {
  noStep: [512, 0, 512, 64], blast: [0, 64, 640, 64], ensign: [0, 128, 384, 256], jack: [384, 128, 192, 128],
};
for (let i = 1; i <= 8; i++) ATLAS[`n${i}`] = [(i - 1) * 64, 0, 64, 64];
let decalMat: THREE.MeshStandardMaterial | undefined;
/** Painted stencils and the (fictional) ensign and jack: white letters on transparent, flags in colour. */
function decals(): THREE.MeshStandardMaterial {
  if (decalMat) return decalMat;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(226,228,224,0.85)';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = 'bold 50px Helvetica, Arial, sans-serif';
  for (let i = 1; i <= 8; i++) x.fillText(String(i), (i - 0.5) * 64, 34);
  x.font = 'bold 40px Helvetica, Arial, sans-serif';
  x.fillText('NICHT BETRETEN', 768, 34);
  x.fillStyle = 'rgba(214,170,48,0.9)';
  x.fillText('ABGASSTRAHL · GEFAHR', 320, 98);
  // Ensign (fictional Westbund naval flag): white field, blue canton with a four-point star, blue foot band
  const star = (cx: number, cy: number, r: number) => {
    x.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = k % 2 ? r * 0.3 : r;
      x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
    x.fill();
  };
  x.fillStyle = '#e8eae6';
  x.fillRect(0, 128, 384, 256);
  x.fillStyle = '#1f3a6b';
  x.fillRect(0, 128, 170, 120);
  x.fillRect(0, 340, 384, 44);
  x.fillStyle = '#e8eae6';
  star(85, 188, 44);
  x.fillStyle = '#1f3a6b';
  x.fillRect(384, 128, 192, 128);
  x.fillStyle = '#e8eae6';
  star(480, 192, 46);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return (decalMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 0.85, side: THREE.DoubleSide }));
}

export class Kit {
  readonly root = new THREE.Group();
  readonly marks: DeckMark[] = [];
  private seed = 1;

  mark(kind: MarkKind, x: number, z: number, r: number, x1?: number, z1?: number): void {
    this.marks.push({ kind, x, z, r, x1, z1 });
  }

  mesh(geo: THREE.BufferGeometry, c: number, mat: THREE.Material = P.paint, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.userData.c = c;
    parent.add(m);
    return m;
  }

  group(x: number, y: number, z: number, ry = 0, rx = 0, parent: THREE.Object3D = this.root): THREE.Group {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.set(x, y, z);
    g.rotation.set(rx, ry, 0);
    parent.add(g);
    return g;
  }

  box(w: number, h: number, l: number, x: number, y: number, z: number, c: number, mat: THREE.Material = P.paint, parent?: THREE.Object3D): THREE.Mesh {
    const m = this.mesh(new THREE.BoxGeometry(w, h, l), c, mat, parent);
    m.position.set(x, y, z);
    return m;
  }

  /** Upright cylinder standing on y (not centred on it). */
  cyl(r: number, h: number, x: number, y: number, z: number, c: number, mat: THREE.Material = P.paint, seg = 12, r2 = r, parent?: THREE.Object3D): THREE.Mesh {
    const m = this.mesh(new THREE.CylinderGeometry(r2, r, h, seg), c, mat, parent);
    m.position.set(x, y + h / 2, z);
    return m;
  }

  /** Upright body of revolution from [radius, y] points. */
  lathe(pts: [number, number][], x: number, y: number, z: number, c: number, mat: THREE.Material = P.paint, seg = 14, parent?: THREE.Object3D): THREE.Mesh {
    const m = this.mesh(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(Math.max(0.002, r), h)), seg), c, mat, parent);
    m.position.set(x, y, z);
    return m;
  }

  /** Round bar from a to b (open ends). */
  tube(a: THREE.Vector3, b: THREE.Vector3, r: number, c: number, mat: THREE.Material = P.paint, seg = 5, parent?: THREE.Object3D, r2 = r): THREE.Mesh {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = this.mesh(new THREE.CylinderGeometry(r2, r, d.length(), seg, 1, true), c, mat, parent);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    return m;
  }

  /** Painted stencil or flag from the atlas, a w × h plane facing +z in its parent. */
  decal(name: string, w: number, h: number, parent: THREE.Object3D = this.root, segs = 1): THREE.Mesh {
    const [ax, ay, aw, ah] = ATLAS[name]!;
    const geo = new THREE.PlaneGeometry(w, h, segs, 1);
    const uv = geo.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (ax + uv.getX(i) * aw) / 1024, 1 - (ay + ah) / 512 + (uv.getY(i) * ah) / 512);
    const m = this.mesh(geo, 0xffffff, decals(), parent);
    m.userData.ao = 0;
    return m;
  }

  torus(r: number, tube: number, c: number, mat: THREE.Material, rs = 4, ts = 10, arc = Math.PI * 2, parent?: THREE.Object3D): THREE.Mesh {
    return this.mesh(new THREE.TorusGeometry(r, tube, rs, ts, arc), c, mat, parent);
  }

  /** Bake every part into one mesh per material (named, so mergeStatic leaves them alone). */
  bake(target: THREE.Group, layer = 0): number {
    this.root.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const col = new THREE.Color();
    let tris = 0;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
      const textured = !!(m.material as THREE.MeshStandardMaterial).map;
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && !(textured && k === 'uv')) geo.deleteAttribute(k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.applyMatrix4(m.matrixWorld);
      const pos = geo.attributes.position!;
      if (!geo.attributes.color) {
        col.set(m.userData.c ?? 0xffffff);
        // Touched-up paint: each part a shade off
        const j = 1 + (this.rand() - 0.5) * 0.06;
        geo.computeBoundingBox();
        const y0 = geo.boundingBox!.min.y;
        const y1 = geo.boundingBox!.max.y;
        const ao = m.userData.ao ?? 0.3;
        const arr = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          // Darker toward the foot of the part: contact shadow
          const f = (1 - ao) + ao * Math.min(1, (pos.getY(i) - y0) / Math.max(0.05, Math.min(0.6, (y1 - y0) * 0.6)));
          arr[i * 3] = col.r * j * f;
          arr[i * 3 + 1] = col.g * j * f;
          arr[i * 3 + 2] = col.b * j * f;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      }
      tris += pos.count / 3;
      const list = byMat.get(m.material as THREE.Material) ?? [];
      list.push(geo);
      byMat.set(m.material as THREE.Material, list);
    });
    let i = 0;
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `own-detail-${layer}-${i++}`;
      mesh.layers.set(layer);
      target.add(mesh);
    }
    return tris;
  }

  rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
}

/**
 * Faceted solid lofted through horizontal polygons (same vertex count each), capped top and
 * bottom; flat normals, faces turned outward from the centroid (shapes must be convex).
 */
export function facet(levels: { y: number; pts: [number, number][] }[]): THREE.BufferGeometry {
  const v: number[] = [];
  const ctr = new THREE.Vector3();
  let n = 0;
  for (const l of levels) for (const [x, z] of l.pts) {
    ctr.add(new THREE.Vector3(x, l.y, z));
    n++;
  }
  ctr.divideScalar(n);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3).sub(ctr);
    if (nrm.lengthSq() < 1e-10) return;
    if (nrm.dot(mid) < 0) [b, c] = [c, b];
    v.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const P3 = (l: { y: number; pts: [number, number][] }, i: number) => {
    const p = l.pts[(i + l.pts.length) % l.pts.length]!;
    return new THREE.Vector3(p[0], l.y, p[1]);
  };
  for (let k = 0; k < levels.length - 1; k++) {
    const a = levels[k]!;
    const b = levels[k + 1]!;
    for (let i = 0; i < a.pts.length; i++) {
      tri(P3(a, i), P3(a, i + 1), P3(b, i + 1));
      tri(P3(a, i), P3(b, i + 1), P3(b, i));
    }
  }
  for (const l of [levels[0]!, levels[levels.length - 1]!]) for (let i = 1; i < l.pts.length - 1; i++) tri(P3(l, 0), P3(l, i), P3(l, i + 1));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}
