import { HELO_RANGE, PATTERN_COUNT, bearing, distance, headingVec, targetPosAt, type BuoyPattern, type HeloTaskKind, type HeloView, type Snapshot, type Vec2 } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { btnState } from './btn-state.js';
import { lastFix } from './contact-pos.js';
import { guardFire, targetCheck } from './fire-guard.js';
import { esc, h, setHtml, setText, sm, tdeg3 } from './format.js';

/**
 * Ship's helicopter (C11): one airframe, airborne with a task queue the crew edits at any time.
 * Status (deck/air, fuel, buoys, torpedoes), the queue with ETAs (strike a task with ×), and the
 * tasks Tauchsonar / Bojenlinie / MAD / Angriff / Zurück aimed at the selected contact or at a map
 * point picked from the plot's menu. ANHÄNGEN puts a task at the end, SOFORT drops the rest.
 */

type Mode = 'add' | 'now';
let mode: Mode = 'add';
let picked: Vec2 | undefined;
let pickedAt = 0;

/** Whether new helicopter tasks go to the end of the queue or replace it (the plot menu uses it too). */
export const heloMode = (): Mode => mode;

/** A map point for the helicopter's next task (plot menu Hubschrauber ▸ "Ziel für die Aufträge hier"). */
export function pickHeloPoint(p: Vec2): void {
  picked = { x: p.x, y: p.y };
  pickedAt = performance.now();
}

const KIND: Record<HeloTaskKind, string> = { dip: 'TAUCHSONAR', buoys: 'BOJENLINIE', mad: 'MAD-SUCHE', attack: 'ANGRIFF', return: 'ZURÜCK AN DECK' };
/** Buoy patterns (F15) as named in the panel and the queue. */
export const PATTERN_NAME: Record<BuoyPattern, string> = { line: 'LINIE', barrier: 'SPERRE', circle: 'KREIS', chevron: 'KEIL' };
const PATTERN_TITLE: Record<BuoyPattern, string> = {
  line: 'Linie quer zur Sichtlinie, 1,3 sm (2,5 km) Abstand',
  barrier: 'Sperre: zwei versetzte Reihen quer zum Anmarschweg, die Lücken der einen deckt die andere',
  circle: 'Kreis um das Datum (1,5 sm Radius): das Boot kann nach keiner Seite unbemerkt ablaufen',
  chevron: 'Keil vor einem schnellen Boot: Spitze voraus auf seinem Kurs (TMA), die Schenkel laufen zurück',
};
let pattern: BuoyPattern = 'line';
/** Buoy pattern chosen in the panel (the plot menu offers every pattern itself). */
export const heloPattern = (): BuoyPattern => pattern;

