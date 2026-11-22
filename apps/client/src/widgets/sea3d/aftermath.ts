import * as THREE from 'three';

/**
 * What stays on the water after a hit: an expanding foam ring, a spreading oil slick with
 * burning patches (bright at night), and debris bobbing in the swell. Built once per blast
 * and driven by the blast's age (s).
 */

const N_DEBRIS = 12;
const N_FIRES = 5;

export function createAftermath(seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'aftermath';
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0xf2f8f8, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.7;
  ring.name = 'ring';
  g.add(ring);
  // Oil: an irregular dark blob (noisy circle), slightly sheened
  const shape = new THREE.Shape();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 1 + 0.25 * Math.sin(a * 3 + seed) + 0.15 * Math.sin(a * 7 + seed * 2);
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const oil = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: 0x0a0c0b, emissive: 0x111410, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  oil.rotation.x = -Math.PI / 2;
  oil.position.y = 0.55;
  oil.name = 'oil';
  g.add(oil);
  // Flames: a soft orange body with a hot yellow core, both additive so they glow
  const blob = new THREE.SphereGeometry(1, 10, 8);
  blob.translate(0, 1, 0); // base at the water
  for (let i = 0; i < N_FIRES; i++) {
    const f = new THREE.Group();
    f.name = `fire${i}`;
    const outer = new THREE.Mesh(blob, new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    const core = new THREE.Mesh(blob, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    outer.name = 'outer';
    core.name = 'core';
    core.scale.set(0.5, 0.6, 0.5);
    f.add(outer, core);
    g.add(f);
  }
  const wood = new THREE.MeshLambertMaterial({ color: 0x3b2f25, flatShading: true });
  const metal = new THREE.MeshLambertMaterial({ color: 0x4a5055, flatShading: true });
  for (let i = 0; i < N_DEBRIS; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(2 + (i % 4) * 1.5, 0.6 + (i % 3) * 0.4, 1 + (i % 5)), i % 3 === 0 ? metal : wood);
    d.name = `deb${i}`;
    g.add(d);
  }
  return g;
}

/** Animate by blast age (s), clock t (s) and daylight (0 night … 1 day). */
export function updateAftermath(g: THREE.Group, age: number, t: number, light: number, seed: number): void {
  const ring = g.getObjectByName('ring') as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  const r = Math.min(160, age * 22);
  ring.scale.setScalar(Math.max(0.01, r));
  ring.material.opacity = Math.max(0, 0.8 - age / 9);
  ring.visible = age < 9;
  const oil = g.getObjectByName('oil') as THREE.Mesh<THREE.ShapeGeometry, THREE.MeshLambertMaterial>;
  const spread = Math.min(140, 15 + age * 1.6);
  oil.scale.set(spread, spread * 0.8, 1);
  oil.rotation.z = seed;
  oil.material.opacity = Math.min(0.75, Math.max(0, (age - 3) / 8));
  // Burning oil: flames flicker on the slick; they glow strongest at night and die down over minutes
  const burn = Math.max(0, 1 - age / 240) * (age > 2 ? 1 : 0);
  for (let i = 0; i < N_FIRES; i++) {
    const f = g.getObjectByName(`fire${i}`) as THREE.Group;
    const a = seed * 3 + i * 1.3;
    const d = spread * (0.15 + 0.12 * i);
    const flick = 0.75 + 0.25 * Math.sin(t * (7 + i) + i) * Math.sin(t * 3.3 + i * 2);
    const h = (3 + (i % 3) * 2.5) * burn * flick;
    f.visible = h > 0.2;
    const wobble = 1 + 0.15 * Math.sin(t * 11 + i * 3);
    f.scale.set((2.2 + i * 0.6) * wobble, Math.max(0.01, h), (2.2 + i * 0.6) / wobble);
    f.position.set(Math.cos(a) * d, 0.3, Math.sin(a) * d);
    const op = (0.35 + 0.55 * (1 - light)) * Math.min(1, burn * 2);
    (f.getObjectByName('outer') as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>).material.opacity = op * 0.7;
    (f.getObjectByName('core') as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>).material.opacity = op;
  }
  // Debris drifts outward and bobs; some of it sinks after a while
  for (let i = 0; i < N_DEBRIS; i++) {
    const d = g.getObjectByName(`deb${i}`)!;
    const a = seed + i * 2.399;
    const dist = Math.min(90, 6 + age * (0.6 + (i % 5) * 0.25));
    const sink = i % 4 === 0 ? Math.max(0, (age - 40) * 0.05) : 0;
    d.visible = age > 1.5 && sink < 3;
    d.position.set(Math.cos(a) * dist, 0.3 + Math.sin(t * 0.9 + i) * 0.35 - sink, Math.sin(a) * dist);
    d.rotation.set(Math.sin(t * 0.7 + i) * 0.2, a, Math.cos(t * 0.6 + i) * 0.2);
  }
}
