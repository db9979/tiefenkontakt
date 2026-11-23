import { evaluateSolution, ownLegChange, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { esc, h, setHtml } from './format.js';
import { FIRST_PATROL_STEPS } from './tutorial-feindfahrt.js';
import { FIRST_ESCORT_STEPS } from './tutorial-geleitfahrt.js';

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

export const LESSON_STEPS: Record<string, { title: string; steps: Step[]; sequential?: boolean }> = {
  feindfahrt: FIRST_PATROL_STEPS,
  geleitfahrt: FIRST_ESCORT_STEPS,
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
      { where: 'Ruderstand', text: 'Fahre etwa 3 Minuten geradeaus, dann ändere den Kurs um 40–60° (Klick in den Kompass). Bei 4 kn dreht das Boot langsam: die Wende dauert gut 2 Minuten. Erst danach ist die Entfernung bestimmbar.', done: () => !!sel() && ownLegChange(sel()!.history, store.ownTrack) >= 30 },
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
      { where: 'Meldungen', text: 'Warte auf den Treffer. Danach ablaufen: Fahrt erhöhen, dann tiefer gehen (ohne Fahrt tauchen die Tiefenruder kaum).', done: (s) => s.score.sunkTons > 0 },
    ],
  },
  ujagd: {
    title: 'U-Jagd mit Fregatte',
    steps: [
      { where: '2 · Sonar', text: 'Bringe das Schleppsonar mit 900 m aus (unter der Sprungschicht). Die Winde braucht knapp 4 Minuten; danach 60 s Kurs halten.', done: (s) => s.own.towedLength >= 600 },
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
  // Progress survives a reload of the tab (one-off steps such as the shot can't tick again)
  const key = `tk_tut_${store.matchId ?? ''}_${lesson}`;
  const saved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? '{}') as { done?: number[]; skipped?: number[] };
    } catch {
      return {};
    }
  })();
  const done = new Set<number>(saved.done ?? []);
  const skipped = new Set<number>(saved.skipped ?? []);
  let savedN = done.size;
  const save = () => {
    if (done.size === savedN) return;
    savedN = done.size;
    sessionStorage.setItem(key, JSON.stringify({ done: [...done], skipped: [...skipped] }));
  };
  let collapsed = false;
  let reported = false;
  el.querySelector<HTMLButtonElement>('#tut-min')!.onclick = () => {
    collapsed = !collapsed;
    el.querySelector<HTMLElement>('#tut-body')!.style.display = collapsed ? 'none' : '';
  };
  const next = () => (def ? def.steps.findIndex((_, i) => !done.has(i)) : -1);
  function update(): void {
    const s = store.snap;
    if (!s || !def) return;
    if (def.sequential) {
      // Strictly in order: only the current step is checked
      for (let i = next(); i >= 0 && def.steps[i]!.done(s); i = next()) done.add(i);
    } else {
      def.steps.forEach((st, i) => {
        if (!done.has(i) && st.done(s)) done.add(i);
      });
    }
    save();
    const current = next();
    if (current < 0 && !reported) {
      reported = true;
      net.send({ t: 'lesson_done' });
    }
    setHtml(el.querySelector('#tut-body')!, def.steps.map((st, i) => `
      <div class="row ${i === current ? 'amber' : done.has(i) ? 'dim' : ''}" style="display:block">
        <span>${skipped.has(i) ? '»' : done.has(i) ? '✓' : i === current ? '▸' : '·'} <span class="dim">${esc(st.where)}</span></span>
        ${i === current || (!done.has(i) && !def.sequential) ? `<div>${esc(st.text)}</div>` : ''}
        ${i === current ? '<div style="text-align:right"><button class="tut-skip" title="Diesen Schritt überspringen">Weiter</button></div>' : ''}
      </div>`).join('') + (current < 0 ? '<div class="row">LEKTION GESCHAFFT. ÜBER „?“ GEHT ES ZUR HILFE, ÜBER DIE LOBBY ZUR NÄCHSTEN LEKTION.</div>' : ''));
  }
  // "Weiter": skip the current step (stuck, or already known); the body is re-rendered, so delegate
  el.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.tut-skip')) return;
    const i = next();
    if (i < 0) return;
    done.add(i);
    skipped.add(i);
    update();
  });
  return { el, update };
}
