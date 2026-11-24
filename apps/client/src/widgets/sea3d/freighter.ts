import type * as THREE from 'three';
import { navLights, smoke, wake } from './parts.js';
import { loftHull, type Hull } from './hullkit.js';
import { C, Kit, base, bulwark, derrick, funnel, hatch, lifeboat, loftBlock, narrowest, pole, radar, raisedDeck, shipName, windlass, winRow, type V3 } from './civilkit.js';
import { hullFor, pick, stretch, type Look } from './variety.js';

/**
 * Convoy merchantmen of the 1960s–80s, built from one pattern with many variants: a general
 * cargo ship (house amidships, three quarters aft or right aft; four to six hatches; goalpost
 * derricks, king posts or deck cranes; timber, boxes or vehicles on the hatches), a white reefer
 * on fine lines, a geared or gearless container feeder, a bulk carrier with wide hatch covers
 * and a Ro-Ro freighter. Bow +z, waterline y = 0, port = +x; fittings stand on the deck.
 */

const HULLS = [0x26292b, 0x4a5156, 0x4a2e24, 0x2b3a31, 0x23344a, 0x5a5f5c, 0x6b2a22];
const FUNNELS: [number, number | undefined][] = [
  [0x1c1f21, 0xb03a2e], [0xb03a2e, 0xd9dcda], [0xb4945a, undefined], [0x2a3f5a, 0xd9dcda], [0xd9dcda, 0x2a5a8a],
  [0xd8732e, 0x1c1f21], [0x2b4a3a, 0xd9dcda], [0xd9dcda, 0xb03a2e], [0x6b2a22, undefined], [0xc9a640, 0x1c1f21],
];
const NAMES = [
  'NORDLAND', 'ELBSTROM', 'HANSA TRADER', 'BALTIC STAR', 'MARIA K', 'SKAGEN', 'WESERLAND', 'KAP ARKONA', 'HELLAS', 'ANNA K',
  'CITY OF LEITH', 'TORM ESBJERG', 'ATLANTIC FAITH', 'MARE NOSTRUM', 'POLAR TRADER', 'SANTA ELENA', 'IRISH OAK', 'FALKENSTEIN',
  'NORTHERN VENTURE', 'CAPE HORN', 'LAKE ONTARIO', 'STAR OF DUNDEE', 'BERGENSFJORD', 'ROTTERDAM EXPRESS',
];
const CRATES = [0x8a3b2c, 0x2f5d7c, 0x4d6a3a, 0xb08a3a, 0x7a8085, 0xc4c8c2, 0xb8602a, 0x2f6a6a];

type Gear = 'goalpost' | 'kingpost' | 'crane' | 'none';
type Stack = 'timber' | 'boxes' | 'vehicles' | 'none';

/** Funnel shapes of the era: tall and raked (steam), straight, squat motorship stump. */
function stack(k: Kit, r: () => number, y0: number, z: number, body: number, band: number | undefined, size = 1): V3 {
  const f = pick(r, ['raked', 'raked', 'straight', 'motor'] as const);
  if (f === 'raked') return funnel(k, 0, y0, z, 4.4 * size, 7.4 * size, 9.5 * size, body, band, -0.18);
  if (f === 'straight') return funnel(k, 0, y0, z, 4.8 * size, 6.4 * size, 7.6 * size, body, band, -0.03);
  return funnel(k, 0, y0, z, 5.6 * size, 7.2 * size, 4.4 * size, body, band, -0.1);
}

/**
 * Accommodation from zA (aft) to zF (front): main deck house across the ship, boat deck with
 * lifeboats, `extra` intermediate decks, wheelhouse with wings and a dark roof. Returns the
 * boat deck height, the wheelhouse roof and the half breadth.
 */
