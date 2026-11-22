import { angleDiff, wrap360, type AlertView, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { deg3, h, setHtml, setText } from './format.js';
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

function plan(s: Snapshot, torp?: AlertView, ping?: AlertView): Plan | undefined {
  const o = s.own;
  const layer = s.env.layerDepth;
  const cross = layer === undefined ? (o.depth < 80 ? Math.min(200, o.depth + 60) : Math.max(30, o.depth - 50))
    : o.depth < layer ? layer + 40 : Math.max(30, layer - 40);
  if (torp?.bearing !== undefined) {
    // Put the torpedo on the quarter (150° off its bearing), sprint, change depth through the layer, decoy
    const a = wrap360(torp.bearing + 150);
    const b = wrap360(torp.bearing - 150);
    const heading = Math.abs(angleDiff(o.heading, a)) < Math.abs(angleDiff(o.heading, b)) ? a : b;
    return { text: `TORPEDO ${deg3(torp.bearing)}: KURS ${deg3(heading)}, AK, TIEFE ${cross} M, TÄUSCHKÖRPER`, heading, speedKn: 99, depth: cross, decoy: true };
  }
  if (ping?.bearing !== undefined) {
    // Stern to the pinger (smallest echo), creep, hide across the layer
    const heading = wrap360(ping.bearing + 180);
    return { text: `HECK ZUM PINGER: KURS ${deg3(heading)}, SCHLEICHFAHRT 4 KN, TIEFE ${cross} M`, heading, speedKn: 4, depth: cross, decoy: false };
  }
  return undefined;
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
      const hull = pings.filter((a) => a.source !== 'dip');
      const dip = pings.filter((a) => a.source === 'dip');
      const splashes = recent.filter((a) => a.kind === 'transient' && /BOJENEINSCHLAG/.test(a.text));
      const torp = recent.filter((a) => a.kind === 'torpedo' && s.time - a.time < 90).pop();
      const loud = pings.reduce<AlertView | undefined>((m, a) => ((a.level ?? 0) > (m?.level ?? -1) ? a : m), undefined);
      const last2 = pings.slice(-2);
      const trend = last2.length === 2 ? (last2[1]!.level ?? 0) - (last2[0]!.level ?? 0) : 0;
      setText(q('#th-sum'), torp ? 'TORPEDO!' : pings.length ? `${pings.length} PINGS / 5 MIN` : 'RUHIG');
      q('#th-sum').className = torp ? 'red blink' : pings.length ? 'amber' : 'dim';
      setHtml(q('#th-rows'), [
        `<div class="row"><span class="dim">BORDSONAR · TAUCHSONAR</span><span>${hull.length} · ${dip.length}</span></div>`,
        loud ? `<div class="row"><span class="dim">LAUTESTER</span><span class="${(loud.level ?? 0) >= ECHO_LIKELY ? 'red' : ''}">${deg3(loud.bearing ?? 0)}° · ${loud.level ?? 0} DB${(loud.level ?? 0) >= ECHO_LIKELY ? ' · ER HAT VERMUTLICH EIN ECHO' : ''}</span></div>` : '',
        last2.length === 2 ? `<div class="row"><span class="dim">TREND</span><span class="${trend > 1 ? 'red' : ''}">${trend > 1 ? 'STEIGEND · ER KOMMT NÄHER' : trend < -1 ? 'FALLEND' : 'GLEICH'}</span></div>` : '',
        `<div class="row"><span class="dim">BOJENEINSCHLÄGE (4 SM)</span><span class="${splashes.length ? 'amber' : ''}">${splashes.length}${splashes.length ? ` · ZULETZT ${deg3(splashes[splashes.length - 1]!.bearing ?? 0)}°` : ''}</span></div>`,
      ].join(''));
      current = plan(s, torp, pings[pings.length - 1]);
      setText(q('#th-plan'), current ? `VORSCHLAG: ${current.text}` : '');
      q<HTMLButtonElement>('#th-go').disabled = !current;
    },
  };
}
