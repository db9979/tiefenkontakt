import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { isRegion, registerGrid } from '@tk/shared';

/** The real sea areas' bathymetry (packages/shared/data/bathy/<id>.bin.gz), loaded once at start. */
export const BATHY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/shared/data/bathy');

let loaded = false;
export function loadBathymetry(): void {
  if (loaded || !existsSync(BATHY_DIR)) return;
  loaded = true;
  for (const f of readdirSync(BATHY_DIR)) {
    const id = f.replace(/\.bin\.gz$/, '');
    if (!isRegion(id)) continue;
    const b = gunzipSync(readFileSync(resolve(BATHY_DIR, f)));
    registerGrid(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  }
}

/** The gzipped grid as stored (the client unpacks it), or undefined for an unknown region. */
export function bathyFile(id: string): Buffer | undefined {
  if (!isRegion(id)) return undefined;
  const p = resolve(BATHY_DIR, `${id}.bin.gz`);
  return existsSync(p) ? readFileSync(p) : undefined;
}
