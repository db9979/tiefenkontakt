import { REGIONS, regionToGeo, type RegionId } from './regions.js';

/**
 * Bathymetry grids of the real sea areas: elevation (m, ETOPO: negative = below sea level) on a
 * regular latitude/longitude grid. Binary format (little endian): Float64 lat0, lon0, dLat, dLon;
 * Int32 nLat, nLon; then nLat·nLon Int16, row by row from the southern edge. The server loads
 * the files at start (apps/server/src/bathy-load.ts); the client fetches the one it needs
 * (/api/bathy/<id>). Until a grid is there, depthAt falls back to the procedural seabed.
 */

interface Grid { lat0: number; lon0: number; dLat: number; dLon: number; nLat: number; nLon: number; z: Int16Array }

const grids = new Map<RegionId, Grid>();
/** Coarse overview grids (about 3.7 km) for the chart zoomed far out. */
const wide = new Map<RegionId, Grid>();

export function parseGrid(buf: ArrayBuffer): Grid {
  const v = new DataView(buf);
  const lat0 = v.getFloat64(0, true), lon0 = v.getFloat64(8, true), dLat = v.getFloat64(16, true), dLon = v.getFloat64(24, true);
  const nLat = v.getInt32(32, true), nLon = v.getInt32(36, true);
  const z = new Int16Array(buf.slice(40, 40 + nLat * nLon * 2));
  if (z.length !== nLat * nLon) throw new Error('bathymetry grid truncated');
  return { lat0, lon0, dLat, dLon, nLat, nLon, z };
}

export function encodeGrid(g: Grid): ArrayBuffer {
  const buf = new ArrayBuffer(40 + g.z.length * 2);
  const v = new DataView(buf);
  v.setFloat64(0, g.lat0, true); v.setFloat64(8, g.lon0, true); v.setFloat64(16, g.dLat, true); v.setFloat64(24, g.dLon, true);
  v.setInt32(32, g.nLat, true); v.setInt32(36, g.nLon, true);
  new Int16Array(buf, 40).set(g.z);
  return buf;
}

export function registerGrid(id: RegionId, buf: ArrayBuffer, overview = false): void {
  (overview ? wide : grids).set(id, parseGrid(buf));
}

export const hasWideGrid = (id: RegionId) => wide.has(id);

export const hasGrid = (id: RegionId) => grids.has(id);

/** Bilinear sample of a grid; undefined outside it. `edge`: weight 0..1 that falls to 0 over the last cells. */
function sample(g: Grid, lat: number, lon: number): { z: number; edge: number } | undefined {
  const fi = (lat - g.lat0) / g.dLat;
  const fj = (lon - g.lon0) / g.dLon;
  if (fi < 0 || fj < 0 || fi > g.nLat - 1 || fj > g.nLon - 1) return undefined;
  const i = Math.min(g.nLat - 2, Math.floor(fi)), j = Math.min(g.nLon - 2, Math.floor(fj)), a = fi - i, b = fj - j;
  const at = (ii: number, jj: number) => g.z[Math.max(0, Math.min(g.nLat - 1, ii)) * g.nLon + Math.max(0, Math.min(g.nLon - 1, jj))]!;
  // Catmull-Rom in both directions: smooth slopes, so the relief shading shows no grid cells
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (ii: number) => cr(at(ii, j - 1), at(ii, j), at(ii, j + 1), at(ii, j + 2), b);
  const z = cr(row(i - 1), row(i), row(i + 1), row(i + 2), a);
  const m = Math.min(fi, fj, g.nLat - 1 - fi, g.nLon - 1 - fj);
  // Fade over the outer sixth of the grid, so its coast meets the coarser overview without a seam
  return { z, edge: Math.min(1, m / Math.max(4, Math.min(g.nLat, g.nLon) / 6)) };
}

/**
 * Real water depth (m, negative = land) at game x/y of a region: the fine grid around the route,
 * blending into the coarse overview toward its edge and beyond; undefined without data there.
 */
export function gridDepth(id: RegionId, x: number, y: number): number | undefined {
  const g = grids.get(id);
  if (!g) return undefined;
  const { lat, lon } = regionToGeo(REGIONS[id], x, y);
  const f = sample(g, lat, lon);
  const ww = wide.get(id);
  const c = ww ? sample(ww, lat, lon) : undefined;
  if (f && (f.edge >= 1 || !c)) return -f.z;
  if (f && c) return -(f.z * f.edge + c.z * (1 - f.edge));
  if (c) return -c.z;
  return undefined;
}
