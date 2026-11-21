import { evaluateSolution, ownLegChange, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { esc, h } from './format.js';

interface Step {
  text: string;
  where: string;
  done: (s: Snapshot) => boolean;
}

const sel = () => store.selectedContact();
const marks = () => (store.selected ? store.marks.get(store.selected) : undefined);
const bestQuality = () => {
  const c = sel();
  const sol = c ? store.solutions.get(c.label) : undefined;
  return c && sol ? evaluateSolution(sol, c.history, store.ownTrack).quality : 0;
};

export const LESSON_STEPS: Record<string, { title: string; steps: Step[] }> = {
  klassifizieren: {
    title: 'Horchen und Klassifizieren',
    steps: [
      { where: '1 · Horchraum', text: 'Wähle einen Kontakt: Klick auf eine Spur im Wasserfall oder in die Kontaktliste.', done: () => !!sel() },
      { where: 'Signalanalyse · LOFAR', text: 'Klicke auf eine helle senkrechte Linie und dann „Grundton markieren“. Die gestrichelten 2f/3f-Linien zeigen die Familie.', done: () => !!marks()?.tonalHz },
      { where: 'Signalanalyse · DEMON', text: 'Markiere die tiefe Linie als „Welle“ und die stärkere höhere als „Blatt“. Die Blattzahl erscheint darunter.', done: () => !!marks()?.shaftHz && !!marks()?.bladeHz },
      { where: 'Auswertung', text: 'Prüfe die Klassenbibliothek und klassifiziere den Kontakt mit einem Klassen-Knopf.', done: () => !!sel()?.assigned },
      { where: 'Kontaktliste', text: 'Klassifiziere alle drei Frachter.', done: (s) => s.contacts.filter((c) => c.assigned === 'merchant').length >= 3 },
    ],
  },
  tma: {
    title: 'Zielbewegungsanalyse',
    steps: [
      { where: '3 · Feuerleitung', text: 'Wähle einen Frachter in der Kontaktliste.', done: () => !!sel() },
      { where: 'Ruderstand', text: 'Fahre etwa 3 Minuten geradeaus, dann ändere den Kurs um 40–60° (Klick in den Kompass). Erst dann ist die Entfernung bestimmbar.', done: () => !!sel() && ownLegChange(sel()!.history, store.ownTrack) >= 30 },
      { where: 'Zielbewegungsanalyse', text: 'Erzeuge eine Lösung: „Auto-TMA“ (Einsteiger) oder Rechtsklick auf die Karte „TMA-Lösung hierher“.', done: () => !!sel() && store.solutions.has(sel()!.label) },
      { where: 'Lagebild', text: 'Ziehe den gelben Kreis und seine Vektorspitze, bis die Residuen um null streuen und die Güte über 60 % liegt.', done: () => bestQuality() > 60 },
      { where: 'Methoden', text: 'Vergleiche mit „Dot-Stack“: die ruhigste Zeile zeigt die richtige Entfernung.', done: () => bestQuality() > 75 },
    ],
  },
  angriff: {
    title: 'Torpedoangriff',
    steps: [
      { where: '3 · Feuerleitung', text: 'Wähle einen Frachter und erstelle eine TMA-Lösung (Kurswechsel nicht vergessen).', done: () => bestQuality() > 40 },
      { where: 'Torpedo', text: '„Lösung übernehmen“ berechnet Schusskurs und Suchkopf-Distanz. Dann „Feuer“, oder Rechtsklick auf die Karte „Torpedo hierher“.', done: (s) => s.torpedoes.length > 0 },
      { where: 'Draht', text: 'Halte das Boot unter 12 kn, damit der Draht hält; korrigiere mit ◀ ▶, bis „ZIEL ERFASST“ erscheint.', done: (s) => s.torpedoes.some((t) => t.homing) },
      { where: 'Meldungen', text: 'Warte auf den Treffer. Danach schnell und tief ablaufen.', done: (s) => s.score.sunkTons > 0 },
    ],
  },
  ujagd: {
    title: 'U-Jagd mit Fregatte',
    steps: [
      { where: '2 · Sonar', text: 'Bringe das Schleppsonar mit 900 m aus (unter der Sprungschicht) und halte danach 60 s Kurs.', done: (s) => s.own.towedLength >= 600 },
      { where: '1 · OPZ', text: 'Rechtsklick vor den Konvoi: „Sonarboje tief“ abwerfen.', done: (s) => (s.air?.buoys.length ?? 0) > 0 },
      { where: '2 · Sonar', text: 'Finde den leisen Kontakt und klassifiziere ihn per LOFAR/DEMON als U-Boot.', done: (s) => s.contacts.some((c) => c.assigned === 'submarine') },
      { where: '2 · Sonar', text: 'Kurz pingen (LFM ist genauer), um die Entfernung zu bekommen.', done: (s) => s.contacts.some((c) => c.assigned === 'submarine' && c.range !== undefined) },
      { where: '3 · Waffen', text: 'U-Jagd-Rakete auf das U-Boot (Knopf oder Rechtsklick auf die Karte).', done: (s) => s.own.loadout.rockets < 8 },
    ],
  },
};

/** Floating lesson checklist; steps tick themselves off as the player does them. */
export function mountTutorial(lesson: string): { el: HTMLElement; update(): void } {
  const def = LESSON_STEPS[lesson];
  const el = h(`<div class="tutorial panel"><div class="hd"><span>Ausbildung · ${esc(def?.title ?? '')}</span><button id="tut-min">–</button></div><div id="tut-body"></div></div>`);
  const done = new Set<number>();
  let collapsed = false;
  let reported = false;
  el.querySelector<HTMLButtonElement>('#tut-min')!.onclick = () => {
    collapsed = !collapsed;
    el.querySelector<HTMLElement>('#tut-body')!.style.display = collapsed ? 'none' : '';
  };
  return {
    el,
    update() {
      const s = store.snap;
      if (!s || !def) return;
      def.steps.forEach((st, i) => {
        if (!done.has(i) && st.done(s)) done.add(i);
      });
      const current = def.steps.findIndex((_, i) => !done.has(i));
      if (current < 0 && !reported) {
        reported = true;
        net.send({ t: 'lesson_done' });
      }
      el.querySelector('#tut-body')!.innerHTML = def.steps.map((st, i) => `
        <div class="row ${i === current ? 'amber' : done.has(i) ? 'dim' : ''}" style="display:block">
          <span>${done.has(i) ? '✓' : i === current ? '▸' : '·'} <span class="dim">${esc(st.where)}</span></span>
          ${i === current || !done.has(i) ? `<div>${esc(st.text)}</div>` : ''}
        </div>`).join('') + (current < 0 ? '<div class="row">LEKTION GESCHAFFT. ÜBER „?“ GEHT ES ZUR HILFE, ÜBER DIE LOBBY ZUR NÄCHSTEN LEKTION.</div>' : '');
    },
  };
}
