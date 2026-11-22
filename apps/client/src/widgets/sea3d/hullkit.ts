import * as THREE from 'three';

/**
 * Second-generation building blocks for ship and boat models:
 *  - loftHull: a real hull from stations (sheer, flare, raked stem, bulb, transom or cruiser
 *    stern, U/V sections) with a painted boot-top at the waterline and subtle weathering in
 *    vertex colours; returns deckAt(z) and halfBeamAt(z, y) so every fitting can be set
 *    exactly onto the deck or against the side (nothing may float).
 *  - lathe: bodies of revolution (submarine hulls, fuselages, funnels, domes).
 *  - railing, windowBand, hullNumber, mast, whip: small details that make a silhouette read.
 * Bow toward +z, waterline y = 0, port (left looking forward) = +x.
 */

export const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.15, ...o });

export const K = {
  navy: std(0x6b767c), navyDark: std(0x4d565b), deck: std(0x3d4244, { roughness: 0.95 }), black: std(0x1a1d1f, { roughness: 0.6 }),
  white: std(0xcfd4d4, { roughness: 0.7 }), glass: std(0x0a1013, { roughness: 0.15, metalness: 0.6 }), sub: std(0x2a3135, { roughness: 0.55, metalness: 0.2 }),
  rubber: std(0x15181a, { roughness: 0.95 }), orange: std(0xd8732e, { roughness: 0.6 }), steel: std(0x8b9499, { roughness: 0.5, metalness: 0.5 }),
};

export interface HullSpec {
  len: number;
  beam: number;
  /** Freeboard amidships (deck height above the waterline). */
  freeboard: number;
  draft: number;
  /** Extra deck height at the bow / stern (sheer). */
  sheerBow?: number;
  sheerStern?: number;
  /** How far the stem rakes forward from the waterline to the deck (m). */
  rake?: number;
  /** Outward flare of the topsides toward the deck (0 = wall sided, 0.15 = strong). */
  flare?: number;
  /** 0 fine (warship) … 1 full (tanker): length of the parallel mid-body and bow fullness. */
  fullness?: number;
  /** Width of the transom relative to the beam (cruiser stern ≈ 0.25). */
  transom?: number;
  /** Section shape: 0 = slack V, 1 = full U. */
  bilge?: number;
  bulb?: boolean;
  colors: { top: number; boot: number; bottom: number };
  /** Boot-top band from y0 to y1 around the waterline. */
  boot?: [number, number];
}

