import { evaluateSolution, ownLegChange } from '@tk/shared';
import { store } from '../store.js';
import { TEL, type Lesson } from './tutorial-step.js';

/**
 * "Erste Feindfahrt": guided beginner sortie against a lone, slow freighter. The steps
 * run strictly in order (each is only checked once it is the current one), so later
 * conditions such as "deep and fast" cannot tick off early.
 */

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

export const FIRST_PATROL_STEPS: Lesson & { sequential: true } = {
  title: 'Erste Feindfahrt',
  sequential: true,
  steps: [
    {
      station: 'zentrale', where: 'Tiefe', target: '[data-depth="60"]',
      do: 'Befiehl 60 m Tiefe: Knopf „60 m“ oder der Tiefenregler am Ruderstand.',
      why: 'Willkommen an Bord. Das Boot fährt auf 30 m. Tiefer ist leiser und schwerer zu orten.',
      done: (s) => s.own.order.depth >= 50 && s.own.depth >= 45,
    },
    {
      where: 'Ruderstand · Fahrt', target: TEL.schleich,
      do: 'Stelle die Fahrt auf „Schleich“ (3 kn).',
      why: 'Mit 7 kn hört das eigene Sonar vor allem das eigene Boot.',
      done: (s) => s.own.order.speedKn <= 5,
    },
    {
      station: 'horch', where: 'Kontakt', target: '#wf',
      do: 'Klicke auf die helle Spur im Wasserfall oder auf den Kontakt in der Liste.',
      why: 'Eine helle Spur, die von oben nach unten läuft, ist ein Schiff.',
      done: () => !!sel(),
    },
    {
      station: 'horch', where: 'Peilung', target: '#wf',
      do: 'Beobachte die Peilung des Kontakts drei Minuten lang.',
      why: 'Die Peilung ist die Richtung zum Kontakt (0° = Nord). Wandert die Spur nach rechts oder links, bewegt sich das Ziel quer zu dir.',
      done: () => heardFor() >= 180,
    },
    {
      where: 'Ruderstand · Kurswechsel', target: '#h-compass',
      do: 'Fahrt „Langsam“, dann Kurs etwa 210° (Klick in den Kompass): vom Ziel weg, quer zur Sichtlinie.',
      why: 'Aus Peilungen allein folgt keine Entfernung: erst ein zweiter Schlag lässt die Peilung schnell wandern. Bei Schleichfahrt dreht das Boot zu träge. Nicht auf das Ziel zu drehen: bleibt die Peilung stehen, läuft ihr auf Kollisionskurs und die Entfernung bleibt unbestimmt.',
      done: () => !!sel() && ownLegChange(sel()!.history, store.ownTrack) >= 30,
    },
    {
      station: 'feuerleitung', where: 'Lagebild', target: '#auto',
      do: 'Erzeuge eine Lösung: „Auto-TMA“ oder Rechtsklick auf die Karte „TMA-Lösung hierher“.',
      why: 'Die Zielbewegungsanalyse schätzt Entfernung, Kurs und Fahrt des Ziels aus den Peilungen beider Schläge.',
      done: () => !!sel() && store.solutions.has(sel()!.label),
    },
    {
      station: 'feuerleitung', where: 'Güte', target: '#v-q',
      do: 'Bringe die Güte über 60 %: gelben Kreis und Vektorspitze ziehen oder später noch einmal „Auto-TMA“.',
      why: 'Stimmt die Lösung, streuen die Residuen um null. Ein paar Minuten auf dem neuen Schlag machen sie genauer.',
      done: () => quality() > 60,
    },
    {
      station: 'sehrohr', where: 'Mast', target: '#up',
      do: '„Auf Sehrohrtiefe“, dann „Mast ausfahren“ und „Auf Ziel“.',
      why: 'Der Sehrohrblick misst die Entfernung und bestätigt die Lösung. Den Mast nicht zu lange oben lassen: Radar kann ihn finden.',
      done: (s) => s.contacts.some((c) => c.sensors.includes('periscope')),
    },
    {
      station: 'feuerleitung', where: 'Torpedo', target: '#calc',
      do: 'Mast einfahren, „Lösung übernehmen“, dann „Feuer“.',
      why: '„Lösung übernehmen“ programmiert Schusskurs und Suchkopf-Distanz aus der Lösung.',
      done: (s) => s.torpedoes.length > 0,
    },
    {
      station: 'feuerleitung', where: 'Draht', target: '#wires',
      do: 'Unter 12 kn bleiben und mit ◀ ▶ nachsteuern, bis „ZIEL ERFASST“ erscheint; dann auf den Treffer warten.',
      why: 'Der Torpedo hängt am Draht. Kein „ZIEL ERFASST“, obwohl er längst beim Ziel sein müsste, oder ist er abgelaufen? Dann war die Entfernung zu groß geschätzt und der Suchkopf schaltete erst hinter dem Ziel ein. Noch ein Schuss: „Auto-TMA“, „Lösung übernehmen“, „Suchkopf ein nach“ halbieren, „Feuer“.',
      // Only the hit counts: a torpedo that found the target can still lose it again
      done: (s) => s.score.sunkTons > 0,
    },
    {
      where: 'Ruderstand · Ablaufen', target: TEL.halbe,
      do: 'Mast einfahren, Fahrt „Halbe“, tiefer als 60 m und vom Ziel wegdrehen.',
      why: 'Nach dem Schuss weiß der Gegner, wo du bist.',
      done: (s) => !s.own.mastUp && s.own.depth >= 55 && s.own.order.speedKn >= 8,
    },
  ],
};
