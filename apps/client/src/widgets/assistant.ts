import { CLASSES, ownLegChange, type Snapshot, type StationId } from '@tk/shared';
import { store } from '../store.js';
import { esc, setHtml } from './format.js';
import { isFriendlyContact } from './friendly.js';
import { solutionQuality } from './speed-prior.js';
import { lang } from '../i18n/index.js';

const L = (de: string, en: string) => (lang === 'en' ? en : de);
/** "1 Kontakt" / "3 Kontakte" (and the English). */
const contacts = (n: number) => L(`${n} ${n === 1 ? 'Kontakt' : 'Kontakte'}`, `${n} ${n === 1 ? 'contact' : 'contacts'}`);

/** Hint plus the station it refers to (for a click-to-go). */
export interface Hint {
  text: string;
  station?: StationId;
  urgent?: boolean;
}

/** Güte as TMA and FEUER show it (bounded by the speed prior, N4). */
const quality = solutionQuality;

/** Next step for the submarine (exported for the station-reference test). */
export function subHint(s: Snapshot): Hint {
  const o = s.own;
  const cap = CLASSES[o.cls].battery?.capacityKnH;
  if (s.alerts.some((a) => a.kind === 'torpedo' && s.time - a.time < 45)) return { text: L('Torpedo! Täuschkörper werfen, volle Fahrt, Tiefe wechseln – möglichst durch die Sprungschicht.', 'Torpedo! Launch a decoy, full speed, change depth – through the layer if you can.'), station: 'feuerleitung', urgent: true };
  if (o.mastUp && o.mastUpSince !== undefined && s.time - o.mastUpSince > 60) return { text: L(`Mast seit ${Math.round(s.time - o.mastUpSince)} s oben – Radar kann dich finden. Mast einfahren.`, `Mast up for ${Math.round(s.time - o.mastUpSince)} s – radar can find you. Lower the mast.`), station: 'sehrohr', urgent: true };
  if (cap && o.battery !== undefined && o.battery / cap < 0.25 && !o.snorkel) return { text: L('Batterie unter 25 %: wenn es ruhig ist, auf Sehrohrtiefe schnorcheln (Zentrale).', 'Battery below 25 %: when it is quiet, snorkel at periscope depth (control room).'), station: 'zentrale' };
  const torp = s.torpedoes.find((t) => t.wire) ?? s.torpedoes[0];
  if (torp) {
    return {
      text: torp.homing ? L('Torpedo hat das Ziel erfasst – Kurs halten.', 'Torpedo has acquired the target – hold course.')
        : torp.wire ? L('Torpedo läuft: unter 12 kn bleiben, damit der Draht hält; mit ◀ ▶ nachsteuern.', 'Torpedo running: stay below 12 kn so the wire holds; steer it with ◀ ▶.')
        : L('Torpedo läuft: Lauf verfolgen, danach tief und schnell ablaufen.', 'Torpedo running: follow its run, then go deep and fast away.'),
      station: 'feuerleitung',
    };
  }
  const fresh = s.contacts.filter((c) => s.time - c.lastSeen < 60);
  if (!fresh.length) return { text: L('Noch kein Kontakt: langsam (unter 5 kn) und unter 100 m fahren und den Wasserfall beobachten.', 'No contact yet: go slow (below 5 kn) and deeper than 100 m, and watch the waterfall.'), station: 'horch' };
  const c = store.selectedContact();
  if (!c) return { text: L(`${contacts(fresh.length)} – einen in der Liste oder im Wasserfall anklicken.`, `${contacts(fresh.length)} – click one in the list or the waterfall.`), station: 'horch' };
  // A shot being set up on it (a TMA solution): the next step is the shot, not the class
  if (!c.assigned && !store.solutions.has(c.label)) return { text: L(`${c.label} klassifizieren: Signalanalyse → Linien markieren → Klassen-Knopf.`, `Classify ${c.label}: signal analysis → mark lines → class button.`), station: 'horch' };
  if (c.assigned === 'warship') return { text: L(`${c.label} ist ein Kriegsschiff – Abstand halten, tief und langsam bleiben, Frachter suchen.`, `${c.label} is a warship – keep away, stay deep and slow, look for merchants.`) };
  const q = quality(c.label);
  if (!store.solutions.has(c.label) && ownLegChange(c.history, store.ownTrack) < 30) return { text: L(`Für die Entfernung zu ${c.label}: Kurswechsel von 40–60° fahren, dann TMA erstellen.`, `For the range to ${c.label}: turn 40–60°, then build a TMA solution.`), station: 'feuerleitung' };
  if (q < 60) return { text: L(`TMA-Güte ${Math.round(q)} %: Auto-TMA oder gelben Kreis ziehen; notfalls einen zweiten Kurswechsel fahren.`, `TMA quality ${Math.round(q)} %: auto TMA or drag the yellow circle; make a second turn if needed.`), station: 'feuerleitung' };
  return { text: L(`Schusslösung für ${c.label} steht (Güte ${Math.round(q)} %): Feuerleitung → Lösung übernehmen → Feuer.`, `Firing solution on ${c.label} ready (quality ${Math.round(q)} %): fire control → use solution → fire.`), station: 'feuerleitung' };
}

