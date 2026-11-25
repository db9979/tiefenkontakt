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
};

/** Shades. */
export const C = {
  haze: 0x7d868b, hazeL: 0x8d969a, hazeD: 0x626b70, deck: 0x5c6164, rail: 0x9aa2a6, chain: 0x3d3b39, steel: 0x7f8587, gun: 0x6f787d,
  dark: 0x101314, canvas: 0x2f3538, orange: 0xd0602a, white: 0xd6dada, rust: 0x6a3d27, boot: 0x1b1e20, bottom: 0x5a2a24,
};

export type MarkKind = 'grime' | 'rust' | 'ring' | 'line' | 'wear';
/** Something to paint on the deck texture at (x, z) in ship metres. */
export interface DeckMark { kind: MarkKind; x: number; z: number; r: number; x1?: number; z1?: number }

const UP = new THREE.Vector3(0, 1, 0);

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

  torus(r: number, tube: number, c: number, mat: THREE.Material, rs = 4, ts = 10, arc = Math.PI * 2, parent?: THREE.Object3D): THREE.Mesh {
    return this.mesh(new THREE.TorusGeometry(r, tube, rs, ts, arc), c, mat, parent);
  }

  /** Bake every part into one mesh per material (named, so mergeStatic leaves them alone). */
  bake(target: THREE.Group): number {
    this.root.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const col = new THREE.Color();
    let tris = 0;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') geo.deleteAttribute(k);
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
      mesh.name = `own-detail-${i++}`;
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
