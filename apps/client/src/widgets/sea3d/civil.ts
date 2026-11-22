import * as THREE from 'three';
import { navLights, smoke, wake } from './parts.js';
import { loftHull, railing, type Hull } from './hullkit.js';
import { C, Kit, base, bulwark, funnel, lifeboat, loftBlock, narrowest, pole, radar, raisedDeck, rng, shipName, windlass, winRow, type V3 } from './civilkit.js';

/**
 * Neutral civil ships after typical 1970s–80s types: a VLCC with the house and funnel right
 * aft and a catwalk over the pipe deck, a container ship with tiered bays and the bridge three
 * quarters aft, a RoRo ferry with long white tiers and twin funnels, a harbour/coastal tug with
 * the wheelhouse forward and a towing arch aft, a sloop under sail and a stern trawler with a
 * gantry over its ramp. Bow +z, waterline y = 0, port = +x; every part rests on the deck or on
 * another part (lifeboats hang in their davits, bridge wings reach out from the wheelhouse).
 */

const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;

/** Window rows on both sides and the front of a block (x half width hw, from z0 to the front z1). */
function blockWindows(k: Kit, hw: number, y: number, z0: number, z1: number, every = 2.4, w = 0.9, hgt = 0.8): void {
  const ns = Math.max(1, Math.floor((z1 - z0 - 2) / every));
  for (const sx of [-1, 1]) winRow(k, 'z', sx * (hw + 0.03), y, (z0 + z1) / 2, (ns - 1) * every, ns, w, hgt);
  const nf = Math.max(1, Math.floor((hw * 2 - 2) / every));
  winRow(k, 'x', 0, y, z1 + 0.03, (nf - 1) * every, nf, w, hgt);
}

/**
 * Accommodation block: stacked tiers of height th from y0, the given half widths and z spans
 * (the last tier is the wheelhouse), with window rows. Returns the roof height of each tier.
 */
function tiers(k: Kit, y0: number, spec: { hw: number; z0: number; z1: number }[], th: number, c: number, wheel = true): number[] {
  const tops: number[] = [];
  let y = y0;
  spec.forEach((t, i) => {
    k.block(t.hw * 2, th, t.z1 - t.z0, 0, y, (t.z0 + t.z1) / 2, c);
    const last = i === spec.length - 1 && wheel;
    blockWindows(k, t.hw, y + th * 0.58, t.z0, t.z1, last ? 1.3 : 2.4, last ? 1.05 : 0.8, last ? 1.0 : 0.75);
    y += th;
    tops.push(y);
  });
  // Roof edge of the wheelhouse (slight overhang, dark)
  const w = spec[spec.length - 1]!;
  k.block(w.hw * 2 + 0.4, 0.25, w.z1 - w.z0 + 0.4, 0, y, (w.z0 + w.z1) / 2, C.dark);
  return tops;
}

/** Bridge wings: a solid-fronted platform across the ship at the wheelhouse floor, at its front. */
function wings(k: Kit, h: Hull, y: number, zFront: number, c: number): void {
  const half = narrowest(h, zFront - 2, zFront) - 0.3;
  k.block(half * 2, 1.15, 2.2, 0, y, zFront - 1.1, c);
  k.block(half * 2, 0.15, 2.4, 0, y + 1.15, zFront - 1.1, C.dark);
}

/** Thin painted overlay on the deck between z0 and z1 (tanker red, teak), following the sheer. */
function deckPaint(k: Kit, h: Hull, z0: number, z1: number, inset: number, c: number): void {
  loftBlock(k, h, z0, z1, inset, (z) => h.deckAt(z) - 0.05, (z) => h.deckAt(z) + 0.06, c, c, 16);
}

/** Polyline of round bar following the deck at height dy above it, at x, from z0 to z1. */
function deckRun(k: Kit, h: Hull, x: number, dy: number, z0: number, z1: number, r: number, c: number, step = 20): void {
  for (let z = z0; z < z1 - 0.01; z += step) {
    const zb = Math.min(z1, z + step);
    k.rod([x, h.deckAt(z) + dy, z], [x, h.deckAt(zb) + dy, zb], r, c, 5);
  }
}

