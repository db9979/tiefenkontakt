import { CLASSES, type NeutralClass } from './classes.js';
import { createShip, isConvoyShip, type Ship } from './entities.js';
import { distance, headingVec, wrap360, type Vec2 } from './math.js';
import { depthAt } from './seabed.js';
import type { BioKind } from './signatures.js';
import type { World } from './world.js';

/**
 * Neutral shipping and sea life. Every mission starts with civil traffic suited to the
 * waters (tankers and container ships in the open ocean, ferries, tugs, trawlers and yachts
 * near the coast); ships steam through on their own courses, keep clear of shoals and are
 * replaced when they leave the area. Fishing boats trawl slowly and turn now and then.
 */

interface Profile { kn: number; names: string[] }

const PROFILE: Record<NeutralClass, Profile> = {
  tanker: { kn: 14, names: ['Aurora Spirit', 'Polar Venture', 'Golden Fjord', 'Atlas Crown'] },
  container: { kn: 20, names: ['Hanse Express', 'Atlantic Trader', 'Nordsee Bridge', 'Cape Orion'] },
  faehre: { kn: 18, names: ['Nordlicht', 'Skagerrak', 'Kronprinsesse', 'Baltic Star'] },
  schlepper: { kn: 11, names: ['Herkules', 'Wiking', 'Fairplay IX', 'Bugsier 7'] },
  yacht: { kn: 6, names: ['Albatros', 'Mira', 'Seeschwalbe', 'Freya'] },
  fischer: { kn: 5, names: ['Gudrun', 'Kormoran', 'Hvalur', 'Dornbusch'] },
};

/** Which traffic fits which water, as relative weights. */
const MIX: Record<'tief' | 'schelf' | 'fjord', Partial<Record<NeutralClass, number>>> = {
  tief: { tanker: 3, container: 3, faehre: 1, fischer: 1.5, schlepper: 1, yacht: 0.3 },
  schelf: { fischer: 3, faehre: 2, container: 1.5, tanker: 1, schlepper: 1, yacht: 1 },
  fjord: { faehre: 2, fischer: 2, schlepper: 2, yacht: 2 },
};

/** Ships of neutral traffic present at once, per mission. */
const COUNT: Record<string, number> = { groenland: 4, schelf: 6, fjord: 3, hafen: 3, duell: 2, fuehlung: 4, meerenge: 3, aufklaerung: 5, eigene: 4 };

/** Sea life per water: the snapping-shrimp bed only lives in shallow water, sperm whales only off the shelf. */
const BIO: Record<'tief' | 'schelf' | 'fjord', BioKind[]> = {
  tief: ['bio', 'blauwal', 'buckelwal', 'pottwal', 'orca', 'delfine'],
  schelf: ['buckelwal', 'orca', 'delfine', 'garnelen', 'bio'],
  fjord: ['orca', 'delfine', 'garnelen'],
};

/** Source level, depth and speed of each biological source in the sim's terms. */
export const BIO_SOURCE: Record<BioKind, { sl: number; depth: number; kn: number }> = {
  bio: { sl: 168, depth: 50, kn: 6 }, blauwal: { sl: 172, depth: 60, kn: 4 }, buckelwal: { sl: 160, depth: 20, kn: 3 },
  pottwal: { sl: 170, depth: 400, kn: 3 }, orca: { sl: 150, depth: 10, kn: 6 }, delfine: { sl: 145, depth: 5, kn: 8 },
  garnelen: { sl: 150, depth: -1, kn: 0 },
};

const LEAVE_M = 42_000;
const LOOK_S = 5;

function waters(w: World): 'tief' | 'schelf' | 'fjord' {
  const k = w.env.seabed?.kind;
  return k === 'schelf' ? 'schelf' : k === 'fjord' ? 'fjord' : 'tief';
}

function pick<T extends string>(w: World, weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights) as [T, number][];
  let r = w.rng.next() * entries.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of entries) if ((r -= v) <= 0) return k;
  return entries[0]![0];
}

/** Centre of the action: the convoy, else the warships. */
function centre(w: World): Vec2 {
  const ships = w.ships.filter((s) => s.alive && s.team !== 'neutral');
  const convoy = ships.filter(isConvoyShip);
  const set = convoy.length ? convoy : ships;
  if (!set.length) return { x: 0, y: 0 };
  return { x: set.reduce((a, s) => a + s.pos.x, 0) / set.length, y: set.reduce((a, s) => a + s.pos.y, 0) / set.length };
}

/** Deep enough along the way ahead for this draft? */
function clearAhead(w: World, p: Vec2, heading: number, draft: number, metres: number): boolean {
  if (!w.env.seabed) return true;
  const v = headingVec(heading);
  for (let d = 0; d <= metres; d += 1000) if (depthAt(w.env.seabed, p.x + v.x * d, p.y + v.y * d) < draft + 15) return false;
  return true;
}

