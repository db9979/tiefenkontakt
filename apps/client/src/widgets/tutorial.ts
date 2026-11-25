import { evaluateSolution, ownLegChange, type StationId } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { stationLabel } from '../stations/titles.js';
import { esc, h, setHtml } from './format.js';
import { FIRST_PATROL_STEPS } from './tutorial-feindfahrt.js';
import { FIRST_ESCORT_STEPS } from './tutorial-geleitfahrt.js';
import { TEL, type Lesson, type Step } from './tutorial-step.js';

export type { Lesson, Step };

const sel = () => store.selectedContact();
const marks = () => (store.selected ? store.marks.get(store.selected) : undefined);
const bestQuality = () => {
  const c = sel();
  const sol = c ? store.solutions.get(c.label) : undefined;
  return c && sol ? evaluateSolution(sol, c.history, store.ownTrack).quality : 0;
};

export const LESSON_STEPS: Record<string, Lesson> = {
  feindfahrt: FIRST_PATROL_STEPS,
  geleitfahrt: FIRST_ESCORT_STEPS,
  klassifizieren: {
    title: 'Horchen und Klassifizieren',
    steps: [
      { station: 'horch', where: 'Kontakt', target: '#wf', do: 'Wähle einen Kontakt: Spur im Wasserfall oder Zeile in der Kontaktliste.', done: () => !!sel() },
      { station: 'horch', where: 'Signalanalyse · LOFAR', target: '#ana', do: 'Klicke auf eine helle senkrechte Linie, dann „Grundton markieren“.', why: 'Die gestrichelten 2f/3f-Linien zeigen die Familie der Harmonischen.', done: () => !!marks()?.tonalHz },
      { station: 'horch', where: 'Signalanalyse · DEMON', target: '#ana', do: 'Markiere die tiefe Linie als „Welle“ und die stärkere höhere als „Blatt“.', why: 'Aus beiden folgt die Blattzahl der Schraube; sie steht darunter.', done: () => !!marks()?.shaftHz && !!marks()?.bladeHz },
      { station: 'horch', where: 'Auswertung', target: '#ana', do: 'Klassifiziere den Kontakt mit einem Klassen-Knopf.', why: 'Die Klassenbibliothek vergleicht die markierten Linien mit bekannten Schiffen.', done: () => !!sel()?.assigned },
      { station: 'horch', where: 'Kontaktliste', target: '#list', do: 'Klassifiziere alle drei Frachter.', done: (s) => s.contacts.filter((c) => c.assigned === 'merchant').length >= 3 },
    ],
  },
  tma: {
    title: 'Zielbewegungsanalyse',
    steps: [
      { station: 'feuerleitung', where: 'Kontakt', target: '#list', do: 'Wähle einen Frachter in der Kontaktliste.', done: () => !!sel() },
      { where: 'Ruderstand · Kurswechsel', target: '#h-compass', do: 'Fahre etwa 3 Minuten geradeaus, dann ändere den Kurs um 40–60° (Klick in den Kompass).', why: 'Erst nach einem Kurswechsel ist die Entfernung bestimmbar. Bei 4 kn dreht das Boot langsam: die Wende dauert gut 2 Minuten.', done: () => !!sel() && ownLegChange(sel()!.history, store.ownTrack) >= 30 },
      { station: 'feuerleitung', where: 'Lösung', target: '#auto', do: 'Erzeuge eine Lösung: „Auto-TMA“ oder Rechtsklick auf die Karte „TMA-Lösung hierher“.', done: () => !!sel() && store.solutions.has(sel()!.label) },
      { station: 'feuerleitung', where: 'Lagebild', target: '#plot', do: 'Ziehe den gelben Kreis und seine Vektorspitze, bis die Güte über 60 % liegt.', why: 'Stimmt die Lösung, streuen die Residuen um null.', done: () => bestQuality() > 60 },
      { station: 'feuerleitung', where: 'Methoden', target: '[data-method="dots"]', do: 'Vergleiche mit „Dot-Stack“ und bringe die Güte über 75 %.', why: 'Die ruhigste Zeile zeigt die richtige Entfernung.', done: () => bestQuality() > 75 },
    ],
  },
  angriff: {
    title: 'Torpedoangriff',
    steps: [
      { station: 'feuerleitung', where: 'Lösung', target: '#auto', do: 'Wähle einen Frachter und erstelle eine TMA-Lösung.', why: 'Ohne eigenen Kurswechsel bleibt die Entfernung unbestimmt.', done: () => bestQuality() > 40 },
      { station: 'feuerleitung', where: 'Torpedo', target: '#calc', do: '„Lösung übernehmen“, dann „Feuer“ (oder Rechtsklick auf die Karte „Torpedo hierher“).', why: '„Lösung übernehmen“ berechnet Schusskurs und Suchkopf-Distanz.', done: (s) => s.torpedoes.length > 0 },
      { station: 'feuerleitung', where: 'Draht', target: '#wires', do: 'Unter 12 kn bleiben und mit ◀ ▶ korrigieren, bis „ZIEL ERFASST“ erscheint.', why: 'Schneller reißt der Draht.', done: (s) => s.torpedoes.some((t) => t.homing) },
      { where: 'Meldungen', target: TEL.halbe, do: 'Warte auf den Treffer, dann ablaufen: erst Fahrt erhöhen, dann tiefer gehen.', why: 'Ohne Fahrt tauchen die Tiefenruder kaum.', done: (s) => s.score.sunkTons > 0 },
    ],
  },
  ujagd: {
    title: 'U-Jagd mit Fregatte',
    steps: [
      { station: 'sonar', where: 'Schleppsonar', target: '[data-len="900"]', do: 'Bringe das Schleppsonar mit 900 m aus.', why: 'Lang liegt es unter der Sprungschicht. Die Winde braucht knapp 4 Minuten; danach 60 s Kurs halten.', done: (s) => s.own.towedLength >= 600 },
      { station: 'opz', where: 'Sonarboje', target: '#plot', do: 'Rechtsklick vor den Konvoi: „Sonarboje tief“.', done: (s) => (s.air?.buoys.length ?? 0) > 0 },
      { station: 'sonar', where: 'Klassifizieren', target: '[data-ptab="ana"]', do: 'Finde den leisen Kontakt und klassifiziere ihn per LOFAR/DEMON als U-Boot.', done: (s) => s.contacts.some((c) => c.assigned === 'submarine') },
      { station: 'sonar', where: 'Aktiv', target: '#as-one', do: 'Reiter „Aktiv“: LFM wählen und einen Einzelping senden.', why: 'Der Ping gibt die Entfernung (LFM ist genauer), verrät aber die Fregatte.', done: (s) => s.contacts.some((c) => c.assigned === 'submarine' && c.range !== undefined) },
      { station: 'waffen', where: 'Rakete', target: '#rocket', do: 'U-Jagd-Rakete auf das U-Boot (Knopf oder Rechtsklick auf die Karte).', done: (s) => s.own.loadout.rockets < 8 },
    ],
  },
};

