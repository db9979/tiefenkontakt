import { angleDiff, emitterSpec, emitterText, esmDangerText, esmStrengthText, isDangerEmitter, candidateNames, type AlertView, type Snapshot } from '@tk/shared';
import { esc, tdeg3 } from './format.js';

/**
 * ESM intercept texts for the stations: emitter, likely platform (with "?" where two classes
 * share the set), strength and trend; aircraft and fire-control radars are red.
 */

/** Colour class of an intercept: danger red, navigation radars dim, the rest amber. */
export function esmTone(id: string | undefined): 'red' | 'amber' | 'dim' {
  if (!id) return 'amber';
  if (isDangerEmitter(id)) return 'red';
  return emitterSpec(id)?.threat === 'nav' ? 'dim' : 'amber';
}

/** Tooltip with band, scan, pulse and the possible platforms (German parts, translated per part). */
export function esmTitle(id: string | undefined): string {
  const e = emitterSpec(id);
  if (!e) return 'FUNKSPRUCH';
  return [e.id, `BAND ${e.band}`, e.rotationS ? `UMLAUF ${e.rotationS} S` : 'KEINE ROTATION', e.pulse, 'MÖGLICH', ...candidateNames(e.id).split(' / ')].join(' · ');
}

const LEVEL_SHORT = ['SCHWACH', 'MITTEL', 'STARK'];
const TREND_ARROW: Record<string, string> = { '1': '↑', '0': '→', '-1': '↓' };

/**
 * One grid row per intercept (widgets.css .esm-row): label, bearing, emitter (cut with an
 * ellipsis, in full in the tooltip), strength with a trend arrow, age.
 */
export function esmRow(label: string, bearing: number, age: string, id: string | undefined, lvl: number | undefined, trend: number | undefined, tone: string): string {
  const what = id ? emitterText(id) : 'FUNK';
  const str = esmStrengthText(lvl, trend);
  const strShort = lvl === undefined ? '' : `<span>${LEVEL_SHORT[lvl] ?? ''}</span>${trend !== undefined ? ` ${TREND_ARROW[String(trend)] ?? ''}` : ''}`;
  const title = [what, str, esmTitle(id)].filter(Boolean).join(' · ');
  return `<div class="row esm-row ${tone}" title="${esc(title)}"><span>${esc(label)}</span><span>${tdeg3(bearing)}°</span><span class="esm-what">${esc(what)}</span><span class="esm-lvl">${strShort}</span><span class="dim">${age}</span></div>`;
}

/**
 * Periscope ESM warning: fresh radar intercepts (one row per emitter and bearing) and aircraft
 * radars; aircraft and fire-control radars are red and tell the boat to dive.
 */
export function periscopeEsmRows(s: Snapshot): string {
  // Newest first; one row per emitter and bearing (repeats within 10° are the same transmitter)
  const fresh = s.alerts.filter((a) => a.kind === 'esm' && s.time - a.time < 10).sort((a, b) => b.time - a.time);
  const kept: AlertView[] = [];
  for (const a of fresh) {
    if (!kept.some((k) => k.emitter === a.emitter && Math.abs(angleDiff(k.bearing ?? 0, a.bearing ?? 0)) < 10)) kept.push(a);
  }
  const rows = kept.map((a) => ({ b: a.bearing ?? 0, id: a.emitter, lvl: a.esmLvl, trend: a.esmTrend }));
  for (const p of s.planes ?? []) if (p.via.includes('esm')) rows.push({ b: p.bearing, id: p.emitter, lvl: p.esmLvl, trend: p.esmTrend });
  return rows.map((r) => {
    const danger = esmDangerText(r.id, true);
    const tone = danger ? 'red blink' : r.id ? esmTone(r.id) : 'red';
    return `<div title="${esc(esmTitle(r.id))}"><div class="row ${tone}"><span>ESM ${tdeg3(r.b)}°</span><span>${esc(r.id ? emitterText(r.id) : 'RADAR')}</span></div>
      ${r.id ? `<div class="row ${tone}"><span>${esmStrengthText(r.lvl, r.trend)}</span><span>${danger ?? ''}</span></div>` : ''}</div>`;
  }).join('');
}

/** Short plot label: "E3 SEEFALKE-2". */
export function esmPlotLabel(label: string, id: string | undefined): string {
  return id ? `${label} ${id}` : label;
}