export function house(k: Kit, g: THREE.Object3D, h: Hull, zA: number, zF: number, extra: number, c: number): { y2: number; roof: number; half: number } {
  const D = zF - zA;
  const y1 = base(h, zA, zF);
  const half = narrowest(h, zA, zF) - 0.5;
  k.block(half * 2, 3, D, 0, y1, (zA + zF) / 2, c);
  winRow(k, 'x', 0, y1 + 1.6, zF + 0.03, half * 2 - 3, Math.max(3, Math.round(half * 0.8)), 0.8, 0.7);
  for (const sx of [-1, 1]) winRow(k, 'z', sx * (half + 0.03), y1 + 1.6, (zA + zF) / 2, D - 5, Math.max(3, Math.round(D / 3)), 0.8, 0.7);
  const y2 = y1 + 3;
  const bw = Math.min(half * 2 - 4, half * 1.3);
  let y = y2;
  let l = D - 3;
  for (let i = 0; i <= extra; i++) {
    k.block(bw, 2.8, l, 0, y, zF - 1 - l / 2, c);
    winRow(k, 'x', 0, y + 1.5, zF - 0.97, bw - 3, Math.max(3, Math.round(bw / 1.5)), 0.8, 0.7);
    for (const sx of [-1, 1]) winRow(k, 'z', sx * (bw / 2 + 0.03), y + 1.5, zF - 1 - l / 2, l - 4, Math.max(2, Math.round(l / 3)), 0.8, 0.7);
    y += 2.8;
    l = Math.max(7, l * 0.6);
  }
  for (const sx of [-1, 1]) lifeboat(k, sx * (bw / 2 + 1.6), y2, zA + Math.min(9, D * 0.45), 7, sx);
  // Wheelhouse with wings right across, dark roof, mast and radar
  const wl = 6;
  k.block(bw - 1, 2.8, wl, 0, y, zF - 1 - wl / 2, c);
  winRow(k, 'x', 0, y + 1.7, zF - 0.97, bw - 3, Math.max(4, Math.round(bw / 1.3)), 1.0, 1.0);
  k.block(half * 2, 1.1, 2, 0, y, zF - 2, c);
  const roof = y + 2.8;
  k.block(bw - 0.6, 0.3, wl + 0.4, 0, roof, zF - 1 - wl / 2, C.dark);
  pole(k, 0, roof + 0.3, zF - 1 - wl * 0.8, 5, 0.22, C.dark, [0.6], 2.4);
  radar(g, k, 0, roof + 0.3, zF - 2.4, 3);
  return { y2, roof, half };
}

/** Deck cargo on a hatch cover at height y: lashed timber, boxes, or lorries and cars. */
function deckCargo(k: Kit, r: () => number, what: Stack, y: number, z: number, l: number, w: number): void {
  if (what === 'timber') {
    const hgt = 1.8 + r() * 1.6;
    k.block(w - 0.4, hgt, l - 0.8, 0, y, z, C.wood);
    for (let i = 0; i < 4; i++) k.block(w - 0.3, 0.08, 0.15, 0, y + hgt, z - l / 2 + 0.8 + ((l - 1.6) * i) / 3, C.dark);
  } else if (what === 'boxes') {
    const rows = Math.floor(w / 2.5);
    const len = l >= 12.5 ? 12.2 : 6.1;
    for (let i = 0; i < rows; i++) {
      const t = 1 + Math.floor(r() * 2);
      for (let j = 0; j < t; j++) k.block(2.45, 2.6, len, (i - (rows - 1) / 2) * 2.5, y + j * 2.6, z, pick(r, CRATES));
    }
  } else if (what === 'vehicles') {
    for (let x = -w / 2 + 1.6; x < w / 2 - 1.4; x += 3) {
      for (let zz = z - l / 2 + 3; zz < z + l / 2 - 2.5; zz += 6) {
        if (r() < 0.25) continue;
        const truck = r() < 0.5;
        k.block(2.3, truck ? 3 : 1.5, truck ? 5.5 : 4.2, x, y, zz, pick(r, [C.white, C.grey, 0x3b5a3a, 0x7a2a22, C.blue, C.buff]));
      }
    }
  }
}

