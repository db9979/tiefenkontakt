import { CLASSES, evaluateSolution, ownLegChange, type Snapshot } from '@tk/shared';
import { store } from '../store.js';
import { esc } from './format.js';
import { lang } from '../i18n/index.js';

const L = (de: string, en: string) => (lang === 'en' ? en : de);

/** Hint plus the station it refers to (index, for a click-to-go). */
interface Hint {
  text: string;
  station?: number;
  urgent?: boolean;
}

function quality(label: string): number {
  const c = store.snap?.contacts.find((x) => x.label === label);
  const sol = store.solutions.get(label);
  return c && sol ? evaluateSolution(sol, c.history, store.ownTrack).quality : 0;
}

function subHint(s: Snapshot): Hint {
  const o = s.own;
  const cap = CLASSES[o.cls].battery?.capacityKnH;
  if (s.alerts.some((a) => a.kind === 'torpedo' && s.time - a.time < 45)) return { text: L('Torpedo! Täuschkörper werfen, volle Fahrt, Tiefe wechseln – möglichst durch die Sprungschicht.', 'Torpedo! Launch a decoy, full speed, change depth – through the layer if you can.'), station: 3, urgent: true };
  if (o.mastUp && o.mastUpSince !== undefined && s.time - o.mastUpSince > 60) return { text: L(`Mast seit ${Math.round(s.time - o.mastUpSince)} s oben – Radar kann dich finden. Mast einfahren.`, `Mast up for ${Math.round(s.time - o.mastUpSince)} s – radar can find you. Lower the mast.`), station: 1, urgent: true };
  if (cap && o.battery !== undefined && o.battery / cap < 0.25 && !o.snorkel) return { text: L('Batterie unter 25 %: wenn es ruhig ist, auf Sehrohrtiefe schnorcheln (Tauchstand).', 'Battery below 25 %: when it is quiet, snorkel at periscope depth (diving station).'), station: 3 };
  const torp = s.torpedoes.find((t) => t.wire);
  if (torp) return { text: torp.homing ? 'Torpedo hat das Ziel erfasst – Kurs halten.' : 'Torpedo läuft: unter 12 kn bleiben, damit der Draht hält; mit ◀ ▶ nachsteuern.', station: 2 };
  const fresh = s.contacts.filter((c) => s.time - c.lastSeen < 60);
  if (!fresh.length) return { text: L('Noch kein Kontakt: langsam (unter 5 kn) und unter 100 m fahren und den Wasserfall beobachten.', 'No contact yet: go slow (below 5 kn) and deeper than 100 m, and watch the waterfall.'), station: 0 };
  const c = store.selectedContact();
  if (!c) return { text: L(`${fresh.length} Kontakt(e) – einen in der Liste oder im Wasserfall anklicken.`, `${fresh.length} contact(s) – click one in the list or the waterfall.`), station: 0 };
  if (!c.assigned) return { text: L(`${c.label} klassifizieren: Signalanalyse → Linien markieren → Klassen-Knopf.`, `Classify ${c.label}: signal analysis → mark lines → class button.`), station: 0 };
  if (c.assigned === 'warship') return { text: L(`${c.label} ist ein Kriegsschiff – Abstand halten, tief und langsam bleiben, Frachter suchen.`, `${c.label} is a warship – keep away, stay deep and slow, look for merchants.`) };
  const q = quality(c.label);
  if (!store.solutions.has(c.label) && ownLegChange(c.history, store.ownTrack) < 30) return { text: L(`Für die Entfernung zu ${c.label}: Kurswechsel von 40–60° fahren, dann TMA erstellen.`, `For the range to ${c.label}: turn 40–60°, then build a TMA solution.`), station: 2 };
  if (q < 60) return { text: L(`TMA-Güte ${Math.round(q)} %: Auto-TMA oder gelben Kreis ziehen; notfalls einen zweiten Kurswechsel fahren.`, `TMA quality ${Math.round(q)} %: auto TMA or drag the yellow circle; make a second turn if needed.`), station: 2 };
  return { text: L(`Schusslösung für ${c.label} steht (Güte ${Math.round(q)} %): Feuerleitung → Lösung übernehmen → Feuer.`, `Firing solution on ${c.label} ready (quality ${Math.round(q)} %): fire control → use solution → fire.`), station: 2 };
}

