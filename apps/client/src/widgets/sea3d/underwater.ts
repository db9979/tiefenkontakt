import * as THREE from 'three';
import type { ClassId } from '@tk/shared';
import { shipModel } from './models.js';
import { mergeStatic } from './merge.js';
import { dprGl } from '../perf.js';

/**
 * Underwater reconstruction of a torpedo hit, for boats that only heard it: the hull seen
 * from below against the bright surface, the detonation's gas bubble expanding, collapsing
 * and pulsing again (what breaks a keel), then the hull breaking in two and going down in
 * a stream of bubbles. Murky green water, light shafts, a dim Snell's window overhead.
 */

const BUBBLES = 260;

export class UnderwaterScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2000);
  private halves: THREE.Group[] = [];
  private bubble: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private flash = new THREE.PointLight(0xfff0d0, 0, 400, 1.5);
  private shafts: THREE.Mesh[] = [];
  private rising: THREE.Points;
  private seeds = new Float32Array(BUBBLES * 3);
  private cls: ClassId | undefined;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.localClippingEnabled = true;
    this.scene.background = new THREE.Color(0x041a19);
    this.scene.fog = new THREE.FogExp2(0x0b3532, 0.011);
    this.scene.add(new THREE.HemisphereLight(0x8fd8cc, 0x02100f, 1.1), this.flash);
    // The surface from below: bright, wavy; a brighter disc straight overhead (Snell's window)
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 1, 1), new THREE.MeshBasicMaterial({ color: 0x4f9c94, side: THREE.DoubleSide, fog: true }));
    surface.rotation.x = Math.PI / 2;
    this.scene.add(surface);
    const windowDisc = new THREE.Mesh(new THREE.CircleGeometry(60, 40), new THREE.MeshBasicMaterial({ color: 0xbff2ea, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    windowDisc.rotation.x = Math.PI / 2;
    windowDisc.position.set(30, -0.2, 50);
    this.scene.add(windowDisc);
    for (let i = 0; i < 9; i++) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 7, 120, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fe8dc, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      shaft.position.set(-80 + i * 22, -60, -30 + (i % 3) * 40);
      shaft.rotation.z = 0.25;
      this.shafts.push(shaft);
      this.scene.add(shaft);
    }
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xdff8f4, transparent: true, opacity: 0.55, depthWrite: false }));
    this.scene.add(this.bubble);
    const pos = new Float32Array(BUBBLES * 3);
    for (let i = 0; i < BUBBLES; i++) {
      this.seeds[i * 3] = (Math.random() - 0.5) * 120;
      this.seeds[i * 3 + 1] = Math.random();
      this.seeds[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    this.rising = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)),
      new THREE.PointsMaterial({ color: 0xe6fbf7, size: 1.6, transparent: true, opacity: 0.8, depthWrite: false }));
    this.scene.add(this.rising);
    this.camera.rotation.order = 'YXZ';
  }

  /** Two halves of the struck ship, each clipped at the break (amidships). */
  private build(cls: ClassId): void {
    for (const h of this.halves) this.scene.remove(h);
    this.halves = [];
    for (const side of [1, -1]) {
      const g = mergeStatic(shipModel(cls));
      g.getObjectByName('wake')?.removeFromParent();
      g.getObjectByName('bow')?.removeFromParent();
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, side), 0);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.material) return;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
          const c = x.clone();
          c.clippingPlanes = [plane];
          c.side = THREE.DoubleSide;
          return c;
        });
        m.material = Array.isArray(m.material) ? mats : mats[0]!;
      });
      g.userData.plane = plane;
      g.userData.side = side;
      this.halves.push(g);
      this.scene.add(g);
    }
    this.cls = cls;
  }

  render(cls: ClassId, age: number, light: number): void {
    if (this.cls !== cls) this.build(cls);
    const w = this.canvas.clientWidth || 400;
    const h = this.canvas.clientHeight || 220;
    const dpr = dprGl();
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Camera drifts slowly below and abeam, looking up at the keel
    this.camera.position.set(48 + age * 1.2, -20 - age * 0.3, 62 - age * 1.5);
    this.camera.lookAt(0, -5 - Math.min(25, age * 1.1), -6);
    const lit = 0.25 + 0.75 * light;
    // Background and fog share one colour so the far water has no visible edge
    (this.scene.fog as THREE.FogExp2).color.setRGB(0.04 * lit, 0.19 * lit, 0.18 * lit);
    (this.scene.background as THREE.Color).copy((this.scene.fog as THREE.FogExp2).color);
    // Gas bubble under the keel: expand, collapse, pulse again, then break up
    const b = age < 0.6 ? age / 0.6 : age < 1.2 ? 1 - ((age - 0.6) / 0.6) * 0.8 : age < 1.9 ? 0.2 + ((age - 1.2) / 0.7) * 0.5 : Math.max(0, 0.7 - (age - 1.9) * 1.4);
    this.bubble.scale.setScalar(Math.max(0.01, b * 14));
    this.bubble.position.set(0, -16 + Math.max(0, age - 1.2) * 4, 8);
    this.bubble.visible = b > 0.02;
    this.flash.position.set(0, -16, 8);
    this.flash.intensity = age < 0.35 ? (1 - age / 0.35) * 40 : 0;
    // The hull breaks: the halves part, bow and stern tilt, both settle into the deep
    const brk = Math.max(0, age - 1.6);
    for (const half of this.halves) {
      const side = half.userData.side as number;
      half.position.set(0, -brk * 1.4, side * brk * 0.8);
      half.rotation.x = side * Math.min(0.5, brk * 0.07);
    }
    // Bubbles: a column from the blast, later streaming out of the broken hull
    const pos = this.rising.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < BUBBLES; i++) {
      const x0 = this.seeds[i * 3]!, ph = this.seeds[i * 3 + 1]!, z0 = this.seeds[i * 3 + 2]!;
      const fromHull = i % 2 === 0;
      const start = fromHull ? 2.2 + ph * 6 : 0.5 + ph * 1.5;
      const tt = age - start;
      if (tt < 0) { pos.setXYZ(i, 0, -500, 0); continue; }
      const cycle = (tt * (6 + ph * 5)) % 45;
      const x = fromHull ? x0 * 0.9 : x0 * 0.08;
      const y = (fromHull ? -brk * 1.4 - 4 : -16) + cycle + Math.sin(tt * 3 + i) * 0.4;
      pos.setXYZ(i, x, Math.min(-0.5, y), (fromHull ? 0 : 8) + z0 * (fromHull ? 0.5 : 0.3));
    }
    pos.needsUpdate = true;
    for (const [i, s] of this.shafts.entries()) (s.material as THREE.MeshBasicMaterial).opacity = (0.04 + 0.03 * Math.sin(age * 0.8 + i)) * lit;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const x of mats) x.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
