import { gameDeg, trueDeg } from '../../north.js';
import { onTap } from '../../widgets/touch.js';
import {
  CHOICE_MAX_KN,
  CLASSES,
  autoSolve,
  lsqSolve,
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
import { COL, clock, fitCanvas, h, km, setHtml, tdeg1, tdeg3 } from '../../widgets/format.js';
import { Plot } from '../../widgets/plot.js';
import { courseAction, torpedoAction } from '../../widgets/actions.js';

type Method = 'hyp' | 'ekelund' | 'dots';
const DOT_FACTORS = [0.6, 1, 1.6];
const FIX_MAX_AGE = 120; // s sim time

/** Residual plot: one row per hypothesis (dot-stack) or a single scatter (hypothesis). */
function drawResiduals(c: HTMLCanvasElement, rows: { label: string; res: { t: number; err: number }[] }[]): void {
  const H = rows.length > 1 ? 96 : 70;
  const ctx = fitCanvas(c, H);
  const w = c.clientWidth;
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, w, H);
  ctx.strokeStyle = COL.grid;
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, H); ctx.stroke();
  ctx.fillStyle = COL.dim;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('−5°', 2, 10);
  ctx.fillText('+5°', w - 22, 10);
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
  const el = h(`<div class="cols">
    <div class="panel"><div class="hd"><span>Feuerleitstand · Lagebild</span><span class="kbd">GELBEN KREIS ZIEHEN = TMA · RECHTSKLICK = AKTIONEN</span></div>
      <canvas id="plot"></canvas>
      <div id="list" style="margin-top:6px"></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Zielbewegungsanalyse</span><span id="tgt" class="amber"></span></div>
        <div class="steps"><button data-method="hyp" title="Hypothese anpassen, Residuen prüfen">Hypothese</button><button data-method="ekelund" title="Entfernung aus den Peilraten zweier eigener Schläge">Ekelund</button><button data-method="dots" title="Residuen bei 0,6-, 1,0- und 1,6-facher Entfernung">Dot-Stack</button></div>
        <div style="display:flex;gap:4px;margin-bottom:6px"><button id="auto">Auto-TMA</button><button id="clear">Verwerfen</button><button id="ekel-take" style="display:none">Ekelund-Entfernung übernehmen</button></div>
        <div class="row"><span class="dim">BEOBACHTBARKEIT</span><span id="v-obs"></span></div>
        <div class="row" id="ekel-row" style="display:none"><span class="dim">EKELUND</span><span id="v-ekel"></span></div>
        <div class="row"><span class="dim">ENTFERNUNG</span><span id="v-rng"></span></div><input id="s-rng" type="range" min="500" max="40000" step="100">
        <div class="row"><span class="dim">ZIELKURS</span><span id="v-crs"></span></div><input id="s-crs" type="range" min="0" max="359" step="1">
        <div class="row"><span class="dim">ZIELFAHRT</span><span id="v-spd"></span></div><input id="s-spd" type="range" min="0" max="30" step="0.5">
        <div class="row"><span class="dim">GÜTE / FEHLER</span><span id="v-q"></span></div>
        <div class="row"><span class="dim">LÖSUNG ALTER</span><span id="v-age"></span></div>
        <canvas id="res" style="margin-top:4px"></canvas>
        <div id="steps" style="margin-top:6px"></div>
      </div>
      <div class="panel"><div class="hd"><span>Torpedo</span><span id="tubes"></span></div>
        <div class="row"><span class="dim">LAUFGESCHWINDIGKEIT</span><select id="t-spd"><option>40</option><option>30</option></select></div>
        <div class="row"><span class="dim">SUCHKOPF EIN NACH</span><span><input id="t-en" type="number" value="2000" step="250" style="width:80px"> M</span></div>
        <div class="row"><span class="dim">SUCHTIEFE</span><span><input id="t-dep" type="number" value="15" step="5" style="width:80px"> M</span></div>
        <div class="row"><span class="dim">SUCHMODUS</span><select id="t-mode"><option value="passive">PASSIV</option><option value="active">AKTIV</option></select></div>
        <div class="row"><span class="dim">SCHUSSKURS</span><span><input id="t-hdg" type="number" min="0" max="359" style="width:80px">°</span></div>
        <div class="row"><span class="dim">SALVE</span><span class="steps" id="t-salvo">${Array.from({ length: SALVO_MAX }, (_, i) => `<button data-salvo="${i + 1}">${i + 1}</button>`).join('')}</span></div>
        <div class="row"><span class="dim">FÄCHER</span><span><input id="t-spread" type="number" min="0" max="10" step="0.5" value="3" style="width:80px">° <span id="t-spread-auto" class="dim"></span></span></div>
        <div style="display:flex;gap:4px;margin-top:6px"><button id="calc">Lösung übernehmen</button><button id="fire" class="fire" style="flex:1">Feuer</button></div>
        <div id="fire-why" class="row amber" style="display:none;margin-top:4px;align-items:center"><span id="fire-why-t"></span><button id="fire-fix"></button></div>
        <div id="wires" style="margin-top:6px"></div>
      </div>
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

  /** Edit the selected solution via range (along latest bearing), course and speed. */
  function fromSliders(): void {
    const s = store.snap;
    const c = store.selectedContact();
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
    const c = store.selectedContact();
    if (!c) return;
    const r = ekelundRange(c.history, store.ownTrack);
    const old = store.solutions.get(c.label);
    const sol = r && solutionAtRange(c.history, store.ownTrack, r.range, old?.course ?? 0, old?.speedKn ?? 0);
    if (sol) store.solutions.set(c.label, sol);
  };
  q<HTMLButtonElement>('#auto').onclick = () => {
    const c = store.selectedContact();
    if (!c) return;
    // Classified contacts bound the speed search: a freighter can't make 24 kn
    const maxKn = c.assigned ? CHOICE_MAX_KN[c.assigned] : c.classified ? CLASSES[c.classified].maxSpeedKn : 30;
    // Least-squares fit over the whole plot (both legs); the grid search is the fallback for
    // contacts without own-ship bearings (unresolved towed array)
    const sol = lsqSolve(c.history, store.ownTrack, maxKn, c.assigned)?.sol ?? autoSolve(c.history, store.ownTrack, maxKn);
    if (sol) store.solutions.set(c.label, sol);
  };
  q<HTMLButtonElement>('#clear').onclick = () => store.selected && store.solutions.delete(store.selected);
  q<HTMLButtonElement>('#calc').onclick = () => {
    const s = store.snap;
    const sol = store.selected ? store.solutions.get(store.selected) : undefined;
    if (!s || !sol) return;
    const c = store.selectedContact();
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
  // Fire asks twice on a weak or missing solution, or with our own ship as the target
  guardFire(q<HTMLButtonElement>('#fire'), () => {
    if (q<HTMLInputElement>('#t-hdg').value === '') return { block: 'KEIN SCHUSSKURS' };
    const c = store.selectedContact();
    const s = store.snap;
    if (c && s && isFriendlyContact(c, s)) return { warn: 'EIGENES SCHIFF' };
    const sol = c ? store.solutions.get(c.label) : undefined;
    const qual = c && sol ? evaluateSolution(sol, c.history, store.ownTrack).quality : 0;
    if (qual < 30) return { warn: `GÜTE ${Math.round(qual)} %` };
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
  onTap(q('#wires'), '[data-steer]', (b) => {
    const t = store.snap?.torpedoes.find((x) => x.id === b.dataset.steer);
    if (t) net.send({ t: 'steer', torpId: t.id, heading: (t.heading + Number(b.dataset.d) + 360) % 360 });
  });

  return {
    title: 'Feuerleitung',
    el,
    snap() {
      const s = store.snap!;
      renderContactList(q('#list'), (via) => via === 'own');
      const c = store.selectedContact();
      const sol: TmaSolution | undefined = c ? store.solutions.get(c.label) : undefined;
      q('#tgt').textContent = c ? c.label : 'KONTAKT WÄHLEN';
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
        btnState(fireBtn, tubeTag(lo.tubes));
      }
      q('#fire-why').style.display = block ? '' : 'none';
      el.querySelectorAll<HTMLButtonElement>('[data-salvo]').forEach((b) => b.classList.toggle('on', Number(b.dataset.salvo) === salvo));
      q<HTMLInputElement>('#t-spread').disabled = salvo === 1;
      q('#t-spread-auto').textContent = salvo > 1 ? `${salvo} TORPEDOS · FÄCHER ${Math.round((salvo - 1) * (Number(q<HTMLInputElement>('#t-spread').value) || 0))}°` : '';
      const hasSol = !!(store.selected && store.solutions.get(store.selected));
      btnState(q('#calc'), hasSol ? { label: 'LÖSUNG' } : { label: 'KEINE', tone: 'empty' });
      const legs = c ? c.history.length : 0;
      const fitQ = c && sol ? evaluateSolution(sol, c.history, store.ownTrack).quality : 0;
      const step = (done: boolean, text: string) => `<div class="${done ? '' : 'amber'}">${done ? '✓' : '▸'} ${text}</div>`;
      setHtml(q('#steps'), [
        step(!!c, 'Kontakt wählen (Liste, Karte oder Wasserfall)'),
        step(legs > 40, 'Peilungen sammeln, dabei einmal den Kurs um 30–60° ändern'),
        step(!!sol, 'Auto-TMA oder gelben Kreis auf der Karte ziehen'),
        step(fitQ > 60, 'Güte über 60 % bringen'),
        step(s.torpedoes.length > 0, 'Lösung übernehmen und Feuer'),
      ].join(''));
      if (c && sol) {
        const fit = evaluateSolution(sol, c.history, store.ownTrack);
        const now = targetPosAt(sol, s.time);
        const rng = distance(s.own, now);
        q('#v-rng').textContent = km(rng);
        q('#v-crs').textContent = `${tdeg3(sol.course)}°`;
        q('#v-spd').textContent = `${sol.speedKn.toFixed(1)} KN`;
        // Eased readouts: the fit settles instead of flickering with each noisy bearing
        shownQ = shownQ === undefined || shownLabel !== c.label ? fit.quality : shownQ + (fit.quality - shownQ) * 0.2;
        shownRms = shownRms === undefined || shownLabel !== c.label ? fit.rmsDeg : shownRms + (fit.rmsDeg - shownRms) * 0.2;
        shownLabel = c.label;
        setHtml(q('#v-q'), `<span class="${shownQ > 60 ? '' : 'amber'}">${Math.round(shownQ)} %</span> / ${shownRms.toFixed(1)}°`);
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
          ? DOT_FACTORS.map((f) => ({ label: `${f.toFixed(1)}×`, res: evaluateSolution(scaleSolutionRange(sol, f, tl, store.ownTrack), c.history, store.ownTrack).residuals }))
          : [{ label: '', res: fit.residuals }]);
        const seen = solSeen.get(c.label);
        if (!seen || seen.ref !== sol) solSeen.set(c.label, { ref: sol, at: s.time });
        const age = s.time - (solSeen.get(c.label)?.at ?? s.time);
        setHtml(q('#v-age'), age > FIX_MAX_AGE ? `<span class="amber">${Math.round(age)} S · VERALTET, NEU ANPASSEN</span>` : `${Math.round(age)} S`);
      } else {
        for (const id of ['#v-rng', '#v-crs', '#v-spd', '#v-q', '#v-age']) q(id).textContent = '—';
        drawResiduals(q<HTMLCanvasElement>('#res'), [{ label: '', res: [] }]);
      }
      el.querySelectorAll<HTMLButtonElement>('[data-method]').forEach((b) => b.classList.toggle('on', b.dataset.method === method));
      const leg = c ? ownLegChange(c.history, store.ownTrack) : 0;
      setHtml(q('#v-obs'), !c ? '—' : leg >= 30 ? `JA · KURSWECHSEL ${leg.toFixed(0)}°` : leg >= 6 ? `<span class="amber">SCHWACH · ${leg.toFixed(0)}° (BESSER 30–60°)</span>` : '<span class="red">NEIN · EIGENEN KURS ÄNDERN</span>');
      const ek = method === 'ekelund' && c ? ekelundRange(c.history, store.ownTrack) : undefined;
      q('#ekel-row').style.display = method === 'ekelund' ? '' : 'none';
      q('#ekel-take').style.display = method === 'ekelund' && ek ? '' : 'none';
      setHtml(q('#v-ekel'), ek ? `${km(ek.range)} BEIM SCHLAGWECHSEL (${ek.courseChange.toFixed(0)}°)` : '<span class="amber">ZWEI SCHLÄGE JE 90 S, MIND. 30° KURSWECHSEL</span>');
      const tubes = s.own.loadout.tubes;
      setHtml(q('#tubes'), tubes.map((t, i) => `<span class="${t.loaded ? '' : 'dim'}">R${i + 1}${t.loaded ? '' : ` ${Math.ceil(t.reloadLeft)}S`}</span>`).join(' ') + ` <span class="dim">· VORRAT ${s.own.loadout.heavy}</span>`);
      setHtml(q('#wires'), s.torpedoes.map((t) => `
        <div class="row ${t.id === store.selected ? 'selrow amber' : ''}"><span>${t.id} ${t.homing ? '<span class="red">ZIEL ERFASST</span>' : 'LÄUFT'}</span>
        <span>${tdeg1(t.heading)}° · ${km(t.run)} · <span class="${(t.leftS ?? Infinity) < 60 ? 'amber' : ''}">${t.leftS !== undefined ? clock(t.leftS) : '—'}</span> <button data-steer="${t.id}" data-d="-10">◀</button><button data-steer="${t.id}" data-d="10">▶</button></span></div>`).join(''));
    },
    frame() {
      plot.draw(Math.max(320, window.innerHeight - 300));
    },
  };
}
