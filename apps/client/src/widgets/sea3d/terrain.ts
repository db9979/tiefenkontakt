import * as THREE from 'three';
import { depthAt, type SeabedSpec, type Vec2 } from '@tk/shared';

/** Square of land around the own ship (m) and its cell size: mountains far off still show. */
const SPAN = 60_000;
const CELLS = 200;
/** Rebuild when the ship has moved this far from the last centre (m). */
const REBUILD_M = 6_000;

const SAND = new THREE.Color('#8a8470');
const GRASS = new THREE.Color('#4d5a44');
const ROCK = new THREE.Color('#5f5f5a');
const SNOW = new THREE.Color('#d9dcdc');

function landColour(h: number, slope: number, out: THREE.Color): THREE.Color {
  if (h < 6) return out.copy(SAND);
  if (h > 650) return out.copy(SNOW).lerp(ROCK, Math.min(1, slope * 1.5));
  out.copy(GRASS).lerp(ROCK, Math.min(1, slope * 2 + h / 900));
  return out;
}

/**
 * Coasts, islands and mountains of the sea chart in the 3D view (periscope, bridge): a height
 * mesh built from the same chart the plot and the radar use (negative depth = height above
 * the sea), around the own ship, rebuilt as she moves on. Only cells with land are drawn; the
 * scene's haze lets distant ranges fade like real coasts.
 */
export class Terrain {
  readonly group = new THREE.Group();
  private mesh?: THREE.Mesh;
  private centre?: Vec2;
  private spec?: SeabedSpec;
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });

  /** Place the land for the own position (game frame); rebuild when needed. */
  update(spec: SeabedSpec | undefined, own: Vec2): void {
    if (!spec) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    if (spec !== this.spec || !this.centre || Math.hypot(own.x - this.centre.x, own.y - this.centre.y) > REBUILD_M) {
      this.spec = spec;
      this.centre = { x: Math.round(own.x / 500) * 500, y: Math.round(own.y / 500) * 500 };
      this.build(spec, this.centre);
    }
    // Scene: x east of the own ship, z = −(north offset), y up
    this.group.position.set(this.centre!.x - own.x, 0, -(this.centre!.y - own.y));
  }

  private build(spec: SeabedSpec, c: Vec2): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = undefined;
    }
    const n = CELLS + 1;
    const step = SPAN / CELLS;
    const h = new Float32Array(n * n);
    let anyLand = false;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = c.x - SPAN / 2 + i * step;
        const y = c.y - SPAN / 2 + j * step;
        const e = -depthAt(spec, x, y);
        h[j * n + i] = e;
        if (e > 0) anyLand = true;
      }
    }
    if (!anyLand) return;
    const pos: number[] = [];
    const col: number[] = [];
    const tmp = new THREE.Color();
    const vert = (i: number, j: number) => {
      const e = h[j * n + i]!;
      // Water vertices sit just under the sea surface, so a coast meets the water cleanly
      pos.push(-SPAN / 2 + i * step, e > 0 ? e : -3, -(-SPAN / 2 + j * step));
      const sx = (h[j * n + Math.min(n - 1, i + 1)]! - h[j * n + Math.max(0, i - 1)]!) / (2 * step);
      const sy = (h[Math.min(n - 1, j + 1) * n + i]! - h[Math.max(0, j - 1) * n + i]!) / (2 * step);
      landColour(Math.max(0, e), Math.hypot(sx, sy), tmp);
      col.push(tmp.r, tmp.g, tmp.b);
    };
    for (let j = 0; j < CELLS; j++) {
      for (let i = 0; i < CELLS; i++) {
        const a = h[j * n + i]!, b = h[j * n + i + 1]!, d = h[(j + 1) * n + i]!, e = h[(j + 1) * n + i + 1]!;
        if (a <= 0 && b <= 0 && d <= 0 && e <= 0) continue;
        vert(i, j); vert(i + 1, j); vert(i, j + 1);
        vert(i + 1, j); vert(i + 1, j + 1); vert(i, j + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  dispose(): void {
    if (this.mesh) this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
