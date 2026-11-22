import { evaluateSolution, ownLegChange, type Snapshot } from '@tk/shared';
import { store } from '../store.js';

/**
 * "Erste Feindfahrt": guided beginner sortie against a lone, slow freighter. The steps
 * run strictly in order (each is only checked once it is the current one), so later
 * conditions such as "deep and fast" cannot tick off early.
 */

interface Step {
  where: string;
  text: string;
  done: (s: Snapshot) => boolean;
}

const sel = () => store.selectedContact();
const quality = () => {
  const c = sel();
  const sol = c ? store.solutions.get(c.label) : undefined;
  return c && sol ? evaluateSolution(sol, c.history, store.ownTrack).quality : 0;
};
/** Seconds of bearing history on the selected contact. */
const heardFor = () => {
  const h = sel()?.history;
  return h && h.length > 1 ? h[h.length - 1]!.t - h[0]!.t : 0;
};

export const FIRST_PATROL_STEPS: { title: string; sequential: true; steps: Step[] } = {
  title: 'Erste Feindfahrt',
  sequential: true,
  steps: [
    {
      where: 'Ruderstand · Tiefe',
      text: 'Willkommen an Bord. Das Boot fährt auf 30 m. Befiehl 60 m Tiefe: Tiefenregler im Ruderstand oder „60 m“ im Tauchstand (Taste 4). Tiefer ist leiser und schwerer zu orten.',
      done: (s) => s.own.order.depth >= 50 && s.own.depth >= 45,
    },
    {
      where: 'Ruderstand · Fahrt',
      text: 'Mit 7 kn hört das eigene Sonar vor allem das eigene Boot. Stelle die Fahrt auf „Schleich“ (3 kn).',
      done: (s) => s.own.order.speedKn <= 5,
    },
    {
      where: '1 · Horchraum',
      text: 'Im Wasserfall läuft eine helle Spur von oben nach unten: das ist ein Schiff. Klicke auf die Spur oder auf den Kontakt in der Kontaktliste.',
      done: () => !!sel(),
    },
    {
      where: '1 · Horchraum · Peilung',
      text: 'Die Peilung ist die Richtung zum Kontakt (0° = Nord). Beobachte sie drei Minuten lang: wandert die Spur nach rechts oder links, bewegt sich das Ziel quer zu dir.',
      done: () => heardFor() >= 180,
    },
    {
      where: 'Ruderstand · Kurswechsel',
      text: 'Aus Peilungen allein folgt keine Entfernung. Fahre einen zweiten Schlag: ändere den Kurs um 40–60° (Klick in den Kompass), am besten quer zur Sichtlinie zum Ziel, und halte ihn ein paar Minuten.',
      done: () => !!sel() && ownLegChange(sel()!.history, store.ownTrack) >= 30,
    },
    {
      where: '3 · Feuerleitung · Lagebild',
      text: 'Erzeuge eine Lösung für das Ziel: „Auto-TMA“ (Einsteiger) oder Rechtsklick auf die Karte „TMA-Lösung hierher“.',
      done: () => !!sel() && store.solutions.has(sel()!.label),
    },
    {
      where: '3 · Feuerleitung · Güte',
      text: 'Ziehe den gelben Kreis und seine Vektorspitze, bis die Residuen um null streuen. Die Güte muss über 60 % steigen; mit jeder Minute auf dem neuen Schlag wird sie besser.',
      done: () => quality() > 60,
    },
    {
      where: '2 · Sehrohr',
      text: 'Prüfe die Entfernung mit dem Auge: „Auf Sehrohrtiefe“, dann „Mast ausfahren“ und „Auf Ziel“. Der Sehrohrblick misst die Entfernung. Mast nicht zu lange oben lassen!',
      done: (s) => s.contacts.some((c) => c.sensors.includes('periscope')),
    },
    {
      where: '3 · Feuerleitung · Torpedo',
      text: 'Mast einfahren. „Lösung übernehmen“ programmiert Schusskurs und Suchkopf-Distanz aus der Lösung. Dann „Feuer“.',
      done: (s) => s.torpedoes.length > 0,
    },
    {
      where: '3 · Feuerleitung · Draht',
      text: 'Der Torpedo hängt am Draht: unter 12 kn bleiben. Korrigiere mit ◀ ▶, bis „ZIEL ERFASST“ erscheint, und warte auf den Treffer.',
      done: (s) => s.score.sunkTons > 0 || s.torpedoes.some((t) => t.homing),
    },
    {
      where: 'Ruderstand · Ablaufen',
      text: 'Nach dem Schuss weiß der Gegner, wo du bist. Ablaufen: Mast einfahren, Fahrt „Halbe“, dann tiefer als 60 m und vom Ziel wegdrehen.',
      done: (s) => !s.own.mastUp && s.own.depth >= 55 && s.own.order.speedKn >= 8,
    },
  ],
};
