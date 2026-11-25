import * as THREE from 'three';
import type { DeckMark } from './own-kit.js';

/**
 * Procedural non-skid deck for the own ship's foredeck (own-detail.ts): grey non-skid with
 * grain and aggregate speckle, worn walkways, plate seams, grime in the waterways and around
 * every fitting, rust below the hawse pipes, a painted centreline and safety circles. One
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

export function foredeckTexture(o: { W: number; z0: number; z1: number; half: (z: number) => number; marks: DeckMark[]; seed: number }): THREE.CanvasTexture {
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
  // Painted centreline (white, worn)
  x.strokeStyle = 'rgba(214,218,216,0.62)';
  x.lineWidth = 0.1 * ppm;
  x.setLineDash([]);
  x.beginPath();
  x.moveTo(X(0), Y(o.z0));
  x.lineTo(X(0), Y(o.z1 - 1.5));
  x.stroke();
  for (const mk of o.marks) {
    const px = X(mk.x);
    const py = Y(mk.z);
    const rr = mk.r * ppm;
    if (mk.kind === 'ring') {
      // Safety circle round a mount, painted white and dashed
      x.strokeStyle = 'rgba(214,218,216,0.55)';
      x.lineWidth = 0.08 * ppm;
      x.setLineDash([0.6 * ppm, 0.35 * ppm]);
      x.beginPath();
      x.arc(px, py, rr, 0, Math.PI * 2);
      x.stroke();
      x.setLineDash([]);
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