/** Next step for the frigate. */
export function frigateHint(s: Snapshot): Hint {
  const o = s.own;
  if (s.alerts.some((a) => a.kind === 'torpedo' && s.time - a.time < 45)) return { text: L('Torpedo! Täuschkörper-Schleppe ausbringen und mit hoher Fahrt abdrehen.', 'Torpedo! Stream the towed decoy and turn away at high speed.'), station: 'waffen', urgent: true };
  const tow = CLASSES[o.cls].towed;
  if (tow && (o.towedOrder ?? o.towedLength) === 0) {
    const len = Math.min(900, tow.maxLength);
    return { text: L(`Schleppsonar ausbringen (Sonar → ${len} m), danach 60 s Kurs halten.`, `Stream the towed array (sonar → ${len} m), then hold course for 60 s.`), station: 'sonar' };
  }
  const fresh = s.contacts.filter((c) => s.time - c.lastSeen < 60 && c.via === 'own');
  if (!fresh.length) return { text: L('Kein Kontakt: zwischen Konvoi und vermuteter U-Boot-Richtung bleiben, Sonarbojen voraus werfen (Rechtsklick auf die Karte).', 'No contact: stay between the convoy and the likely submarine sector, drop sonobuoys ahead (right-click the map).'), station: 'opz' };
  const c = store.selectedContact();
  if (!c) return { text: L(`${contacts(fresh.length)} – einen in der Kontaktliste anklicken.`, `${contacts(fresh.length)} – click one in the contact list.`), station: 'sonar' };
  // A track the datalink places on an own ship needs no class: look at the others
  if (!c.assigned && isFriendlyContact(c, s)) return { text: L(`${c.label} ist ein eigenes Schiff (Datalink) – einen fremden Kontakt wählen.`, `${c.label} is one of ours (datalink) – pick an unknown contact.`), station: 'sonar' };
  if (!c.assigned) return { text: L(`${c.label} klassifizieren: Signalanalyse → Linien markieren → Klassen-Knopf.`, `Classify ${c.label}: signal analysis → mark lines → class button.`), station: 'sonar' };
  if (c.assigned !== 'submarine') return { text: L(`${c.label} ist kein U-Boot – weitersuchen.`, `${c.label} is not a submarine – keep searching.`) };
  if (c.range === undefined) return { text: L(`Entfernung zu ${c.label}: Sonar, Reiter „Aktiv“: LFM und ein Einzelping, oder Hubschrauber-Tauchsonar per Rechtsklick.`, `Range to ${c.label}: sonar, tab “Active”: LFM and a single ping, or the helicopter dipping sonar via right-click.`), station: 'sonar' };
  return { text: L(`${c.label} geortet: U-Jagd-Rakete (Waffen oder Rechtsklick auf die Karte).`, `${c.label} located: ASW rocket (weapons or right-click the map).`), station: 'waffen' };
}

/** "Next step" bar for beginners in normal matches. */
export function mountAssistant(host: HTMLElement, go: (station: StationId) => void): { update(): void } {
  const el = document.createElement('div');
  el.className = 'assist';
  host.prepend(el);
  let station: StationId | undefined;
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
      setHtml(el, html);
    },
  };
}