/** VLCC (game scale 240 m): very low freeboard, full hull with bulb, pipe deck and catwalk, house and funnel right aft. */
export function tanker(g: THREE.Group): void {
  const r = rng();
  const hullC = pick(r, [0x26292b, 0x3d4a52, 0x4a2e24, 0x2b3a31]);
  const deckC = pick(r, [C.rust, C.green, 0x5f3a2c]);
  const len = 240;
  const beam = 40;
  const h = loftHull(g, {
    len, beam, freeboard: 6, draft: 14, sheerBow: 2, sheerStern: 0.3, rake: 4, flare: 0.02, fullness: 0.95, transom: 0.55, bilge: 1,
    bulb: true, colors: { top: hullC, boot: 0x7a2a22, bottom: 0x5a2a24 }, boot: [-0.8, 1.4],
  });
  const k = new Kit(g);
  deckPaint(k, h, -84, 104, 0.4, deckC);
  // Forecastle with bulwark, windlass and a short foremast
  raisedDeck(k, h, 104, 120, 3, hullC, deckC);
  bulwark(k, h, 104, 119.6, 1.2, hullC, 3);
  windlass(k, h.deckAt(112) + 3, 112, 3.5);
  pole(k, 0, h.deckAt(107) + 2.9, 107, 10, 0.4, C.cream, [0.8], 3);
  // Pipe runs on low supports, catwalk on posts over the centreline, tank hatches in rows
  for (const x of [-4.2, -2.6, 2.6, 4.2]) deckRun(k, h, x, 0.7, -84, 104, 0.4, C.grey);
  for (let z = -80; z <= 100; z += 12) k.block(10, 0.55, 0.6, 0, base(h, z - 0.3, z + 0.3), z, C.grey);
  for (let z = -78; z <= 100; z += 12) k.rod([0, base(h, z, z), z], [0, h.deckAt(z) + 2.6, z], 0.18, C.grey, 4);
  deckRun(k, h, 0, 2.75, -84, 104, 0.55, C.steel, 12);
  for (let z = -70; z <= 96; z += 15) for (const sx of [-1, 1]) k.cyl(0.8, 0.8, sx * 10, h.deckAt(z) + 0.3, z, C.grey, 0.8, 6);
  // Manifold amidships: cross pipes with valves to both sides, hose cranes, control house
  const yM = base(h, -4, 4);
  for (const z of [-2.4, 0, 2.4]) {
    k.rod([-17, yM + 1.4, z], [17, yM + 1.4, z], 0.35, C.grey, 6);
    for (const sx of [-1, 1]) k.block(1.2, 1.6, 1.2, sx * 15.5, yM, z, C.red);
  }
  for (const sx of [-1, 1]) {
    const x = sx * 10;
    k.cyl(0.6, 9, x, yM + 4.5, 8, C.cream, 0.5, 8);
    const tip: V3 = [sx * 15.5, yM + 11.5, -1];
    k.rod([x, yM + 7, 8], tip, 0.3, C.cream, 6, 0.2);
    k.line([x, yM + 9, 8], tip);
    k.line(tip, [tip[0], yM + 4, tip[2]]);
  }
  k.block(5, 2.6, 4, 0, yM, -8, C.white);
  // House right aft: two wide lower decks, four upper decks, wheelhouse with wings; engine casing and funnel behind
  const z0 = -104;
  const y0 = base(h, z0, -84);
  const lower = narrowest(h, z0, -84) - 0.8;
  const tops = tiers(k, y0, [
    { hw: lower, z0, z1: -84 }, { hw: lower, z0, z1: -84 }, { hw: 12, z0: -100, z1: -85 }, { hw: 12, z0: -100, z1: -85 },
    { hw: 12, z0: -100, z1: -85 }, { hw: 11, z0: -93, z1: -86 },
  ], 2.8, C.white);
  wings(k, h, tops[4]!, -86, C.white);
  for (const sx of [-1, 1]) lifeboat(k, sx * 13.4, tops[1]!, -95, 7.5, sx);
  k.block(13, 8.4, 9, 0, y0, -108.5, C.white);
  const top = funnel(k, 0, y0 + 8.4, -108, 7, 10, 15, pick(r, [C.dark, C.cream, C.red, C.blue]), pick(r, [C.white, C.red, undefined]), -0.12);
  pole(k, 0, tops[5]! + 0.25, -90, 7, 0.3, C.dark, [0.55, 0.8], 4);
  radar(g, k, 0, tops[5]! + 0.25, -87.3, 4);
  k.done();
  shipName(g, h, pick(r, ['PETRO ATLAS', 'OCEAN REGENT', 'NORDIC SUN', 'GULF PIONEER', 'AEGEAN SPIRIT']), 110, h.deckAt(110) + 1.2, 2);
  smoke(g, top[0], top[1] + 0.6, top[2], 8);
  navLights(g, len, beam, tops[5]! + 7, -90, h.deckAt(0));
  wake(g, 320, beam, len / 2, -len / 2);
}

