import * as THREE from 'three';
import type { DeckMark } from './own-kit.js';

/**
 * Procedural non-skid deck for the own ship's foredeck (own-detail.ts): grey non-skid with
 * grain and aggregate speckle, worn walkways, plate seams, grime in the waterways and around
 * every fitting, rust below the hawse pipes, a painted centreline, scuppers and yellow training-limit arcs. One
 * canvas covers the deck from z0 to the bow (u across the full width W, v along); a small
 * tiling version of the grain serves the rest of the deck.
 */

const rng = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

/** Per-pixel grain and speckle over what is already painted. */
function grain(x: CanvasRenderingContext2D, w: number, h: number, r: () => number, amp: number): void {
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let n = (r() - 0.5) * amp;
    // Aggregate: sparse lighter and darker grains
    const s = r();
    if (s > 0.985) n += 22;
    else if (s < 0.012) n -= 26;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  x.putImageData(img, 0, 0);
}

export function foredeckTexture(o: { W: number; z0: number; z1: number; half: (z: number) => number; marks: DeckMark[]; seed: number; gap?: [number, number] }): THREE.CanvasTexture {
  const cw = 512;
  const ppm = cw / o.W;
  const ch = Math.min(2048, Math.round((o.z1 - o.z0) * ppm));
  const sy = ch / (o.z1 - o.z0);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const r = rng(o.seed);
  const X = (m: number) => cw / 2 + m * ppm;
  const Y = (z: number) => (o.z1 - z) * sy;
  x.fillStyle = '#5e6366';
  x.fillRect(0, 0, cw, ch);
  // Cloudy unevenness of the coating
  for (let i = 0; i < 90; i++) {
    const px = r() * cw;
    const py = r() * ch;
    const rr = (1 + r() * 4) * ppm;
    const g = x.createRadialGradient(px, py, 0, px, py, rr);
    const light = r() > 0.5;
    g.addColorStop(0, light ? 'rgba(150,156,158,0.10)' : 'rgba(20,24,26,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  // Worn walkways: either side of the centreline and inboard of the rails, lighter and smoother
  x.lineCap = 'round';
  for (const m of [-1, 1]) {
    x.strokeStyle = 'rgba(160,165,166,0.07)';
    x.lineWidth = 0.9 * ppm;
    x.beginPath();
    for (let z = o.z0; z < o.z1 - 4; z += 1) {
      const xx = m * Math.max(0, o.half(z) - 1.1);
      if (z === o.z0) x.moveTo(X(xx), Y(z));
      else x.lineTo(X(xx), Y(z));
    }
    x.stroke();
  }
  // Plate seams: butts across every 2.4 m, a longitudinal seam either side
  x.strokeStyle = 'rgba(25,28,30,0.28)';
  x.lineWidth = 1;
  for (let z = Math.ceil(o.z0 / 2.4) * 2.4; z < o.z1; z += 2.4) {
    const hw = o.half(z);
    x.beginPath();
    x.moveTo(X(-hw), Y(z));
    x.lineTo(X(hw), Y(z));
    x.stroke();
  }
  for (const m of [-1.8, 1.8]) {
    x.beginPath();
    x.moveTo(X(m), Y(o.z0));
    x.lineTo(X(m), Y(o.z1 - 6));
    x.stroke();
  }
  // Grime in the waterways along the deck edge
  for (const [wdt, a] of [[1.2, 0.14], [0.45, 0.3]] as const) {
    x.strokeStyle = `rgba(22,24,24,${a})`;
    x.lineWidth = wdt * ppm;
    for (const m of [-1, 1]) {
      x.beginPath();
      for (let z = o.z0; z <= o.z1; z += 0.5) {
        const xx = m * o.half(z);
        if (z === o.z0) x.moveTo(X(xx), Y(z));
        else x.lineTo(X(xx), Y(z));
      }
      x.stroke();
    }
  }
  // Scuppers in the waterways every 3 m: dark slots with a short wet streak below them
  for (let z = Math.ceil(o.z0 / 3) * 3; z < o.z1 - 3; z += 3) for (const m of [-1, 1]) {
    const ex = X(m * (o.half(z) - 0.08));
    x.fillStyle = 'rgba(8,10,10,0.8)';
    x.fillRect(ex - 0.08 * ppm, Y(z) - 0.2 * ppm, 0.16 * ppm, 0.4 * ppm);
    x.fillStyle = 'rgba(20,22,22,0.18)';
    x.fillRect(ex - m * 0.5 * ppm - 0.25 * ppm, Y(z) - 0.15 * ppm, 0.5 * ppm, 0.3 * ppm);
  }
  // Painted centreline (white, worn)
  x.strokeStyle = 'rgba(214,218,216,0.62)';
  x.lineWidth = 0.1 * ppm;
  x.setLineDash([]);
  // (not under a gun barrel, where it would read as one)
  const [g0, g1] = o.gap ?? [o.z1, o.z1];
  for (const [a, b] of [[o.z0, g0], [g1, o.z1 - 1.5]] as const) {
    if (b <= a) continue;
    x.beginPath();
    x.moveTo(X(0), Y(a));
    x.lineTo(X(0), Y(b));
    x.stroke();
  }
  for (const mk of o.marks) {
    const px = X(mk.x);
    const py = Y(mk.z);
    const rr = mk.r * ppm;
    if (mk.kind === 'arc') {
      // Training limit of a mount: a thin yellow arc, open astern (toward the bridge)
      x.strokeStyle = 'rgba(201,160,44,0.6)';
      x.lineWidth = 0.06 * ppm;
      x.beginPath();
      x.arc(px, py, rr, Math.PI / 2 + 0.75, Math.PI / 2 - 0.75 + Math.PI * 2);
      x.stroke();
      continue;
    }
    if (mk.kind === 'line') {
      x.strokeStyle = 'rgba(214,218,216,0.55)';
      x.lineWidth = mk.r * ppm;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(X(mk.x1 ?? mk.x), Y(mk.z1 ?? mk.z));
      x.stroke();
      continue;
    }
    const col = mk.kind === 'rust' ? '84,56,40' : mk.kind === 'wear' ? '150,154,155' : '18,20,21';
    const a = mk.kind === 'rust' ? 0.5 : mk.kind === 'wear' ? 0.12 : 0.42;
    const g = x.createRadialGradient(px, py, rr * 0.15, px, py, rr * 1.5);
    g.addColorStop(0, `rgba(${col},${a})`);
    g.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g;
    x.fillRect(px - rr * 1.6, py - rr * 1.6, rr * 3.2, rr * 3.2);
    if (mk.kind === 'rust') {
      // Rust run outboard and aft (camber and the ship's trim carry the water)
      const out = Math.sign(mk.x) || 1;
      for (let i = 0; i < 5; i++) {
        x.strokeStyle = `rgba(${col},${0.12 + r() * 0.16})`;
        x.lineWidth = (0.05 + r() * 0.08) * ppm;
        x.beginPath();
        x.moveTo(px + (r() - 0.5) * rr, py);
        x.quadraticCurveTo(px + out * rr * (1 + r()), py + rr * (0.5 + r()), px + out * rr * (1.5 + r() * 1.5), py + rr * (1.5 + r() * 2.5));
        x.stroke();
      }
    }
  }
  grain(x, cw, ch, r, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Small tiling non-skid for the rest of the deck (repeat every 3 m). */
export function deckTile(seed: number): THREE.CanvasTexture {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#5b6063';
  x.fillRect(0, 0, n, n);
  grain(x, n, n, rng(seed), 18);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Open-bridge deck (own-bridge.ts): painted non-skid steel over the wheelhouse roof and the
 * wings, mapped once over the whole deck (u across from −wing to +wing, v from the after edge
 * z0 to the front zf). Welded plate seams where the wings join the roof and across them, a
 * darker waterway along the foot of the bulwark with rust-stained drain holes, worn paths
 * from the ladder well out to the wings and where the lookouts stand.
 */
export function bridgeDeckTexture(o: { wing: number; hw: number; z0: number; zf: number; spots: [number, number][]; seed: number }): THREE.CanvasTexture {
  const W = 2 * o.wing;
  const D = o.zf - o.z0;
  const cw = 1024;
  const ppm = cw / W;
  const ch = Math.round(D * ppm);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const r = rng(o.seed);
  const X = (m: number) => (m + o.wing) * ppm;
  const Y = (z: number) => (o.zf - z) * ppm;
  x.fillStyle = '#545b5e';
  x.fillRect(0, 0, cw, ch);
  // Patchy coating: touched-up areas a shade off
  for (let i = 0; i < 40; i++) {
    const px = r() * cw;
    const py = r() * ch;
    const rr = (0.4 + r() * 1.4) * ppm;
    const g = x.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, r() > 0.5 ? 'rgba(140,148,150,0.10)' : 'rgba(18,22,24,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  // Worn paths: from the ladder well (aft, middle) out to both wings, along the front, and where the lookouts stand
  x.lineCap = 'round';
  for (const [wd, a] of [[1.1, 0.05], [0.6, 0.06]] as const) {
    x.strokeStyle = `rgba(165,170,170,${a})`;
    x.lineWidth = wd * ppm;
    for (const m of [-1, 1]) {
      x.beginPath();
      x.moveTo(X(0), Y(o.z0 + 0.3));
      x.quadraticCurveTo(X(m * o.hw * 0.6), Y(o.z0 + D * 0.55), X(m * (o.wing - 1.0)), Y(o.z0 + D * 0.6));
      x.stroke();
    }
    x.beginPath();
    x.moveTo(X(-o.wing + 1), Y(o.zf - 0.8));
    x.lineTo(X(o.wing - 1), Y(o.zf - 0.8));
    x.stroke();
  }
  for (const [sx, sz] of o.spots) {
    const g = x.createRadialGradient(X(sx), Y(sz), 0, X(sx), Y(sz), 0.8 * ppm);
    g.addColorStop(0, 'rgba(170,174,174,0.09)');
    g.addColorStop(1, 'rgba(170,174,174,0)');
    x.fillStyle = g;
    x.fillRect(X(sx) - ppm, Y(sz) - ppm, 2 * ppm, 2 * ppm);
  }
  // Welded seams: a dark line with a faint bead beside it
  const seam = (x0: number, z0: number, x1: number, z1: number) => {
    for (const [col, wd, d] of [['rgba(20,24,26,0.4)', 1.6, 0], ['rgba(150,156,158,0.18)', 1.2, 1.6]] as const) {
      x.strokeStyle = col;
      x.lineWidth = wd;
      x.beginPath();
      x.moveTo(X(x0) + d, Y(z0) + d);
      x.lineTo(X(x1) + d, Y(z1) + d);
      x.stroke();
    }
  };
  for (const m of [-1, 1]) {
    seam(m * o.hw, o.z0, m * o.hw, o.zf);
    for (let z = o.z0 + 1.8; z < o.zf - 0.5; z += 1.8) seam(m * o.hw, z, m * o.wing, z);
    seam(m * (o.hw + (o.wing - o.hw) / 2), o.z0, m * (o.hw + (o.wing - o.hw) / 2), o.zf);
  }
  seam(-o.hw, o.z0 + D * 0.5, o.hw, o.z0 + D * 0.5);
  seam(0, o.z0 + D * 0.5, 0, o.zf);
  // Waterway along the bulwark: darker and grimy, rust stains at the drain holes
  const edge: [number, number, number, number][] = [[-o.wing, o.zf, o.wing, o.zf]];
  for (const m of [-1, 1]) edge.push([m * o.wing, o.z0, m * o.wing, o.zf], [m * o.hw, o.z0, m * o.wing, o.z0]);
  for (const [wd, a] of [[0.34, 0.16], [0.14, 0.32]] as const) {
    x.strokeStyle = `rgba(16,18,18,${a})`;
    x.lineWidth = wd * 2 * ppm;
    for (const [x0, z0, x1, z1] of edge) {
      x.beginPath();
      x.moveTo(X(x0), Y(z0));
      x.lineTo(X(x1), Y(z1));
      x.stroke();
    }
  }
  for (const [x0, z0, x1, z1] of edge) for (const f of drains(Math.hypot(x1 - x0, z1 - z0))) {
    const px = X(x0 + (x1 - x0) * f);
    const py = Y(z0 + (z1 - z0) * f);
    const g = x.createRadialGradient(px, py, 0, px, py, 0.45 * ppm);
    g.addColorStop(0, 'rgba(96,60,36,0.5)');
    g.addColorStop(1, 'rgba(96,60,36,0)');
    x.fillStyle = g;
    x.fillRect(px - 0.45 * ppm, py - 0.45 * ppm, 0.9 * ppm, 0.9 * ppm);
  }
  // Scuffs: boot marks and darker smears
  for (let i = 0; i < 70; i++) {
    x.strokeStyle = `rgba(20,22,22,${0.05 + r() * 0.08})`;
    x.lineWidth = (0.03 + r() * 0.05) * ppm;
    const px = r() * cw;
    const py = r() * ch;
    const a = r() * Math.PI;
    const l = (0.1 + r() * 0.25) * ppm;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
    x.stroke();
  }
  grain(x, cw, ch, r, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Drain holes along a waterway of length len: fractions along it (about every 1.6 m). */
export function drains(len: number): number[] {
  const n = Math.max(1, Math.round(len / 1.6));
  return Array.from({ length: n }, (_, i) => (i + 0.5) / n);
}

/** Fine non-skid relief (bump map, tiles about every metre): grains of aggregate in the paint. */
export function nonSkidBump(seed: number): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const r = rng(seed);
  const img = x.createImageData(n, n);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const s = r();
    const v = 128 + (r() - 0.5) * 50 + (s > 0.93 ? 70 : s < 0.05 ? -50 : 0);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
