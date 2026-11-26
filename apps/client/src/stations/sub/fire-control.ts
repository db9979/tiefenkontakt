import { gameDeg, trueDeg } from '../../north.js';
import { onTap } from '../../widgets/touch.js';
import './sub-audit.css';
import {
  CLASSES,
  boundedQuality,
  lsqSolve,
  solveInPrior,
  rangeUndetermined,
  betterSolution,
  speedAtBound,
  type SpeedPrior,
  bearing,
  ekelundRange,
  ownLegChange,
  scaleSolutionRange,
  solutionAtRange,
  distance,
  evaluateSolution,
  headingVec,
  interceptHeading,
  ownPosAt,
  targetPosAt,
  type TmaSolution,
  defaultSpreadDeg,
  launchBlock,
  SALVO_MAX,
} from '@tk/shared';
import { net } from '../../net.js';
import { btnState, tubeTag } from '../../widgets/btn-state.js';
import { guardFire } from '../../widgets/fire-guard.js';
import { isFriendlyContact } from '../../widgets/friendly.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { COL, fitCanvas, h, km, kn, setHtml, setRows, tdeg1, tdeg3 } from '../../widgets/format.js';
import { Plot } from '../../widgets/plot.js';
import { courseAction, torpedoAction } from '../../widgets/actions.js';
import { decoy } from '../../widgets/emergency.js';
import { fillBox } from '../../widgets/fill.js';
import { priorFor } from '../../widgets/speed-prior.js';
import { keycap } from '../../widgets/keys.js';
import { tubeBank } from '../../widgets/tube-bank.js';

type Method = 'hyp' | 'ekelund' | 'dots';
type Contact = NonNullable<ReturnType<typeof store.selectedContact>>;
const DOT_FACTORS = [0.6, 1, 1.6];
const FIX_MAX_AGE = 120; // s sim time
/** A lost contact's solution is dead-reckoned this long (s sim time) before it is dropped. */
const GHOST_S = 180;
/** Below this Güte FEUER asks once. */
const FIRE_Q_MIN = 50;
/** Clicks on FEUER closer together than this (ms) count as one. */
const FIRE_DEBOUNCE_MS = 700;

const n1 = (x: number) => x.toFixed(1).replace('.', ',');
const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export { priorFor };

/** Why Auto-TMA kept the range (audit 4: a weak second leg no longer collapses to 0,5-1 km). */
const VAGUE_TIP = 'ENTFERNUNG UNBESTIMMT: die Peilungen passen zu jeder Entfernung (der Kurswechsel ändert die Peilrate kaum, oder das Ziel hat selbst gezackt). Auto-TMA behält die Entfernung bei; Kurs um 30–60° ändern und länger peilen';
const PRIOR_BY: Record<SpeedPrior['by'], string> = { class: 'KLASSE', demon: 'DEMON', tonals: 'TONALE', none: 'SUCHGRENZE' };

/** Residual plot: one row per hypothesis (dot-stack) or a single scatter (hypothesis). */
function drawResiduals(c: HTMLCanvasElement, rows: { label: string; res: { t: number; err: number }[] }[]): void {
  const H = 70;
  const ctx = fitCanvas(c, H);
  const w = c.clientWidth;
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, w, H);
  ctx.strokeStyle = COL.grid;
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, H); ctx.stroke();
  ctx.fillStyle = COL.dim;
  ctx.font = '10px ui-monospace, monospace';
  // Scale marks inset from the frame
  ctx.textAlign = 'left';
  ctx.fillText('−5°', 6, 13);
  ctx.textAlign = 'right';
  ctx.fillText('+5°', w - 6, 13);
  ctx.textAlign = 'left';
  const band = (H - 12) / Math.max(1, rows.length);
  rows.forEach((row, ri) => {
    // Fixed time axis (newest at the top, 5 min span): dots scroll smoothly instead of reshuffling
    const tNew = row.res[row.res.length - 1]?.t ?? 0;
    const recent = row.res.filter((r) => tNew - r.t <= 300);
    const y0 = 12 + ri * band;
    if (rows.length > 1) {
      ctx.fillStyle = COL.dim;
      ctx.fillText(row.label, 2, y0 + band / 2 + 3);
    }
    recent.forEach((r) => {
      const x = w / 2 + (Math.max(-5, Math.min(5, r.err)) / 5) * (w / 2 - 4);
      const age = (tNew - r.t) / 300;
      const y = rows.length > 1 ? y0 + band / 2 + (Math.floor(r.t / 7) % 5 - 2) * 2 : 12 + age * (H - 16);
      ctx.fillStyle = Math.abs(r.err) < 1 ? COL.g2 : COL.amber;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    });
  });
}