/** Cargo gear standing at station z between two hatches. */
function gearAt(k: Kit, h: Hull, gear: Gear, z: number, c: number, reach: number, r: () => number): void {
  const y0 = base(h, z - 1, z + 1);
  if (gear === 'goalpost') {
    const top = y0 + 14;
    k.block(9, 1.4, 2, 0, y0, z, c);
    for (const sx of [-1, 1]) {
      k.cyl(0.42, top - y0, sx * 3.6, (y0 + top) / 2, z, c, 0.32, 8);
      derrick(k, sx * 3.6, y0 + 1.6, z + 1, top - 0.5, 1, reach, 0.4);
      derrick(k, sx * 3.6, y0 + 1.6, z - 1, top - 0.5, -1, reach, 0.4);
    }
    k.box(8.2, 0.7, 0.9, 0, top - 0.35, z, c);
    pole(k, 0, top, z, 5, 0.2, c, []);
  } else if (gear === 'kingpost') {
    const top = y0 + 12;
    k.block(3, 1.6, 3, 0, y0, z, c);
    k.cyl(0.5, top - y0, 0, (y0 + top) / 2, z, c, 0.35, 8);
    k.box(5, 0.3, 0.3, 0, top - 1.5, z, c);
    for (const sx of [-1, 1]) {
      derrick(k, sx * 1.6, y0 + 1.6, z + 0.6, top - 1.5, 1, reach, 0.45);
      derrick(k, sx * 1.6, y0 + 1.6, z - 0.6, top - 1.5, -1, reach, 0.45);
    }
  } else if (gear === 'crane') {
    // Pedestal crane on the centreline, cab on top, jib laid along the ship over a hatch
    const x = 0;
    k.cyl(1.2, 5, x, y0 + 2.5, z, c, 1.3, 12);
    k.block(3.2, 3.2, 3.6, x, y0 + 5, z, c);
    k.box(0.1, 1, 1.6, x + 1.62, y0 + 6.8, z + 0.6, C.glass);
    const dir = r() < 0.5 ? 1 : -1;
    const elev = 0.25 + r() * 0.5;
    const heel: V3 = [x, y0 + 6.5, z + dir * 1.4];
    const tip: V3 = [x, heel[1] + Math.sin(elev) * reach * 1.3, heel[2] + dir * Math.cos(elev) * reach * 1.3];
    k.rod(heel, tip, 0.5, c, 6, 0.25);
    k.line([x, y0 + 8.2, z], tip);
    k.line(tip, [tip[0], tip[1] - 6, tip[2]]);
  }
}

export type CargoKind = 'cargo' | 'reefer' | 'feeder';

/** General cargo ship, reefer or feeder (~120–140 m) after the look's seed. */
export function cargoShip(g: THREE.Group, lk: Look, kind: CargoKind = 'cargo'): void {
  const r = lk.r;
  const reefer = kind === 'reefer';
  const feeder = kind === 'feeder';
  const hullC = reefer ? pick(r, [0xe4e7e4, 0xdcdfd8, 0xe8e2d0]) : pick(r, HULLS);
  const [fBody, fBand] = pick(r, FUNNELS);
  const houseC = reefer ? C.white : pick(r, [C.white, C.white, C.cream, C.white]);
  const posts = pick(r, [C.buff, C.white, C.cream, hullC === C.white ? C.buff : C.dark]);
  const len = feeder ? 120 : reefer ? 140 : 130;
  const beam = feeder ? 20 : reefer ? 18.5 : 19;
  const L = len / 2;
  const stripe = reefer ? pick(r, [C.blue, 0x2a6a4a, C.red, undefined]) : r() < 0.25 ? pick(r, [C.white, C.red, C.buff]) : undefined;
  const h = loftHull(g, hullFor(lk, {
    len, beam, freeboard: 7, draft: 7.5, sheerBow: 2.2, sheerStern: 0.8, rake: reefer ? 10 : 7, flare: 0.08, fullness: reefer ? 0.35 : 0.55,
    transom: 0.4, bilge: 0.8, bulb: feeder, colors: { top: hullC, boot: 0x7a2a22, bottom: 0x5a2a24 }, boot: [-0.6, 0.9],
  }, 3.5, stripe));
  const k = new Kit(g);
  // Raised forecastle with bulwark, windlass and foremast; raised poop aft
  const fc = L - 14;
  raisedDeck(k, h, fc, L, 2.4, hullC);
  bulwark(k, h, fc, L - 0.4, 1.0, hullC, 2.4);
  windlass(k, h.deckAt(L - 7) + 2.4, L - 6, 2.2);
  pole(k, 0, h.deckAt(fc + 3) + 2.3, fc + 3, 13, 0.35, posts, [0.75], 3.5);
  raisedDeck(k, h, -L, -L + 8, 2.2, hullC);
  bulwark(k, h, -L + 0.5, -L + 8, 1.0, hullC, 2.2);
  // Where the house stands decides where the holds are
  const layout = feeder ? 'aft' : pick(r, reefer ? ['mid', 'aft34', 'aft34'] : ['mid', 'aft34', 'aft34', 'aft'] as const);
  const D = 21;
  const zA = layout === 'mid' ? -10 : layout === 'aft34' ? -40 : -L + 6;
  const zF = zA + D;
  const segs: [number, number][] = [[zF + 3, fc - 1]];
  if (layout !== 'aft') segs.push([-L + 10, zA - 3]);
  const total = segs.reduce((s, [a, b]) => s + b - a, 0);
  const n = feeder ? 4 + Math.floor(r() * 2) : reefer ? 4 : 4 + Math.floor(r() * 3);
  const gear: Gear = feeder ? pick(r, ['crane', 'none', 'none']) : pick(r, reefer ? ['goalpost', 'kingpost', 'crane'] : ['goalpost', 'goalpost', 'kingpost', 'crane'] as const);
  const cargo: Stack = feeder ? 'boxes' : lk.ballast > 0 ? 'none' : pick(r, ['none', 'none', 'none', 'timber', 'boxes', 'vehicles'] as const);
  const hw = beam * 0.55;
  let left = n;
  segs.forEach(([a, b], si) => {
    const m = si === segs.length - 1 ? left : Math.max(1, Math.round((n * (b - a)) / total));
    left -= m;
    if (m <= 0) return;
    const sp = (b - a) / m;
    const l = Math.min(14, sp * (gear === 'none' ? 0.85 : 0.62));
    for (let i = 0; i < m; i++) {
      const z = a + sp * (i + 0.5);
      const top = hatch(k, h, z, l, hw, 1.3, hullC, reefer ? C.grey : pick(r, [C.green, C.green, C.grey, 0x5a3a2a]));
      if (cargo !== 'none' && (feeder || r() < 0.7)) deckCargo(k, r, cargo, top, z, l, hw);
    }
    // Gear between the hatches, and at the end of a single-hatch hold
    if (gear !== 'none') for (let i = m === 1 ? 0 : 1; i < Math.max(2, m); i++) gearAt(k, h, gear, a + sp * i, posts, Math.min(13, sp * 0.8), r);
  });
  const hs = house(k, g, h, zA, zF, Math.floor(r() * 2), houseC);
  const top = stack(k, r, hs.y2 + 2.8, zA + 6, fBody, fBand);
  k.done();
  shipName(g, h, pick(r, NAMES), L - 8.5, h.deckAt(L - 9) + 0.9, 1.5);
  smoke(g, top[0], top[1] + 0.5, top[2], 7);
  navLights(g, len, beam, hs.roof + 5.3, zF - 5, h.deckAt(0));
  wake(g, 200, beam, L, -L);
  stretch(g, lk);
}

