import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draw-call diet for detailed models: all static meshes of a model that share a material are
 * baked into one mesh (transforms applied), and so are line sets (railings, rigging). Moving or
 * special parts stay separate: anything named (wake, bow, feather, contrail, rotor, navlights,
 * hull…), smoke puffs, transparent decals. The turning radar antenna stays its own object but
 * its parts are baked into it. A frigate goes from ~190 meshes to about a dozen draw calls.
 */
export function mergeStatic(g: THREE.Group): THREE.Group {
  const keep = new Set<THREE.Object3D>();
  const radar = g.userData.radar as THREE.Object3D | undefined;
  if (radar) keep.add(radar);
  for (const p of (g.userData.smoke as { puffs?: THREE.Object3D[] } | undefined)?.puffs ?? []) keep.add(p);
  bake(g, (o) => {
    for (let x: THREE.Object3D | null = o; x && x !== g; x = x.parent) if (x.name || keep.has(x)) return true;
    return false;
  });
  if (radar && !(radar as THREE.Mesh).isMesh) bake(radar, () => false);
  return g;
}

/** Bake the static meshes and line sets under root, except those `skip` names, into one object per material. */
function bake(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { m: THREE.Material; lines: boolean; geos: THREE.BufferGeometry[]; objs: THREE.Object3D[] }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const lines = (o as THREE.LineSegments).isLineSegments === true;
    if ((!mesh.isMesh && !lines) || Array.isArray(mesh.material)) return;
    const m = mesh.material as THREE.Material & { vertexColors?: boolean };
    if (m.transparent || o.userData.keep || skip(o)) return;
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()) as THREE.BufferGeometry;
    // Same attribute set for everything merged with this material
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && (lines || k !== 'normal') && !(k === 'color' && m.vertexColors)) geo.deleteAttribute(k);
    if (!lines && !geo.attributes.normal) geo.computeVertexNormals();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const key = `${lines ? 'L' : 'M'}|${m.uuid}|${Object.keys(geo.attributes).sort().join(',')}`;
    const e = groups.get(key) ?? { m, lines, geos: [], objs: [] };
    e.geos.push(geo);
    e.objs.push(o);
    groups.set(key, e);
  });
  for (const e of groups.values()) {
    if (e.objs.length < 2) continue;
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    for (const o of e.objs) {
      o.removeFromParent();
      (o as THREE.Mesh).geometry.dispose();
    }
    root.add(e.lines ? new THREE.LineSegments(merged, e.m) : new THREE.Mesh(merged, e.m));
  }
}
