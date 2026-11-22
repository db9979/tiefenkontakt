import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draw-call diet for detailed models: all static meshes of a model that share a material are
 * baked into one mesh (transforms applied). Moving or special parts stay separate: anything
 * named (wake, bow, feather, contrail, rotor, navlights, hull…), the radar antenna, smoke
 * puffs, transparent decals. A frigate goes from ~60 draw calls to under ten.
 */
export function mergeStatic(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const keep = new Set<THREE.Object3D>();
  const radar = g.userData.radar as THREE.Object3D | undefined;
  if (radar) keep.add(radar);
  for (const p of (g.userData.smoke as { puffs?: THREE.Object3D[] } | undefined)?.puffs ?? []) keep.add(p);
  const named = (o: THREE.Object3D): boolean => {
    for (let x: THREE.Object3D | null = o; x && x !== g; x = x.parent) if (x.name || keep.has(x)) return true;
    return false;
  };
  const groups = new Map<string, { m: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const m = mesh.material as THREE.Material & { vertexColors?: boolean };
    if (m.transparent || o.userData.keep || named(o)) return;
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()) as THREE.BufferGeometry;
    // Same attribute set for everything merged with this material
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'color' && m.vertexColors)) geo.deleteAttribute(k);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const key = `${m.uuid}|${Object.keys(geo.attributes).sort().join(',')}`;
    const e = groups.get(key) ?? { m, geos: [], meshes: [] };
    e.geos.push(geo);
    e.meshes.push(mesh);
    groups.set(key, e);
  });
  for (const e of groups.values()) {
    if (e.meshes.length < 2) continue;
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    for (const mesh of e.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    g.add(new THREE.Mesh(merged, e.m));
  }
  return g;
}
