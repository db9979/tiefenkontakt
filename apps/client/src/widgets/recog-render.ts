import * as THREE from 'three';
import { RECOG_ORDER, type ClassId } from '@tk/shared';
import { convoyModel, shipModel } from './sea3d/models.js';
import { CONVOY_TYPES, type ConvoyType } from './sea3d/convoy-types.js';

/**
 * Silhouettes for the recognition book, rendered once from the real 3D models: side (bow to
 * the right), bow-on and top view, only what shows above the waterline, flat grey-green on
 * the console background. One short-lived WebGL context renders all of them; the images
 * are cached as data URLs and kept in localStorage per build, so later visits skip the
 * rendering altogether.
 */

export type RecogView = 'side' | 'bow' | 'top';
export const VIEW_SIZE: Record<RecogView, [number, number]> = { side: [300, 96], bow: [120, 96], top: [300, 70] };

/** Build id from vite (a new build may change the models, so old pictures are dropped). */
declare const __BUILD_ID__: string;
const STORE = `tk_recog_${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}`;
const cache = new Map<string, string>(load());

function load(): [string, string][] {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('tk_recog_') && k !== STORE) localStorage.removeItem(k);
    return Object.entries(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, string>);
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    /* storage full or blocked: the session cache still works */
  }
}

/** Render all silhouettes in the background (prefetch at the lobby). */
export function prerender(): void {
  renderRecog(RECOG_ORDER as ClassId[]);
}

/** Drop wakes, smoke, sprites and lights: only the hull and its fittings. */
function clean(g: THREE.Group): void {
  const drop: THREE.Object3D[] = [];
  g.traverse((o) => {
    if (['wake', 'bow', 'feather', 'contrail', 'navlights'].includes(o.name) || o instanceof THREE.Sprite || o instanceof THREE.Points) drop.push(o);
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m && (m as THREE.MeshBasicMaterial).transparent && !o.userData.keep) drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
}

export function recogImage(cls: ClassId, view: RecogView): string | undefined {
  return cache.get(`${cls}|${view}`);
}

/** Side view of one convoy type (the convoy page shows them all). */
export function convoyImage(type: ConvoyType): string | undefined {
  return cache.get(`merchant~${type}|side`);
}

/** Render every missing silhouette of these classes (synchronously, a few ms each). */
export function renderRecog(classes: ClassId[]): void {
  // Every class in three views; the convoy types in side view only
  const todo: { key: string; build: () => THREE.Group; views: RecogView[] }[] = classes
    .filter((c) => !cache.has(`${c}|side`))
    .map((c) => ({ key: c, build: () => shipModel(c), views: ['side', 'bow', 'top'] }));
  if (classes.includes('merchant')) {
    for (const [type] of CONVOY_TYPES) {
      if (!cache.has(`merchant~${type}|side`)) todo.push({ key: `merchant~${type}`, build: () => convoyModel(type), views: ['side'] });
    }
  }
  if (!todo.length) return;
  const canvas = document.createElement('canvas');
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
  } catch {
    return;
  }
  renderer.setPixelRatio(2);
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);
  const water = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.05);
  const mat = new THREE.MeshLambertMaterial({ color: 0xa9c2ba, clippingPlanes: [water], side: THREE.DoubleSide });
  const scene = new THREE.Scene();
  scene.overrideMaterial = mat;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404848, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-40, 90, 60);
  scene.add(sun);
  for (const item of todo) {
    const g = item.build();
    clean(g);
    scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    const top = Math.max(2, box.max.y);
    const len = box.max.z - box.min.z;
    const beam = box.max.x - box.min.x;
    const midZ = (box.max.z + box.min.z) / 2;
    for (const view of item.views) {
      const [w, h] = VIEW_SIZE[view];
      renderer.setSize(w, h, false);
      // Ortho frame: the object fills the picture with a margin, waterline at 11 % from the bottom
      const needH = (top * 1.1) / 0.89 / 2;
      const halfH = view === 'top' ? Math.max(len * 0.54 * (h / w), beam * 0.6) : Math.max((view === 'bow' ? beam * 0.65 : len * 0.54) * (h / w), needH);
      const halfW = (halfH * w) / h;
      const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 2000);
      const cy = halfH * 0.78;
      if (view === 'side') {
        cam.position.set(-600, cy, midZ);
        cam.lookAt(0, cy, midZ);
      } else if (view === 'bow') {
        cam.position.set(0, cy, 600);
        cam.lookAt(0, cy, 0);
      } else {
        cam.up.set(1, 0, 0);
        cam.position.set(0, 600, midZ);
        cam.lookAt(0, 0, midZ);
      }
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      cache.set(`${item.key}|${view}`, canvas.toDataURL('image/png'));
    }
    scene.remove(g);
    g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
  mat.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  save();
}
