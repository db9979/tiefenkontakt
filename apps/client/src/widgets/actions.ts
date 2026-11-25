import { ROCKET_MIN_RANGE, bearing, distance, launchBlock, type Snapshot, type Vec2 } from '@tk/shared';
import { friendNear } from './fire-guard.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { km, tdeg3 } from './format.js';
import { openMenu, type MenuItem } from './menu.js';

/** A warning in front of a weapon order when own or friendly ships are near where it lands. */
const warnNear = (s: Snapshot, p: Vec2): string => (friendNear(s, p, 2000) ? '⚠ EIGENE IN DER NÄHE · ' : '');

/** Right-click map actions shared by stations. */
export function courseAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  if (!s) return [];
  const b = Math.round(bearing(s.own, p));
  return [{ label: `Kurs hierher (${tdeg3(b)}°)`, run: () => net.send({ t: 'order', heading: b % 360 }) }];
}

/**
 * "Torpedo hierher". Outside the launch envelope it only says why. With `aim` (expert mode) it
 * doesn't fire: it sets the firing course and seeker distance, and the guarded FEUER button fires.
 */
export function torpedoAction(
  p: Vec2,
  opts: { speedKn: number; searchDepth: number; mode: 'passive' | 'active'; aim?: (heading: number, enableAfter: number) => void },
): MenuItem[] {
  const s = store.snap;
  if (!s || !s.own.loadout.tubes.some((t) => t.loaded)) return [];
  const block = launchBlock(s.own.cls, s.own.speedKn, s.own.depth);
  if (block) {
    const why = block.why === 'speed'
      ? `Abschuss nur bis ${block.limit} kn (jetzt ${Math.round(s.own.speedKn)} kn)`
      : `Abschuss nur bis ${block.limit} m Tiefe (jetzt ${Math.round(s.own.depth)} m)`;
    return [{ label: why, run: () => undefined }];
  }
  const b = bearing(s.own, p);
  const d = distance(s.own, p);
  const enableAfter = Math.max(500, d * 0.7);
  const aim = opts.aim;
  if (aim) return [{ label: `Schusskurs hierher (${tdeg3(b)}°, Suchkopf ab ${km(d * 0.7)})`, run: () => aim(b, enableAfter) }];
  return [{
    label: `${warnNear(s, p)}Torpedo hierher (${tdeg3(b)}°, Suchkopf ab ${km(d * 0.7)})`,
    danger: true,
    run: () => net.send({ t: 'fire', heading: b, enableAfter, mode: opts.mode, searchDepth: opts.searchDepth, speedKn: opts.speedKn }),
  }];
}

export function rocketAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  if (!s || s.own.loadout.rockets <= 0) return [];
  const d = distance(s.own, p);
  if (d < ROCKET_MIN_RANGE || d > 18_000) return [{ label: 'U-Jagd-Rakete: 1,8–18 km Reichweite', run: () => undefined }];
  return [{
    label: `${warnNear(s, p)}U-Jagd-Rakete hierher (${km(d)})`,
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
  return [{ label: `${warnNear(s, p)}Seeziel-FK hierher (${km(d)}, noch ${fk.left})`, danger: true, run: () => net.send({ t: 'ssm', bearing: bearing(s.own, p), range: d }) }];
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

/** Page position of the last pointer press (the task submenu opens where the first menu was). */
let lastPress = { x: 200, y: 200 };
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => (lastPress = { x: e.clientX, y: e.clientY }), true);

/**
 * Escort commander: "Auftrag an <Schiff>" for each AI escort of the side; picking one opens her
 * tasks at this point (station here, search the sector, prosecute the datum, helicopter here).
 */
export function escortOrderActions(p: Vec2): MenuItem[] {
  const s = store.snap;
  const cmd = s?.command;
  if (!s || !cmd?.escorts.length) return [];
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  return cmd.escorts.map((e) => ({
    label: `Auftrag an ${e.name} …`,
    run: () => {
      const items: MenuItem[] = [
        ...(cmd.convoy ? [{ label: 'Station hier (zieht mit dem Konvoi)', run: () => net.send({ t: 'escort_task', shipId: e.id, task: 'station', x, y }) }] : []),
        { label: 'Sektor hier absuchen', run: () => net.send({ t: 'escort_task', shipId: e.id, task: 'sector', x, y }) },
        { label: 'Datum hier verfolgen', run: () => net.send({ t: 'escort_task', shipId: e.id, task: 'datum', x, y }) },
        ...(e.helo ? [{ label: 'Hubschrauber hierher', run: () => net.send({ t: 'escort_task', shipId: e.id, task: 'helo', x, y }) }] : []),
        ...(e.task ? [{ label: 'Auftrag aufheben (zurück in die Sicherung)', run: () => net.send({ t: 'escort_task', shipId: e.id, task: 'cancel' }) }] : []),
      ];
      // Opened after the first menu has closed
      setTimeout(() => openMenu(lastPress.x, lastPress.y, items, `Auftrag an ${e.name}`), 0);
    },
  }));
}
