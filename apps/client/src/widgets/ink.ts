/**
 * Light mode for the 2D displays without a CSS filter: every colour a 2D canvas is given
 * (fill, stroke, shadow, gradient stops, pixels put with putImageData) has its lightness
 * mirrored while hue and chroma stay: glowing green on black becomes dark green on paper.
 * Adding k = 1 − max − min to each channel does exactly that (the HSL lightness L becomes
 * 1 − L). Canvases marked .gl (WebGL) or .keep (optics, photos) are left as they are.
 */
let light = false;

/** Mirror the lightness of one colour; unknown formats pass through. */
export function ink(c: string): string {
  let v = cache.get(c);
  if (v === undefined) {
    v = convert(c);
    if (cache.size > 4000) cache.clear();
    cache.set(c, v);
  }
  return v;
}
const cache = new Map<string, string>();

const NAMED: Record<string, [number, number, number]> = { black: [0, 0, 0], white: [255, 255, 255] };

function convert(c: string): string {
  const s = c.trim().toLowerCase();
  let r: number, g: number, b: number, a: string | undefined;
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    const full = hex.length <= 4 ? hex.split('').map((x) => x + x).join('') : hex;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
    if (full.length === 8) a = String(Math.round((parseInt(full.slice(6, 8), 16) / 255) * 1000) / 1000);
  } else if (s.startsWith('rgb')) {
    const n = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')).split(/[\s,/]+/).filter(Boolean);
    [r, g, b] = n.slice(0, 3).map(Number) as [number, number, number];
    a = n[3];
  } else if (NAMED[s]) {
    [r, g, b] = NAMED[s]!;
  } else return c;
  if ([r, g, b].some((x) => !Number.isFinite(x))) return c;
  const k = 255 - Math.max(r, g, b) - Math.min(r, g, b);
  const [R, G, B] = [r + k, g + k, b + k].map((x) => Math.round(Math.max(0, Math.min(255, x))));
  return a === undefined ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${a})`;
}

/** Mirror the lightness of RGBA pixels in place. */
export function inkPixels(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    const k = 255 - (r > g ? (r > b ? r : b) : g > b ? g : b) - (r < g ? (r < b ? r : b) : g < b ? g : b);
    d[i] = r + k;
    d[i + 1] = g + k;
    d[i + 2] = b + k;
  }
}

/** True when this 2D context draws in light-mode ink. */
export function inkOn(ctx: CanvasRenderingContext2D): boolean {
  if (!light) return false;
  const cl = (ctx.canvas as HTMLCanvasElement).classList;
  return !cl || !(cl.contains('gl') || cl.contains('keep'));
}

export const isInkLight = (): boolean => light;

/** Switch the canvases' ink; displays that cache a picture listen for 'tk-ink'. */
export function setInkLight(on: boolean): void {
  if (on === light) return;
  light = on;
  window.dispatchEvent(new Event('tk-ink'));
}

const inked = new WeakSet<CanvasGradient>();

function install(): void {
  if (typeof CanvasRenderingContext2D === 'undefined') return;
  const P = CanvasRenderingContext2D.prototype;
  for (const prop of ['fillStyle', 'strokeStyle', 'shadowColor'] as const) {
    const d = Object.getOwnPropertyDescriptor(P, prop);
    if (!d?.set || !d.get) continue;
    Object.defineProperty(P, prop, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set(this: CanvasRenderingContext2D, v: unknown) {
        d.set!.call(this, typeof v === 'string' && inkOn(this) ? ink(v) : v);
      },
    });
  }
  for (const m of ['createLinearGradient', 'createRadialGradient', 'createConicGradient'] as const) {
    const orig = P[m] as (...a: number[]) => CanvasGradient;
    if (!orig) continue;
    (P as unknown as Record<string, unknown>)[m] = function (this: CanvasRenderingContext2D, ...a: number[]) {
      const g = orig.apply(this, a);
      if (inkOn(this)) inked.add(g);
      return g;
    };
  }
  const stop = CanvasGradient.prototype.addColorStop;
  CanvasGradient.prototype.addColorStop = function (this: CanvasGradient, o: number, c: string) {
    stop.call(this, o, inked.has(this) ? ink(c) : c);
  };
  const put = P.putImageData;
  P.putImageData = function (this: CanvasRenderingContext2D, img: ImageData, ...rest: number[]) {
    if (!inkOn(this)) return (put as (...a: unknown[]) => void).call(this, img, ...rest);
    const copy = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    inkPixels(copy.data);
    (put as (...a: unknown[]) => void).call(this, copy, ...rest);
  } as typeof P.putImageData;
}
install();
