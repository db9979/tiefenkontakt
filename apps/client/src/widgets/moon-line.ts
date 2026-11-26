import { REGIONS, moonReport, type Snapshot } from '@tk/shared';
import { tbrg } from './format.js';

/**
 * The moon as the bridge and the periscope report it: "MOND 72 % ZUN. · 214° 18° HOCH · UNTERGANG 04:10"
 * or "MOND 40 % ABN. · UNTER · AUFGANG 23:35", "NEUMOND". Undefined off the real charts.
 * Worked out again once a ship's-clock minute (rising and setting take a search over the day).
 */
let cache: { key: string; text?: string } = { key: '' };

export function moonLine(env: Snapshot['env']): string | undefined {
  const region = env.seabed?.region;
  if (!region || !env.month || env.day === undefined || env.clock === undefined) return undefined;
  const key = `${region}:${env.month}:${env.day}:${Math.floor(env.clock * 60)}`;
  if (cache.key === key) return cache.text;
  const r = REGIONS[region];
  // The report gives the true azimuth; the stations write bearings from the game frame
  const text = moonReport({ lat: r.lat, lon: r.lon, month: env.month, day: env.day }, env.clock, (az) => tbrg(az - r.bearing)).text;
  cache = { key, text };
  return text;
}

/** The MOND row of a station's data block (empty off the real charts). */
export function moonRow(s: Snapshot): string {
  const t = moonLine(s.env);
  return t ? `<div class="row"><span class="dim">MOND</span><span>${t.replace(/^MOND /, '')}</span></div>` : '';
}
