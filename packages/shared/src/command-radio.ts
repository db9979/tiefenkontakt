import { CLASSES } from './classes.js';
import { isConvoyShip, type Ship } from './entities.js';
import { KN, NM, bearing, distance } from './math.js';
import type { World } from './world.js';

/**
 * Broadcasts from fleet command to the wolfpack: a situation report at fixed times.
 * A submerged boat only copies it with 60 s of steady reception during the window:
 * shallow enough for the VLF loop (≤ 25 m), or with the trailing buoy antenna streamed
 * (≤ 60 m and ≤ 6 kn). Copying it costs depth and speed when it matters most.
 */

export const BROADCAST_EVERY_S = 1200;
export const BROADCAST_FIRST_S = 600;
export const BROADCAST_WINDOW_S = 180;
const RX_NEEDED_S = 60;
const VLF_DEPTH_M = 25;
const BUOY_DEPTH_M = 60;
const BUOY_MAX_KN = 6;
/** ELF reaches a nuclear boat deep down, but carries only a few letters: the call to come up. */
const ELF_WARN_S = 150;
const ELF_CLASSES = new Set(['ssn']);

/** Index of the broadcast whose window contains `t`, or undefined. */
export function broadcastAt(t: number): number | undefined {
  if (t < BROADCAST_FIRST_S) return undefined;
  const k = Math.floor((t - BROADCAST_FIRST_S) / BROADCAST_EVERY_S);
  return t - (BROADCAST_FIRST_S + k * BROADCAST_EVERY_S) < BROADCAST_WINDOW_S ? k : undefined;
}

/** Seconds until the next window opens (0 while one is open). */
export function nextBroadcastIn(t: number): number {
  if (broadcastAt(t) !== undefined) return 0;
  if (t < BROADCAST_FIRST_S) return BROADCAST_FIRST_S - t;
  const k = Math.floor((t - BROADCAST_FIRST_S) / BROADCAST_EVERY_S) + 1;
  return BROADCAST_FIRST_S + k * BROADCAST_EVERY_S - t;
}

/** Whether the boat can copy VLF right now (and how). */
export function canCopy(s: Ship): 'vlf' | 'buoy' | undefined {
  if (s.depth <= VLF_DEPTH_M) return 'vlf';
  if (s.buoyAntenna && s.depth <= BUOY_DEPTH_M && s.speed / KN <= BUOY_MAX_KN) return 'buoy';
  return undefined;
}

/** What command knows: convoy centre (with an error of a mile or so), course and speed. */
function report(w: World, s: Ship): string {
  const merchants = w.ships.filter((m) => isConvoyShip(m) && m.alive);
  if (!merchants.length) return 'FÜHRUNG: KEINE NEUEN ERKENNTNISSE. FREIE JAGD.';
  const c = merchants.reduce((a, m) => ({ x: a.x + m.pos.x / merchants.length, y: a.y + m.pos.y / merchants.length }), { x: 0, y: 0 });
  const err = { x: w.rng.gauss(0, 1500), y: w.rng.gauss(0, 1500) };
  const rep = { x: c.x + err.x, y: c.y + err.y };
  // Given relative to where the boat believes it is (its dead reckoning)
  const me = { x: s.pos.x + (s.drErr?.x ?? 0), y: s.pos.y + (s.drErr?.y ?? 0) };
  const b = Math.round(bearing(me, rep)).toString().padStart(3, '0');
  const r = (distance(me, rep) / NM).toFixed(0);
  const crs = Math.round(w.convoy?.guideHeading ?? merchants[0]!.heading).toString().padStart(3, '0');
  const kn = Math.round(merchants[0]!.speed / KN);
  const escorts = w.ships.filter((x) => x.alive && x.team !== s.team && !CLASSES[x.cls].submarine && x.cls !== 'merchant').length;
  return `FÜHRUNG: KONVOI ${merchants.length} FRACHTER, PEILUNG ${b}, CA. ${r} SM, KURS ${crs}, ${kn} KN. ${escorts} GELEITSCHIFFE.`;
}

export function stepCommandRadio(w: World, dt: number): void {
  const k = broadcastAt(w.time);
  const was = broadcastAt(w.time - dt);
  const elf = nextBroadcastIn(w.time) <= ELF_WARN_S && nextBroadcastIn(w.time - dt) > ELF_WARN_S;
  for (const s of w.ships) {
    if (!s.alive || !CLASSES[s.cls].submarine || s.team === 'neutral') continue;
    // The ELF bell ringer: a few characters at any depth, "come up for traffic"
    if (elf && ELF_CLASSES.has(s.cls) && !canCopy(s)) {
      w.events.push({ kind: 'boat', time: w.time, shipId: s.id, what: 'command', text: 'ELF-RUF: FUNKSPRUCH DER FÜHRUNG IN 2 MIN · AUF EMPFANGSTIEFE GEHEN (25 M ODER SCHLEPPANTENNE)' });
    }
    const rx = s.cmdRx;
    if (k !== undefined) {
      if (!rx || rx.k !== k) s.cmdRx = { k, secs: 0, done: false };
      const r = s.cmdRx!;
      if (r.done) continue;
      r.secs = canCopy(s) ? r.secs + dt : 0;
      if (r.secs >= RX_NEEDED_S) {
        r.done = true;
        w.events.push({ kind: 'boat', time: w.time, shipId: s.id, what: 'command', text: report(w, s) });
      }
    } else if (was !== undefined && rx && rx.k === was && !rx.done) {
      rx.done = true;
      w.events.push({ kind: 'boat', time: w.time, shipId: s.id, what: 'command-missed', text: 'FUNKSPRUCH DER FÜHRUNG VERPASST · NÄCHSTER IN 17 MIN' });
    }
  }
}
