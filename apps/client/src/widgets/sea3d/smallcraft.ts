import * as THREE from 'three';
import { navLights, smoke, wake } from './parts.js';
import { loftHull, railing } from './hullkit.js';
import { C, Kit, base, bulwark, funnel, loftBlock, narrowest, pole, radar, raisedDeck, type V3 } from './civilkit.js';
import { blockWindows, deckPaint } from './civil.js';
import { hullFor, pick, stretch, type Look } from './variety.js';

/**
 * Small civil craft: sloops under sail (the yacht class always carries a mast: the stadimeter
 * ranges on it), stern trawlers with a ramp
 * and gantry, and older side trawlers with the bridge aft and gallows at the rail. Bow +z,
 * waterline y = 0, port = +x. Each takes a Look (variety.ts) for its colours and size.
 */

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
export function yacht(g: THREE.Group, lk: Look): void {
  const r = lk.r;
  const hullC = pick(r, [C.white, C.white, C.blue, 0x2b4a3a, 0x9a2a2a, 0x23324a]);
  const len = 13;
  const beam = 4;
  const h = loftHull(g, {
    len, beam, freeboard: 1.05, draft: 0.6, sheerBow: 0.5, sheerStern: 0.15, rake: 1.8, flare: 0.04, fullness: 0.1, transom: 0.6, bilge: 0.35,
    colors: { top: hullC, boot: hullC === C.white ? pick(r, [C.blue, C.red, 0x2b4a3a]) : C.white, bottom: 0x23324a }, boot: [-0.06, 0.12],
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
  const mh = 14 + r() * 3;
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
  stretch(g, lk, 0.2, 0.08);
}

/** Stern trawler (~42 m): whaleback shelter deck with the bridge forward, net drum, ramp and gantry aft. */
export function trawler(g: THREE.Group, lk: Look): void {
  if (lk.varied && lk.r() < 0.4) return sideTrawler(g, lk);
  const r = lk.r;
  const hullC = pick(r, [0x7a2a22, 0x23415a, 0x2b4a3a, 0x3a3f44, C.dark, C.blue, 0x8a5a2a]);
  const len = 42;
  const beam = 10;
  const h = loftHull(g, {
    len, beam, freeboard: 2.6, draft: 4, sheerBow: 2.2, sheerStern: 0.3, rake: 2, flare: 0.12, fullness: 0.4, transom: 0.85, bilge: 0.6,
    colors: { top: hullC, boot: C.dark, bottom: 0x5a2a24 }, boot: [-0.4, 0.5], rust: Math.min(1, lk.rust * 1.5), seed: lk.seed,
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
  stretch(g, lk, 0.15, 0.06);
}

/** Side trawler (~50 m, the older type): long forecastle, bridge and funnel aft, gallows at the starboard rail, two masts. */
function sideTrawler(g: THREE.Group, lk: Look): void {
  const r = lk.r;
  const hullC = pick(r, [C.dark, 0x23415a, 0x2b4a3a, 0x7a2a22, 0x3a3f44]);
  const len = 48, beam = 9, L = len / 2;
  const h = loftHull(g, hullFor(lk, {
    len, beam, freeboard: 2.2, draft: 4.2, sheerBow: 3.2, sheerStern: 1.2, rake: 2.5, flare: 0.1, fullness: 0.35, transom: 0.4, bilge: 0.6,
    colors: { top: hullC, boot: C.white, bottom: 0x5a2a24 }, boot: [-0.4, 0.3],
  }, 0, r() < 0.5 ? C.white : undefined));
  const k = new Kit(g);
  raisedDeck(k, h, L - 16, L, 2.1, hullC);
  bulwark(k, h, -L + 0.5, L - 16, 1.1, hullC);
  bulwark(k, h, L - 16, L - 0.3, 1.0, hullC, 2.1);
  pole(k, 0, h.deckAt(L - 12) + 2.1, L - 12, 11, 0.25, C.buff, [0.7], 2.2);
  // Bridge and funnel aft of amidships, casing, mizzen with a riding sail
  const yS = base(h, -10, 2);
  const hw = narrowest(h, -10, 2) - 1.2;
  k.block(hw * 2, 2.4, 12, 0, yS, -4, C.white);
  k.block(5.6, 2.3, 4.5, 0, yS + 2.4, -0.2, pick(r, [C.white, C.buff]));
  blockWindows(k, 2.8, yS + 3.6, -2.45, 2.05, 1.1, 0.8, 0.9);
  k.block(6, 0.2, 5, 0, yS + 4.7, -0.2, C.dark);
  radar(g, k, 0, yS + 4.9, -0.5, 1.8);
  const top = funnel(k, 0, yS + 2.4, -6.5, 2.4, 3.4, 5, pick(r, [C.dark, C.buff, hullC]), pick(r, [C.white, C.red, undefined]), -0.15);
  pole(k, 0, base(h, -L + 4, -L + 6), -L + 5, 8, 0.2, C.buff, [0.8], 1.6);
  k.raw([0, base(h, -L + 4, -L + 6) + 2.5, -L + 5.1, 0, base(h, -L + 4, -L + 6) + 7.5, -L + 5.1, 0, base(h, -L + 4, -L + 6) + 2.5, -L + 9], 0x8a7a5a);
  // Gallows: inverted U frames at the starboard rail fore and aft, trawl doors hung on them
  for (const z of [L - 20, -L + 11]) {
    const x = -(h.halfBeamAt(z, h.deckAt(z)) - 0.3);
    const y0 = h.deckAt(z);
    const fr: V3[] = [[x, y0, z - 1.2], [x - 0.6, y0 + 3.4, z - 0.6], [x - 0.6, y0 + 3.4, z + 0.6], [x, y0, z + 1.2]];
    for (let i = 0; i < 3; i++) k.rod(fr[i]!, fr[i + 1]!, 0.16, C.buff, 5);
    k.box(0.15, 1.6, 2.6, x - 0.35, y0 + 1.1, z, C.dark);
  }
  k.done();
  smoke(g, top[0], top[1] + 0.3, top[2], 3);
  navLights(g, len, beam, yS + 9, -0.5, h.deckAt(0));
  wake(g, 80, beam, L, -L);
  stretch(g, lk, 0.12, 0.05);
}
