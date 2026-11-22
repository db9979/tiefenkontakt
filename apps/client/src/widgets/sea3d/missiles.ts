import * as THREE from 'three';
import type { SamView } from '@tk/shared';

/**
 * Surface-to-air missiles in the 3D sea view: a white smoke trail from the launcher up to
 * the missile, a bright motor flame at its head and a burst (fire and smoke puff) where it
 * hit or self-destructed. Trails are kept in world coordinates and drift apart slowly.
 */

const EARTH_R = 6_371_000;
const FADE_S = 40;

interface Trail {
  pts: { x: number; y: number; alt: number }[];
  line: THREE.Line;
  head: THREE.Points;
  burst?: THREE.Points;
  done?: 'hit' | 'miss';
  doneAt?: number;
  seenAt: number;
}

export class MissileTrails {
  private trails = new Map<string, Trail>();

  constructor(private scene: THREE.Scene) {}

  /** Update from the latest missile list; me = own position (world m); now = seconds (frame clock). */
  update(list: SamView[], me: { x: number; y: number }, now: number, light: number): void {
    for (const m of list) {
      let tr = this.trails.get(m.id);
      if (!tr) {
        const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe8ecee, transparent: true, opacity: 0.85, fog: true }));
        const head = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
          new THREE.PointsMaterial({ color: 0xffc070, size: 5, sizeAttenuation: false, transparent: true, fog: false }));
        tr = { pts: [{ x: m.fromX, y: m.fromY, alt: 15 }], line, head, seenAt: now };
        this.scene.add(line, head);
        this.trails.set(m.id, tr);
      }
      tr.seenAt = now;
      const last = tr.pts[tr.pts.length - 1]!;
      if (Math.hypot(m.x - last.x, m.y - last.y, m.alt - last.alt) > 20) tr.pts.push({ x: m.x, y: m.y, alt: m.alt });
      if (m.done && !tr.done) {
        tr.done = m.done;
        tr.doneAt = now;
        const p = this.local(m, me);
        // Burst: an orange flash with a grey puff for a kill, a small puff for a self-destruct
        const n = m.done === 'hit' ? 40 : 14;
        const pos: number[] = [];
        for (let i = 0; i < n; i++) pos.push(p.x + (Math.random() - 0.5) * 60, p.y + (Math.random() - 0.5) * 40, p.z + (Math.random() - 0.5) * 60);
        tr.burst = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)),
          new THREE.PointsMaterial({ color: m.done === 'hit' ? 0xff8a3a : 0xb8bcc0, size: m.done === 'hit' ? 6 : 4, sizeAttenuation: false, transparent: true, fog: false }));
        this.scene.add(tr.burst);
      }
    }
    for (const [id, tr] of this.trails) {
      const age = tr.doneAt !== undefined ? now - tr.doneAt : now - tr.seenAt > 3 ? FADE_S : 0;
      if (age >= FADE_S) {
        for (const o of [tr.line, tr.head, tr.burst]) {
          if (!o) continue;
          this.scene.remove(o);
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
        this.trails.delete(id);
        continue;
      }
      const pos: number[] = [];
      for (const p of tr.pts) {
        const q = this.local(p, me);
        pos.push(q.x, q.y, q.z);
      }
      tr.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      tr.line.geometry.computeBoundingSphere();
      const lm = tr.line.material as THREE.LineBasicMaterial;
      // Smoke shows grey by day, faintly at night; it thins out after the end of the flight
      lm.opacity = (0.35 + 0.5 * Math.min(1, light + 0.2)) * (1 - age / FADE_S);
      lm.color.setScalar(0.25 + 0.7 * light);
      const head = tr.pts[tr.pts.length - 1]!;
      const hq = this.local(head, me);
      tr.head.position.set(hq.x, hq.y, hq.z);
      tr.head.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      tr.head.visible = !tr.done;
      if (tr.burst) {
        const bm = tr.burst.material as THREE.PointsMaterial;
        bm.opacity = Math.max(0, 1 - age / 12);
        bm.size = (tr.done === 'hit' ? 6 : 4) + age * 0.6;
      }
    }
  }

  /** World metres to scene coordinates around the eye: x east, z south, y up (earth curvature off). */
  private local(p: { x: number; y: number; alt: number }, me: { x: number; y: number }): THREE.Vector3 {
    const dx = p.x - me.x;
    const dy = p.y - me.y;
    const r2 = dx * dx + dy * dy;
    return new THREE.Vector3(dx, p.alt - r2 / (2 * EARTH_R), -dy);
  }
}
