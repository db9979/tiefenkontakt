import type { NeutralClass } from './classes.js';
import type { Vec2 } from './math.js';
import { REGIONS, type RegionId } from './regions.js';
import { hasGrid } from './bathymetry.js';
import { depthAt, type SeabedSpec } from './seabed.js';

/**
 * Real traffic of the sea areas: the separation schemes and through routes the big ships
 * follow, the ferries shuttling across, and the banks where the trawlers work. Points are
 * latitude/longitude; the sim turns them into the map frame of the area.
 */

export interface Lane {
  name: string;
  pts: [number, number][];
  mix: Partial<Record<NeutralClass, number>>;
  /** Ferries turn round at the ends; through traffic leaves. */
  shuttle?: boolean;
}
export interface Ground { lat: number; lon: number; rKm: number }

const THROUGH = { tanker: 3, container: 3, schlepper: 0.5 };
const COASTAL = { container: 1, tanker: 1, schlepper: 1 };
const FERRY = { faehre: 1 };

export const LANES: Partial<Record<RegionId, Lane[]>> = {
  gibraltar: [
    { name: 'Verkehrstrennung westwärts', pts: [[35.99, -5.35], [35.985, -5.6], [35.96, -5.85], [35.95, -6.15]], mix: THROUGH },
    { name: 'Verkehrstrennung ostwärts', pts: [[35.9, -6.15], [35.925, -5.85], [35.935, -5.6], [35.94, -5.35]], mix: THROUGH },
    { name: 'Fähre Tarifa–Tanger', pts: [[36.0, -5.61], [35.79, -5.8]], mix: FERRY, shuttle: true },
  ],
  messina: [
    { name: 'Durchgangsweg', pts: [[38.32, 15.66], [38.24, 15.63], [38.15, 15.6], [37.98, 15.55]], mix: { ...COASTAL, faehre: 0.5 } },
    { name: 'Fähre Messina–Villa San Giovanni', pts: [[38.19, 15.57], [38.21, 15.63]], mix: FERRY, shuttle: true },
  ],
  dardanellen: [
    { name: 'Fahrwasser der Dardanellen', pts: [[40.36, 26.7], [40.2, 26.43], [40.13, 26.38], [40.05, 26.27], [39.97, 26.14]], mix: THROUGH },
    { name: 'Fähre Çanakkale–Eceabat', pts: [[40.15, 26.41], [40.18, 26.36]], mix: FERRY, shuttle: true },
  ],
  pentland: [
    { name: 'Durchfahrt Pentland Firth', pts: [[58.7, -2.6], [58.7, -3.1], [58.67, -3.5]], mix: COASTAL },
    { name: 'Fähre Gills Bay–St Margaret\'s Hope', pts: [[58.64, -3.16], [58.83, -2.96]], mix: FERRY, shuttle: true },
  ],
  clyde: [
    { name: 'Fahrwasser Firth of Clyde', pts: [[55.55, -5.0], [55.75, -4.92], [55.95, -4.8]], mix: COASTAL },
    { name: 'Fähre Gourock–Dunoon', pts: [[55.96, -4.82], [55.95, -4.92]], mix: FERRY, shuttle: true },
  ],
  kola: [{ name: 'Fahrwasser der Kolabucht', pts: [[69.47, 33.68], [69.3, 33.55], [69.1, 33.38]], mix: COASTAL }],
  nordkap: [{ name: 'Küstenroute Nordkap', pts: [[71.15, 23.0], [71.25, 25.6], [71.05, 28.0]], mix: { ...COASTAL, faehre: 1 } }],
  vestfjord: [
    { name: 'Fahrwasser nach Narvik', pts: [[67.7, 13.6], [68.0, 14.6], [68.3, 15.7]], mix: COASTAL },
    { name: 'Fähre Bodø–Moskenes', pts: [[67.29, 14.38], [67.9, 13.05]], mix: FERRY, shuttle: true },
  ],
  ofotfjord: [{ name: 'Fahrwasser nach Narvik', pts: [[68.3, 16.3], [68.4, 16.9], [68.43, 17.4]], mix: COASTAL }],
  bornholm: [
    { name: 'Bornholmsgat', pts: [[55.3, 13.9], [55.33, 14.6], [55.4, 15.7], [55.6, 16.8]], mix: THROUGH },
    { name: 'Fähre Rønne–Ystad', pts: [[55.1, 14.69], [55.42, 13.83]], mix: FERRY, shuttle: true },
  ],
  gotland: [{ name: 'Ostsee-Hauptweg', pts: [[56.6, 18.9], [57.4, 19.6], [58.3, 20.3]], mix: THROUGH }],
  finnbusen: [
    { name: 'Fahrwasser Finnischer Meerbusen', pts: [[59.6, 23.6], [59.78, 25.2], [59.95, 26.8]], mix: THROUGH },
    { name: 'Fähre Helsinki–Tallinn', pts: [[60.15, 24.96], [59.45, 24.77]], mix: FERRY, shuttle: true },
  ],
  fladengrund: [{ name: 'Nordsee-Route', pts: [[57.6, 1.6], [58.4, 0.9], [59.3, 0.3]], mix: { ...THROUGH, schlepper: 1.5 } }],
  faeroeshetland: [{ name: 'Route Färöer–Shetland', pts: [[61.8, -6.0], [61.2, -3.5], [60.6, -1.2]], mix: COASTAL }],
};