export interface Hull {
  /** Deck height at a station (z). */
  deckAt(z: number): number;
  /** Half breadth of the hull at station z and height y (y at or below the deck). */
  halfBeamAt(z: number, y: number): number;
  spec: HullSpec;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Half breadth at the waterline as a fraction of beam/2, by position t (0 stern … 1 bow). */
function planform(t: number, s: HullSpec): number {
  const full = s.fullness ?? 0.3;
  const tr = s.transom ?? 0.8;
  const aft = 0.12 + 0.1 * full;
  const fwd = 0.45 + 0.35 * full;
  if (t < aft) return tr + (1 - tr) * Math.sin((t / aft) * Math.PI / 2);
  if (t <= fwd) return 1;
  const u = (t - fwd) / (1 - fwd);
  return Math.pow(Math.max(0, 1 - u * u), 0.55 + 0.4 * full);
}

/** Section width factor at height fraction h (0 keel … 1 deck). */
function section(h: number, s: HullSpec, hWl: number): number {
  const bilge = s.bilge ?? 0.5;
  const flare = s.flare ?? 0.06;
  if (h >= hWl) return 1 + flare * ((h - hWl) / (1 - hWl));
  const k = h / hWl;
  // U sections round out quickly, V sections widen linearly
  const u = Math.sin((k * Math.PI) / 2);
  return 0.12 + 0.88 * (u * bilge + k * (1 - bilge));
}

export function loftHull(g: THREE.Object3D, s: HullSpec): Hull {
  const N = 48;
  const M = 9;
  const L = s.len / 2;
  const B = s.beam / 2;
  const rake = s.rake ?? s.freeboard * 1.2;
  const deckAt = (z: number) => {
    const t = Math.min(1, Math.max(0, (z + L) / s.len));
    return s.freeboard + (s.sheerBow ?? s.freeboard * 0.35) * Math.pow(t, 3) + (s.sheerStern ?? 0) * Math.pow(1 - t, 4);
  };
  const ht = (z: number) => deckAt(z) + s.draft;
  const hWl = (z: number) => s.draft / ht(z);
  const halfAt = (t: number, y: number, z: number) => B * planform(t, s) * section((y + s.draft) / ht(z), s, hWl(z));
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const cTop = new THREE.Color(s.colors.top);
  const cBoot = new THREE.Color(s.colors.boot);
  const cBot = new THREE.Color(s.colors.bottom);
  const [b0, b1] = s.boot ?? [-0.4, 0.6];
  const rng = (i: number) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
  // Section rings, port deck edge → keel → starboard deck edge; extra rows at the boot-top edges
  const heights = (z: number): number[] => {
    const top = deckAt(z);
    const hs = [-s.draft];
    for (let j = 1; j < M; j++) hs.push(-s.draft + (top + s.draft) * (j / M));
    hs.push(b0, b0 + 0.001, b1, b1 + 0.001, top);
    return [...new Set(hs)].filter((y) => y <= top).sort((a, b) => a - b);
  };
  const rings: number[][] = [];
  let vi = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let z = -L + t * s.len;
    const hs = heights(z);
    const ring: number[] = [];
    // starboard (−x) from deck down to keel, then port (+x) back up
    const side = (sx: number, ys: number[]) => {
      for (const y of ys) {
        // Raked stem: the lower part of the bow stations is pulled aft
        const hf = (y + s.draft) / ht(z);
        const zz = t > 0.9 ? z - rake * (1 - hf) * smooth(0.9, 1, t) : z;
        let w = halfAt(t, y, z);
        if (s.bulb && t > 0.93 && y < -s.draft * 0.3) w = Math.max(w, B * 0.12 * (1 - Math.abs(y + s.draft * 0.65) / (s.draft * 0.4)));
        pos.push(sx * w, y, zz);
        const c = y < b0 ? cBot : y <= b1 ? cBoot : cTop;
        // Weathering: slightly darker streaks below the deck edge, never on the boot-top
        const dirt = y > b1 ? 1 - 0.07 * Math.abs(rng(i * 31 + Math.round(y * 3))) : 1;
        col.push(c.r * dirt, c.g * dirt, c.b * dirt);
        ring.push(vi++);
      }
    };
    side(-1, [...hs].reverse());
    side(1, hs.slice(1));
    rings.push(ring);
    void z;
  }
  // Skin between rings (rings can differ in count near the ends: connect by fraction)
  for (let i = 0; i < N; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    const n = Math.max(a.length, b.length);
    for (let k = 0; k < n - 1; k++) {
      const a0 = a[Math.round((k / (n - 1)) * (a.length - 1))]!;
      const a1 = a[Math.round(((k + 1) / (n - 1)) * (a.length - 1))]!;
      const b0i = b[Math.round((k / (n - 1)) * (b.length - 1))]!;
      const b1i = b[Math.round(((k + 1) / (n - 1)) * (b.length - 1))]!;
      if (a0 !== a1) idx.push(a0, b0i, a1);
      if (b0i !== b1i) idx.push(a1, b0i, b1i);
    }
  }
  // Transom: fan from the stern ring's centre
  const stern = rings[0]!;
  const cIdx = vi++;
  pos.push(0, deckAt(-L) * 0.5 - s.draft * 0.3, -L);
  col.push(cTop.r, cTop.g, cTop.b);
  for (let k = 0; k < stern.length - 1; k++) idx.push(cIdx, stern[k + 1]!, stern[k]!);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const hullMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.12, side: THREE.DoubleSide }));
  hullMesh.name = 'hull';
  g.add(hullMesh);
  // Deck: strip between the two deck edges of every station
  const dpos: number[] = [];
  const didx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -L + t * s.len;
    const y = deckAt(z);
    const w = halfAt(t, y, z) * 0.995;
    dpos.push(-w, y + 0.02, z, w, y + 0.02, z);
    if (i < N) didx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  dgeo.setIndex(didx);
  dgeo.computeVertexNormals();
  const deck = new THREE.Mesh(dgeo, K.deck);
  deck.name = 'deck';
  g.add(deck);
  return {
    spec: s,
    deckAt,
    halfBeamAt: (z: number, y: number) => halfAt(Math.min(1, Math.max(0, (z + L) / s.len)), Math.min(y, deckAt(z)), z),
  };
}

