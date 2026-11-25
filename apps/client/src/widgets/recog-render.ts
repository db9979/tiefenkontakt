import * as THREE from 'three';
import { RECOG_ORDER, type ClassId } from '@tk/shared';
import { convoyModel, shipModel } from './sea3d/models.js';
import { CONVOY_TYPES, type ConvoyType } from './sea3d/convoy-types.js';

/**
 * Silhouettes for the recognition book, rendered once from the real 3D models: side (bow to
 * the right), bow-on and top view, flat grey-green on the console background. Each picture is
 * cropped to the model in a known frame in metres (RecogMeta), so the book can lay every class
 * out at one common scale; side and bow come as two halves, above and below the waterline. One
 * short-lived WebGL context renders all of them; the images are cached as data URLs and kept
 * in localStorage per build, so later visits skip the rendering altogether.
 */

export type RecogView = 'side' | 'bow' | 'top';
/** Picture parts: the views above water, and side and bow below the waterline. */
export type RecogPart = RecogView | 'sideU' | 'bowU';

/** The model's extent (m, waterline y = 0, bow +z) and the margin around it in every picture. */
export interface RecogMeta {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  pad: number;
}

/** Build id from vite (a new build may change the models, so old pictures are dropped). */
declare const __BUILD_ID__: string;
const STORE = `tk_recog_v2_${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}`;
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

export function recogImage(cls: ClassId, part: RecogPart): string | undefined {
  return cache.get(`${cls}|${part}`);
}

export function recogMeta(cls: ClassId): RecogMeta | undefined {
  const m = cache.get(`${cls}|meta`);
  return m ? (JSON.parse(m) as RecogMeta) : undefined;
}

/** Side view of one convoy type (the convoy page shows them all). */
export function convoyImage(type: ConvoyType): string | undefined {
  return cache.get(`merchant~${type}|side`);
}

const PAD = 0.5;

/** Render every missing silhouette of these classes (synchronously, a few ms each). */
export function renderRecog(classes: ClassId[]): void {
  // Every class in all parts; the convoy types in side view only
  const todo: { key: string; build: () => THREE.Group; parts: RecogPart[] }[] = classes
    .filter((c) => !cache.has(`${c}|meta`))
    .map((c) => ({ key: c, build: () => shipModel(c), parts: ['side', 'sideU', 'bow', 'bowU', 'top'] }));
  if (classes.includes('merchant')) {
    for (const [type] of CONVOY_TYPES) {
      if (!cache.has(`merchant~${type}|side`)) todo.push({ key: `merchant~${type}`, build: () => convoyModel(type), parts: ['side'] });
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
  renderer.setPixelRatio(1);
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);
  const above = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.05);
  const below = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.05);
  const mat = new THREE.MeshLambertMaterial({ color: 0xa9c2ba, clippingPlanes: [above], side: THREE.DoubleSide });
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
    const meta: RecogMeta = { minX: box.min.x, maxX: box.max.x, minY: Math.min(0, box.min.y), maxY: Math.max(1, box.max.y), minZ: box.min.z, maxZ: box.max.z, pad: PAD };
    const len = meta.maxZ - meta.minZ;
    // Pixels per metre: about 560 px for the length, sharp enough when the book shrinks it
    const ppm = Math.min(14, Math.max(2, 560 / Math.max(1, len)));
    const zL = meta.minZ - PAD;
    const zR = meta.maxZ + PAD;
    const xL = meta.minX - PAD;
    const xR = meta.maxX + PAD;
    const yT = meta.maxY + PAD;
    const yB = meta.minY - PAD;
    for (const part of item.parts) {
      if ((part === 'sideU' || part === 'bowU') && meta.minY > -0.3) continue;
      const under = part === 'sideU' || part === 'bowU';
      mat.clippingPlanes = [under ? below : above];
      const [top, bottom] = under ? [0, yB] : [yT, 0];
      let cam: THREE.OrthographicCamera;
      let w: number;
      let h: number;
      if (part === 'side' || part === 'sideU') {
        // From port looking to starboard: +z (bow) to the right
        cam = new THREE.OrthographicCamera(zL, zR, top, bottom, 0.1, 2000);
        cam.position.set(-600, 0, 0);
        cam.lookAt(0, 0, 0);
        [w, h] = [(zR - zL) * ppm, (top - bottom) * ppm];
      } else if (part === 'bow' || part === 'bowU') {
        // From ahead: +x to the right
        cam = new THREE.OrthographicCamera(xL, xR, top, bottom, 0.1, 2000);
        cam.position.set(0, 0, 600);
        cam.lookAt(0, 0, 0);
        [w, h] = [(xR - xL) * ppm * 2, (top - bottom) * ppm * 2];
      } else {
        // From above, bow to the right, starboard (+x) up
        cam = new THREE.OrthographicCamera(zL, zR, xR, xL, 0.1, 2000);
        cam.up.set(1, 0, 0);
        cam.position.set(0, 600, 0);
        cam.lookAt(0, 0, 0);
        [w, h] = [(zR - zL) * ppm, (xR - xL) * ppm];
      }
      renderer.setSize(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)), false);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      cache.set(`${item.key}|${part}`, canvas.toDataURL('image/png'));
    }
    if (!item.key.includes('~')) cache.set(`${item.key}|meta`, JSON.stringify(meta));
    scene.remove(g);
    g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
  mat.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  save();
}
