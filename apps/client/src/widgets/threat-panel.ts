import { CLASSES, angleDiff, wrap360, type AlertView, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { h, setHtml, setText, tdeg3 } from './format.js';
import { onTap } from './touch.js';

/**
 * Threat page for boats: intercepted pings of the last 5 minutes by source (hull sonar or
 * dipping sonar), the loudest level and its trend, buoy splashes nearby, and an evasion
 * proposal the captain sees before it is carried out.
 */

const WINDOW_S = 300;
/** Signal excess at which the pinger probably has an echo off us. */
const ECHO_LIKELY = 25;

interface Plan { text: string; heading: number; speedKn: number; depth: number; decoy: boolean }

/** Deepest the evasion may order: the boat's limit and 20 m over the ground. */
function floorOf(s: Snapshot): number {
  return Math.min(CLASSES[s.own.cls].maxDepth * 0.9, (s.env.bottom ?? Infinity) - 20);
}

/**
 * Where to hide from a pinger. Hull sonars and dipping sonars sit above the layer: a boat
 * already below it stays deep (at least 30 m under it) instead of climbing into the pinger's
 * water; only a boat on the pinger's side goes down through it. Without a measured layer:
 * shallow boats go deeper, deep ones stay.
 */
export function evasionDepth(s: Snapshot, pingerAbove = true): number {
  const o = s.own;
  const layer = s.env.layerDepth;
  const floor = floorOf(s);
  const clamp = (d: number) => Math.round(Math.max(30, Math.min(floor, d)));
  if (layer === undefined) return clamp(o.depth < 80 ? o.depth + 60 : o.depth);
  const under = layer + 30;
  if (pingerAbove) return o.depth >= layer ? clamp(Math.max(o.depth, under)) : clamp(layer + 40);
  // A pinger below the layer (deep buoy): get above it
  return o.depth < layer ? clamp(Math.min(o.depth, layer - 40)) : clamp(layer - 40);
}

function plan(s: Snapshot, torp?: AlertView, ping?: AlertView): Plan | undefined {
  const o = s.own;
  const layer = s.env.layerDepth;
  // A torpedo: change depth hard, through the layer when there is one (break the seeker's lock)
  const floor = floorOf(s);
  const cross = Math.round(Math.max(30, Math.min(floor, layer === undefined ? (o.depth < 80 ? Math.min(200, o.depth + 60) : Math.max(30, o.depth - 50))
    : o.depth < layer ? layer + 40 : Math.max(30, layer - 40))));
  if (torp?.bearing !== undefined) {
    // Put the torpedo on the quarter (150° off its bearing), sprint, change depth through the layer, decoy
    const a = wrap360(torp.bearing + 150);
    const b = wrap360(torp.bearing - 150);
    const heading = Math.abs(angleDiff(o.heading, a)) < Math.abs(angleDiff(o.heading, b)) ? a : b;
    return { text: `TORPEDO ${tdeg3(torp.bearing)}: KURS ${tdeg3(heading)}, AK, TIEFE ${cross} M, TÄUSCHKÖRPER`, heading, speedKn: 99, depth: cross, decoy: true };
  }
  if (ping?.bearing !== undefined) {
    // Stern to the pinger (smallest echo), creep; below the layer stay there, above it go under
    const heading = wrap360(ping.bearing + 180);
    const depth = evasionDepth(s);
    const stay = layer !== undefined && o.depth >= layer && Math.abs(depth - o.depth) < 5;
    return { text: `HECK ZUM PINGER: KURS ${tdeg3(heading)}, SCHLEICHFAHRT 4 KN, ${stay ? `TIEFE ${depth} M HALTEN (UNTER SCHICHT)` : `TIEFE ${depth} M`}`, heading, speedKn: 4, depth, decoy: false };
  }
  return undefined;
}

/** Aircraft: enemy radar heard on ESM (bearing only) or aircraft in sight through the periscope. */
function airRow(s: Snapshot): string {
  const air = (s.planes ?? []).filter((p) => p.side !== 'friend' && (p.via.includes('esm') || p.via.includes('visual')));
  if (!air.length) return '<div class="row"><span class="dim">LUFT</span><span class="dim">—</span></div>';
  const radar = air.filter((p) => p.via.includes('esm'));
  return `<div class="row"><span class="dim">LUFT</span><span class="${radar.length ? 'red' : 'amber'}">${radar.length ? `FLUGZEUGRADAR ${radar.map((p) => `${tdeg3(p.bearing)}°`).join(' · ')} · MAST EINFAHREN` : `${air.length} IN SICHT`}</span></div>`;
}

/**
 * Distinct pinging sources in a list of ping alerts: by kind (hull, dipping, buoy) and bearing
 * (pings within 8° of a known one are the same pinger). The threat count, not the ping count.
 */
export function pingSources(pings: readonly AlertView[]): number {
  const seen: { src: string; b: number }[] = [];
  for (const p of pings) {
    const src = p.source ?? 'hull';
    if (p.bearing === undefined) {
      if (!seen.some((x) => x.src === src)) seen.push({ src, b: NaN });
      continue;
    }
    const known = seen.find((x) => x.src === src && (Number.isNaN(x.b) || Math.abs(angleDiff(x.b, p.bearing!)) < 8));
    if (known) known.b = p.bearing;
    else seen.push({ src, b: p.bearing });
  }
  return seen.length;
}

export function threatPanel(): { el: HTMLElement; update(s: Snapshot): void } {
  const el = h(`<div class="panel threat"><div class="hd"><span>Bedrohung</span><span id="th-sum" class="dim"></span></div>
    <div id="th-rows"></div>
    <div id="th-plan" class="amber" style="margin-top:6px"></div>
    <div class="steps" style="margin-top:4px"><button id="th-go" class="warn">Ausweichen</button></div></div>`);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  let current: Plan | undefined;
  onTap(el, '#th-go', () => {
    if (!current) return;
    net.send({ t: 'order', heading: current.heading, speedKn: current.speedKn, depth: current.depth });
    if (current.decoy) net.send({ t: 'noisemaker' });
  });
  return {
    el,
    update(s) {
      const recent = s.alerts.filter((a) => s.time - a.time < WINDOW_S);
      const pings = recent.filter((a) => a.kind === 'ping');
      const hull = pings.filter((a) => a.source !== 'dip' && a.source !== 'buoy');
      const buoy = pings.filter((a) => a.source === 'buoy');
      const dip = pings.filter((a) => a.source === 'dip');
      const splashes = recent.filter((a) => a.kind === 'transient' && /BOJENEINSCHLAG/.test(a.text));
      const torp = recent.filter((a) => a.kind === 'torpedo' && s.time - a.time < 90).pop();
      const loud = pings.reduce<AlertView | undefined>((m, a) => ((a.level ?? 0) > (m?.level ?? -1) ? a : m), undefined);
      const last2 = pings.slice(-2);
      const trend = last2.length === 2 ? (last2[1]!.level ?? 0) - (last2[0]!.level ?? 0) : 0;
      const sources = pingSources(pings);
      setText(q('#th-sum'), torp ? 'TORPEDO!' : pings.length ? `${sources} PINGER · ${pings.length} PINGS / 5 MIN` : 'RUHIG');
      q('#th-sum').className = torp ? 'red blink' : pings.length ? 'amber' : 'dim';
      setHtml(q('#th-rows'), [
        `<div class="row"><span class="dim">BORDSONAR · TAUCHSONAR · BOJE</span><span>${hull.length} · ${dip.length} · ${buoy.length}</span></div>`,
        loud ? `<div class="row"><span class="dim">LAUTESTER</span><span class="${(loud.level ?? 0) >= ECHO_LIKELY ? 'red' : ''}">${tdeg3(loud.bearing ?? 0)}° · ${loud.level ?? 0} DB${(loud.level ?? 0) >= ECHO_LIKELY ? ' · ER HAT VERMUTLICH EIN ECHO' : ''}</span></div>` : '',
        last2.length === 2 ? `<div class="row"><span class="dim">TREND</span><span class="${trend > 1 ? 'red' : ''}">${trend > 1 ? 'STEIGEND · ER KOMMT NÄHER' : trend < -1 ? 'FALLEND' : 'GLEICH'}</span></div>` : '',
        airRow(s),
        `<div class="row"><span class="dim">BOJENEINSCHLÄGE (4 SM)</span><span class="${splashes.length ? 'amber' : ''}">${splashes.length}${splashes.length ? ` · ZULETZT ${tdeg3(splashes[splashes.length - 1]!.bearing ?? 0)}°` : ''}</span></div>`,
      ].join(''));
      current = plan(s, torp, pings[pings.length - 1]);
      setText(q('#th-plan'), current ? `VORSCHLAG: ${current.text}` : '');
      q<HTMLButtonElement>('#th-go').disabled = !current;
    },
  };
}