/** One neutral ship somewhere around the action, on a course that keeps it in safe water. */
export function spawnNeutral(w: World, cls?: NeutralClass, far = false): Ship | undefined {
  const st = w.env.incidents;
  if (!st) return undefined;
  const kind = cls ?? pick<NeutralClass>(w, MIX[waters(w)]);
  const spec = CLASSES[kind];
  const c = centre(w);
  const course = w.convoy?.guideHeading ?? 0;
  for (let i = 0; i < 14; i++) {
    const a = w.rng.next() * 360;
    const r = far ? 24_000 + w.rng.next() * 8000 : 5000 + w.rng.next() * 20_000;
    const v = headingVec(a);
    const pos = { x: c.x + v.x * r, y: c.y + v.y * r };
    // Through traffic heads back across the area; fishermen pick any course
    const heading = kind === 'fischer' ? w.rng.next() * 360 : wrap360(a + 180 + w.rng.gauss(0, 35) + (w.rng.next() < 0.3 ? course - a : 0));
    if (!clearAhead(w, pos, heading, spec.draft, 8000)) continue;
    const prof = PROFILE[kind];
    const n = createShip({
      id: `n${++st.neutrals}`, cls: kind, name: prof.names[st.neutrals % prof.names.length]!, team: 'neutral',
      pos, heading, speedKn: prof.kn,
    });
    n.autoNav = true;
    w.ships.push(n);
    return n;
  }
  return undefined;
}

/** A pod of whales, a school of dolphins or a shrimp bed near the action. */
export function spawnBio(w: World, until: number): void {
  const st = w.env.incidents;
  if (!st) return;
  const kinds = BIO[waters(w)];
  const kind = kinds[Math.floor(w.rng.next() * kinds.length)]!;
  const c = centre(w);
  const v = headingVec(w.rng.next() * 360);
  const r = 4000 + w.rng.next() * 14_000;
  const p = { x: c.x + v.x * r, y: c.y + v.y * r };
  const bottom = w.env.seabed ? depthAt(w.env.seabed, p.x, p.y) : 3000;
  // Shrimp only on shallow ground, sperm whales only over deep water
  if ((kind === 'garnelen' && bottom > 120) || (kind === 'pottwal' && bottom < 600)) return;
  st.whales.push({ id: `W${Math.round(w.time)}${st.whales.length}`, x: p.x, y: p.y, heading: w.rng.next() * 360, until, kind });
}

/** Mission start: the traffic of the area and maybe some sea life. */
export function installTraffic(w: World): void {
  const st = w.env.incidents;
  if (!st) return;
  // TK_NO_TRAFFIC=1 switches traffic off (A/B balance runs in scripts/bot-arena.ts)
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  st.traffic = env?.TK_NO_TRAFFIC ? 0 : COUNT[w.env.mission ?? 'eigene'] ?? 4;
  for (let i = 0; i < st.traffic; i++) spawnNeutral(w);
  if (w.rng.next() < 0.8) spawnBio(w, w.time + 2400);
}

/** Steam on, keep clear of shoals, trawl, and replace ships that have left the area. */
export function stepTraffic(w: World): void {
  const st = w.env.incidents;
  if (!st) return;
  const look = w.time >= (st.nextLook ?? 0);
  if (look) st.nextLook = w.time + LOOK_S;
  const c = look ? centre(w) : undefined;
  let present = 0;
  for (let i = w.ships.length - 1; i >= 0; i--) {
    const s = w.ships[i]!;
    if (s.team !== 'neutral') continue;
    if (!s.alive) continue;
    const kind = s.cls as NeutralClass;
    const prof = PROFILE[kind];
    if (!prof) continue;
    present++;
    s.order.speedKn = prof.kn;
    if (!look) continue;
    // Left the area for good: drop it (a new one comes in elsewhere)
    if (c && distance(s.pos, c) > LEAVE_M) {
      w.ships.splice(i, 1);
      present--;
      continue;
    }
    const draft = CLASSES[s.cls].draft;
    if (!clearAhead(w, s.pos, s.order.heading, draft, kind === 'tanker' || kind === 'container' ? 4000 : 2000)) {
      for (const off of [40, -40, 80, -80, 135, -135, 180]) {
        const h = wrap360(s.order.heading + off);
        if (clearAhead(w, s.pos, h, draft, 3000)) {
          s.order.heading = h;
          break;
        }
      }
    } else if (kind === 'fischer' && w.rng.next() < LOOK_S / 900) {
      // Trawling: a new leg every quarter of an hour or so
      s.order.heading = wrap360(s.order.heading + (w.rng.next() < 0.5 ? 1 : -1) * (60 + w.rng.next() * 60));
    }
  }
  if (look && present < (st.traffic ?? 0) && w.rng.next() < 0.2) spawnNeutral(w, undefined, true);
}
