import { hasGrid, registerGrid, type RegionId } from '@tk/shared';

async function load(name: string): Promise<ArrayBuffer> {
  const r = await fetch(`/api/bathy/${name}`);
  if (!r.ok || !r.body) throw new Error(String(r.status));
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/** Fetch a real sea area's bathymetry once (gzipped grid from the server), then it is in depthAt. */
const pending = new Set<RegionId>();

export function ensureGrid(id: RegionId): boolean {
  if (hasGrid(id)) return true;
  if (pending.has(id)) return false;
  pending.add(id);
  void (async () => {
    try {
      // The overview first (the fine grid falls back on it at its edges), then the fine grid
      const [wideBuf, buf] = await Promise.all([load(`${id}.wide`).catch(() => undefined), load(id)]);
      if (wideBuf) registerGrid(id, wideBuf, true);
      registerGrid(id, buf);
      window.dispatchEvent(new Event('tk-bathy'));
    } catch {
      // Try again on a later frame
      setTimeout(() => pending.delete(id), 5000);
    }
  })();
  return false;
}
