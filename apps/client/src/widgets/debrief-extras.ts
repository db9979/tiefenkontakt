import type { Debrief, PlayerStats } from '@tk/shared';
import { esc } from './format.js';
import { lang } from '../i18n/index.js';

const L = (de: string, en: string) => (lang === 'en' ? en : de);

/** Event markers above the replay slider: sunk red, shots amber, arrivals blue. Click jumps there. */
export function timelineMarkers(d: Debrief): string {
  const col = { sunk: 'var(--red)', shot: 'var(--amber)', arrived: 'var(--blue)' } as const;
  return `<div class="tl">${d.events.map((e, i) => `<i data-ev="${i}" title="${e.kind}" style="left:${(100 * e.t) / Math.max(1, d.duration)}%;background:${col[e.kind]};height:${e.kind === 'sunk' ? 12 : 7}px"></i>`).join('')}</div>`;
}

/** Concrete lessons for the player from their own numbers. */
export function debriefTips(st: PlayerStats | undefined): string {
  if (!st) return '';
  const sub = st.cls === 'ssk' || st.cls === 'ssn' || st.cls === 'ssc';
  const tips: { good: boolean; text: string }[] = [];
  if (st.kills > 0) tips.push({ good: true, text: L(`${st.kills} Schiff(e) versenkt, ${Math.round(st.tonnageSunk / 1000)}k BRT.`, `${st.kills} ship(s) sunk, ${Math.round(st.tonnageSunk / 1000)}k GRT.`) });
  if (st.firstContactS === undefined) tips.push({ good: false, text: L('Kein eigener Kontakt: langsamer fahren (das Eigengeräusch überdeckt alles) und das Schleppsonar nutzen.', 'No contact of your own: go slower (self noise masks everything) and use the towed array.') });
  else if (st.firstContactS > 900) tips.push({ good: false, text: L(`Erster Kontakt erst nach ${Math.round(st.firstContactS / 60)} min: früher in Richtung der Lagemeldung laufen, dann langsam horchen.`, `First contact only after ${Math.round(st.firstContactS / 60)} min: head for the reported position earlier, then listen slowly.`) });
  if (sub) {
    if (st.shots === 0) tips.push({ good: false, text: L('Kein Torpedo abgefeuert: nach dem ersten Kurswechsel reicht oft schon eine Güte von 60 %.', 'No torpedo fired: after the first turn a quality of 60 % is often enough.') });
    else if (st.kills === 0) tips.push({ good: false, text: L(`${st.shots} Schuss ohne Treffer: die TMA-Güte abwarten, auf 30 kn schießen (Suchkopf hört weiter) und den Suchkopf näher am Ziel einschalten.`, `${st.shots} shot(s) without a hit: wait for TMA quality, fire at 30 kn (the seeker hears further) and enable the seeker closer to the target.`) });
    if (!st.survived) tips.push({ good: false, text: L('Boot verloren: nach jedem Schuss tief und schnell ablaufen, Täuschkörper werfen und den toten Winkel achtern regelmäßig freischauen.', 'Boat lost: after every shot clear out deep and fast, launch decoys and clear your baffles regularly.') });
  } else {
    if (st.buoys === 0) tips.push({ good: false, text: L('Keine Sonarbojen geworfen: Bojen voraus des Konvois finden leise U-Boote, bevor sie schießen.', 'No sonobuoys dropped: buoys ahead of the convoy find quiet submarines before they shoot.') });
    if (st.rockets > 0 && st.kills === 0) tips.push({ good: false, text: L(`${st.rockets} Rakete(n) ohne Treffer: erst eine Entfernung holen (LFM-Ping, Tauchsonar oder Kreuzpeilung mit einer Boje).`, `${st.rockets} rocket(s) without a hit: get a range first (LFM ping, dipping sonar or a cross-fix with a buoy).`) });
    if (!st.survived) tips.push({ good: false, text: L('Fregatte verloren: bei einer Torpedowarnung sofort Täuschkörper-Schleppe und mit hoher Fahrt abdrehen.', 'Frigate lost: on a torpedo warning stream the towed decoy at once and turn away at high speed.') });
  }
  if (st.survived && st.won) tips.push({ good: true, text: L('Überlebt und gewonnen. Sauber gefahren.', 'Survived and won. Well handled.') });
  if (!tips.length) return '';
  return `<div class="hd" style="margin-top:4px"><span>${L('Auswertung', 'Evaluation')}</span><span class="dim">${L('FÜR DICH', 'FOR YOU')}</span></div>` +
    tips.map((t) => `<div class="tip ${t.good ? 'good' : ''}">${t.good ? '✓' : '▸'} ${esc(t.text)}</div>`).join('');
}
