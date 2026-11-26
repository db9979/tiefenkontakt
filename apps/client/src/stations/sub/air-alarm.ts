import { PERISCOPE_DEPTH, type PlaneView, type Snapshot } from '@tk/shared';
import { audio } from '../../audio.js';
import { store } from '../../store.js';
import { tdeg3 } from '../../widgets/format.js';
import { callouts } from '../../widgets/callouts.js';
import { pushLog } from '../../widgets/log-group.js';

/**
 * Fliegeralarm: an enemy (or unknown) aircraft seen by eye or on the mast radar while the boat
 * shows a mast or snorkel. A helicopter hovering a few hundred metres off is the one sight that
 * must send a boat down at once, so it rings, writes a log line and offers ALARMTAUCHEN.
 */

const NAME: Record<PlaneView['kind'], string> = { airliner: 'VERKEHR', light: 'KLEINFLZ.', recon: 'AUFKL.', mpa: 'SEEAUFKL.', helo: 'HUBSCHR.' };
/** Within this range (m) a seen aircraft is an air alarm. */
const ALARM_M = 8000;
/** The same aircraft rings again only after this long out of sight (s). */
const RE_ARM_S = 120;
/** Low: below this height (m) the aircraft is low enough to see a mast wake. */
const LOW_M = 1500;

/** Same pseudo-random range error the chart uses for an eye-only sighting (air-symbols.ts). */
function hash(id: string): number {
  let x = 2166136261;
  for (let i = 0; i < id.length; i++) x = Math.imul(x ^ id.charCodeAt(i), 16777619);
  return ((x >>> 0) % 1000) / 1000;
}

export interface AirThreat {
  plane: PlaneView;
  /** Estimated range (m): by eye about ±25 %. */
  range: number;
  /** "HUBSCHR. 081° ~0,6 KM · NIEDRIG" */
  text: string;
}

/** The nearest hostile or unknown aircraft in sight (eye or radar), if any. */
export function airThreat(s: Snapshot): AirThreat | undefined {
  let best: AirThreat | undefined;
  for (const p of s.planes ?? []) {
    if (p.side === 'friend' || p.side === 'neutral' || p.kind === 'airliner') continue;
    if (!p.via.includes('visual') && !p.via.includes('radar')) continue;
    if (p.x === undefined || p.y === undefined) continue;
    const err = p.rough ? 1 + 0.5 * (hash(p.id) - 0.5) : 1;
    const range = Math.hypot(p.x - s.own.x, p.y - s.own.y) * err;
    if (range > ALARM_M || (best && best.range <= range)) continue;
    const km = range / 1000;
    const kmTxt = km < 10 ? km.toFixed(1).replace('.', ',') : String(Math.round(km));
    const low = (p.alt ?? 0) < LOW_M;
    best = { plane: p, range, text: `${NAME[p.kind]} ${tdeg3(p.bearing)}° ${p.rough ? '~' : ''}${kmTxt} KM · ${low ? 'NIEDRIG' : 'HOCH'}` };
  }
  return best;
}

/** The boat shows something above the water (mast, snorkel) or is surfaced. */
export function exposed(s: Snapshot): boolean {
  const o = s.own;
  return o.depth <= PERISCOPE_DEPTH + 0.5 && (o.depth <= 0.5 || o.mastUp || !!o.mastPending || o.snorkel || (o.mastExt ?? 0) > 0 || (o.snorkelExt ?? 0) > 0);
}

const lastSeen = new Map<string, number>();
let shownUntil = 0;
let shownText = '';

/** Every snapshot: ring once for each aircraft that comes into sight while the boat is exposed. */
export function collectAirAlarm(s: Snapshot): AirThreat | undefined {
  const th = exposed(s) ? airThreat(s) : undefined;
  if (th) {
    const prev = lastSeen.get(th.plane.id);
    if (prev === undefined || s.time - prev > RE_ARM_S) {
      audio.depthAlarm(true);
      shownText = `FLIEGERALARM: ${th.text} · ALARMTAUCHEN!`;
      // S3: a log line that stays (alarm level, never folded or cut), not only the 8 s message line
      pushLog(callouts.log, { time: s.time, text: shownText, level: 'alarm', keep: true, whole: true, station: 'zentrale' });
      store.lastError = shownText;
      shownUntil = performance.now() + 8000;
      setTimeout(() => {
        if (store.lastError === shownText && performance.now() >= shownUntil - 50) store.lastError = '';
      }, 8000);
    }
    lastSeen.set(th.plane.id, s.time);
  }
  return th;
}