/** Bulk carrier (~165 m): full hull, seven wide hatches, gearless or with deck cranes, house right aft. */
export function bulkCarrier(g: THREE.Group, lk: Look): void {
  const r = lk.r;
  const hullC = pick(r, HULLS);
  const [fBody, fBand] = pick(r, FUNNELS);
  const len = 165, beam = 25, L = len / 2;
  const h = loftHull(g, hullFor(lk, {
    len, beam, freeboard: 6.5, draft: 10, sheerBow: 2, sheerStern: 0.4, rake: 5, flare: 0.04, fullness: 0.85, transom: 0.6, bilge: 1,
    bulb: true, colors: { top: hullC, boot: 0x7a2a22, bottom: 0x5a2a24 }, boot: [-0.7, 1.1],
  }, 5.5, r() < 0.3 ? C.white : undefined));
  const k = new Kit(g);
  raisedDeck(k, h, L - 12, L, 2.6, hullC);
  bulwark(k, h, L - 12, L - 0.4, 1.1, hullC, 2.6);
  windlass(k, h.deckAt(L - 6) + 2.6, L - 5, 2.8);
  pole(k, 0, h.deckAt(L - 10) + 2.5, L - 10, 10, 0.35, C.cream, [0.8], 3);
  const cover = pick(r, [C.green, C.grey, 0x7a2a22, 0x2f5d7c]);
  const geared = r() < 0.45;
  const zF = -L + 28;
  const n = 7;
  const sp = (L - 14 - (zF + 3)) / n;
  for (let i = 0; i < n; i++) hatch(k, h, zF + 3 + sp * (i + 0.5), sp * 0.7, beam * 0.6, 1.4, hullC, cover);
  if (geared) for (let i = 1; i < n; i += 2) gearAt(k, h, 'crane', zF + 3 + sp * i, pick(r, [C.buff, C.white, C.orange]), 12, r);
  const hs = house(k, g, h, -L + 7, zF, 2 + Math.floor(r() * 2), pick(r, [C.white, C.cream]));
  const top = stack(k, r, hs.y2 + 2.8, -L + 11, fBody, fBand, 1.15);
  k.done();
  shipName(g, h, pick(r, NAMES), L - 8, h.deckAt(L - 8) + 1, 1.8);
  smoke(g, top[0], top[1] + 0.5, top[2], 7);
  navLights(g, len, beam, hs.roof + 5.3, zF - 5, h.deckAt(0));
  wake(g, 240, beam, L, -L);
  stretch(g, lk, 0.1, 0.05);
}

