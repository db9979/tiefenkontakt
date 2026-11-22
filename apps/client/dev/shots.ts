/**
 * Dev-only page for the player handbook: renders one ship model (?cls=ffg) on white,
 * from the side and slightly above, without wake, smoke or lights. Not part of the build.
 */
import * as THREE from 'three';
import type { ClassId } from '@tk/shared';
import { shipModel } from '../src/widgets/sea3d/models.js';
import { aircraftModel } from '../src/widgets/sea3d/aircraft.js';
import type { PlaneKind } from '@tk/shared';

const p = new URLSearchParams(location.search);
const cls = (p.get('cls') ?? 'ffg') as ClassId;
const W = 1400;
const H = 460;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.setClearColor(0xffffff, 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-60, 120, 80);
scene.add(sun);

// ?plane=airliner|light|recon|mpa|helo renders an aircraft instead (no contrail, rotor still)
const plane = p.get('plane') as PlaneKind | null;
const g = plane ? aircraftModel(plane) : shipModel(cls);
const drop: THREE.Object3D[] = [];
g.traverse((o) => {
  if (['wake', 'bow', 'feather', 'contrail'].includes(o.name) || o instanceof THREE.Sprite || o instanceof THREE.Points) drop.push(o);
  const m = (o as THREE.Mesh).material as THREE.Material | undefined;
  if (m && (m as THREE.MeshBasicMaterial).transparent && !o.userData.keep) drop.push(o);
});
for (const o of drop) o.removeFromParent();
scene.add(g);

// Waterline as a thin grey line for scale
const box = new THREE.Box3().setFromObject(g);
const size = box.getSize(new THREE.Vector3());
const ctr = box.getCenter(new THREE.Vector3());
const line = new THREE.Mesh(new THREE.BoxGeometry(size.z * 1.15, 0.15, 0.15), new THREE.MeshBasicMaterial({ color: 0x7aa0b8 }));
line.rotation.y = Math.PI / 2;
line.position.set(ctr.x + size.x, 0, ctr.z);
if (box.min.y > -3 && !plane) scene.add(line);

const cam = new THREE.PerspectiveCamera(18, W / H, 1, 5000);
const dist = (Math.max(size.z, size.y * 2.5) * 1.75) / Number(p.get('zoom') ?? 1);
// ?view=bow: from ahead on the port bow, lower; ?view=top: from above; default: port side, slightly above
const view = p.get('view');
if (view === 'bow') cam.position.set(ctr.x + dist * 0.55, ctr.y + dist * 0.12, ctr.z + dist * 0.8);
else if (view === 'top') cam.position.set(ctr.x + dist * 0.2, ctr.y + dist * 1.0, ctr.z + dist * 0.15);
else cam.position.set(ctr.x + dist * 0.9, ctr.y + dist * 0.3, ctr.z + dist * 0.32);
cam.lookAt(ctr);
renderer.render(scene, cam);
document.title = 'ready';