/** What the flight deck tells the bridge: the course to hold, or why there is no launch. */
export function deckText(d: NonNullable<HeloView['deck']>): { text: string; tone: 'amber' | 'red' | '' } {
  const what = d.need === 'launch' ? 'START' : 'LANDUNG';
  if (d.block === 'sea') return { text: 'SEEGANG ZU HOCH · KEIN START', tone: 'red' };
  if (d.ok) return { text: `FLUGKURS LIEGT AN · ${what} ${mmss(Math.min(d.heldS, d.needS))}/${mmss(d.needS)}`, tone: '' };
  if (d.block === 'turn') return { text: `SCHIFF DREHT · FLUGDECK ROT · ${what} WARTET`, tone: 'amber' };
  return { text: `FLUGKURS NÖTIG · WIND ${tdeg3(d.windFrom)}° · KURS ${tdeg3(d.course)}°`, tone: 'amber' };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Where the selected contact probably is: a fresh fix, else the TMA solution. */
function contactPoint(s: Snapshot): { p: Vec2; label: string } | undefined {
  const c = store.selectedContact();
  if (!c) return undefined;
  const fix = lastFix(c, s, 120);
  if (fix) return { p: fix.pos, label: c.label };
  const sol = store.solutions.get(c.label);
  return sol ? { p: targetPosAt(sol, s.time + 60), label: c.label } : undefined;
}

/** The task's aim: a freshly picked map point wins over the selected contact. */
function aim(s: Snapshot): { p: Vec2; label?: string; what: string } | undefined {
  const c = contactPoint(s);
  if (picked && (!c || pickedAt >= lastSelect)) return { p: picked, what: 'KARTENPUNKT' };
  return c ? { ...c, what: c.label } : undefined;
}

/** Guessed range for a buoy line laid out along a bearing-only contact's bearing (m, line centre). */
export const BEARING_LINE_RANGE = 8000;

/** A selected contact with only a bearing (no fix, no TMA solution): its label and bearing. */
function bearingOnly(s: Snapshot): { label: string; bearing: number; origin?: Vec2 } | undefined {
  const c = store.selectedContact();
  if (!c || contactPoint(s)) return undefined;
  if (picked && pickedAt >= lastSelect) return undefined;
  // A buoy's or a datalink mate's bearing runs from where it was measured, not from the own ship
  return { label: c.label, bearing: c.bearing, ...(c.originX !== undefined && c.originY !== undefined ? { origin: { x: c.originX, y: c.originY } } : {}) };
}

/** Centre of a buoy line laid along a bearing-only contact's line (own ship → bearing and range). */
export function bearingLineCentre(own: Vec2, b: { bearing: number; origin?: Vec2 }): { bearing: number; range: number } {
  if (!b.origin) return { bearing: b.bearing, range: BEARING_LINE_RANGE };
  const v = headingVec(b.bearing);
  const p = { x: b.origin.x + v.x * BEARING_LINE_RANGE, y: b.origin.y + v.y * BEARING_LINE_RANGE };
  return { bearing: bearing(own, p), range: distance(own, p) };
}
let lastSelect = 0;
let lastLabel: string | undefined;

export function mountHeloPanel(el: HTMLElement): { update(s: Snapshot): void; dispose?(): void } {
  const root = h(`<div class="helo-panel">
    <div class="row hp-strow"><span class="dim">STATUS</span><span id="hp-st"></span></div>
    <div id="hp-rows"></div>
    <div class="row"><span class="dim">ZIEL</span><span id="hp-tgt" class="amber"></span></div>
    <div class="hp-opts">
      <div class="seg" title="Anhängen: ans Ende der Liste · Sofort: alles andere fällt weg"><button data-mode="add">ANHÄNGEN</button><button data-mode="now">SOFORT</button></div>
      <span class="hp-n" title="Bojen je Muster (Linie höchstens 6, Sperre und Kreis 8, Keil 7)"><span class="dim">BOJEN</span><span class="seg"><button data-n="4">4</button><button data-n="5">5</button><button data-n="6">6</button><button data-n="8">8</button></span></span>
    </div>
    <div class="row"><span class="dim">MUSTER</span><span class="seg">${(Object.keys(PATTERN_NAME) as BuoyPattern[]).map((p) => `<button data-pat="${p}" title="${PATTERN_TITLE[p]}">${PATTERN_NAME[p]}</button>`).join('')}</span></div>
    <div class="row" id="hp-deck" style="display:none"><span id="hp-deck-t"></span><button id="hp-deck-go" title="Den Kurs ans Ruder geben: Wind im Flugdeckbereich (30° beiderseits des Bugs)">FLUGKURS STEUERN</button></div>
    <div class="grid2" style="gap:4px">
      <button class="primary" data-task="dip" title="Je Tauchstelle etwa 4–5 min: einschweben, Dom fieren (4,5 m/s), über und unter der gemessenen Schicht pingen, Dom hieven, dann gut 2 sm weiter in Suchrichtung (3 Tauchstellen)">Tauchsonar</button>
      <button class="primary" data-task="buoys" title="Passive Bojen im gewählten Muster über dem Ziel, abwechselnd über und unter der Schicht">Bojen legen</button>
      <button class="primary" data-task="mad" title="Magnetsonde: Kleeblatt über dem Punkt (6 min), findet getauchte Boote nur sehr nah">MAD</button>
      <button id="hp-att" class="fire" title="Leichttorpedo auf die letzte gehaltene Position des Kontakts (aus dem Schweben etwa 1 min)">Angriff</button>
      <button data-task="return" title="Zurück an Deck: 10 min tanken und aufmunitionieren">Zurück</button>
      <button id="hp-clr" title="Auftragsliste leeren (in der Luft: zurück an Deck)">Liste leeren</button>
    </div>
    <div class="hint" id="hp-hint"><span>ZIEL: GEWÄHLTER KONTAKT ODER KARTE</span> <span>(RECHTSKLICK / LANGE TIPPEN)</span></div>
    <div id="hp-q" style="margin-top:4px"></div>
  </div>`);
  el.append(root);
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  let count = 4;
  let snap: Snapshot | undefined;

  const send = (kind: HeloTaskKind, extra: { count?: number; pattern?: BuoyPattern } = {}) => {
    const s = snap;
    if (!s) return;
    if (kind === 'return') return net.send({ t: 'helo', op: mode, kind });
    const a = aim(s);
    if (!a) {
      // Bearing only: the buoy line goes out along the bearing, centred at a guessed range
      const b = kind === 'buoys' ? bearingOnly(s) : undefined;
      if (b) net.send({ t: 'helo', op: mode, kind, ...bearingLineCentre(s.own, b), axis: b.bearing, label: b.label, ...extra });
      return;
    }
    // A chevron goes ahead of the boat on its TMA course (apex 3 km ahead), else it points at the own ship
    let p = a.p;
    let axis: number | undefined;
    const sol = a.label ? store.solutions.get(a.label) : undefined;
    if (kind === 'buoys' && extra.pattern === 'chevron' && sol) {
      axis = sol.course;
      const v = headingVec(sol.course);
      p = { x: p.x + v.x * 3000, y: p.y + v.y * 3000 };
    }
    net.send({ t: 'helo', op: mode, kind, bearing: bearing(s.own, p), range: distance(s.own, p), label: a.label, ...(axis !== undefined ? { axis } : {}), ...extra });
  };
  const check = (kind?: HeloTaskKind) => {
    const s = snap;
    if (!s?.air?.helo) return { block: 'KEIN HUBSCHRAUBER' };
    const a = aim(s);
    if (!a) return kind === 'buoys' && bearingOnly(s) ? {} : { block: bearingOnly(s) ? 'NUR PEILUNG' : 'KONTAKT ODER PUNKT WÄHLEN' };
    if (distance(s.own, a.p) > HELO_RANGE) return { block: `ZU WEIT (${sm(HELO_RANGE)})` };
    return {};
  };
  root.querySelectorAll<HTMLButtonElement>('[data-task]').forEach((b) => {
    const kind = b.dataset.task as HeloTaskKind;
    if (kind === 'return') b.onclick = () => send('return');
    else guardFire(b, () => check(kind), () => send(kind, kind === 'buoys' ? { count: Math.min(count, PATTERN_COUNT[pattern].max), pattern: pattern === 'line' ? undefined : pattern } : {}));
  });
  guardFire(q<HTMLButtonElement>('#hp-att'), () => {
    const c = check();
    if (c.block) return c;
    if (!snap?.air?.helo?.torps && !snap?.air?.helo?.magTorps) return { block: 'KEIN TORPEDO' };
    return targetCheck(snap && aim(snap)?.p);
  }, () => send('attack'));
  q<HTMLButtonElement>('#hp-clr').onclick = () => net.send({ t: 'helo', op: 'clear' });
  // Flight deck: give the helm the flying course
  q<HTMLButtonElement>('#hp-deck-go').onclick = () => {
    const d = snap?.air?.helo?.deck;
    if (d) net.send({ t: 'order', heading: d.course });
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.mode) mode = b.dataset.mode as Mode;
    if (b.dataset.n) count = Number(b.dataset.n);
    if (b.dataset.pat) pattern = b.dataset.pat as BuoyPattern;
    if (b.dataset.rm) net.send({ t: 'helo', op: 'remove', id: Number(b.dataset.rm) });
    if (b.dataset.mode || b.dataset.n || b.dataset.pat) paintToggles();
  });
  const paintToggles = () => {
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    root.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === count));
    root.querySelectorAll<HTMLButtonElement>('[data-pat]').forEach((b) => b.classList.toggle('on', b.dataset.pat === pattern));
  };
  paintToggles();

  return {
    update(s: Snapshot) {
      snap = s;
      // A newly selected contact takes over from an older map point
      if (store.selected !== lastLabel) {
        lastLabel = store.selected;
        if (store.selected) lastSelect = performance.now();
      }
      const hv = s.air?.helo;
      const st = q('#hp-st');
      root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.disabled = !hv || !s.own.alive; });
      if (!hv) {
        st.textContent = '—';
        setHtml(q('#hp-rows'), '<div class="dim">KEIN HUBSCHRAUBER AN BORD</div>');
        setHtml(q('#hp-q'), '');
        q('#hp-tgt').textContent = '';
        q('#hp-deck').style.display = 'none';
        return;
      }
      // Flight deck: the course to hold for launch or recovery, with the button that orders it
      const deck = hv.deck;
      q('#hp-deck').style.display = deck ? '' : 'none';
      if (deck) {
        const dt = deckText(deck);
        const el2 = q('#hp-deck-t');
        setText(el2, dt.text);
        el2.className = dt.tone;
        q<HTMLButtonElement>('#hp-deck-go').style.display = deck.ok || deck.block === 'sea' ? 'none' : '';
      }
      const doing = hv.doing ? KIND[hv.doing] : 'HÄLT POSITION';
      st.className = hv.state === 'deck' && (hv.readyInS > 0 || hv.launchInS !== undefined) ? 'amber' : '';
      st.textContent = hv.state === 'air' ? (hv.deck?.alongside ? (hv.deck.ok ? 'LANDEANFLUG' : 'LÄNGSSEITS · WARTET AUF FLUGKURS') : `IN DER LUFT · ${doing}${hv.working && hv.doing === 'dip' ? ` · SCHWEBT${hv.domeM ? ` · DOM ${hv.domeM} M` : ''}` : ''}`)
        : hv.launchInS !== undefined ? (hv.launchInS > 0 ? `STARTVORBEREITUNG ${mmss(hv.launchInS)}` : hv.deck?.ok ? 'ROTOREN LAUFEN · START' : 'STARTBEREIT · WARTET AUF FLUGKURS')
        : hv.readyInS > 0 ? `AN DECK · TANKEN/AUFMUNITIONIEREN · ${mmss(hv.readyInS)}` : 'AN DECK · BEREIT';
      const fuelMin = Math.floor(hv.fuelS / 60);
      setHtml(q('#hp-rows'), `
        <div class="row"><span class="dim">KRAFTSTOFF</span><span class="${hv.fuelS < 20 * 60 ? 'amber' : ''}">${fuelMin} MIN</span></div>
        <div class="row"><span class="dim">SONARBOJEN</span><span>${hv.buoys} AN BORD · ${hv.magBuoys} IM MAGAZIN</span></div>
        <div class="row"><span class="dim">LEICHTTORPEDOS</span><span>${hv.torps} AN BORD · ${hv.magTorps} IM MAGAZIN</span></div>`);
      btnState(q('#hp-att'), { label: String(hv.torps), tone: hv.torps || hv.magTorps ? undefined : 'empty' });
      const a = aim(s);
      const bo = a ? undefined : bearingOnly(s);
      // With no new target picked but a task running, the row names that task instead of asking (amber only when idle)
      const run = hv.queue[0];
      const busy = !a && !bo && run !== undefined && run.kind !== 'return';
      q('#hp-tgt').textContent = a ? `${a.what} · ${tdeg3(bearing(s.own, a.p))}° · ${sm(distance(s.own, a.p))}`
        : bo ? `${bo.label} · ${tdeg3(bo.bearing)}° · NUR PEILUNG – PINGEN, TMA ODER KARTENPUNKT (RECHTSKLICK) · BOJENLINIE LÄNGS DER PEILUNG`
        : busy ? `AUFTRAG: ${KIND[run.kind]}${run.track ? ` · ${run.track}` : ''} · ${tdeg3(bearing(s.own, run))}° · ${sm(distance(s.own, run))}`
        : 'KONTAKT ODER PUNKT WÄHLEN';
      q('#hp-tgt').className = busy ? '' : 'amber';
      // Rows are rebuilt only when the queue changes (the × buttons stay clickable); distance and ETA tick in place
      const rows = hv.queue.map((t, i) => {
        const detail = t.kind === 'dip' ? `${Math.min((t.step ?? 0) + 1, t.count ?? 1)}/${t.count ?? 1}`
          : t.kind === 'buoys' ? `${t.pattern ? `${PATTERN_NAME[t.pattern]} · ` : ''}${t.step ?? 0}/${t.count ?? 1}${t.active ? ' · AKTIV' : ''}` : t.track ? esc(t.track) : '';
        const where = t.kind === 'return' ? '' : sm(distance(s.own, t));
        const when = i === 0 && hv.state === 'air' && hv.working ? 'LÄUFT' : t.etaS > 0 ? `ETA ${mmss(t.etaS)}` : 'JETZT';
        return { key: `${t.id}:${detail}`, html: `<span><span class="dim">${i + 1}</span> <span>${KIND[t.kind]}${detail ? ` · ${detail}` : ''}</span></span>`, where, when, id: t.id };
      });
      const key = `${hv.state}|${rows.map((r) => r.key).join(',')}`;
      const list = q('#hp-q');
      if (list.dataset.key !== key) {
        list.dataset.key = key;
        setHtml(list, rows.length ? rows.map((r) => `<div class="row">${r.html}<span class="dim hp-where"></span><span class="hp-when"></span><button data-rm="${r.id}" title="Auftrag streichen" style="padding:0 6px">×</button></div>`).join('')
          : `<div class="dim">${hv.state === 'air' ? 'KEIN AUFTRAG · HÄLT POSITION' : 'KEIN AUFTRAG'}</div>`);
      }
      list.querySelectorAll('.row').forEach((row, i) => {
        const r = rows[i];
        if (!r) return;
        setText(row.querySelector('.hp-where')!, r.where);
        setText(row.querySelector('.hp-when')!, r.when);
      });
    },
    dispose() {
      root.remove();
    },
  };
}
