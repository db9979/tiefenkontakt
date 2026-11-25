import { createLoadout, type Snapshot } from '@tk/shared';
import { store } from '../store.js';

/**
 * "Erste Geleitfahrt": guided beginner sortie on the frigate. A small convoy follows the
 * frigate east; one diesel boat comes the other way, deep and on a steady course (no
 * torpedoes). The steps run strictly in order, like "Erste Feindfahrt".
 */

interface Step {
  where: string;
  text: string;
  done: (s: Snapshot) => boolean;
}

const ROCKETS = createLoadout('ffg').rockets;
const sub = (s: Snapshot) => s.contacts.find((c) => c.assigned === 'submarine');

export const FIRST_ESCORT_STEPS: { title: string; sequential: true; steps: Step[] } = {
  title: 'Erste Geleitfahrt',
  sequential: true,
  steps: [
    {
      where: 'Ruderstand · Fahrt',
      text: 'Willkommen an Bord der Fregatte. Hinter dir laufen drei Frachter nach Osten, du sicherst sie nach vorn. Mit 20 kn hört das Sonar fast nur das eigene Schiff, und ein Schleppsonar rauscht über 14 kn. Stelle die Fahrt auf „Halbe“ (12 kn).',
      done: (s) => s.own.order.speedKn <= 12,
    },
    {
      where: '2 · Sonar · Schleppsonar',
      text: 'Das Schleppsonar hört leise U-Boote viel weiter als das Rumpfsonar. Station Sonar: Knopf „900 m“ unter dem Schleppsonar-Wasserfall.',
      done: (s) => (s.own.towedOrder ?? s.own.towedLength) >= 900,
    },
    {
      where: '2 · Sonar · Kurs halten',
      text: 'Die Winde braucht knapp 4 Minuten. Danach muss das Kabel 60 s gerade hinter dem Schiff liegen: Kurs halten, bis oben „900 M · BEREIT“ steht. Jede Kursänderung lässt es neu einschwingen.',
      done: (s) => s.own.towedLength >= 880 && !!s.own.towedReady,
    },
    {
      where: '1 · OPZ · Sonarboje',
      text: 'Station OPZ: Rechtsklick in die Karte etwa 4 km vor das eigene Schiff (rechts, Richtung Osten) und „Sonarboje tief“. Der Bordhubschrauber fliegt hin und wirft sie ab; sie hört dort, wo der Konvoi gleich hinfährt.',
      done: (s) => (s.air?.buoys.length ?? 0) > 0,
    },
    {
      where: '2 · Sonar · Kontakt',
      text: 'Die Frachter hinter dir sind laut. Suche voraus nach einer schwachen, neuen Spur im Schleppsonar-Wasserfall und klicke sie an (oder wähle den Kontakt in der Kontaktliste). Das Schleppsonar weiß nicht, ob links oder rechts: die Peilung kann gespiegelt sein.',
      done: () => !!store.selectedContact(),
    },
    {
      where: '2 · Sonar · Klassifizieren',
      text: 'Rechts in der Signalanalyse: LOFAR-Grundton und DEMON-Linien markieren, die Klassenbibliothek vergleicht. Ein langsamer Kontakt ohne die tiefen Linien eines Frachters ist ein U-Boot: klicke „U-Boot“.',
      done: (s) => !!sub(s),
    },
    {
      where: '1 · OPZ · Konvoi warnen',
      text: 'Das U-Boot steht vor dem Geleitzug. Station OPZ, Feld „Konvoi umleiten“: versetze den Konvoi vom U-Boot weg (steht es nördlich, also an Backbord des Konvois: „3 km ▶“). Alternativ eine Funkmeldung an den Konvoi (Reiter „Funk“).',
      done: (s) => (s.own.convoyOffset ?? 0) !== 0 || s.radio.some((r) => r.from === s.own.name),
    },
    {
      where: '6 · Ortung · Entfernung',
      text: 'Passiv gibt es nur die Peilung. Station Ortung: wähle „LFM“ (genaue Entfernung) und schalte „Aktivsonar“ ein. Sobald der Kontakt eine Entfernung hat, den Ping wieder aus: er verrät die Fregatte. Liegt das U-Boot achteraus, erst darauf zudrehen (achtern ist das Rumpfsonar taub).',
      done: (s) => !!sub(s)?.sensors.includes('active') && sub(s)?.range !== undefined,
    },
    {
      where: '3 · Waffen · Rakete',
      text: 'Station Waffen: den U-Boot-Kontakt wählen und „Rakete auf Ziel“ – sie zielt auf die frische Ortung (nicht älter als 45 s, sonst erneut pingen). Flugzeit etwa 40 s.',
      done: (s) => s.own.loadout.rockets < ROCKETS,
    },
    {
      where: 'Meldungen · Treffer',
      text: 'Der Leichtgewichtstorpedo sucht im Kreis und greift an. Warte auf die Explosion. Kein Treffer nach drei Minuten: neu orten (Ping) und noch eine Rakete.',
      done: (s) => s.alerts.some((a) => a.kind === 'hit'),
    },
  ],
};
