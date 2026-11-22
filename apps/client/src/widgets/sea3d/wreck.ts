import * as THREE from 'three';
import type { WreckView } from '@tk/shared';
import { createAftermath, updateAftermath } from './aftermath.js';

/**
 * Damage on ships seen from the periscope or bridge: a struck ship lists and settles, fires
 * burn on deck with a smoke column (glowing at night), a sinking ship goes down by the bow or
 * the stern with a growing list, and leaves an oil slick with floating debris that stays for
 * minutes. Geometry and materials are shared; counts are capped.
 */

const MAX_FIRES = 6;
const MAX_SLICKS = 6;
/** How long the slick stays on the water (s). */
export const SLICK_S = 720;
const SINK_S = 120;

const flameGeo = new THREE.ConeGeometry(1, 1, 7, 1, true).translate(0, 0.5, 0);
const puffGeo = new THREE.SphereGeometry(1, 7, 5);
/** Soft round glow (radial gradient), drawn additively as a sprite. */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,170,80,1)');
  g.addColorStop(0.35, 'rgba(255,110,40,0.45)');
  g.addColorStop(1, 'rgba(255,80,20,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const outerMat = new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
const coreMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
let glowMat: THREE.SpriteMaterial | undefined;
const smokeMat = new THREE.MeshLambertMaterial({ color: 0x1e2022, transparent: true, opacity: 0.6, depthWrite: false });

interface Fire { g: THREE.Group; flames: THREE.Mesh[]; puffs: THREE.Mesh[]; glow: THREE.Sprite; len: number; deck: number }

/** Size of a ship model: length along z and deck height. */
function dims(g: THREE.Group): { len: number; deck: number } {
  const ud = g.userData as { dims?: { len: number; deck: number } };
  if (ud.dims) return ud.dims;
  const b = new THREE.Box3().setFromObject(g);
  ud.dims = { len: Math.max(10, b.max.z - b.min.z), deck: Math.max(2, Math.min(12, b.max.y * 0.35)) };
  return ud.dims;
}

function fireOf(ship: THREE.Group): Fire {
  const ud = ship.userData as { wreckFire?: Fire };
  if (ud.wreckFire) return ud.wreckFire;
  const g = new THREE.Group();
  g.name = 'wreckfire';
  const { len, deck } = dims(ship);
  const flames: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const o = new THREE.Mesh(flameGeo, outerMat);
    const c = new THREE.Mesh(flameGeo, coreMat);
    c.scale.set(0.5, 0.6, 0.5);
    o.add(c);
    o.position.set((i - 1) * 2.5, deck, (i - 1) * len * 0.08);
    flames.push(o);
    g.add(o);
  }
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(puffGeo, smokeMat);
    puffs.push(p);
    g.add(p);
  }
  glowMat ??= new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const glow = new THREE.Sprite(glowMat);
  glow.position.y = deck + 4;
  g.add(glow);
  ship.add(g);
  ud.wreckFire = { g, flames, puffs, glow, len, deck };
  return ud.wreckFire;
}

/**
 * Pose a ship from its damage: list (deg, + starboard down), trim (deg, + bow down) and
 * settling, plus fire and smoke. Returns the fire's strength for the scene light.
 */
