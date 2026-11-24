import { hasGrid, registerGrid, type RegionId } from '@tk/shared';

/** Fetch a real sea area's bathymetry once (gzipped grid from the server), then it is in depthAt. */
const pending = new Set<RegionId>();

export function ensureGrid(id: RegionId): boolean {
  if (hasGrid(id)) return true;
  if (pending.has(id)) return false;
  pending.add(id);
  void (async () => {
    try {
      const r = await fetch(`/api/bathy/${id}`);
      if (!r.ok || !r.body) throw new Error(String(r.status));
      const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      registerGrid(id, buf);
      window.dispatchEvent(new Event('tk-bathy'));
    } catch {
      // Try again on a later frame
      setTimeout(() => pending.delete(id), 5000);
    }
  })();
  return false;
}