const BOXES = [0x8a3b2c, 0x2f5d7c, 0x4d6a3a, 0xb08a3a, 0x7a8085, 0xc4c8c2, 0xb8602a, 0x6a2a2a, 0x2f6a6a, 0x3b4a7a];

/**
 * One 40-ft bay of containers on a hatch cover: rows across the hatch in stacks of random
 * height and colour (one box per stack tier). Returns nothing; everything stands on the cover.
 */
function bay(k: Kit, h: Hull, r: () => number, z: number, maxTiers: number): void {
  const l = 12.2;
  const y0 = base(h, z - l / 2, z + l / 2);
  const half = narrowest(h, z - l / 2 - 0.4, z + l / 2 + 0.4) - 1.0;
  const yc = Math.max(h.deckAt(z - l / 2), h.deckAt(z + l / 2)) + 1.5;
  k.block(half * 2, yc - y0, l + 0.6, 0, y0, z, C.grey);
  const rows = Math.floor((half * 2 - 0.4) / 2.5);
  let i = 0;
  while (i < rows) {
    const n = Math.min(rows - i, 1 + Math.floor(r() * 3));
    const x = (i + n / 2 - rows / 2) * 2.5;
    const t = Math.max(1, maxTiers - Math.floor(r() * r() * 3));
    // Boxes sit exactly on each other and side by side: no slivers of daylight between them
    for (let j = 0; j < t; j++) k.block(n * 2.5, 2.6, l, x, yc + j * 2.6, z, pick(r, BOXES));
    i += n;
  }
}

/** Container ship (~200 m): finer hull, bays in tiers following the taper, house three quarters aft, funnel behind it. */
export function containerShip(g: THREE.Group): void {
  const r = rng();
  const hullC = pick(r, [0x2f4a5e, 0x5f686e, 0x7a2a22, 0x2b3a31, 0x26292b]);
  const len = 200;
  const beam = 30;
  const h = loftHull(g, {
    len, beam, freeboard: 8, draft: 9.5, sheerBow: 3, sheerStern: 0.5, rake: 8, flare: 0.1, fullness: 0.4, transom: 0.8, bilge: 0.7,
    bulb: true, colors: { top: hullC, boot: 0x7a2a22, bottom: 0x5a2a24 }, boot: [-0.6, 1.0],
  });
  const k = new Kit(g);
  raisedDeck(k, h, 88, 100, 2.6, hullC);
  bulwark(k, h, 88, 99.6, 1.1, hullC, 2.6);
  windlass(k, h.deckAt(94) + 2.6, 94, 2.8);
  pole(k, 0, h.deckAt(90) + 2.5, 90, 9, 0.35, C.cream, [0.8], 3);
  for (let z = 78.5; z > -38; z -= 13) bay(k, h, r, z, z > 60 ? 2 : z > 30 ? 3 : 4);
  for (const z of [-72.5, -85.5]) bay(k, h, r, z, 3);
  // House: two wide lower decks, four upper decks, wheelhouse with wings; funnel casing aft of it
  const y0 = base(h, -56, -40);
  const tops = tiers(k, y0, [
    { hw: 11.5, z0: -56, z1: -40 }, { hw: 11.5, z0: -56, z1: -40 }, { hw: 9, z0: -54, z1: -41 }, { hw: 9, z0: -54, z1: -41 },
    { hw: 9, z0: -54, z1: -41 }, { hw: 9, z0: -54, z1: -41 }, { hw: 8.5, z0: -48, z1: -42 },
  ], 2.8, C.white);
  wings(k, h, tops[5]!, -42, C.white);
  for (const sx of [-1, 1]) lifeboat(k, sx * 10.2, tops[1]!, -50, 7, sx);
  const yF = base(h, -64, -56);
  k.block(10, 8.4, 8, 0, yF, -60, C.white);
  const top = funnel(k, 0, yF + 8.4, -60, 6, 8, 15, pick(r, [C.dark, C.blue, C.red, C.cream]), pick(r, [C.white, C.orange, undefined]), -0.1);
  pole(k, 0, tops[6]! + 0.25, -46, 6, 0.28, C.dark, [0.6], 3.6);
  radar(g, k, 0, tops[6]! + 0.25, -43.3, 3.6);
  k.done();
  shipName(g, h, pick(r, ['ATLANTIC CROWN', 'BISCAY BAY', 'HANSE EXPRESS', 'NORTH SEA LINK', 'CARIBIA']), 92, h.deckAt(92) + 1.0, 1.8);
  smoke(g, top[0], top[1] + 0.6, top[2], 6);
  navLights(g, len, beam, tops[6]! + 6, -46, h.deckAt(0));
  wake(g, 280, beam, len / 2, -len / 2);
}