/**
 * Body of revolution about the z axis from [radius, z] points ordered by increasing z (stern →
 * bow); faces point outward. For upright parts (turrets, domes, funnels) use LatheGeometry
 * directly about y.
 */
export function lathe(g: THREE.Object3D, profile: [number, number][], m: THREE.Material, segments = 20): THREE.Mesh {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(0.001, r), z));
  const geo = new THREE.LatheGeometry(pts, segments);
  // Lathe turns about y: a proper rotation (no mirroring) puts profile height onto +z
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m);
  g.add(mesh);
  return mesh;
}

/** Deck-edge railing on both sides between z0 and z1 (thin lines, cheap). */
export function railing(g: THREE.Object3D, h: Hull, z0: number, z1: number, height = 1.1, inset = 0.25): void {
  const pts: number[] = [];
  const step = 2.5;
  for (const sx of [-1, 1]) {
    let prev: [number, number, number] | undefined;
    for (let z = z0; z <= z1 + 0.01; z += step) {
      const y = h.deckAt(z);
      const x = sx * (h.halfBeamAt(z, y) - inset);
      pts.push(x, y, z, x, y + height, z);
      if (prev) pts.push(prev[0], prev[1] + height, prev[2], x, y + height, z, prev[0], prev[1] + height * 0.5, prev[2], x, y + height * 0.5, z);
      prev = [x, y, z];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9aa3a8 })));
}

/** Dark window band on a box face: x side (±1 or 0 for the front), centred at (x, y, z). */
export function windowBand(g: THREE.Object3D, w: number, h: number, x: number, y: number, z: number, facing: 'x+' | 'x-' | 'z+' | 'z-'): void {
  const geo = new THREE.PlaneGeometry(w, h);
  const m = new THREE.Mesh(geo, K.glass);
  m.position.set(x, y, z);
  if (facing === 'x+') m.rotation.y = Math.PI / 2;
  else if (facing === 'x-') m.rotation.y = -Math.PI / 2;
  else if (facing === 'z-') m.rotation.y = Math.PI;
  g.add(m);
}

/** Painted hull number on both bows (fictional pennants), placed flush against the side at z. */
export function hullNumber(g: THREE.Object3D, h: Hull, text: string, z: number, y: number, size = 2.4): void {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(0,0,0,0)';
  x.fillRect(0, 0, 256, 96);
  x.fillStyle = '#e9ecec';
  x.font = 'bold 72px Helvetica, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 52);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(size * 2.6, size), m);
    p.position.set(sx * (h.halfBeamAt(z, y + size / 2) + 0.15), y, z);
    p.renderOrder = 2;
    p.userData.keep = true;
    p.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(p);
  }
}

/** Tapered pole mast from y0 up by height, with optional yards (cross arms) at fractions of the height. */
export function mast(g: THREE.Object3D, x: number, y0: number, z: number, height: number, r0: number, yards: { at: number; span: number }[] = [], m: THREE.Material = K.navy): THREE.Group {
  const grp = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 0.45, r0, height, 8), m);
  pole.position.y = height / 2;
  grp.add(pole);
  for (const yd of yards) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(yd.span, 0.18, 0.18), m);
    a.position.y = height * yd.at;
    grp.add(a);
  }
  grp.position.set(x, y0, z);
  g.add(grp);
  return grp;
}

/** Thin whip antenna standing on a point. */
export function whip(g: THREE.Object3D, x: number, y0: number, z: number, height: number): void {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, height, 4), K.black);
  m.position.set(x, y0 + height / 2, z);
  g.add(m);
}
