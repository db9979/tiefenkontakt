import { CLASSES, distance, glowStrength, seesTorpedoTrack, type GlowTrackView, type Ship, type World } from '@tk/shared';

/**
 * Glowing torpedo tracks for the bridge's 3D view (F-QA7): on a dark night in a bloom the lookouts
 * see a running torpedo by the glowing water it churns up (lookout.ts seesTorpedoTrack, the same
 * rule as the torpedo alarm). The snapshot carries the sighted torpedo's recent path, so the view
 * can draw a faint glowing line on the sea along it. Kept outside the simulation: a few crumbs
 * per torpedo, sampled while snapshots are built.
 */

/** A crumb every this many seconds, kept for this long (s): about 900 m of track at 45 kn. */
const SAMPLE_S = 2;
const KEEP_S = 40;
/** Deeper than this a torpedo no longer stirs the surface; shallower than the first it does fully (m). */
const SHALLOW_M = 15;
const DEEP_M = 80;

interface Crumbs { pts: { x: number; y: number; t: number }[] }
const trails = new WeakMap<object, Crumbs>();

function crumbsOf(t: { pos: { x: number; y: number } }, now: number): Crumbs {
  let c = trails.get(t);
  if (!c) trails.set(t, (c = { pts: [] }));
  const last = c.pts[c.pts.length - 1];
  if (!last || now - last.t >= SAMPLE_S) c.pts.push({ x: t.pos.x, y: t.pos.y, t: now });
  while (c.pts.length && now - c.pts[0]!.t > KEEP_S) c.pts.shift();
  return c;
}

/** Torpedo tracks the own lookouts can see glowing now (undefined when there are none). */
export function glowTracksFor(w: World, own: Ship): GlowTrackView[] | undefined {
  const torps = w.weapons?.torpedoes;
  if (!torps?.length || CLASSES[own.cls].submarine || !own.alive) return undefined;
  // Daylight tracks are white water, not glow: only at night, where the sea lights up
  if ((w.env.light ?? 1) >= 0.4) return undefined;
  const glow = glowStrength(w.env);
  if (glow <= 0.02) return undefined;
  const out: GlowTrackView[] = [];
  for (const t of torps) {
    const c = crumbsOf(t, w.time);
    if (t.ownerId === own.id) continue;
    const r = distance(own.pos, t.pos);
    if (!seesTorpedoTrack(own, r, w.env)) continue;
    const depth = Math.max(0, Math.min(1, (DEEP_M - t.depth) / (DEEP_M - SHALLOW_M)));
    const k = Math.round(glow * depth * 100) / 100;
    if (k < 0.03) continue;
    const pts: number[] = [];
    for (const p of c.pts) pts.push(Math.round(p.x), Math.round(p.y));
    pts.push(Math.round(t.pos.x), Math.round(t.pos.y));
    out.push({ id: t.id, k, pts });
  }
  return out.length ? out : undefined;
}