export function fireControlStation(): Station {
  // Left: the plot takes the height, under it the contacts (four rows, the one list that
  // scrolls) and a strip with the wires and the decoy. Right: the TMA at a fixed height, the
  // tube bank in one row, the torpedo settings as a 2-column grid and at the foot the sticky
  // action bar (take over the solution, FEUER). Stacked below 1150 px: plot, action bar,
  // wires, tube bank, TMA, settings, contacts (--stack).
  const el = h(`<div class="st two sub-fc stack">
    <div class="st-col">
      <div class="panel grow" style="--stack:1"><div class="hd"><span>Feuerleitung · Lagebild</span><span id="tgt-st" class="dim"></span></div>
        <div class="fill" id="plot-box"><canvas id="plot"></canvas></div>
        <div class="hint">GELBEN KREIS ZIEHEN = TMA · RECHTSKLICK = AKTIONEN</div>
      </div>
      <div class="panel fc-wire" style="--stack:3" title="Draht: unter 12 kn bleiben · nach dem Täuschkörper abdrehen und Tiefe wechseln">
        <span class="tl">DRAHT</span><div id="wires"></div>
        <button id="tr-nm" class="warn" title="Geräuschboje gegen anlaufende Torpedos; danach abdrehen und Tiefe wechseln">Täuschkörper${keycap('decoy')}</button>
      </div>
    </div>
    <div class="st-col">
      <div class="panel fc-tma" style="--stack:5"><div class="hd"><span>Zielbewegungsanalyse</span><span id="tgt" class="amber"></span></div>
        <div class="fc-tmabar"><span class="seg"><button data-method="hyp" title="Hypothese anpassen, Residuen prüfen">Hypothese</button><button data-method="ekelund" title="Entfernung aus den Peilraten zweier eigener Schläge">Ekelund</button><button data-method="dots" title="Residuen bei 0,6-, 1,0- und 1,6-facher Entfernung">Dot-Stack</button></span>
          <span class="fc-acts"><button id="auto" title="Einmal die beste Lösung aus allen Peilungen rechnen (danach von Hand nachführen)">Auto-TMA</button><button id="clear" title="Lösung des gewählten Kontakts verwerfen">Verwerfen</button></span></div>
        <div class="row"><span class="dim">BEOBACHTBARKEIT</span><span id="v-obs"></span></div>
        <div class="row" id="ekel-row" style="display:none"><span class="dim">EKELUND</span><span id="v-ekel"></span><button id="ekel-take" style="display:none" title="Ekelund-Entfernung übernehmen">Übernehmen</button></div>
        <div class="tma-sl">
          <div><div class="row"><span class="dim">ENTFERNUNG</span><b id="v-rng"></b></div><input id="s-rng" type="range" min="500" max="40000" step="100" aria-label="Entfernung"></div>
          <div><div class="row"><span class="dim">ZIELKURS</span><b id="v-crs"></b></div><input id="s-crs" type="range" min="0" max="359" step="1" aria-label="Zielkurs"></div>
          <div><div class="row"><span class="dim">ZIELFAHRT</span><b id="v-spd"></b></div><input id="s-spd" type="range" min="0" max="30" step="0.5" aria-label="Zielfahrt"></div>
        </div>
        <div class="row fc-prior" title="Fahrtbereich aus Klassifizierung, DEMON-Wellendrehzahl und Handelsschiff-Tonalen: Auto-TMA sucht nur darin. Liegt die Lösung an der Grenze, bestimmen die Peilungen die Fahrt nicht"><span class="dim">FAHRTBEREICH</span><span id="v-prior"></span></div>
        <div class="row fc-qrow"><span><span class="dim">GÜTE / FEHLER</span> <span id="v-q"></span></span><span><span class="dim">LÖSUNG ALTER</span> <span id="v-age"></span></span></div>
        <canvas id="res"></canvas>
        <div id="steps" class="tma-step"></div>
      </div>
      <div class="panel fc-tubes" style="--stack:4"><div class="hd"><span>Torpedo</span><span id="tubes" class="dim"></span></div>
        <div id="tr-tubes"></div>
      </div>
      <div class="panel fc-set" style="--stack:6">
        <div class="fc-grid">
          <label title="Laufgeschwindigkeit"><span class="dim">LAUF</span><select id="t-spd"><option>40</option><option>30</option></select><span class="u">KN</span></label>
          <label title="Suchkopf ein nach"><span class="dim">SUCHKOPF</span><input id="t-en" type="number" value="2000" step="250"><span class="u">M</span></label>
          <label><span class="dim">SUCHTIEFE</span><input id="t-dep" type="number" value="15" step="5"><span class="u">M</span></label>
          <label title="Suchmodus"><span class="dim">MODUS</span><select id="t-mode"><option value="passive">PASSIV</option><option value="active">AKTIV</option></select><span class="u"></span></label>
          <label><span class="dim">SCHUSSKURS</span><input id="t-hdg" type="number" min="0" max="359" placeholder="—"><span class="u">°</span></label>
          <label title="Fächerwinkel zwischen zwei Torpedos"><span class="dim">FÄCHER</span><input id="t-spread" type="number" min="0" max="10" step="0.5" value="3"><span class="u">°</span></label>
          <div class="lbl"><span class="dim">SALVE</span><span class="seg" id="t-salvo">${Array.from({ length: SALVO_MAX }, (_, i) => `<button data-salvo="${i + 1}">${i + 1}</button>`).join('')}</span></div>
          <div class="lbl"><span id="t-spread-auto" class="dim"></span></div>
        </div>
        <div id="fire-why" class="row amber" style="display:none;margin-top:4px;align-items:center"><span id="fire-why-t"></span><button id="fire-fix"></button></div>
      </div>
      <div class="panel fc-list" style="--stack:7"><div id="list"></div></div>
      <div class="actionbar" style="--stack:2"><button id="calc" style="flex:3">Lösung übernehmen</button><button id="fire" class="fire" style="flex:4">Feuer${keycap('fire')}</button></div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const plot = new Plot(q<HTMLCanvasElement>('#plot'), {
    bearingLines: true, showConvoy: false, esmLines: true,
    actions: (p) => [
      ...courseAction(p),
      ...torpedoAction(p, {
        speedKn: Number(q<HTMLSelectElement>('#t-spd').value), searchDepth: Number(q<HTMLInputElement>('#t-dep').value) || 15,
        mode: q<HTMLSelectElement>('#t-mode').value as 'passive' | 'active',
        // Expert: the map only sets course and seeker distance; the guarded FEUER button fires
        aim: store.realism === 'profi' ? (hdg, enableAfter) => {
          q<HTMLInputElement>('#t-hdg').value = String(Math.round(trueDeg(hdg)) % 360);
          q<HTMLInputElement>('#t-en').value = String(Math.round(enableAfter / 250) * 250);
          q<HTMLButtonElement>('#fire').focus();
        } : undefined,
      }),
    ],
  });


  // Salvo: how many fish, and the angle between them (default from the target's size at range and the TMA error)
  let salvo = 1;
  let spreadTouched = false;
  onTap(q('#t-salvo'), '[data-salvo]', (b) => (salvo = Number(b.dataset.salvo)));
  q<HTMLInputElement>('#t-spread').addEventListener('input', () => (spreadTouched = true));
  // Outside the launch envelope the fire button is off; one click on the fix brings the boat into it
  let fix: (() => void) | undefined;
  q<HTMLButtonElement>('#fire-fix').onclick = () => fix?.();

  /**
   * A contact that drops out of the picture keeps its solution for a few minutes, dead-reckoned
   * ("LÖSUNG GEKOPPELT · KONTAKT VERLOREN"): the fire-control problem does not vanish mid-attack.
   */
  let ghost: { c: Contact; lostAt: number } | undefined;
  let lastSel: Contact | undefined;
  /** The contact being worked: the selected one, or the lost one whose solution is still coupled. */
  const cur = (): Contact | undefined => store.selectedContact() ?? (store.selected ? undefined : ghost?.c);
  function trackGhost(): void {
    const s = store.snap;
    if (!s) return;
    const sel = store.selectedContact();
    if (sel) {
      lastSel = sel;
      ghost = undefined;
    } else if (lastSel && !store.selected && !s.contacts.some((x) => x.label === lastSel!.label) && store.solutions.has(lastSel.label)) {
      ghost = { c: lastSel, lostAt: s.time };
      lastSel = undefined;
    }
    if (ghost && (store.selected || s.time - ghost.lostAt > GHOST_S || !store.solutions.has(ghost.c.label))) ghost = undefined;
    // N1: the label is held again (the track was re-associated): it is live, not VERLOREN
    if (ghost && s.contacts.some((x) => x.label === ghost!.c.label)) {
      store.selected = ghost.c.label;
      ghost = undefined;
    }
  }

  /** Güte of the worked contact's solution, capped while its speed only sits on a bound of the prior. */
  function solQuality(c: Contact | undefined): number {
    const sol = c ? store.solutions.get(c.label) : undefined;
    if (!c || !sol) return 0;
    return boundedQuality(evaluateSolution(sol, c.history, store.ownTrack).quality, sol, priorFor(c));
  }

  /** Edit the selected solution via range (along latest bearing), course and speed. */
  function fromSliders(): void {
    const s = store.snap;
    const c = cur();
    if (!s || !c) return;
    const last = c.history[c.history.length - 1];
    if (!last) return;
    const own = ownPosAt(store.ownTrack, last.t) ?? s.own;
    const prev = store.solutions.get(c.label);
    let b = last.b;
    if (prev && last.alt !== undefined) {
      const pb = bearing(own, targetPosAt(prev, last.t));
      if (Math.abs(((pb - last.alt + 540) % 360) - 180) < Math.abs(((pb - last.b + 540) % 360) - 180)) b = last.alt;
    }
    const v = headingVec(b);
    const r = Number(q<HTMLInputElement>('#s-rng').value);
    store.solutions.set(c.label, {
      t0: last.t, x0: own.x + v.x * r, y0: own.y + v.y * r,
      course: gameDeg(Number(q<HTMLInputElement>('#s-crs').value)), speedKn: Number(q<HTMLInputElement>('#s-spd').value),
    });
  }
  ['#s-rng', '#s-crs', '#s-spd'].forEach((id) => (q<HTMLInputElement>(id).oninput = fromSliders));

  let method: Method = 'hyp';
  let sliderSol: TmaSolution | undefined;
  let shownQ: number | undefined;
  let shownRms: number | undefined;
  let shownLabel: string | undefined;
  const solSeen = new Map<string, { ref: TmaSolution; at: number }>();
  el.querySelectorAll<HTMLButtonElement>('[data-method]').forEach((b) => (b.onclick = () => (method = b.dataset.method as Method)));
  q<HTMLButtonElement>('#ekel-take').onclick = () => {
    const c = cur();
    if (!c) return;
    const r = ekelundRange(c.history, store.ownTrack);
    const old = store.solutions.get(c.label);
    const sol = r && solutionAtRange(c.history, store.ownTrack, r.range, old?.course ?? 0, old?.speedKn ?? 0);
    if (sol) store.solutions.set(c.label, sol);
  };
  q<HTMLButtonElement>('#auto').onclick = () => {
    const c = cur();
    if (!c) return;
    // The speed prior bounds the search: classification, the DEMON shaft rate and merchant
    // tonals (a freighter can't make 24 kn). Least squares over the whole plot (both legs)
    // first; the grid search inside the prior when that leaves it or finds nothing
    // (no own-ship bearings, unresolved towed array)
    // A weak second leg leaves the range open: then the range already set is kept (audit 4)
    const old = store.solutions.get(c.label);
    const last = c.history[c.history.length - 1];
    const me = last && ownPosAt(store.ownTrack, last.t);
    const rangeHint = old && last && me ? distance(me, targetPosAt(old, last.t)) : undefined;
    const sol = solveInPrior(c.history, store.ownTrack, priorFor(c), (maxKn) => lsqSolve(c.history, store.ownTrack, maxKn, c.assigned)?.sol, { rangeHint });
    if (!sol) return;
    // N8: never store a solution that fits the plot worse than the one already there
    if (betterSolution(sol, old, c.history, store.ownTrack)) store.solutions.set(c.label, sol);
    else store.lastError = 'Auto-TMA: keine bessere Lösung als die vorhandene';
  };
  q<HTMLButtonElement>('#clear').onclick = () => {
    const c = cur();
    if (c) store.solutions.delete(c.label);
  };
  q<HTMLButtonElement>('#calc').onclick = () => {
    const s = store.snap;
    const c = cur();
    const sol = c ? store.solutions.get(c.label) : undefined;
    if (!s || !sol) return;
    if (store.realism === 'profi' && c && ownLegChange(c.history, store.ownTrack) < 6) {
      store.lastError = 'Entfernung nicht beobachtbar: erst einen eigenen Kurswechsel fahren';
      return;
    }
    const hdg = interceptHeading(s.own, Number(q<HTMLSelectElement>('#t-spd').value), sol, s.time);
    if (hdg !== undefined) q<HTMLInputElement>('#t-hdg').value = String(Math.round(trueDeg(hdg)) % 360);
    const rng = distance(s.own, targetPosAt(sol, s.time));
    q<HTMLInputElement>('#t-en').value = String(Math.max(500, Math.round((rng * 0.7) / 250) * 250));
    if (!spreadTouched && c) {
      const fan = defaultSpreadDeg(rng, evaluateSolution(sol, c.history, store.ownTrack).rmsDeg);
      q<HTMLInputElement>('#t-spread').value = (Math.round(fan * 2) / 2).toFixed(1);
    }
  };
  // One click, one torpedo: a double click (or a bouncing key) within the debounce counts once.
  // Registered before the guard, so the guard never sees the second click.
  let fireClickAt = -1e9;
  q<HTMLButtonElement>('#fire').addEventListener('click', (e) => {
    const now = performance.now();
    if (now - fireClickAt < FIRE_DEBOUNCE_MS) e.stopImmediatePropagation();
    else fireClickAt = now;
  });
  // Fire asks twice on a weak (below 50 %) or missing solution, or with our own ship as the target
  guardFire(q<HTMLButtonElement>('#fire'), () => {
    if (q<HTMLInputElement>('#t-hdg').value === '') return { block: 'KEIN SCHUSSKURS' };
    const c = cur();
    const s = store.snap;
    if (c && s && isFriendlyContact(c, s)) return { warn: 'EIGENES SCHIFF' };
    const qual = solQuality(c);
    // A fixed text: the guard confirms only the same warning, and the Güte moves with every bearing
    if (qual < FIRE_Q_MIN) return { warn: `GÜTE UNTER ${FIRE_Q_MIN} %` };
    return {};
  }, () => {
    const hdg = Number(q<HTMLInputElement>('#t-hdg').value);
    if (!Number.isFinite(hdg)) return;
    net.send({
      t: 'fire', heading: gameDeg(hdg), enableAfter: Number(q<HTMLInputElement>('#t-en').value),
      mode: q<HTMLSelectElement>('#t-mode').value as 'passive' | 'active', searchDepth: Number(q<HTMLInputElement>('#t-dep').value),
      speedKn: Number(q<HTMLSelectElement>('#t-spd').value),
      ...(salvo > 1 ? { salvo, spread: Math.max(0, Math.min(10, Number(q<HTMLInputElement>('#t-spread').value) || 0)) } : {}),
    });
  });
  el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
  // Wires: steer the running torpedoes in small or big steps; a click on the name selects it
  onTap(q('#wires'), '[data-steer]', (b) => {
    const t = store.snap?.torpedoes.find((x) => x.id === b.dataset.steer);
    if (t) net.send({ t: 'steer', torpId: t.id, heading: (t.heading + Number(b.dataset.d) + 360) % 360 });
  });
  onTap(q('#wires'), '[data-pick]', (b) => (store.selected = b.dataset.pick));
  q<HTMLButtonElement>('#tr-nm').onclick = decoy;
  const box = fillBox(q('#plot-box'), 240);
  // The tube bank: one cell per tube with its reload as a fill (the frigate's look)
  const bank = tubeBank();
  q('#tr-tubes').replaceWith(bank.el);

  return {
    id: 'feuerleitung',
    title: 'Feuerleitung',
    el,
    snap() {
      const s = store.snap!;
      renderContactList(q('#list'), (via) => via === 'own');
      trackGhost();
      const c = cur();
      const lost = !!c && c === ghost?.c;
      const sol: TmaSolution | undefined = c ? store.solutions.get(c.label) : undefined;
      setHtml(q('#tgt'), !c ? 'KONTAKT WÄHLEN' : lost ? `${c.label} <span class="fc-lost">LÖSUNG GEKOPPELT · KONTAKT VERLOREN</span>` : c.label);
      q('#tgt').title = lost ? `${c!.label} wird nicht mehr gehört: die Lösung läuft noch ${Math.max(0, Math.round((GHOST_S - (s.time - ghost!.lostAt)) / 60))} min gekoppelt weiter (Kurs und Fahrt wie zuletzt)` : '';
      q('#tgt-st').textContent = c ? `ZIEL ${c.label}${lost ? ' · VERLOREN' : ''}` : '';
      q('#auto').style.display = store.realism === 'einsteiger' ? '' : 'none';
      // Fire: tubes ready or the next reload; take-over: only with a solution
      const lo = s.own.loadout;
      // Launch envelope: too fast or too deep switches the button off and offers the fix
      const block = launchBlock(s.own.cls, s.own.speedKn, s.own.depth);
      const fireBtn = q<HTMLButtonElement>('#fire');
      fireBtn.disabled = !!block;
      if (block?.why === 'speed') {
        const to = Math.min(12, block.limit - 3);
        fix = () => net.send({ t: 'order', speedKn: to });
        btnState(fireBtn, { label: 'ZU SCHNELL', tone: 'warn' });
        q('#fire-why-t').textContent = `Abschuss nur bis ${block.limit} kn (jetzt ${Math.round(s.own.speedKn)} kn)`;
        q('#fire-fix').textContent = `ZU SCHNELL · AUF ${to} KN`;
      } else if (block?.why === 'depth') {
        const to = block.limit - 10;
        fix = () => net.send({ t: 'order', depth: to });
        btnState(fireBtn, { label: 'ZU TIEF', tone: 'warn' });
        q('#fire-why-t').textContent = `Abschuss nur bis ${block.limit} m Tiefe (jetzt ${Math.round(s.own.depth)} m)`;
        q('#fire-fix').textContent = `ZU TIEF · AUF ${to} M`;
      } else {
        fix = undefined;
        // Tubes ready but a weak solution: the Güte on the button in amber (FEUER asks once)
        const tag = tubeTag(lo.tubes);
        const ready = lo.tubes.some((t) => t.loaded);
        const qNow = Math.round(solQuality(c));
        btnState(fireBtn, ready && c && sol && qNow < FIRE_Q_MIN ? { label: `GÜTE ${qNow} %`, tone: 'warn' } : tag);
      }
      q('#fire-why').style.display = block ? '' : 'none';
      el.querySelectorAll<HTMLButtonElement>('[data-salvo]').forEach((b) => b.classList.toggle('on', Number(b.dataset.salvo) === salvo));
      q<HTMLInputElement>('#t-spread').disabled = salvo === 1;
      q('#t-spread-auto').textContent = salvo > 1 ? `${salvo} TORPEDOS · FÄCHER ${Math.round((salvo - 1) * (Number(q<HTMLInputElement>('#t-spread').value) || 0))}°` : '';
      btnState(q('#calc'), sol ? { label: lost ? 'GEKOPPELT' : 'LÖSUNG', tone: lost ? 'warn' : undefined } : { label: 'KEINE', tone: 'empty' });
      const legs = c ? c.history.length : 0;
      const prior = c ? priorFor(c) : undefined;
      const fitQ = solQuality(c);
      // The checklist in one line: the first step still open, the whole list in the tooltip
      const steps: [boolean, string][] = [
        [!!c, 'Kontakt wählen (Liste, Karte oder Wasserfall)'],
        [legs > 40, 'Peilungen sammeln, dabei einmal den Kurs um 30–60° ändern'],
        [!!sol, 'Auto-TMA oder gelben Kreis auf der Karte ziehen'],
        [fitQ > 60, 'Güte über 60 % bringen'],
        [s.torpedoes.length > 0, 'Lösung übernehmen und Feuer'],
      ];
      const open = steps.find(([done]) => !done);
      const nDone = steps.filter(([done]) => done).length;
      const stepsEl = q('#steps');
      setHtml(stepsEl, open ? `<span class="dim">${nDone}/5</span> <span class="amber">▸ ${open[1]}</span>` : '<span>✓ Lösung steht, Torpedo läuft</span>');
      stepsEl.title = steps.map(([done, text]) => `${done ? '✓' : '▸'} ${text}`).join('\n');
      // The speed band the search may use, and a warning when the solution sits on its edge
      const atEdge = !!(sol && prior && speedAtBound(sol, prior));
      setHtml(q('#v-prior'), !prior ? '—' : atEdge ? '<span class="amber">ZIELFAHRT AN DER GRENZE – UNBESTIMMT</span>'
        : `${n1(prior.lo)}–${n1(prior.hi)} KN <span class="dim">· ${PRIOR_BY[prior.by]}${prior.demonKn !== undefined ? ` ~${n1(prior.demonKn)} KN` : ''}</span>`);
      q('.fc-prior').title = atEdge && prior
        ? `Die Lösung liegt mit ${n1(sol!.speedKn)} kn an der Grenze ${n1(prior.lo)}–${n1(prior.hi)} kn (${PRIOR_BY[prior.by]}): die Peilungen bestimmen die Fahrt nicht, die Güte bleibt unter 30 %. Kurs ändern, länger peilen, DEMON-Welle markieren oder klassifizieren`
        : 'Fahrtbereich aus Klassifizierung, DEMON-Wellendrehzahl und Handelsschiff-Tonalen: Auto-TMA sucht nur darin. Liegt die Lösung an der Grenze, bestimmen die Peilungen die Fahrt nicht';
      if (c && sol) {
        const fit = evaluateSolution(sol, c.history, store.ownTrack);
        const now = targetPosAt(sol, s.time);
        const rng = distance(s.own, now);
        // A kept range (the bearings leave it open): the number amber and marked ≈; the
        // observability row says ENTFERNUNG UNBESTIMMT
        setHtml(q('#v-rng'), rangeUndetermined(sol) ? `<span class="amber">≈${km(rng)}</span>` : km(rng));
        q('#v-rng').title = rangeUndetermined(sol) ? VAGUE_TIP : '';
        q('#v-crs').textContent = `${tdeg3(sol.course)}°`;
        q('#v-spd').textContent = kn(sol.speedKn);
        q('#v-spd').className = atEdge ? 'amber' : '';
        // Eased readouts: the fit settles instead of flickering with each noisy bearing
        const qTarget = prior ? boundedQuality(fit.quality, sol, prior) : fit.quality;
        shownQ = shownQ === undefined || shownLabel !== c.label ? qTarget : shownQ + (qTarget - shownQ) * 0.2;
        if (atEdge) shownQ = Math.min(shownQ, qTarget);
        shownRms = shownRms === undefined || shownLabel !== c.label ? fit.rmsDeg : shownRms + (fit.rmsDeg - shownRms) * 0.2;
        shownLabel = c.label;
        setHtml(q('#v-q'), `<span class="${shownQ > 60 ? '' : 'amber'}">${Math.round(shownQ)} %</span> / ${n1(shownRms)}°`);
        const last = c.history[c.history.length - 1];
        const own = last ? ownPosAt(store.ownTrack, last.t) ?? s.own : s.own;
        // Move the sliders only when the solution itself changed (not on every update)
        if (sliderSol !== sol) {
          sliderSol = sol;
          const ae = document.activeElement;
          if (ae !== q('#s-rng')) q<HTMLInputElement>('#s-rng').value = String(distance(own, targetPosAt(sol, last?.t ?? s.time)));
          if (ae !== q('#s-crs')) q<HTMLInputElement>('#s-crs').value = String(trueDeg(sol.course));
          if (ae !== q('#s-spd')) q<HTMLInputElement>('#s-spd').value = String(sol.speedKn);
        }
        const tl = c.history[c.history.length - 1]?.t ?? s.time;
        drawResiduals(q<HTMLCanvasElement>('#res'), method === 'dots'
          ? DOT_FACTORS.map((f) => ({ label: `${n1(f)}×`, res: evaluateSolution(scaleSolutionRange(sol, f, tl, store.ownTrack), c.history, store.ownTrack).residuals }))
          : [{ label: '', res: fit.residuals }]);
        const seen = solSeen.get(c.label);
        if (!seen || seen.ref !== sol) solSeen.set(c.label, { ref: sol, at: s.time });
        const age = s.time - (solSeen.get(c.label)?.at ?? s.time);
        // Stale: a short amber badge (the row never wraps); what to do is in the tooltip
        setHtml(q('#v-age'), age > FIX_MAX_AGE ? `${Math.round(age)} S <span class="fc-badge">VERALTET</span>` : `${Math.round(age)} S`);
        q('#v-age').title = age > FIX_MAX_AGE ? 'Lösung älter als 2 min: neu anpassen (Regler oder Auto-TMA)' : '';
      } else {
        for (const id of ['#v-rng', '#v-crs', '#v-spd', '#v-q', '#v-age']) q(id).textContent = '—';
        q('#v-spd').className = '';
        drawResiduals(q<HTMLCanvasElement>('#res'), [{ label: '', res: [] }]);
      }
      el.querySelectorAll<HTMLButtonElement>('[data-method]').forEach((b) => b.classList.toggle('on', b.dataset.method === method));
      const leg = c ? ownLegChange(c.history, store.ownTrack) : 0;
      const vague = !!(c && sol && rangeUndetermined(sol));
      q('#v-obs').title = vague ? VAGUE_TIP : '';
      setHtml(q('#v-obs'), !c ? '—' : vague ? '<span class="amber">ENTFERNUNG UNBESTIMMT</span>' : leg >= 30 ? `JA · KURSWECHSEL ${leg.toFixed(0)}°` : leg >= 6 ? `<span class="amber">SCHWACH · ${leg.toFixed(0)}° (BESSER 30–60°)</span>` : '<span class="amber">NEIN · EIGENEN KURS ÄNDERN</span>');
      const ek = method === 'ekelund' && c ? ekelundRange(c.history, store.ownTrack) : undefined;
      q('#ekel-row').style.display = method === 'ekelund' ? '' : 'none';
      q('#ekel-take').style.display = method === 'ekelund' && ek ? '' : 'none';
      setHtml(q('#v-ekel'), ek ? `${km(ek.range)} BEIM SCHLAGWECHSEL (${ek.courseChange.toFixed(0)}°)` : '<span class="amber">ZWEI SCHLÄGE JE 90 S, MIND. 30° KURSWECHSEL</span>');
      // Tube bank: every tube with its load state and the reload as a fill bar
      const tubes = lo.tubes;
      q('#tubes').textContent = `${tubes.filter((t) => t.loaded).length}/${tubes.length} GELADEN · VORRAT ${lo.heavy}`;
      bank.update(tubes);
      // One wire row per torpedo: name and state, course · run so far · fuel left (mm:ss), steering
      // One row per torpedo, kept by id: the figures change every snapshot, the steering buttons stay
      // the same nodes (buttons inserted while a finger is down make iOS drop the tap)
      const wires = q('#wires');
      setRows(wires, s.torpedoes.length ? s.torpedoes.map((t) => ({ key: t.id, html: `
        <div class="row wire-row"><span class="clickable wr-name" data-pick="${t.id}" title="Torpedo wählen"></span>
        <span class="wr-data" title="Kurs · gelaufene Strecke · Restlaufzeit (Brennstoff)"></span>
        <span class="seg wr-steer"><button data-steer="${t.id}" data-d="-10" title="Über den Draht 10° nach Backbord">◀◀</button><button data-steer="${t.id}" data-d="-2" title="Über den Draht 2° nach Backbord">◀</button><button data-steer="${t.id}" data-d="2" title="Über den Draht 2° nach Steuerbord">▶</button><button data-steer="${t.id}" data-d="10" title="Über den Draht 10° nach Steuerbord">▶▶</button></span></div>` }))
        : [{ key: 'none', html: '<div class="dim" title="Kein eigener Torpedo am Draht">KEIN TORPEDO</div>' }]);
      s.torpedoes.forEach((t, i) => {
        const row = wires.children[i] as HTMLElement | undefined;
        if (!row) return;
        row.classList.toggle('selrow', t.id === store.selected);
        row.classList.toggle('amber', t.id === store.selected);
        setHtml(row.querySelector('.wr-name')!, `${t.id} ${t.homing ? '<span class="red">ZIEL ERFASST</span>' : 'LÄUFT'}`);
        setHtml(row.querySelector('.wr-data')!, `${tdeg1(t.heading)}° · GELAUFEN ${km(t.run)} · <span class="${(t.leftS ?? Infinity) < 60 ? 'amber' : ''}">REST ${t.leftS !== undefined ? mmss(t.leftS) : '—'}</span>`);
      });
      btnState(q('#tr-nm'), { label: String(lo.noisemakers), tone: lo.noisemakers ? undefined : 'empty' });
    },
    frame() {
      plot.draw(box.h);
    },
    dispose() {
      box.dispose();
    },
  };
}
