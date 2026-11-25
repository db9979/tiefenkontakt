import { createLoadout, type Snapshot } from '@tk/shared';
import { store } from '../store.js';
import { TEL, type Lesson } from './tutorial-step.js';

/**
 * "Erste Geleitfahrt": guided beginner sortie on the frigate. A small convoy follows the
 * frigate east; one diesel boat comes the other way, deep and on a steady course (no
 * torpedoes). The steps run strictly in order, like "Erste Feindfahrt".
 */

const ROCKETS = createLoadout('ffg').rockets;
const sub = (s: Snapshot) => s.contacts.find((c) => c.assigned === 'submarine');

export const FIRST_ESCORT_STEPS: Lesson & { sequential: true } = {
  title: 'Erste Geleitfahrt',
  sequential: true,
  steps: [
    {
      where: 'Ruderstand · Fahrt', target: TEL.halbe,
      do: 'Stelle die Fahrt auf „Halbe“ (12 kn).',
      why: 'Willkommen an Bord der Fregatte. Hinter dir laufen drei Frachter nach Osten, du sicherst sie nach vorn. Mit 20 kn hört das Sonar fast nur das eigene Schiff, und ein Schleppsonar rauscht über 14 kn.',
      done: (s) => s.own.order.speedKn <= 12,
    },
    {
      station: 'sonar', where: 'Schleppsonar', target: '[data-len="900"]',
      do: 'Bringe das Schleppsonar aus: Knopf „900 m“ unter dem Schleppsonar-Wasserfall.',
      why: 'Das Schleppsonar hört leise U-Boote viel weiter als das Rumpfsonar.',
      done: (s) => (s.own.towedOrder ?? s.own.towedLength) >= 900,
    },
    {
      station: 'sonar', where: 'Kurs halten', target: '#ts',
      do: 'Kurs halten, bis oben „900 M · BEREIT“ steht.',
      why: 'Die Winde braucht knapp 4 Minuten. Danach muss das Kabel 60 s gerade hinter dem Schiff liegen; jede Kursänderung lässt es neu einschwingen.',
      done: (s) => s.own.towedLength >= 880 && !!s.own.towedReady,
    },
    {
      station: 'opz', where: 'Sonarboje', target: '#plot',
      do: 'Rechtsklick in die Karte etwa 4 km vor das eigene Schiff (Richtung Osten), dann „Sonarboje tief“.',
      why: 'Der Bordhubschrauber fliegt hin und wirft sie ab; sie hört dort, wo der Konvoi gleich hinfährt.',
      done: (s) => (s.air?.buoys.length ?? 0) > 0,
    },
    {
      station: 'sonar', where: 'Kontakt', target: '#tow',
      do: 'Suche voraus eine schwache neue Spur im Schleppsonar-Wasserfall und klicke sie an.',
      why: 'Die Frachter hinter dir sind laut. Das Schleppsonar weiß nicht, ob links oder rechts: die Peilung kann gespiegelt sein. Der Kontakt in der Kontaktliste geht auch.',
      done: () => !!store.selectedContact(),
    },
    {
      station: 'sonar', where: 'Klassifizieren', target: '[data-ptab="ana"]',
      do: 'Reiter „Analyse“: LOFAR-Grundton und DEMON-Linien markieren, dann „U-Boot“.',
      why: 'Die Klassenbibliothek vergleicht die Linien. Ein langsamer Kontakt ohne die tiefen Linien eines Frachters ist ein U-Boot.',
      done: (s) => !!sub(s),
    },
    {
      station: 'opz', where: 'Konvoi warnen', target: '[data-ptab="group"]',
      do: 'Reiter „Verband“, Feld „Konvoi umleiten“: den Konvoi vom U-Boot weg versetzen.',
      why: 'Das U-Boot steht vor dem Geleitzug. Steht es nördlich, also an Backbord des Konvois: „3 km ▶“. Alternativ eine Funkmeldung an den Konvoi (Reiter „Funk“).',
      done: (s) => (s.own.convoyOffset ?? 0) !== 0 || s.radio.some((r) => r.from === s.own.name),
    },
    {
      station: 'sonar', where: 'Entfernung', target: '#as-one',
      do: 'Reiter „Aktiv“: „LFM“ und „16 KM“ wählen, dann Einzelpings, bis eine Entfernung steht.',
      why: 'Passiv gibt es nur die Peilung; LFM misst die Entfernung genau. Nicht jeder Ping bringt ein Echo: nach dem Nachhall noch einmal. Jeder Ping verrät die Fregatte. Liegt das U-Boot achteraus, erst darauf zudrehen: achtern ist das Rumpfsonar taub.',
      done: (s) => !!sub(s)?.sensors.includes('active') && sub(s)?.range !== undefined,
    },
    {
      station: 'waffen', where: 'Rakete', target: '#rocket',
      do: 'Den U-Boot-Kontakt wählen und „Rakete auf Ziel“.',
      why: 'Sie zielt auf die frische Ortung (nicht älter als 45 s, sonst erneut pingen). Flugzeit etwa 40 s.',
      done: (s) => s.own.loadout.rockets < ROCKETS,
    },
    {
      where: 'Meldungen · Treffer',
      do: 'Warte auf die Explosion.',
      why: 'Der Leichtgewichtstorpedo sucht im Kreis und greift an. Kein Treffer nach drei Minuten: neu orten (Ping) und noch eine Rakete.',
      done: (s) => s.alerts.some((a) => a.kind === 'hit'),
    },
  ],
};
