import { CLASSES, HELO_RANGE, ROCKET_MAX_RANGE, ROCKET_MIN_RANGE, bearing, distance, launchBlock, type Snapshot, type Vec2 } from '@tk/shared';
import { friendNear } from './fire-guard.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { chartDist, km, tdeg3 } from './format.js';
import { rocketCheck } from './weapon-reach.js';
import { openMenu, type MenuItem } from './menu.js';
import { heloMode, pickHeloPoint } from './helo-panel.js';

/** A warning in front of a weapon order when own or friendly ships are near where it lands. */
const warnNear = (s: Snapshot, p: Vec2): string => (friendNear(s, p, 2000) ? '⚠ EIGENE IN DER NÄHE · ' : '');
/** A range in the chart's unit: sea miles on a surface ship (F19), kilometres on the boat. */
const dist = (s: Snapshot, m: number) => chartDist(m, !CLASSES[s.own.cls].submarine);

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
    return [{ label: why, run: () => undefined, info: true }];
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
  // F18: the same envelope check as the fire buttons; out of reach it is a disabled line saying why
  const chk = rocketCheck(d);
  if (chk.block) {
    // The envelope in the chart's unit too (not "über 18 km" beside a range in sea miles)
    const why = d < ROCKET_MIN_RANGE ? `ZU NAH (${dist(s, d)} · AB ${dist(s, ROCKET_MIN_RANGE)})` : `ZU WEIT (${dist(s, d)} · BIS ${dist(s, ROCKET_MAX_RANGE)})`;
    return [{ label: `U-Jagd-Rakete: ${why}`, run: () => undefined, info: true }];
  }
  return [{
    label: `${warnNear(s, p)}U-Jagd-Rakete hierher (${dist(s, d)})`,
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
  if (d < (fk.minRange ?? 0) || d > (fk.maxRange ?? 0)) return [{ label: `Seeziel-FK: ${km(fk.minRange ?? 0)}–${km(fk.maxRange ?? 0)}`, run: () => undefined, info: true }];
  if (fk.readyInS) return [{ label: `Seeziel-FK: Starter lädt (${fk.readyInS} s)`, run: () => undefined, info: true }];
  return [{ label: `${warnNear(s, p)}Seeziel-FK hierher (${dist(s, d)}, noch ${fk.left})`, danger: true, run: () => net.send({ t: 'ssm', bearing: bearing(s.own, p), range: d }) }];
}

export function buoyAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  if (!s?.air) return [];
  const d = distance(s.own, p);
  const hv = s.air.helo;
  if (!hv) return [];
  if (d < 500 || d > HELO_RANGE) return [{ label: `Hubschrauber: 0,5–${HELO_RANGE / 1000} km Reichweite`, run: () => undefined, info: true }];
  const b = bearing(s.own, p);
  // Tasks go into the helicopter's queue (at the end, or at once in SOFORT mode of the helicopter panel)
  const op = heloMode();
  const now = op === 'now' ? ' (sofort)' : '';
  const task = (kind: 'dip' | 'buoys' | 'mad' | 'attack', extra: { active?: boolean } = {}) => () => net.send({ t: 'helo', op, kind, bearing: b, range: d, ...extra });
  // The submenu's title says "Hubschrauber": the lines name only the task
  const items: MenuItem[] = [
    { label: `Ziel für die Aufträge hier (${dist(s, d)})`, run: () => pickHeloPoint(p) },
    { label: `Tauchsonar hier${now}`, run: task('dip') },
    ...(hv.buoys + hv.magBuoys > 0 ? [
      { label: `Bojenlinie hier${now}`, run: task('buoys') },
      { label: 'Aktive Bojenlinie (DICASS) · pingt, verrät sich', run: task('buoys', { active: true }) },
    ] : []),
    { label: `MAD-Suche hier (Kleeblatt, 6 min)${now}`, run: task('mad') },
    ...(hv.torps + hv.magTorps > 0 ? [{ label: `${warnNear(s, p)}Torpedo hier (${hv.torps})${now}`, danger: true, run: task('attack') }] : []),
  ];
  // One line in the chart menu, the tasks in a second menu (the chart menu stays short)
  return [submenu(`Hubschrauber ▸ (${dist(s, d)})`, `Hubschrauber · ${tdeg3(b)}° · ${dist(s, d)}`, items)];
}

/** A menu line that opens a second menu where the first one was. */
function submenu(label: string, title: string, items: MenuItem[]): MenuItem {
  return { label, run: () => setTimeout(() => openMenu(lastPress.x, lastPress.y, items, title), 0) };
}

/** Maritime patrol aircraft: a buoy line across the line of sight at that point. */
export function mpaAction(p: Vec2): MenuItem[] {
  const s = store.snap;
  if (!s?.air) return [];
  if (s.air.mpaReadyInS > 0) return [{ label: `Seefernaufklärer bereit in ${Math.ceil(s.air.mpaReadyInS / 60)} min`, run: () => undefined, info: true }];
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
  if (!s || !cmd) return [];
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  // Convoy course toward the clicked point, from the middle of the merchants afloat
  const ms = s.friendlies.filter((f) => f.cls === 'merchant' && f.alive);
  const convoyItems: MenuItem[] = cmd.convoy && ms.length ? [{
    label: 'Konvoi-Kurs hierher',
    run: () => {
      const cx = ms.reduce((a, m) => a + m.x, 0) / ms.length;
      const cy = ms.reduce((a, m) => a + m.y, 0) / ms.length;
      net.send({ t: 'convoy_order', order: 'course', course: Math.round(((Math.atan2(x - cx, y - cy) * 180) / Math.PI + 360) % 360) });
    },
  }] : [];
  const escortItems = cmd.escorts.map((e) => ({
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
  const all = [...convoyItems, ...escortItems];
  // More than one order for the group: one line "Verband ▸" in the chart menu
  return all.length > 1 ? [submenu('Verband ▸', 'Verband · Befehle an diesen Punkt', all)] : all;
}