/** Glazed or painted band on both sides of an outline-following tier (just proud of its side). */
function sideBand(k: Kit, h: Hull, z0: number, z1: number, inset: number, y0: number, y1: number, c: number): void {
  const n = Math.ceil((z1 - z0) / 3);
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) zs.push(z0 + ((z1 - z0) * i) / n);
  const w = (z: number) => h.halfBeamAt(z, h.deckAt(z)) - inset + 0.08;
  for (const sx of [-1, 1]) k.strip(zs.map((z): V3 => [sx * w(z), y0, z]), zs.map((z): V3 => [sx * w(z), y1, z]), c);
}

/**
 * Raked bridge front: a wedge on the wheelhouse front leaning forward by `rake` at the top,
 * with the window band in the sloped face (glare off the glass goes down to the sea) and mullions.
 */
function rakedFront(k: Kit, hw: number, y0: number, y1: number, z: number, rake: number): void {
  const zAt = (y: number) => z + ((y - y0) / (y1 - y0)) * rake;
  const row = (y: number, dz = 0): V3[] => [[-hw, y, zAt(y) + dz], [hw, y, zAt(y) + dz]];
  const g0 = y0 + 0.8, g1 = y1 - 0.35;
  k.strip(row(y0), row(g0), C.white);
  k.strip(row(g0), row(g1), C.glass);
  k.strip(row(g1), row(y1), C.white);
  k.strip([[-hw, y1, z], [hw, y1, z]], row(y1), C.white);
  for (const sx of [-1, 1]) k.raw([sx * hw, y0, z, sx * hw, y1, z, sx * hw, y1, z + rake], C.white);
  for (let x = -hw + 1.6; x < hw - 0.8; x += 1.6) k.line([x, g0, zAt(g0) + 0.03], [x, g1, zAt(g1) + 0.03]);
}

/** RoRo ferry (~150 m): white tiers along most of the length with window bands, lifeboats along the sides, twin funnels. */
export function ferry(g: THREE.Group): void {
  const r = rng();
  const livery = pick(r, [C.blue, 0x2a6a4a, 0x9a2a2a, 0x2a3f6a]);
  const len = 150;
  const beam = 25;
  const h = loftHull(g, {
    len, beam, freeboard: 7, draft: 5.8, sheerBow: 2.5, sheerStern: 0.4, rake: 9, flare: 0.1, fullness: 0.35, transom: 0.9, bilge: 0.6,
    bulb: true, colors: { top: C.white, boot: livery, bottom: 0x5a2a24 }, boot: [-0.6, 2.2],
  });
  const k = new Kit(g);
  // Tier A (upper vehicle deck) flush with the hull side, then passenger decks stepping in
  const yA = 12.6;
  const T = [
    { z0: -73, z1: 58, inset: 0.05, y0: 0, y1: yA },
    { z0: -71, z1: 52, inset: 0.4, y0: yA, y1: yA + 2.8 },
    { z0: -66, z1: 46, inset: 2.8, y0: yA + 2.8, y1: yA + 5.6 },
    { z0: -52, z1: 41, inset: 4.2, y0: yA + 5.6, y1: yA + 8.4 },
    { z0: 31, z1: 40, inset: 5.8, y0: yA + 8.4, y1: yA + 11.2 },
  ];
  T.forEach((t, i) => {
    loftBlock(k, h, t.z0, t.z1, t.inset, i === 0 ? (z) => h.deckAt(z) - 0.2 : () => t.y0, () => t.y1, C.white, i === 0 ? C.deck : C.white);
    if (i > 0) {
      sideBand(k, h, t.z0 + 2, t.z1 - 1.5, t.inset, t.y0 + 1.0, t.y0 + 2.1, C.glass);
      const fw = h.halfBeamAt(t.z1, h.deckAt(t.z1)) - t.inset;
      const n = Math.max(1, Math.floor((fw * 2 - 2) / 1.6));
      if (i < T.length - 1) winRow(k, 'x', 0, t.y0 + 1.55, t.z1 + 0.03, (n - 1) * 1.6, n, 1.2, 1.1);
      else rakedFront(k, fw, t.y0, t.y1, t.z1, 1.5);
    }
  });
  // Livery stripe along the hull, square ports on the vehicle deck, stern door outline on the transom
  sideBand(k, h, -72, 57, 0.05, yA - 1.8, yA - 0.9, livery);
  sideBand(k, h, -72, 57, 0.05, yA - 2.5, yA - 2.2, livery);
  for (const sx of [-1, 1]) for (let z = -64; z <= 50; z += 4) k.box(0.1, 0.7, 0.8, sx * (h.halfBeamAt(z, h.deckAt(z)) + 0.02), yA - 4.2, z, C.glass);
  k.box(13, 6.5, 0.1, 0, h.deckAt(-75) - 3.3, -75.05, C.grey);
  // Bow visor seam (a dark line on the bow from near the waterline up to the visor top)
  for (const sx of [-1, 1]) {
    let prev: V3 | undefined;
    for (let y = 2.5; y <= yA + 0.01; y += 1.0) {
      const z = 64 - (y - 2.5) * 0.45;
      const p: V3 = [sx * (h.halfBeamAt(z, Math.min(y, h.deckAt(z))) + 0.06), y, z];
      if (prev) k.line(prev, p);
      prev = p;
    }
  }
  // Lifeboats on the second tier roof, outboard of the third tier
  for (const z of [-30, -18, -6, 6, 18]) for (const sx of [-1, 1]) lifeboat(k, sx * (h.halfBeamAt(z, h.deckAt(z)) - 1.6), yA + 2.8, z, 7.5, sx);
  // Wings at the bridge front, twin raked funnels on the top deck aft, mast and radar on the bridge
  wings(k, h, T[3]!.y1, 40, C.white);
  const fb = pick(r, [livery, C.white]);
  let top: V3 = [0, 0, 0];
  for (const sx of [-1, 1]) top = funnel(k, sx * 4.4, T[3]!.y1, -38, 3.2, 7, 7.5, fb, fb === livery ? C.white : livery, -0.2);
  const yB = T[4]!.y1;
  k.block(2 * (h.halfBeamAt(35, h.deckAt(35)) - 5.8) + 0.4, 0.25, 9.4, 0, yB, 35.5, C.dark);
  pole(k, 0, yB + 0.25, 33, 7, 0.28, C.white, [0.6], 3.6);
  radar(g, k, 0, yB + 0.25, 37.5, 3.6);
  pole(k, 0, T[3]!.y1, -60, 6, 0.25, C.white, [0.7], 2.5);
  k.done();
  smoke(g, 0, top[1] + 0.6, top[2], 5);
  navLights(g, len, beam, yB + 7, 33, h.deckAt(0));
  wake(g, 230, beam, len / 2, -len / 2);
}