export function applyWreck(ship: THREE.Group, w: WreckView | undefined, t: number, light: number, seed: number, burning: { n: number }): number {
  ship.rotation.order = 'YXZ';
  const list = ((w?.list ?? 0) * Math.PI) / 180;
  const trim = ((w?.trim ?? 0) * Math.PI) / 180;
  ship.rotation.x = trim;
  ship.rotation.z += list;
  ship.position.y -= (w?.settle ?? 0) * 4;
  const ud = ship.userData as { wreckFire?: Fire };
  const fire = w?.fire ?? 0;
  if (fire < 0.03 || burning.n >= MAX_FIRES) {
    if (ud.wreckFire) ud.wreckFire.g.visible = false;
    return 0;
  }
  burning.n++;
  const f = fireOf(ship);
  f.g.visible = true;
  f.flames.forEach((m, i) => {
    const flick = 0.7 + 0.3 * Math.sin(t * (8 + i) + seed + i) * Math.sin(t * 3.1 + i * 2);
    const h = (7 + i * 3) * (0.4 + 0.6 * fire) * flick;
    m.visible = i === 1 || fire > 0.3 + i * 0.1;
    m.scale.set(1 + fire * 1.2, Math.max(0.1, h), 1 + fire * 1.2);
  });
  // The smoke column leans downwind and grows with the fire
  f.puffs.forEach((p, i) => {
    const ph = (t * 0.08 + i / f.puffs.length + seed) % 1;
    p.position.set(ph * 18, f.deck + 6 + ph * 45 * (0.5 + fire), ph * 6);
    p.scale.setScalar((3 + ph * 14) * (0.5 + fire));
  });
  const night = 1 - light;
  // The glow only shows in the dark
  f.glow.visible = night > 0.3;
  f.glow.scale.setScalar(30 + 40 * fire);
  glowMat!.opacity = 0.7 * night * (0.85 + 0.15 * Math.sin(t * 6 + seed));
  outerMat.opacity = 0.45 + 0.35 * night;
  return fire;
}

/** A ship going down: list first, then by the bow or stern, deeper and deeper. */
export interface Sinking { g: THREE.Group; since: number; y0: number; dir: number; list: number; trim: number }

export function startSinking(g: THREE.Group, t: number, w: WreckView | undefined, seed: number): Sinking {
  const trim = w?.trim ?? 0;
  const dir = Math.abs(trim) > 0.5 ? Math.sign(trim) : seed % 2 < 1 ? 1 : -1;
  const list = w?.list ? Math.sign(w.list) : seed % 3 < 1.5 ? 1 : -1;
  g.rotation.order = 'YXZ';
  // Dead in the water: no wake or bow wave (they would tip up with the hull)
  for (const n of ['wake', 'bow', 'feather']) {
    const o = g.getObjectByName(n);
    if (o) o.visible = false;
  }
  return { g, since: t, y0: g.position.y, dir, list: (list * Math.PI) / 180, trim: (trim * Math.PI) / 180 };
}

/** Advance a sinking; false once she is gone. */
export function stepSinking(k: Sinking, t: number): boolean {
  const a = t - k.since;
  const len = dims(k.g).len;
  const lean = Math.min(1, a / 25);
  const plunge = Math.max(0, Math.min(1, (a - 18) / 90));
  k.g.rotation.z = k.list * (8 + 20 * lean);
  k.g.rotation.x = k.trim + k.dir * plunge * 0.7;
  // Settle while she lists, then tip up: the high end stands out of the water a while before she goes
  k.g.position.y = k.y0 - 1.5 * lean - plunge * len * 0.12 - Math.pow(plunge, 4) * (len * 0.6 + 30);
  const fire = k.g.getObjectByName('wreckfire');
  if (fire) fire.visible = a < 40;
  return a <= SINK_S;
}

/** Oil slick and debris where a ship went down, fixed in world coordinates. */
export interface Slick { g: THREE.Group; x: number; y: number; since: number; seed: number }

export function addSlick(list: Slick[], scene: THREE.Scene, x: number, y: number, t: number, seed: number): void {
  if (list.some((s) => Math.hypot(s.x - x, s.y - y) < 150)) return;
  if (list.length >= MAX_SLICKS) scene.remove(list.shift()!.g);
  const g = createAftermath(seed);
  scene.add(g);
  list.push({ g, x, y, since: t, seed });
}

/** Place slicks relative to the observer; drop old ones. */
export function updateSlicks(list: Slick[], scene: THREE.Scene, t: number, ownX: number, ownY: number, light: number): Slick[] {
  return list.filter((s) => {
    const age = t - s.since;
    if (age > SLICK_S) {
      scene.remove(s.g);
      return false;
    }
    const dx = s.x - ownX;
    const dy = s.y - ownY;
    const drop = (dx * dx + dy * dy) / (2 * 6_371_000);
    s.g.position.set(dx, -drop, -dy);
    // No new foam ring: the blast was earlier; oil, burning patches and debris remain
    updateAftermath(s.g, age + 10, t, light, s.seed);
    return true;
  });
}
