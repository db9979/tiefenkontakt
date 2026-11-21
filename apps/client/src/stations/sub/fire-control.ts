import {
  CHOICE_MAX_KN,
  CLASSES,
  autoSolve,
  bearing,
  distance,
  evaluateSolution,
  headingVec,
  interceptHeading,
  ownPosAt,
  targetPosAt,
  type TmaSolution,
} from '@tk/shared';
import { net } from '../../net.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { COL, deg1, deg3, fitCanvas, h, km } from '../../widgets/format.js';
import { Plot } from '../../widgets/plot.js';
import { courseAction, torpedoAction } from '../../widgets/actions.js';

function drawResiduals(c: HTMLCanvasElement, res: { t: number; err: number }[]): void {
  const H = 70;
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
  const recent = res.slice(-60);
  recent.forEach((r, i) => {
    const x = w / 2 + (Math.max(-5, Math.min(5, r.err)) / 5) * (w / 2 - 4);
    const y = H - 4 - (i / Math.max(1, recent.length - 1)) * (H - 14);
    ctx.fillStyle = Math.abs(r.err) < 1 ? COL.g2 : COL.amber;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
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
        <div style="display:flex;gap:4px;margin-bottom:6px"><button id="auto">Auto-TMA</button><button id="clear">Verwerfen</button></div>
        <div class="row"><span class="dim">ENTFERNUNG</span><span id="v-rng"></span></div><input id="s-rng" type="range" min="500" max="40000" step="100">
        <div class="row"><span class="dim">ZIELKURS</span><span id="v-crs"></span></div><input id="s-crs" type="range" min="0" max="359" step="1">
        <div class="row"><span class="dim">ZIELFAHRT</span><span id="v-spd"></span></div><input id="s-spd" type="range" min="0" max="30" step="0.5">
        <div class="row"><span class="dim">GÜTE / FEHLER</span><span id="v-q"></span></div>
        <canvas id="res" style="margin-top:4px"></canvas>
        <div id="steps" style="margin-top:6px"></div>
      </div>
      <div class="panel"><div class="hd"><span>Torpedo</span><span id="tubes"></span></div>
        <div class="row"><span class="dim">LAUFGESCHWINDIGKEIT</span><select id="t-spd"><option>40</option><option>30</option></select></div>
        <div class="row"><span class="dim">SUCHKOPF EIN NACH</span><span><input id="t-en" type="number" value="2000" step="250" style="width:80px"> M</span></div>
        <div class="row"><span class="dim">SUCHTIEFE</span><span><input id="t-dep" type="number" value="15" step="5" style="width:80px"> M</span></div>
        <div class="row"><span class="dim">SUCHMODUS</span><select id="t-mode"><option value="passive">PASSIV</option><option value="active">AKTIV</option></select></div>
        <div class="row"><span class="dim">SCHUSSKURS</span><span><input id="t-hdg" type="number" min="0" max="359" style="width:80px">°</span></div>
        <div style="display:flex;gap:4px;margin-top:6px"><button id="calc">Lösung übernehmen</button><button id="fire" class="fire" style="flex:1">Feuer</button></div>
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
      course: Number(q<HTMLInputElement>('#s-crs').value), speedKn: Number(q<HTMLInputElement>('#s-spd').value),
    });
  }
  ['#s-rng', '#s-crs', '#s-spd'].forEach((id) => (q<HTMLInputElement>(id).oninput = fromSliders));

  q<HTMLButtonElement>('#auto').onclick = () => {
    const c = store.selectedContact();
    if (!c) return;
    // Classified contacts bound the speed search: a freighter can't make 24 kn
    const maxKn = c.assigned ? CHOICE_MAX_KN[c.assigned] : c.classified ? CLASSES[c.classified].maxSpeedKn : 30;
    const sol = autoSolve(c.history, store.ownTrack, maxKn);
    if (sol) store.solutions.set(c.label, sol);
  };
  q<HTMLButtonElement>('#clear').onclick = () => store.selected && store.solutions.delete(store.selected);
  q<HTMLButtonElement>('#calc').onclick = () => {
    const s = store.snap;
    const sol = store.selected ? store.solutions.get(store.selected) : undefined;
    if (!s || !sol) return;
    const hdg = interceptHeading(s.own, Number(q<HTMLSelectElement>('#t-spd').value), sol, s.time);
    if (hdg !== undefined) q<HTMLInputElement>('#t-hdg').value = String(Math.round(hdg));
    const rng = distance(s.own, targetPosAt(sol, s.time));
    q<HTMLInputElement>('#t-en').value = String(Math.max(500, Math.round((rng * 0.7) / 250) * 250));
  };
  q<HTMLButtonElement>('#fire').onclick = () => {
    const hdg = Number(q<HTMLInputElement>('#t-hdg').value);
    if (!Number.isFinite(hdg) || q<HTMLInputElement>('#t-hdg').value === '') return;
    net.send({
      t: 'fire', heading: ((hdg % 360) + 360) % 360, enableAfter: Number(q<HTMLInputElement>('#t-en').value),
      mode: q<HTMLSelectElement>('#t-mode').value as 'passive' | 'active', searchDepth: Number(q<HTMLInputElement>('#t-dep').value),
      speedKn: Number(q<HTMLSelectElement>('#t-spd').value),
    });
  };
  el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
  q('#wires').addEventListener('mousedown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-steer]');
    const t = b && store.snap?.torpedoes.find((x) => x.id === b.dataset.steer);
    if (b && t) net.send({ t: 'steer', torpId: t.id, heading: (t.heading + Number(b.dataset.d) + 360) % 360 });
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
      const legs = c ? c.history.length : 0;
      const fitQ = c && sol ? evaluateSolution(sol, c.history, store.ownTrack).quality : 0;
      const step = (done: boolean, text: string) => `<div class="${done ? '' : 'amber'}">${done ? '✓' : '▸'} ${text}</div>`;
      q('#steps').innerHTML = [
        step(!!c, 'Kontakt wählen (Liste, Karte oder Wasserfall)'),
        step(legs > 40, 'Peilungen sammeln, dabei einmal den Kurs um 30–60° ändern'),
        step(!!sol, 'Auto-TMA oder gelben Kreis auf der Karte ziehen'),
        step(fitQ > 60, 'Güte über 60 % bringen'),
        step(s.torpedoes.length > 0, 'Lösung übernehmen und Feuer'),
      ].join('');
      if (c && sol) {
        const fit = evaluateSolution(sol, c.history, store.ownTrack);
        const now = targetPosAt(sol, s.time);
        const rng = distance(s.own, now);
        q('#v-rng').textContent = km(rng);
        q('#v-crs').textContent = `${deg3(sol.course)}°`;
        q('#v-spd').textContent = `${sol.speedKn.toFixed(1)} KN`;
        q('#v-q').innerHTML = `<span class="${fit.quality > 60 ? '' : 'amber'}">${fit.quality} %</span> / ${fit.rmsDeg.toFixed(2)}°`;
        const last = c.history[c.history.length - 1];
        const own = last ? ownPosAt(store.ownTrack, last.t) ?? s.own : s.own;
        const ae = document.activeElement;
        if (ae !== q('#s-rng')) q<HTMLInputElement>('#s-rng').value = String(distance(own, targetPosAt(sol, last?.t ?? s.time)));
        if (ae !== q('#s-crs')) q<HTMLInputElement>('#s-crs').value = String(sol.course);
        if (ae !== q('#s-spd')) q<HTMLInputElement>('#s-spd').value = String(sol.speedKn);
        drawResiduals(q<HTMLCanvasElement>('#res'), fit.residuals);
      } else {
        for (const id of ['#v-rng', '#v-crs', '#v-spd', '#v-q']) q(id).textContent = '—';
        drawResiduals(q<HTMLCanvasElement>('#res'), []);
      }
      const tubes = s.own.loadout.tubes;
      q('#tubes').innerHTML = tubes.map((t, i) => `<span class="${t.loaded ? '' : 'dim'}">R${i + 1}${t.loaded ? '' : ` ${Math.ceil(t.reloadLeft)}S`}</span>`).join(' ') + ` <span class="dim">· VORRAT ${s.own.loadout.heavy}</span>`;
      q('#wires').innerHTML = s.torpedoes.map((t) => `
        <div class="row"><span>${t.id} ${t.homing ? '<span class="red">ZIEL ERFASST</span>' : 'LÄUFT'}</span>
        <span>${deg1(t.heading)}° · ${km(t.run)} <button data-steer="${t.id}" data-d="-10">◀</button><button data-steer="${t.id}" data-d="10">▶</button></span></div>`).join('');
    },
    frame() {
      plot.draw(Math.max(320, window.innerHeight - 300));
    },
  };
}
