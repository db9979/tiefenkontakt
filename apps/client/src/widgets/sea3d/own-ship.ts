import * as THREE from 'three';

/** The own ship around the bridge camera: where the eye sits, and what would block it. */

/** Forward bridge windows (glass planes facing ahead, high up): their z, or a default. */
export function bridgeFront(g: THREE.Group): number {
  let best = -Infinity;
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.geometry.type !== 'PlaneGeometry' || Math.abs(m.rotation.y) > 0.01) return;
    const p = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
    const mat = m.material as THREE.MeshStandardMaterial;
    if (p.y > 8 && mat.color && mat.color.getHex() < 0x202020 && p.z > best) best = p.z;
  });
  return Number.isFinite(best) ? best : 24;
}

/** Remove the own ship's parts whose bounds come within r of the eye. */
export function cullNear(g: THREE.Group, eye: THREE.Vector3, r: number): void {
  g.updateMatrixWorld(true);
  const drop: THREE.Object3D[] = [];
  const box = new THREE.Box3();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name === 'hull' || m.name === 'deck') return;
    box.setFromObject(m);
    // Only what reaches up to eye height (dome, mast foot, whips); the bridge we stand on stays
    if (box.distanceToPoint(eye) < r && box.max.y > eye.y - 0.5) drop.push(m);
  });
  for (const o of drop) o.removeFromParent();
}

/** Hand-held optics: slow sway and a fine tremor (radians) of `deg` amplitude. */
export function handShake(t: number, deg: number): { pitch: number; yaw: number } {
  if (!deg) return { pitch: 0, yaw: 0 };
  const k = (deg * Math.PI) / 180;
  return {
    pitch: k * (Math.sin(t * 1.7) * 0.6 + Math.sin(t * 5.3 + 1) * 0.25 + Math.sin(t * 11.1 + 2) * 0.15),
    yaw: k * (Math.sin(t * 1.3 + 0.5) * 0.6 + Math.sin(t * 4.7 + 3) * 0.3),
  };
}