/** Ro-Ro freighter (~140 m): slab-sided vehicle decks right along, bridge forward, twin funnels and stern ramp aft. */
export function roro(g: THREE.Group, lk: Look): void {
  const r = lk.r;
  const hullC = pick(r, [C.blue, 0x2b3a31, 0x7a2a22, C.dark, 0x4a5156]);
  const boxC = pick(r, [C.white, C.white, hullC, C.grey]);
  const [fBody, fBand] = pick(r, FUNNELS);
  const len = 140, beam = 22, L = len / 2;
  const h = loftHull(g, hullFor(lk, {
    len, beam, freeboard: 6, draft: 6.5, sheerBow: 1.8, sheerStern: 0.2, rake: 8, flare: 0.06, fullness: 0.5, transom: 0.95, bilge: 0.7,
    bulb: true, colors: { top: hullC, boot: 0x7a2a22, bottom: 0x5a2a24 }, boot: [-0.6, 1.0],
  }, 2.5, r() < 0.4 ? C.white : undefined));
  const k = new Kit(g);
  // Upper vehicle decks: a box from the transom nearly to the bow, following the hull outline
  const yTop = (z: number) => h.deckAt(0) + 9 + 0 * z;
  loftBlock(k, h, -L + 0.5, L - 16, 0.05, (z) => h.deckAt(z) - 0.2, yTop, boxC, C.grey);
  const yT = yTop(0);
  for (const sx of [-1, 1]) for (let z = -L + 8; z < L - 22; z += 9) k.box(0.1, 1.2, 4, sx * (h.halfBeamAt(z, h.deckAt(z)) + 0.02), yT - 2.5, z, C.dark);
  // Stern ramp raised against the transom, a dark slot behind it
  k.box(14, yT - h.deckAt(-L) - 1, 0.4, 0, (yT + h.deckAt(-L)) / 2, -L - 0.3, C.grey);
  for (const sx of [-1, 1]) k.line([sx * 7, yT, -L - 0.3], [sx * 7, yT + 6, -L + 4]);
  // Forecastle in front of the box, bridge on top at its front, funnels aft
  raisedDeck(k, h, L - 16, L, 2.4, hullC);
  windlass(k, h.deckAt(L - 6) + 2.4, L - 6, 2.4);
  const zF = L - 17;
  const half = narrowest(h, zF - 14, zF) - 1;
  k.block(half * 2, 2.8, 14, 0, yT, zF - 7, C.white);
  winRow(k, 'x', 0, yT + 1.5, zF + 0.03, half * 2 - 3, Math.round(half), 0.9, 0.8);
  k.block(half * 1.4, 2.8, 7, 0, yT + 2.8, zF - 4, C.white);
  winRow(k, 'x', 0, yT + 4.5, zF - 0.47, half * 1.4 - 2, Math.round(half), 1.0, 1.0);
  k.block(half * 2, 1.1, 2, 0, yT + 2.8, zF - 1.5, C.white);
  k.block(half * 1.4 + 0.4, 0.3, 7.4, 0, yT + 5.6, zF - 4, C.dark);
  pole(k, 0, yT + 5.9, zF - 6, 5, 0.22, C.dark, [0.6], 2.4);
  radar(g, k, 0, yT + 5.9, zF - 2.5, 3);
  for (const sx of [-1, 1]) lifeboat(k, sx * (half - 1.5), yT, zF - 16, 7, sx);
  let top: V3 = [0, 0, 0];
  for (const sx of [-1, 1]) top = funnel(k, sx * (half - 2.5), yT, -L + 14, 2.6, 4.4, 6, fBody, fBand, -0.08);
  k.done();
  shipName(g, h, pick(r, NAMES), L - 8, h.deckAt(L - 8) + 0.9, 1.6);
  smoke(g, 0, top[1] + 0.4, top[2], 6);
  navLights(g, len, beam, yT + 11, zF - 6, h.deckAt(0));
  wake(g, 210, beam, L, -L);
  stretch(g, lk, 0.08, 0.04);
}
