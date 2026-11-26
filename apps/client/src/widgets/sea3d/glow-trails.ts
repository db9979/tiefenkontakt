import * as THREE from 'three';
import type { GlowTrackView } from '@tk/shared';
import { waveHeight, type Waves } from './waves.js';

/**
 * Bioluminescence on the night sea, as the eye sees it from a bridge or periscope:
 *  - a sighted torpedo's track: a faint blue-green line on the water along its recent path;
 *  - a submerged boat's glow ("LEUCHTSPUR IM WASSER"): a pale soft smear where she stirs the sea.
 * Both lie on the water, so seen from 20 m at a mile or two they are foreshortened to a sliver
 * thinner than a pixel. They are drawn at least about as large as the eye resolves a faint light
 * (a soft band, never a hard line), and dimmed by the share they were enlarged, so a near glow and a
 * far one look about equally faint rather than the far one shining like a laser.
 */

const GLOW = new THREE.Color(0x6fe8c8);
/** Smallest band the eye still makes out as a smear at night (screen px): height and length. */
const MIN_V_PX = 8;
const MIN_L_PX = 12;
/** A torpedo track: a thin soft line, at least this tall on screen (px). */
const MIN_TRACK_PX = 3.5;
/** A torpedo's glowing wake is about this wide on the water (m). */
const TRACK_W = 6;

let softTex: THREE.Texture | undefined;
/** Soft elliptical spot, bright core fading to nothing at the rim (shared). */
function softSpot(): THREE.Texture {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 16, 0, 32, 16, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.setTransform(1, 0, 0, 0.5, 0, 8);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return (softTex = new THREE.CanvasTexture(c));
}

let bandTex: THREE.Texture | undefined;
/** Across a band: dark at both edges, bright in the middle (soft line, no hard rim). */
function softBand(): THREE.Texture {
  if (bandTex) return bandTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 32);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 32);
  return (bandTex = new THREE.CanvasTexture(c));
}

/** The glow sighting's model: a soft spot (sprite) the scene sizes every frame (styleGlowSighting). */
export function glowSightingModel(): THREE.Group {
  const g = new THREE.Group();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSpot(), color: GLOW, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.name = 'glow';
  g.add(sp);
  return g;
}

/**
 * Size and brightness of a boat's glow at this range: the smear (about 8 m wide, longer the faster
 * she goes) as foreshortened from the eye, but no smaller than the eye resolves, and dimmer by the
 * share it was enlarged (never below a quarter, so the far smear still reads).
 */
export function styleGlowSighting(g: THREE.Group, o: { range: number; rel: number; kn: number; eye: number; pxPerRad: number; light: number }): void {
  const sp = g.getObjectByName('glow') as THREE.Sprite | undefined;
  if (!sp) return;
  const len = 25 + 6 * Math.max(3, o.kn);
  const wid = 8;
  const along = Math.abs(Math.sin(o.rel));
  const across = Math.abs(Math.cos(o.rel));
  const r = Math.max(50, o.range);
  // Apparent extent (m at the target): length across the view, depth foreshortened by eye / range
  const physL = len * along + wid * across;
  const physV = (len * across + wid * along) * (o.eye / r);
  const mPerPx = r / o.pxPerRad;
  const L = Math.max(physL, MIN_L_PX * mPerPx);
  const V = Math.max(physV, MIN_V_PX * mPerPx);
  sp.scale.set(L, V, 1);
  // The model group is turned along the boat's course: undo that for the sprite's place (it is centred)
  sp.position.set(0, V * 0.45, 0);
  const grown = (physL * physV) / (L * V);
  const k = Math.max(0.28, Math.min(1, Math.sqrt(grown) * 1.6)) * Math.max(0, Math.min(1, (0.45 - o.light) / 0.3));
  (sp.material as THREE.SpriteMaterial).color.copy(GLOW).multiplyScalar(0.9 * k);
}

interface Track { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; view: GlowTrackView; seen: number }

/** Sighted torpedoes' glowing tracks on the sea: one soft ribbon each, rebuilt every frame (a few dozen vertices). */
export class GlowTracks {
  private tracks = new Map<string, Track>();
  private mat = new THREE.MeshBasicMaterial({ map: softBand(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });

  constructor(private scene: THREE.Scene) {}

  update(list: GlowTrackView[] | undefined, o: { own: { x: number; y: number }; cam: THREE.Vector3; waves: Waves; eye: number; pxPerRad: number; light: number; t: number }): void {
    const now = o.t;
    for (const v of list ?? []) {
      let tr = this.tracks.get(v.id);
      if (!tr) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        this.scene.add(mesh);
        this.tracks.set(v.id, (tr = { mesh, view: v, seen: now }));
      }
      tr.view = v;
      tr.seen = now;
    }
    const dark = Math.max(0, Math.min(1, (0.45 - o.light) / 0.3));
    for (const [id, tr] of this.tracks) {
      // Lost from sight: the glow dies away over a few seconds
      const fade = 1 - (now - tr.seen) / 4;
      if (fade <= 0 || dark <= 0) {
        this.scene.remove(tr.mesh);
        tr.mesh.geometry.dispose();
        this.tracks.delete(id);
        continue;
      }
      this.build(tr, o, fade * dark);
    }
  }

  private build(tr: Track, o: { own: { x: number; y: number }; cam: THREE.Vector3; waves: Waves; eye: number; pxPerRad: number }, k0: number): void {
    const p = tr.view.pts;
    const n = p.length / 2;
    if (n < 2) return;
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = p[2 * i]! - o.own.x;
      const z = -(p[2 * i + 1]! - o.own.y);
      const r = Math.max(30, Math.hypot(x - o.cam.x, z - o.cam.z));
      // Direction of the track here, against the line of sight: across the view it is a thin sliver
      const j = Math.min(n - 1, i + 1), h = Math.max(0, j - 1);
      const dx = p[2 * j]! - p[2 * h]!, dz = -(p[2 * j + 1]! - p[2 * h + 1]!);
      const dl = Math.hypot(dx, dz) || 1;
      const sinA = Math.abs((dx * (z - o.cam.z) - dz * (x - o.cam.x)) / (dl * r));
      const physV = (TRACK_W * sinA + 20 * (1 - sinA)) * (o.eye / r);
      const V = Math.max(physV, MIN_TRACK_PX * (r / o.pxPerRad));
      const y0 = waveHeight(o.waves, x, z) + 0.2;
      // Older water glows less and dies out at the tail; just behind the torpedo it glows brightest,
      // tapering into the head itself (no hard end)
      const u = i / (n - 1);
      const along = Math.min(1, u * 1.4) * Math.min(1, (1 - u) * 12 + 0.15);
      const k = k0 * tr.view.k * along * Math.max(0.3, Math.min(1, Math.sqrt(physV / V) * 1.8));
      // Colours are linear (the renderer encodes to sRGB): k as a perceived brightness
      const c = GLOW.clone().multiplyScalar(0.55 * Math.pow(k, 2.2));
      for (let s = 0; s < 2; s++) {
        const v = 2 * i + s;
        pos.set([x, y0 + (s ? V : -V * 0.3), z], v * 3);
        col.set([c.r, c.g, c.b], v * 3);
        uv.set([i / (n - 1), s], v * 2);
      }
      if (i > 0) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    }
    const g = tr.mesh.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
  }

  dispose(): void {
    for (const tr of this.tracks.values()) {
      this.scene.remove(tr.mesh);
      tr.mesh.geometry.dispose();
    }
    this.tracks.clear();
    this.mat.dispose();
  }
}