/** Tug (~34 m): high bow, wheelhouse forward on the deckhouse, funnel, towing winch, arch and hook aft, fenders. */
export function tug(g: THREE.Group): void {
  const r = rng();
  const len = 34;
  const beam = 10;
  const h = loftHull(g, {
    len, beam, freeboard: 2.4, draft: 3.8, sheerBow: 2.6, sheerStern: 0.3, rake: 2, flare: 0.14, fullness: 0.35, transom: 0.7, bilge: 0.55,
    colors: { top: 0x23262a, boot: 0x7a2a22, bottom: 0x5a2a24 }, boot: [-0.4, 0.5],
  });
  const k = new Kit(g);
  bulwark(k, h, -16.8, 16.6, 1.0, 0x23262a);
  // Rubber fender along the sheer, a pudding fender on the stem, tyres hung over the side
  for (const sx of [-1, 1]) {
    let prev: V3 | undefined;
    for (let z = -16.5; z <= 16.6; z += 3) {
      const y = h.deckAt(z) - 0.25;
      const p: V3 = [sx * (h.halfBeamAt(z, y) + 0.2), y, z];
      if (prev) k.rod(prev, p, 0.3, C.black, 5);
      prev = p;
    }
    for (const z of [-8, -2, 4]) k.cyl(0.55, 0.45, sx * (h.halfBeamAt(z, h.deckAt(z) - 1.4) + 0.25), h.deckAt(z) - 1.4, z, C.black, 0.55, 8, 0, Math.PI / 2);
  }
  const stemZ = (y: number) => len / 2 - 2 * (1 - (y + 3.8) / (h.deckAt(len / 2) + 3.8));
  k.rod([0, 0.6, stemZ(0.6) - 0.1], [0, h.deckAt(17) - 0.2, stemZ(h.deckAt(17) - 0.2) + 0.1], 0.55, C.black, 6);
  // Deckhouse, wheelhouse with windows all round and a roof visor, mast and radar
  const y0 = base(h, -2, 10);
  const hw = narrowest(h, -2, 10) - 1.1;
  k.block(hw * 2, 2.4, 12, 0, y0, 4, C.white);
  blockWindows(k, hw, y0 + 1.4, -2, 10, 2.2, 0.6, 0.6);
  const y1 = y0 + 2.4;
  k.block(6.6, 2.5, 5, 0, y1, 7, C.white);
  blockWindows(k, 3.3, y1 + 1.5, 4.5, 9.5, 1.1, 0.85, 1.1);
  winRow(k, 'x', 0, y1 + 1.5, 4.47, 4.4, 4, 0.85, 1.1);
  k.block(7.2, 0.22, 5.6, 0, y1 + 2.5, 7.2, C.dark);
  const yR = y1 + 2.72;
  pole(k, 0, yR, 6.2, 6, 0.18, C.dark, [0.55, 0.8], 2.4);
  radar(g, k, 0, yR, 8.4, 2);
  const [fb, fband] = pick(r, [[C.orange, undefined], [C.dark, C.white], [C.buff, C.dark], [C.red, C.white]] as const);
  const top = funnel(k, 0, y1, 0.8, 2.4, 3.2, 4.2, fb, fband, -0.15);
  // Towing winch, tow hook post and towing arch, H-bitt at the stern
  const yW = base(h, -5.5, -3.5);
  for (const sx of [-1, 1]) k.block(0.3, 1.8, 1.8, sx * 1.8, yW, -4.5, C.grey);
  k.cyl(0.75, 3.3, 0, yW + 1.1, -4.5, C.red, 0.75, 10, 0, Math.PI / 2);
  k.block(1.4, 1.2, 1.4, 2.4, yW, -4.5, C.grey);
  const yH = base(h, -8, -7);
  k.cyl(0.25, 1.6, 0, yH + 0.8, -7.5, C.dark, 0.3, 6);
  k.box(0.25, 0.25, 1.4, 0, yH + 1.6, -8.1, C.dark);
  const za = -10.5;
  const xa = narrowest(h, za - 0.5, za + 0.5) - 0.5;
  const ya = base(h, za - 0.5, za + 0.5);
  const arch: V3[] = [[-xa, ya, za], [-xa, ya + 3.6, za], [-xa * 0.55, ya + 4.6, za], [xa * 0.55, ya + 4.6, za], [xa, ya + 3.6, za], [xa, ya, za]];
  for (let i = 0; i < arch.length - 1; i++) k.rod(arch[i]!, arch[i + 1]!, 0.22, C.buff, 6);
  const yB = base(h, -15.5, -14.5);
  for (const sx of [-1, 1]) k.cyl(0.25, 1.2, sx * 1.2, yB + 0.6, -15, C.dark, 0.25, 6);
  k.box(3, 0.3, 0.3, 0, yB + 0.9, -15, C.dark);
  k.done();
  smoke(g, top[0], top[1] + 0.3, top[2], 3);
  navLights(g, len, beam, yR + 6, 6.2, h.deckAt(0));
  wake(g, 70, beam, len / 2, -len / 2);
}