function frigateHint(s: Snapshot): Hint {
  const o = s.own;
  if (s.alerts.some((a) => a.kind === 'torpedo' && s.time - a.time < 45)) return { text: L('Torpedo! Täuschkörper-Schleppe ausbringen und mit hoher Fahrt abdrehen.', 'Torpedo! Stream the towed decoy and turn away at high speed.'), station: 2, urgent: true };
  const tow = CLASSES[o.cls].towed;
  if (tow && (o.towedOrder ?? o.towedLength) === 0) {
    const len = Math.min(900, tow.maxLength);
    return { text: L(`Schleppsonar ausbringen (Sonar → ${len} m), danach 60 s Kurs halten.`, `Stream the towed array (sonar → ${len} m), then hold course for 60 s.`), station: 1 };
  }
  const fresh = s.contacts.filter((c) => s.time - c.lastSeen < 60 && c.via === 'own');
  if (!fresh.length) return { text: L('Kein Kontakt: zwischen Konvoi und vermuteter U-Boot-Richtung bleiben, Sonarbojen voraus werfen (Rechtsklick auf die Karte).', 'No contact: stay between the convoy and the likely submarine sector, drop sonobuoys ahead (right-click the map).'), station: 0 };
  const c = store.selectedContact();
  if (!c) return { text: L(`${fresh.length} Kontakt(e) – einen in der Kontaktliste anklicken.`, `${fresh.length} contact(s) – click one in the contact list.`), station: 1 };
  if (!c.assigned) return { text: L(`${c.label} klassifizieren: Signalanalyse → Linien markieren → Klassen-Knopf.`, `Classify ${c.label}: signal analysis → mark lines → class button.`), station: 1 };
  if (c.assigned !== 'submarine') return { text: L(`${c.label} ist kein U-Boot – weitersuchen.`, `${c.label} is not a submarine – keep searching.`) };
  if (c.range === undefined) return { text: L(`Entfernung zu ${c.label}: kurz aktiv pingen (LFM) oder Hubschrauber-Tauchsonar per Rechtsklick.`, `Range to ${c.label}: a short active ping (LFM) or the helicopter dipping sonar via right-click.`), station: 1 };
  return { text: L(`${c.label} geortet: U-Jagd-Rakete (Waffen oder Rechtsklick auf die Karte).`, `${c.label} located: ASW rocket (weapons or right-click the map).`), station: 2 };
}

/** "Next step" bar for beginners in normal matches. */
export function mountAssistant(host: HTMLElement, go: (station: number) => void): { update(): void } {
  const el = document.createElement('div');
  el.className = 'assist';
  host.prepend(el);
  let station: number | undefined;
  el.onclick = () => station !== undefined && go(station);
  return {
    update() {
      const s = store.snap;
      const show = !!s && s.own.alive && store.realism === 'einsteiger' && !s.lesson && localStorage.getItem('tk_assist') !== '0';
      el.style.display = show ? '' : 'none';
      if (!show || !s) return;
      const hint = CLASSES[s.own.cls].submarine ? subHint(s) : frigateHint(s);
      station = hint.station;
      el.classList.toggle('urgent', !!hint.urgent);
      el.title = station !== undefined ? 'Klick: zur passenden Station' : '';
      const html = `<span class="assist-k">${L('NÄCHSTER SCHRITT', 'NEXT STEP')}</span> ${esc(hint.text)}`;
      if (el.innerHTML !== html) el.innerHTML = html;
    },
  };
}