export const GROUNDS: Partial<Record<RegionId, Ground[]>> = {
  faroebank: [{ lat: 60.9, lon: -8.2, rKm: 15 }],
  fladengrund: [{ lat: 58.4, lon: 0.8, rKm: 20 }],
  barents: [{ lat: 74.4, lon: 22.5, rKm: 20 }],
  vestfjord: [{ lat: 68.1, lon: 14.4, rKm: 15 }],
  nordkap: [{ lat: 71.4, lon: 26.0, rKm: 15 }],
  islandfaroe: [{ lat: 63.6, lon: -10.0, rKm: 20 }],
};

const M_LAT = 110_574;
const M_LON = 111_320;

/** Latitude/longitude to the map frame of an area (inverse of regionToGeo). */
export function geoToRegion(id: RegionId, lat: number, lon: number): Vec2 {
  const r = REGIONS[id];
  const north = (lat - r.lat) * M_LAT;
  const east = (lon - r.lon) * M_LON * Math.cos((r.lat * Math.PI) / 180);
  const b = (r.bearing * Math.PI) / 180;
  return { x: east * Math.cos(b) - north * Math.sin(b), y: east * Math.sin(b) + north * Math.cos(b) };
}

const routed = new Map<RegionId, (Lane & { xy: Vec2[] })[]>();

/**
 * The lanes of an area in map coordinates, led over water: each leg is searched on the chart
 * (500 m cells, at least 15 m of water, shallows avoided), so a ship never cuts a headland.
 * Needs the chart loaded; without it the straight legs are returned (and not cached).
 */
export function lanesOf(id: RegionId | undefined): (Lane & { xy: Vec2[] })[] {
  if (!id) return [];
  const hit = routed.get(id);
  if (hit) return hit;
  const raw = (LANES[id] ?? []).map((l) => ({ ...l, xy: l.pts.map(([la, lo]) => geoToRegion(id, la, lo)) }));
  if (!hasGrid(id)) return raw;
  const spec = { kind: 'fjord' as const, seed: 0, region: id };
  const out = raw.map((l) => {
    const xy: Vec2[] = [];
    for (let i = 0; i < l.xy.length - 1; i++) {
      let leg = waterRoute(spec, l.xy[i]!, l.xy[i + 1]!);
      // Narrow sounds: try again allowing shallower water
      if (leg.length === 2) {
        MIN_WATER = 6;
        leg = waterRoute(spec, l.xy[i]!, l.xy[i + 1]!);
        MIN_WATER = 15;
      }
      xy.push(...(i === 0 ? leg : leg.slice(1)));
    }
    return { ...l, xy: xy.length >= 2 ? xy : l.xy };
  });
  routed.set(id, out);
  return out;
}

const CELL = 500;
let MIN_WATER = 15;

