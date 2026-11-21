import { bearing, distance, type Vec2 } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { deg3, km } from './format.js';
import type { MenuItem } from './menu.js';

/** Right-click map actions shared by stations. */
export function courseAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  if (!s) return [];
  const b = Math.round(bearing(s.own, p));
  return [{ label: `Kurs hierher (${deg3(b)}°)`, run: () => net.send({ t: 'order', heading: b % 360 }) }];
}

export function torpedoAction(p: Vec2, opts: { speedKn: number; searchDepth: number; mode: 'passive' | 'active' }): MenuItem[] {
  const s = store.snap;
  if (!s || !s.own.loadout.tubes.some((t) => t.loaded)) return [];
  const b = bearing(s.own, p);
  const d = distance(s.own, p);
  return [{
    label: `Torpedo hierher (${deg3(b)}°, Suchkopf ab ${km(d * 0.7)})`,
    danger: true,
    run: () => net.send({ t: 'fire', heading: b, enableAfter: Math.max(500, d * 0.7), mode: opts.mode, searchDepth: opts.searchDepth, speedKn: opts.speedKn }),
  }];
}

export function rocketAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  if (!s || s.own.loadout.rockets <= 0) return [];
  const d = distance(s.own, p);
  if (d < 1000 || d > 18_000) return [{ label: 'U-Jagd-Rakete: 1–18 km Reichweite', run: () => undefined }];
  return [{
    label: `U-Jagd-Rakete hierher (${km(d)})`,
    danger: true,
    run: () => net.send({ t: 'rocket', bearing: bearing(s.own, p), range: d }),
  }];
}

export function buoyAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  if (!s?.air) return [];
  const d = distance(s.own, p);
  if (d < 500 || d > 30_000) return [{ label: 'Hubschrauber: 0,5–30 km Reichweite', run: () => undefined }];
  if (s.air.heloReadyInS > 0) return [{ label: `Hubschrauber bereit in ${Math.ceil(s.air.heloReadyInS / 60)} min`, run: () => undefined }];
  const b = bearing(s.own, p);
  return [
    ...(s.air.stock > 0 ? [
      { label: `Sonarboje flach hierher (${km(d)})`, run: () => net.send({ t: 'buoy', bearing: b, range: d, deep: false }) },
      { label: 'Sonarboje tief (unter Schicht) hierher', run: () => net.send({ t: 'buoy', bearing: b, range: d, deep: true }) },
    ] : []),
    { label: 'Hubschrauber: Tauchsonar hier (flach)', run: () => net.send({ t: 'dip', bearing: b, range: d, deep: false }) },
    { label: 'Hubschrauber: Tauchsonar hier (unter Schicht)', run: () => net.send({ t: 'dip', bearing: b, range: d, deep: true }) },
    ...(s.air.heloTorps > 0 ? [{ label: `Hubschrauber: Torpedo hier (${s.air.heloTorps})`, danger: true, run: () => net.send({ t: 'helotorp', bearing: b, range: d }) }] : []),
  ];
}

/** Maritime patrol aircraft: a buoy line across the line of sight at that point. */
export function mpaAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  if (!s?.air) return [];
  if (s.air.mpaReadyInS > 0) return [{ label: `Seefernaufklärer bereit in ${Math.ceil(s.air.mpaReadyInS / 60)} min`, run: () => undefined }];
  if (s.air.mpaBuoys < 6) return [];
  const b = bearing(s.own, p);
  return [{ label: 'Seefernaufklärer: Bojensperre hier (6 Bojen quer)', run: () => net.send({ t: 'mpa', bearing: b, range: distance(s.own, p) }) }];
}
