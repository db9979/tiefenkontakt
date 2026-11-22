import { deflateSync } from 'node:zlib';

/**
 * Header picture for account mails, drawn procedurally (no image file, no native code):
 * a sonar PPI scope with sweep, range rings and contacts, next to a broadband waterfall,
 * with phosphor glow, scanlines and vignette. Encoded as PNG once and cached.
 */

export const HEADER_W = 1200;
export const HEADER_H = 300;

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Minimal RGB PNG encoder. */
export function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Deterministic hash noise in [0, 1). */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const TAU = Math.PI * 2;
/** Phosphor green. */
const G = [93, 202, 165] as const;
const AMBER = [232, 195, 122] as const;

function headerPixels(): Uint8Array {
  const W = HEADER_W, H = HEADER_H;
  const px = new Uint8Array(W * H * 3);
  const cx = 170, cy = H / 2, R = 128;
  const sweep = (-50 * Math.PI) / 180; // sweep hand direction (screen angle)
  const blips = [[0.55, 0.9], [0.8, 2.6], [0.35, 4.1]] as const; // [range fraction, angle]
  // Contact traces in the waterfall: bearing column that wanders with time (row)
  const traces = [{ x: 0.22, drift: 0.04, w: 2.2, k: 1 }, { x: 0.47, drift: -0.02, w: 1.6, k: 0.8 }, { x: 0.71, drift: 0.07, w: 3, k: 1.2 }, { x: 0.86, drift: 0, w: 1.3, k: 0.5 }];
  const wf0 = 340, wf1 = W - 30, wfTop = 34, wfBot = H - 34;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Background: deep sea-green black with faint grid
      let r = 4, g = 14, b = 13;
      if (x % 40 === 0 || y % 40 === 0) { g += 6; b += 5; }
      let glow = 0;
      let amber = 0;
      // PPI scope
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d < R + 6) {
        if (d < R) {
          r = 2; g = 12; b = 10;
          const a = Math.atan2(dy, dx);
          // Afterglow behind the sweep hand (counter-clockwise trail)
          const behind = ((sweep - a) % TAU + TAU) % TAU;
          glow += Math.exp(-behind * 2.2) * 0.55;
          if (behind < 0.012) glow += 1;
          // Range rings and bearing spokes
          for (const rr of [R / 3, (2 * R) / 3]) if (Math.abs(d - rr) < 0.8) glow += 0.35;
          const spoke = ((a % (Math.PI / 6)) + Math.PI / 6) % (Math.PI / 6);
          if (Math.min(spoke, Math.PI / 6 - spoke) * d < 0.6) glow += 0.18;
          // Sea clutter near the centre, speckle everywhere
          glow += Math.max(0, 0.5 - d / R) * hash(x, y) * 0.5 + (hash(x + 7, y * 3) > 0.985 ? 0.25 : 0);
          for (const [f, ang] of blips) {
            const bx = cx + Math.cos(ang) * f * R, by = cy + Math.sin(ang) * f * R;
            const bd = Math.hypot(x - bx, y - by);
            const fade = Math.exp(-(((sweep - ang) % TAU + TAU) % TAU) * 0.6);
            glow += Math.exp(-bd * bd / 10) * (0.6 + 1.2 * fade);
          }
        }
        if (Math.abs(d - R) < 1.6) glow += 0.8; // bezel ring
        // Bearing ticks on the bezel
        const a2 = Math.atan2(dy, dx);
        const tick = ((a2 + TAU) % (TAU / 36));
        if (d > R && d < R + 6 && Math.min(tick, TAU / 36 - tick) * d < 0.9) glow += 0.5;
      }
      // Waterfall
      if (x >= wf0 && x <= wf1 && y >= wfTop && y <= wfBot) {
        const u = (x - wf0) / (wf1 - wf0);
        const t = (y - wfTop) / (wfBot - wfTop);
        let v = 0.08 + smooth(u * 140, t * 90) * 0.18 + hash(x, y) * 0.12;
        for (const tr of traces) {
          const tx = (tr.x + tr.drift * t + 0.006 * Math.sin(t * 9 + tr.x * 20)) * (wf1 - wf0);
          const dd = Math.abs(x - wf0 - tx);
          v += Math.exp(-dd * dd / (tr.w * tr.w)) * tr.k * (0.6 + 0.4 * smooth(t * 30, tr.x * 10));
        }
        // Newest rows (top) brightest; edges fade into the background
        v *= (1 - t * 0.55) * Math.min(1, u * 12, (1 - u) * 12, (y - wfTop) / 6, (wfBot - y) / 6);
        glow += v * 0.9;
        if (y === wfTop || y === wfBot) glow += 0.25;
      }
      // Amber bearing cursor on one trace, and a short marker under the scope
      if (x > wf0 && Math.abs(x - (wf0 + 0.71 * (wf1 - wf0))) < 0.8 && y < wfTop - 4 && y > wfTop - 16) amber += 0.9;
      // Phosphor glow mapping
      r += G[0] * glow * 0.75 + AMBER[0] * amber;
      g += G[1] * glow * 0.75 + AMBER[1] * amber;
      b += G[2] * glow * 0.75 + AMBER[2] * amber;
      // Scanlines and vignette
      const scan = y % 3 === 0 ? 0.78 : 1;
      const vx = x / W - 0.5, vy = y / H - 0.5;
      const vig = 1 - Math.min(0.55, (vx * vx * 0.9 + vy * vy * 1.6) * 1.1);
      const k = (y * W + x) * 3;
      px[k] = Math.min(255, r * scan * vig);
      px[k + 1] = Math.min(255, g * scan * vig);
      px[k + 2] = Math.min(255, b * scan * vig);
    }
  }
  return px;
}

let cached: Buffer | undefined;
/** The header PNG (1200 × 300, shown at 600 × 150). */
export function headerPng(): Buffer {
  return (cached ??= encodePng(HEADER_W, HEADER_H, headerPixels()));
}