/**
 * Sailcloth: matte and double-sided; thin cloth lets the light through, so the sun lights it
 * from either side (and a little even edge-on), plus a faint glow: it reads white under side light.
 */
const SAIL_MAT = new THREE.MeshStandardMaterial({ color: 0xf7f5ef, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, emissive: 0x2c2b28 });
SAIL_MAT.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
    'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );', 'float dotNL = abs( dot( geometryNormal, directLight.direction ) ) * 0.8 + 0.2;'));
};
SAIL_MAT.customProgramCacheKey = () => 'sailcloth';

/** Sailing yacht (~13 m sloop) under sail: coachroof, cockpit, mast with main and jib sheeted to starboard. */
export function yacht(g: THREE.Group): void {
  const len = 13;
  const beam = 4;
  const h = loftHull(g, {
    len, beam, freeboard: 1.05, draft: 0.6, sheerBow: 0.5, sheerStern: 0.15, rake: 1.8, flare: 0.04, fullness: 0.1, transom: 0.6, bilge: 0.35,
    colors: { top: C.white, boot: C.blue, bottom: 0x23324a }, boot: [-0.06, 0.12],
  });
  const k = new Kit(g);
  // Keel fin with a bulb, spade rudder
  k.box(0.22, 1.7, 1.3, 0, -1.25, 0.3, 0x23324a);
  k.ellipsoid(0, -2.1, 0.1, 0.3, 0.25, 1.1, 0x23324a);
  k.box(0.14, 1.0, 0.7, 0, -0.9, -5.2, 0x23324a);
  // Teak deck, coachroof with windows, cockpit coamings, wheel
  deckPaint(k, h, -6.4, 5.9, 0.08, C.wood);
  loftBlock(k, h, -1.4, 2.8, 0.55, (z) => h.deckAt(z) - 0.05, (z) => h.deckAt(-1.4) + 0.5 + (z > 1.6 ? -(z - 1.6) * 0.15 : 0), C.white);
  for (const sx of [-1, 1]) k.box(0.05, 0.16, 2.2, sx * (h.halfBeamAt(0.6, h.deckAt(0.6)) - 0.53), h.deckAt(-1.4) + 0.3, 0.4, C.glass);
  const yC = base(h, -5.8, -1.4);
  for (const sx of [-1, 1]) k.block(0.1, 0.45, 4.2, sx * (narrowest(h, -5.8, -1.4) - 0.35), yC, -3.6, C.white);
  k.block(2.2, 0.06, 4.2, 0, yC + 0.13, -3.6, 0x5a4a38);
  k.rod([0, yC, -4.9], [0, yC + 0.7, -4.9], 0.05, C.steel, 4);
  k.cyl(0.42, 0.05, 0, yC + 0.75, -4.85, C.steel, 0.42, 12, Math.PI / 2 - 0.3);
  // Mast on the coachroof, spreaders, boom swung out to starboard
  const zM = 1.5;
  const yM = h.deckAt(-1.4) + 0.5;
  const mh = 15;
  const head: V3 = [0, yM + mh, zM];
  k.cyl(0.11, mh, 0, yM + mh / 2, zM, C.steel, 0.08, 6);
  k.box(2.4, 0.06, 0.1, 0, yM + mh * 0.55, zM, C.steel);
  const a = 0.28;
  const bl = 5.6;
  const yb = yM + 1.0;
  const clew: V3 = [-Math.sin(a) * bl, yb + 0.15, zM - Math.cos(a) * bl];
  k.rod([0, yb, zM - 0.1], clew, 0.07, C.steel, 4);
  // Sails with a little belly to leeward (starboard, −x)
  const sk = new Kit(g);
  const sail = (luff: V3[], leech: V3[], belly: number) => {
    const mid = leech.map((p, i): V3 => {
      const q = luff[i]!;
      return [(p[0] + q[0]) / 2 - belly, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    });
    sk.strip(luff, mid, 0xffffff);
    sk.strip(mid, leech, 0xffffff);
  };
  const lerp = (p: V3, q: V3, t: number): V3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const tackM: V3 = [0, yb + 0.1, zM - 0.12];
  const headM: V3 = [0, yM + mh - 0.4, zM - 0.12];
  sail([0, 0.35, 0.7, 1].map((t) => lerp(tackM, headM, t)), [0, 0.35, 0.7, 1].map((t) => lerp(clew, headM, t)), 0.35);
  const stem: V3 = [0, h.deckAt(6.3) + 0.1, 6.3];
  const fore: V3 = [0, yM + mh * 0.86, zM + 0.05];
  const jclew: V3 = [-1.3, h.deckAt(0.6) + 0.9, 0.6];
  sail([0, 0.35, 0.7, 1].map((t) => lerp(stem, fore, t)), [0, 0.35, 0.7, 1].map((t) => lerp(jclew, fore, t)), 0.3);
  // Standing rigging: forestay, backstay, shrouds over the spreaders to the chainplates
  k.line(fore, stem);
  k.line(head, [0, h.deckAt(-6.4) + 0.1, -6.4]);
  for (const sx of [-1, 1]) {
    const sp: V3 = [sx * 1.2, yM + mh * 0.55, zM];
    const cp: V3 = [sx * (h.halfBeamAt(zM, h.deckAt(zM)) - 0.1), h.deckAt(zM), zM];
    k.line(cp, sp);
    k.line(sp, [0, yM + mh * 0.95, zM]);
  }
  railing(g, h, -6.2, 5, 0.6, 0.12);
  k.done();
  const sails = sk.done();
  sails.material = SAIL_MAT;
  sails.name = 'sails';
  navLights(g, len, beam, yM + mh, zM, h.deckAt(0));
  wake(g, 22, beam, len / 2, -len / 2);
}

/** Stern trawler (~42 m): whaleback shelter deck with the bridge forward, net drum, ramp and gantry aft. */
export function trawler(g: THREE.Group): void {
  const r = rng();
  const hullC = pick(r, [0x7a2a22, 0x23415a, 0x2b4a3a, 0x3a3f44]);
  const len = 42;
  const beam = 10;
  const h = loftHull(g, {
    len, beam, freeboard: 2.6, draft: 4, sheerBow: 2.2, sheerStern: 0.3, rake: 2, flare: 0.12, fullness: 0.4, transom: 0.85, bilge: 0.6,
    colors: { top: hullC, boot: C.dark, bottom: 0x5a2a24 }, boot: [-0.4, 0.5],
  });
  const k = new Kit(g);
  // Shelter deck from amidships to the bow, with bulwark forward
  const sh = 2.3;
  raisedDeck(k, h, -6, 21, sh, hullC);
  bulwark(k, h, 10, 20.7, 1.0, hullC, sh);
  bulwark(k, h, -20.8, -6, 1.0, hullC);
  // Bridge house and wheelhouse on the shelter deck, foremast, funnel
  const yS = base(h, 7, 15) + sh;
  const hw = narrowest(h, 7, 15) - 1.0;
  k.block(hw * 2, 2.4, 8, 0, yS, 11, C.white);
  blockWindows(k, hw, yS + 1.4, 7, 15, 2.2, 0.6, 0.6);
  const yW = yS + 2.4;
  k.block(6.6, 2.4, 5, 0, yW, 12, C.white);
  blockWindows(k, 3.3, yW + 1.4, 9.5, 14.5, 1.1, 0.85, 1.0);
  k.block(2 * (narrowest(h, 13, 15) - 0.4), 0.9, 1.6, 0, yW, 13.7, C.white);
  k.block(7.2, 0.22, 5.6, 0, yW + 2.4, 12.2, C.dark);
  const yR = yW + 2.62;
  pole(k, 0, yR, 11, 6.5, 0.18, C.dark, [0.55, 0.8], 2.6);
  radar(g, k, 0, yR, 13.4, 2.2);
  pole(k, 0, h.deckAt(18) + sh - 0.15, 18, 6, 0.2, C.cream, [0.75], 2);
  const top = funnel(k, 0, yS, 4, 2.2, 3.2, 4.6, pick(r, [C.dark, hullC, C.cream]), pick(r, [C.white, C.orange, undefined]), -0.12);
  for (const sx of [-1, 1]) k.cyl(0.45, 1.3, sx * (narrowest(h, -1, 1) - 0.8), yS + 0.5, 0, C.white, 0.45, 8, Math.PI / 2);
  // Gallows gantry at the aft end of the shelter deck, net drum on stands, stern gantry with trawl doors
  const zg = -5;
  const xg = narrowest(h, zg - 0.5, zg + 0.5) - 0.6;
  const yg = base(h, zg - 0.5, zg + 0.5) + sh;
  for (const sx of [-1, 1]) k.rod([sx * xg, yg, zg], [sx * xg, yg + 4.5, zg], 0.22, C.buff, 6);
  k.box(xg * 2 + 0.44, 0.45, 0.45, 0, yg + 4.5, zg, C.buff);
  const zd = -10;
  const yd = base(h, zd - 1.2, zd + 1.2);
  for (const sx of [-1, 1]) k.block(0.3, 1.9, 1.6, sx * 2.8, yd, zd, C.grey);
  k.cyl(1.1, 5.2, 0, yd + 1.75, zd, 0x2b3a31, 1.1, 12, 0, Math.PI / 2);
  for (const sx of [-1, 1]) k.cyl(1.35, 0.15, sx * 2.6, yd + 1.75, zd, C.grey, 1.35, 12, 0, Math.PI / 2);
  // Stern ramp: guide walls either side and the dark ramp opening in the transom
  const yr = base(h, -21, -14);
  for (const sx of [-1, 1]) k.block(0.25, 1.1, 7, sx * 2.2, yr, -17.5, hullC);
  k.block(4.2, 0.08, 7, 0, yr + 0.15, -17.5, C.dark);
  k.box(4.2, h.deckAt(-21) - 0.9, 0.1, 0, (h.deckAt(-21) + 0.9) / 2, -21.05, C.dark);
  const za = -19.6;
  const xa = narrowest(h, za - 0.5, za + 0.5) - 0.5;
  const ya = base(h, za - 0.5, za + 0.5);
  for (const sx of [-1, 1]) {
    k.rod([sx * xa, ya, za + 1.5], [sx * xa * 0.92, ya + 7, za], 0.25, C.buff, 6);
    k.rod([sx * xa, ya, za - 0.9], [sx * xa * 0.92, ya + 7, za], 0.2, C.buff, 6);
    k.box(0.15, 2.0, 2.6, sx * (xa + 0.3), ya + 3.2, za + 0.6, C.dark);
  }
  k.box(xa * 1.84 + 0.5, 0.5, 0.5, 0, ya + 7, za, C.buff);
  for (const sx of [-1, 1]) k.box(0.4, 0.7, 0.4, sx * 1.5, ya + 6.4, za, C.dark);
  k.done();
  smoke(g, top[0], top[1] + 0.3, top[2], 3);
  navLights(g, len, beam, yR + 6.5, 11, h.deckAt(0));
  wake(g, 70, beam, len / 2, -len / 2);
}