/** The step's label: "3 · Feuerleitung · Lagebild", or just the place for the helm and side panels. */
export const stepLabel = (st: Step): string => (st.station ? `${stationLabel(st.station)} · ${st.where}` : st.where);

/**
 * Point at a control: a 2 px amber outline that pulses twice. A control in a closed panel tab
 * opens that tab first.
 */
export function pulseTarget(selector: string | undefined): void {
  if (!selector) return;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  const pane = el.closest<HTMLElement>('[data-pane]');
  if (pane?.hidden) pane.parentElement?.querySelector<HTMLElement>(`[data-ptab="${pane.dataset.pane}"]`)?.click();
  el.classList.remove('tut-pulse');
  void el.offsetWidth;
  el.classList.add('tut-pulse');
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  setTimeout(() => el.classList.remove('tut-pulse'), 1800);
}

/** Floating lesson checklist; steps tick themselves off as the player does them. */
export function mountTutorial(lesson: string, go: (station: StationId) => boolean | void): { el: HTMLElement; update(): void } {
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
  /** Steps whose "Warum?" the player opened (the body is re-rendered on every update). */
  const whyOpen = new Set<number>();
  let savedN = done.size;
  const save = () => {
    if (done.size === savedN) return;
    savedN = done.size;
    try {
      sessionStorage.setItem(key, JSON.stringify({ done: [...done], skipped: [...skipped] }));
    } catch {
      // progress just isn't kept over a reload
    }
  };
  let collapsed = false;
  let reported = false;
  let stepSent = -1;
  let pulsed = -1;
  el.querySelector<HTMLButtonElement>('#tut-min')!.onclick = () => {
    collapsed = !collapsed;
    el.querySelector<HTMLElement>('#tut-body')!.style.display = collapsed ? 'none' : '';
  };
  const next = () => (def ? def.steps.findIndex((_, i) => !done.has(i)) : -1);
  /** Go to the step's station and point at its control. */
  const show = (i: number) => {
    const st = def?.steps[i];
    if (!st) return;
    if (st.station) go(st.station);
    // The station is put on screen at once; its controls exist after this task
    setTimeout(() => pulseTarget(st.target), 60);
  };
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
    // The server counts where players give up a lesson (anonymous drop-out statistics)
    if (current >= 0 && current !== stepSent) {
      stepSent = current;
      net.send({ t: 'lesson_step', step: current });
    }
    // A new step points at its control once, if that control is on screen now
    if (current >= 0 && current !== pulsed) {
      pulsed = current;
      setTimeout(() => pulseTarget(def.steps[current]?.target), 60);
    }
    if (current < 0 && !reported) {
      reported = true;
      net.send({ t: 'lesson_done' });
    }
    setHtml(el.querySelector('#tut-body')!, def.steps.map((st, i) => {
      const now = i === current;
      const open = now || (!done.has(i) && !def.sequential);
      return `<div class="row tutstep ${now ? 'amber' : done.has(i) ? 'dim' : ''}" style="display:block">
        <span>${skipped.has(i) ? '»' : done.has(i) ? '✓' : now ? '▸' : '·'} <span class="${st.station || st.target ? 'clickable tut-go' : ''} dim" data-go="${i}" title="${st.station ? 'Klick: zur Station' : 'Klick: zeigen'}">${esc(stepLabel(st))}</span></span>
        ${open ? `<div class="tut-do">${esc(st.do)}</div>` : ''}
        ${now && st.why ? `<details class="tut-why" data-why="${i}" ${whyOpen.has(i) ? 'open' : ''}><summary>Warum?</summary><div>${esc(st.why)}</div></details>` : ''}
        ${now ? `<div class="tut-acts">${st.station || st.target ? '<button class="tut-show" title="Zur Station gehen und das Bedienelement zeigen">Zeigen</button>' : ''}<button class="tut-skip" title="Diesen Schritt überspringen">Weiter</button></div>` : ''}
      </div>`;
    }).join('') + (current < 0 ? '<div class="row">LEKTION GESCHAFFT. ÜBER „?“ GEHT ES ZUR HILFE, ÜBER DIE LOBBY ZUR NÄCHSTEN LEKTION.</div>' : ''));
  }
  // The body is re-rendered, so all clicks are delegated
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sum = t.closest<HTMLElement>('.tut-why summary');
    if (sum) {
      // Keep "Warum?" open across re-renders
      e.preventDefault();
      const i = Number(sum.parentElement!.dataset.why);
      if (whyOpen.has(i)) whyOpen.delete(i);
      else whyOpen.add(i);
      update();
      return;
    }
    const goEl = t.closest<HTMLElement>('[data-go]');
    if (goEl) return show(Number(goEl.dataset.go));
    if (t.closest('.tut-show')) return show(next());
    if (!t.closest('.tut-skip')) return;
    // "Weiter": skip the current step (stuck, or already known)
    const i = next();
    if (i < 0) return;
    done.add(i);
    skipped.add(i);
    update();
  });
  return { el, update };
}
