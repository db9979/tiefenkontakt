/**
 * Download the bathymetry of the real sea areas (packages/shared/src/regions.ts) from NOAA's
 * ETOPO 2022 15-arc-second grid (public domain, via the CoastWatch ERDDAP server) and store
 * them as gzipped grids in packages/shared/data/bathy/<id>.bin.gz.
 * Usage: npx tsx scripts/fetch-bathymetry.ts [--wide] [regionId …]   (no ids: every missing region)
 * --wide: the coarse overview window (±260 km, 2 arc minutes) as <id>.wide.bin.gz
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { REGIONS, encodeGrid, regionBox, type RegionId } from '../packages/shared/src/index.js';

const OUT = resolve(import.meta.dirname, '../packages/shared/data/bathy');
const STEP = 1 / 240;
mkdirSync(OUT, { recursive: true });
const wideMode = process.argv.includes('--wide');
const args = process.argv.slice(2).filter((a) => a !== '--wide');
const ids = (args.length ? args : Object.keys(REGIONS)) as RegionId[];

for (const id of ids) {
  const r = REGIONS[id];
  if (!r) throw new Error(`unbekanntes Seegebiet: ${id}`);
  const file = resolve(OUT, `${id}${wideMode ? '.wide' : ''}.bin.gz`);
  if (!args.length && existsSync(file)) continue;
  const b = regionBox(r, wideMode);
  const stride = wideMode ? 8 : r.stride;
  const q = `z%5B(${b.lat0.toFixed(4)}):${stride}:(${b.lat1.toFixed(4)})%5D%5B(${b.lon0.toFixed(4)}):${stride}:(${b.lon1.toFixed(4)})%5D`;
  const url = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.json?${q}`;
  // The ERDDAP server is busy now and then: try a few times
  let res = await fetch(url);
  for (let i = 0; i < 4 && !res.ok; i++) {
    await new Promise((ok) => setTimeout(ok, 5000 * (i + 1)));
    res = await fetch(url);
  }
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const rows = ((await res.json()) as { table: { rows: [number, number, number][] } }).table.rows;
  const lats = [...new Set(rows.map((x) => x[0]))].sort((a, c) => a - c);
  const lons = [...new Set(rows.map((x) => x[1]))].sort((a, c) => a - c);
  const li = new Map(lats.map((v, i) => [v, i]));
  const lj = new Map(lons.map((v, i) => [v, i]));
  const z = new Int16Array(lats.length * lons.length);
  for (const [la, lo, h] of rows) z[li.get(la)! * lons.length + lj.get(lo)!] = Math.max(-32000, Math.min(32000, Math.round(h)));
  const grid = { lat0: lats[0]!, lon0: lons[0]!, dLat: STEP * stride, dLon: STEP * stride, nLat: lats.length, nLon: lons.length, z };
  const gz = gzipSync(Buffer.from(encodeGrid(grid)), { level: 9 });
  writeFileSync(file, gz);
  console.log(`${id}${wideMode ? ' (Übersicht)' : ''}: ${lats.length}×${lons.length} Punkte, ${(gz.length / 1024).toFixed(0)} KB`);
}
