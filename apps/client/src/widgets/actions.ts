import { bearing, distance, type Vec2 } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { km, tdeg3 } from './format.js';
import type { MenuItem } from './menu.js';

/** Right-click map actions shared by stations. */
export function courseAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  if (!s) return [];
  const b = Math.round(bearing(s.own, p));
  return [{ label: `Kurs hierher (${tdeg3(b)}°)`, run: () => net.send({ t: 'order', heading: b % 360 }) }];
}

export function torpedoAction(p: Vec2, opts: { speedKn: number; searchDepth: number; mode: 'passive' | 'active' }): MenuItem[] {
  const s = store.snap;
  if (!s || !s.own.loadout.tubes.some((t) => t.loaded)) return [];
  const b = bearing(s.own, p);
  const d = distance(s.own, p);
  return [{
    label: `Torpedo hierher (${tdeg3(b)}°, Suchkopf ab ${km(d * 0.7)})`,
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

/** Anti-ship missile (patrol ship): a sea skimmer to this point, seeker opens 9 km short of it. */
export function ssmAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  const fk = s?.ssm;
  if (!s || fk?.left === undefined || fk.left <= 0) return [];
  const d = distance(s.own, p);
  if (d < (fk.minRange ?? 0) || d > (fk.maxRange ?? 0)) return [{ label: `Seeziel-FK: ${km(fk.minRange ?? 0)}–${km(fk.maxRange ?? 0)}`, run: () => undefined }];
  if (fk.readyInS) return [{ label: `Seeziel-FK: Starter lädt (${fk.readyInS} s)`, run: () => undefined }];
  return [{ label: `Seeziel-FK hierher (${km(d)}, noch ${fk.left})`, danger: true, run: () => net.send({ t: 'ssm', bearing: bearing(s.own, p), range: d }) }];
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
      { label: 'Aktive Boje (DICASS) hierher · pingt, verrät sich', run: () => net.send({ t: 'buoy', bearing: b, range: d, deep: true, active: true }) },
    ] : []),
    { label: 'Hubschrauber: Tauchsonar hier (flach)', run: () => net.send({ t: 'dip', bearing: b, range: d, deep: false }) },
    { label: 'Hubschrauber: Tauchsonar hier (unter Schicht)', run: () => net.send({ t: 'dip', bearing: b, range: d, deep: true }) },
    { label: 'Hubschrauber: MAD-Suche hier (Kleeblatt, 6 min)', run: () => net.send({ t: 'mad', bearing: b, range: d }) },
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
