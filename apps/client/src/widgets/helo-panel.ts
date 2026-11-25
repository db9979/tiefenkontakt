import { bearing, distance, targetPosAt, type HeloTaskKind, type Snapshot, type Vec2 } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { btnState } from './btn-state.js';
import { lastFix } from './contact-pos.js';
import { guardFire, targetCheck } from './fire-guard.js';
import { esc, h, km, setHtml, setText, tdeg3 } from './format.js';

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

/** A map point for the helicopter's next task (plot menu "Hubschrauber-Ziel hier"). */
export function pickHeloPoint(p: Vec2): void {
  picked = { x: p.x, y: p.y };
  pickedAt = performance.now();
}

const KIND: Record<HeloTaskKind, string> = { dip: 'TAUCHSONAR', buoys: 'BOJENLINIE', mad: 'MAD-SUCHE', attack: 'ANGRIFF', return: 'ZURÜCK AN DECK' };

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
let lastSelect = 0;
let lastLabel: string | undefined;

export function mountHeloPanel(el: HTMLElement): { update(s: Snapshot): void; dispose?(): void } {
  const root = h(`<div class="panel helo-panel"><div class="hd"><span>Bordhubschrauber</span><span id="hp-st"></span></div>
    <div id="hp-rows"></div>
    <div class="row"><span class="dim">ZIEL</span><span id="hp-tgt" class="amber"></span></div>
    <div class="hp-opts">
      <div class="seg" title="Anhängen: ans Ende der Liste · Sofort: alles andere fällt weg"><button data-mode="add">ANHÄNGEN</button><button data-mode="now">SOFORT</button></div>
      <span class="hp-n" title="Bojen in der Linie (2,5 km Abstand, quer zur Sichtlinie)"><span class="dim">BOJEN JE LINIE</span><span class="seg"><button data-n="4">4</button><button data-n="5">5</button><button data-n="6">6</button></span></span>
    </div>
    <div class="grid2" style="gap:4px">
      <button class="primary" data-task="dip" title="Schwebt 3 min und pingt über und unter der gemessenen Schicht, dann 4 km weiter in Suchrichtung (3 Tauchstellen)">Tauchsonar</button>
      <button class="primary" data-task="buoys" title="Linie passiver Bojen quer zur Sichtlinie über dem Ziel, abwechselnd über und unter der Schicht">Bojenlinie</button>
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

  const send = (kind: HeloTaskKind, extra: { count?: number } = {}) => {
    const s = snap;
    if (!s) return;
    if (kind === 'return') return net.send({ t: 'helo', op: mode, kind });
    const a = aim(s);
    if (!a) return;
    net.send({ t: 'helo', op: mode, kind, bearing: bearing(s.own, a.p), range: distance(s.own, a.p), label: a.label, ...extra });
  };
  const check = () => {
    const s = snap;
    if (!s?.air?.helo) return { block: 'KEIN HUBSCHRAUBER' };
    const a = aim(s);
    if (!a) return { block: 'KONTAKT ODER PUNKT WÄHLEN' };
    if (distance(s.own, a.p) > 30_000) return { block: 'ZU WEIT (30 KM)' };
    return {};
  };
  root.querySelectorAll<HTMLButtonElement>('[data-task]').forEach((b) => {
    const kind = b.dataset.task as HeloTaskKind;
    if (kind === 'return') b.onclick = () => send('return');
    else guardFire(b, check, () => send(kind, kind === 'buoys' ? { count } : {}));
  });
  guardFire(q<HTMLButtonElement>('#hp-att'), () => {
    const c = check();
    if (c.block) return c;
    if (!snap?.air?.helo?.torps && !snap?.air?.helo?.magTorps) return { block: 'KEIN TORPEDO' };
    return targetCheck(snap && aim(snap)?.p);
  }, () => send('attack'));
  q<HTMLButtonElement>('#hp-clr').onclick = () => net.send({ t: 'helo', op: 'clear' });
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.mode) mode = b.dataset.mode as Mode;
    if (b.dataset.n) count = Number(b.dataset.n);
    if (b.dataset.rm) net.send({ t: 'helo', op: 'remove', id: Number(b.dataset.rm) });
    if (b.dataset.mode || b.dataset.n) paintToggles();
  });
  const paintToggles = () => {
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    root.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === count));
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
        return;
      }
      const doing = hv.doing ? KIND[hv.doing] : 'HÄLT POSITION';
      st.className = hv.state === 'deck' && hv.readyInS > 0 ? 'amber' : '';
      st.textContent = hv.state === 'air' ? `IN DER LUFT · ${doing}${hv.working && hv.doing === 'dip' ? ' · SCHWEBT' : ''}`
        : hv.readyInS > 0 ? `AN DECK · TANKEN/AUFMUNITIONIEREN · ${mmss(hv.readyInS)}` : 'AN DECK · BEREIT';
      const fuelMin = Math.floor(hv.fuelS / 60);
      setHtml(q('#hp-rows'), `
        <div class="row"><span class="dim">KRAFTSTOFF</span><span class="${hv.fuelS < 20 * 60 ? 'amber' : ''}">${fuelMin} MIN</span></div>
        <div class="row"><span class="dim">SONARBOJEN</span><span>${hv.buoys} AN BORD · ${hv.magBuoys} IM MAGAZIN</span></div>
        <div class="row"><span class="dim">LEICHTTORPEDOS</span><span>${hv.torps} AN BORD · ${hv.magTorps} IM MAGAZIN</span></div>`);
      btnState(q('#hp-att'), { label: String(hv.torps), tone: hv.torps || hv.magTorps ? undefined : 'empty' });
      const a = aim(s);
      q('#hp-tgt').textContent = a ? `${a.what} · ${tdeg3(bearing(s.own, a.p))}° · ${km(distance(s.own, a.p))}` : 'KONTAKT ODER PUNKT WÄHLEN';
      // Rows are rebuilt only when the queue changes (the × buttons stay clickable); distance and ETA tick in place
      const rows = hv.queue.map((t, i) => {
        const detail = t.kind === 'dip' ? `${Math.min((t.step ?? 0) + 1, t.count ?? 1)}/${t.count ?? 1}`
          : t.kind === 'buoys' ? `${t.step ?? 0}/${t.count ?? 1}${t.active ? ' · AKTIV' : ''}` : t.track ? esc(t.track) : '';
        const where = t.kind === 'return' ? '' : km(distance(s.own, t));
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