/** A* over a coarse grid of the chart from a to b; ends on land are moved to the nearest water. */
function waterRoute(spec: SeabedSpec, a: Vec2, b: Vec2): Vec2[] {
  const pad = 12_000;
  const x0 = Math.min(a.x, b.x) - pad, y0 = Math.min(a.y, b.y) - pad;
  const nx = Math.ceil((Math.abs(b.x - a.x) + 2 * pad) / CELL) + 1, ny = Math.ceil((Math.abs(b.y - a.y) + 2 * pad) / CELL) + 1;
  const depth = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) depth[j * nx + i] = depthAt(spec, x0 + i * CELL, y0 + j * CELL);
  const cellOf = (p: Vec2) => [Math.round((p.x - x0) / CELL), Math.round((p.y - y0) / CELL)] as const;
  const wet = (k: number) => depth[k]! >= MIN_WATER;
  const snap = (p: Vec2): number | undefined => {
    const [ci, cj] = cellOf(p);
    for (let r = 0; r < 30; r++) {
      let best: number | undefined, bd = Infinity;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= nx || j >= ny || (Math.abs(i - ci) !== r && Math.abs(j - cj) !== r)) continue;
        const k = j * nx + i;
        if (!wet(k)) continue;
        const d = Math.hypot(i - ci, j - cj);
        if (d < bd) { bd = d; best = k; }
      }
      if (best !== undefined) return best;
    }
    return undefined;
  };
  const s = snap(a), g = snap(b);
  if (s === undefined || g === undefined) return [a, b];
  const gi = g % nx, gj = Math.floor(g / nx);
  const cost = new Float64Array(nx * ny).fill(Infinity);
  const done = new Uint8Array(nx * ny);
  const from = new Int32Array(nx * ny).fill(-1);
  const heap = new MinHeap();
  heap.push(0, s);
  cost[s] = 0;
  const h = (k: number) => Math.hypot((k % nx) - gi, Math.floor(k / nx) - gj);
  while (heap.size) {
    const k = heap.pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === g) break;
    const i = k % nx, j = Math.floor(k / nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const n = jj * nx + ii;
      if (!wet(n)) continue;
      // Shallow water costs extra: big ships keep to the deep channel
      const c = cost[k]! + Math.hypot(di, dj) * (depth[n]! < 40 ? 2.5 : 1);
      if (c < cost[n]!) {
        cost[n] = c;
        from[n] = k;
        heap.push(c + h(n), n);
      }
    }
  }
  if (from[g] === -1 && g !== s) return [a, b];
  const cells: number[] = [];
  for (let k = g; k !== -1; k = from[k]!) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => ({ x: x0 + (k % nx) * CELL, y: y0 + Math.floor(k / nx) * CELL }));
  // String-pull: keep a point only where the straight line to the next kept one would cross shoal water
  const out: Vec2[] = [pts[0]!];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(spec, pts[i]!, pts[j]!)) j--;
    out.push(pts[j]!);
    i = j;
  }
  return out;
}

function clear(spec: SeabedSpec, a: Vec2, b: Vec2): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 200);
  for (let i = 1; i < n; i++) if (depthAt(spec, a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n) < MIN_WATER) return false;
  return true;
}

export function groundsOf(id: RegionId | undefined): { c: Vec2; r: number }[] {
  if (!id) return [];
  return (GROUNDS[id] ?? []).map((g) => ({ c: geoToRegion(id, g.lat, g.lon), r: g.rKm * 1000 }));
}

/** Binary min-heap of (priority, cell) pairs for the route search. */
class MinHeap {
  private p: number[] = [];
  private v: number[] = [];
  get size(): number { return this.v.length; }
  push(pri: number, val: number): void {
    const p = this.p, v = this.v;
    let i = v.length;
    p.push(pri); v.push(val);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up]! <= pri) break;
      p[i] = p[up]!; v[i] = v[up]!;
      i = up;
    }
    p[i] = pri; v[i] = val;
  }
  pop(): number {
    const p = this.p, v = this.v;
    const top = v[0]!;
    const lp = p.pop()!, lv = v.pop()!;
    if (!v.length) return top;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i, mp = lp;
      if (l < v.length && p[l]! < mp) { m = l; mp = p[l]!; }
      if (r < v.length && p[r]! < mp) m = r;
      if (m === i) break;
      p[i] = p[m]!; v[i] = v[m]!;
      i = m;
    }
    p[i] = lp; v[i] = lv;
    return top;
  }
}
