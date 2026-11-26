import { KN, distance, headingVec, type ContactTrack, type Ship, type Vec2, type World } from '@tk/shared';
import { isFriendly, type BotMemory } from './common.js';

/**
 * Where the Ostpakt patrol ship believes the convoy is (F29), from what it has: its own radar
 * picture (a cluster of surface fixes is a convoy, a single ship is not) and fleet command's
 * reconnaissance report (Bear-D style over-the-horizon targeting: a position with an error of
 * several kilometres), dead reckoned on the reported course and speed. Never the true positions.
 */

/** Reconnaissance report error (m, 1σ per axis): OTH targeting from a Bear-D was good to a few km. */
export const RECON_ERR_M = 3000;
/** A recon report is dead reckoned this long (s), then it is too old to steer by. */
const RECON_KEEP_S = 1800;
/** Radar fixes this fresh (s) and this close together (m) make a convoy; at least this many. */
const FIX_AGE_S = 60;
const CLUSTER_M = 6000;
const CLUSTER_MIN = 3;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A fixed pseudo-random normal pair for this report (no draw from the world's dice). */
function gauss2(key: string): Vec2 {
  const u1 = ((hash(key) % 100_000) + 0.5) / 100_000;
  const u2 = ((hash(`${key}#`) % 100_000) + 0.5) / 100_000;
  const r = Math.sqrt(-2 * Math.log(u1));
  return { x: r * Math.cos(2 * Math.PI * u2), y: r * Math.sin(2 * Math.PI * u2) };
}

/** The recon report as the patrol ship receives it: the reported position with its error. */
export function reconReport(s: Ship, e: { time: number; x: number; y: number; course: number; speedKn: number }): NonNullable<BotMemory['convoyLine']> {
  const g = gauss2(`${s.id}:${Math.round(e.time)}`);
  return { x: e.x + g.x * RECON_ERR_M, y: e.y + g.y * RECON_ERR_M, course: e.course, speedKn: e.speedKn, t: e.time };
}

/** Centre of the largest cluster of fresh radar fixes on surface contacts (not own ships). */
function radarCluster(w: World, m: BotMemory, s: Ship, tracks: readonly ContactTrack[]): Vec2 | undefined {
  const fixes: Vec2[] = [];
  for (const t of tracks) {
    if (w.time - t.lastSeen > FIX_AGE_S || !t.sensors.includes('radar') || t.range === undefined) continue;
    if (isFriendly(w, s, t, m)) continue;
    const v = headingVec(t.bearing);
    fixes.push({ x: s.pos.x + v.x * t.range, y: s.pos.y + v.y * t.range });
  }
  let best: Vec2[] = [];
  for (const f of fixes) {
    const near = fixes.filter((g) => distance(f, g) < CLUSTER_M);
    if (near.length > best.length) best = near;
  }
  if (best.length < CLUSTER_MIN) return undefined;
  return { x: best.reduce((a, p) => a + p.x, 0) / best.length, y: best.reduce((a, p) => a + p.y, 0) / best.length };
}

/** The patrol ship's convoy estimate: own radar cluster, else the dead-reckoned recon report, else none. */
export function convoyEstimate(w: World, m: BotMemory, s: Ship, tracks: readonly ContactTrack[]): Vec2 | undefined {
  const radar = radarCluster(w, m, s, tracks);
  if (radar) return radar;
  const r = m.convoyLine;
  if (!r || w.time - r.t > RECON_KEEP_S) return undefined;
  const v = headingVec(r.course);
  const run = r.speedKn * KN * (w.time - r.t);
  return { x: r.x + v.x * run, y: r.y + v.y * run };
}
