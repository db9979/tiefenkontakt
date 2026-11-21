import { CLASSES, type ServerMsg } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { diveEngineStation } from '../stations/sub/dive-engine.js';
import { fireControlStation } from '../stations/sub/fire-control.js';
import { periscopeStation } from '../stations/sub/periscope.js';
import { subSonarStation } from '../stations/sub/sonar.js';
import { opsCenterStation } from '../stations/frigate/ops-center.js';
import { frigateSonarStation } from '../stations/frigate/sonar.js';
import { weaponsStation } from '../stations/frigate/weapons.js';
import { radarEsmStation } from '../stations/frigate/radar-esm.js';
import { CLASS_LABEL, clock, esc, h } from '../widgets/format.js';
import { mountHelm } from './helm.js';

export interface Station {
  title: string;
  el: HTMLElement;
  /** Called every animation frame. */
  frame(): void;
  /** Called on each new snapshot. */
  snap?(): void;
  key?(e: KeyboardEvent): boolean;
}

export function gameScreen(root: HTMLElement, onExit: () => void): () => void {
  store.reset();
  const el = h(`<div class="game">
    <div class="topbar">
      <div class="tabs" id="tabs"></div>
      <span class="spacer"></span>
      <span id="score" class="dim"></span>
      <span id="clock"></span>
    </div>
    <div class="station" id="station"></div>
    <div class="side">
      <div class="panel helm" id="helm"></div>
      <div class="panel alerts"><div class="hd"><span>Meldungen</span></div><div id="alerts"></div></div>
      <div class="panel"><div class="hd"><span>Funk</span><span id="radio-state" class="dim"></span></div>
        <div class="radio" id="radio"></div>
        <div style="display:flex;gap:4px;margin-top:6px"><input id="rtext" maxlength="200" placeholder="Konvoi Peilung 052" style="flex:1"><button id="rsend">Senden</button></div>
      </div>
    </div>
  </div>`);
  root.replaceChildren(el);

  let stations: Station[] = [];
  let current = 0;
  const stationEl = el.querySelector<HTMLElement>('#station')!;
  const tabs = el.querySelector<HTMLElement>('#tabs')!;
  const helm = mountHelm(el.querySelector<HTMLElement>('#helm')!);

  function build(): void {
    const sub = store.snap && CLASSES[store.snap.own.cls].submarine;
    stations = sub
      ? [subSonarStation(), periscopeStation(), fireControlStation(), diveEngineStation()]
      : [opsCenterStation(), frigateSonarStation(), weaponsStation(), radarEsmStation()];
    tabs.innerHTML = stations.map((s, i) => `<button data-i="${i}">${i + 1} · ${s.title}</button>`).join('');
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => show(Number(b.dataset.i))));
    show(0);
  }

  function show(i: number): void {
    current = i;
    stationEl.replaceChildren(stations[i]!.el);
    tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === i));
  }

  const sendRadio = () => {
    const inp = el.querySelector<HTMLInputElement>('#rtext')!;
    if (inp.value.trim()) net.send({ t: 'radio', text: inp.value.trim() });
    inp.value = '';
  };
  el.querySelector<HTMLButtonElement>('#rsend')!.onclick = sendRadio;
  el.querySelector<HTMLInputElement>('#rtext')!.onkeydown = (e) => {
    if (e.key === 'Enter') sendRadio();
    e.stopPropagation();
  };

  function renderSide(): void {
    const s = store.snap!;
    el.querySelector('#clock')!.textContent = `${clock(s.time)} · REST ${clock(s.score.timeLeftS)}`;
    const pct = (x: number) => Math.round((100 * x) / Math.max(1, s.score.totalTons));
    el.querySelector('#score')!.textContent =
      `${CLASS_LABEL[s.own.cls]} ${s.own.name} · VERSENKT ${pct(s.score.sunkTons)} % · AM ZIEL ${pct(s.score.arrivedTons)} %`;
    el.querySelector('#alerts')!.innerHTML = [...s.alerts].reverse().map((a) => {
      const fresh = s.time - a.time < 15;
      const color = a.kind === 'torpedo' || a.kind === 'sunk' ? 'red' : a.kind === 'esm' || a.kind === 'ping' ? 'amber' : '';
      return `<div class="${color} ${fresh && a.kind === 'torpedo' ? 'blink' : ''}">${clock(a.time)} ${esc(a.text)}</div>`;
    }).join('') + (store.lastError ? `<div class="amber">${esc(store.lastError)}</div>` : '') +
      (store.ended ? `<div class="${store.ended.winner === s.own.team ? '' : 'red'}">PARTIE BEENDET: ${store.ended.winner === s.own.team ? 'SIEG' : 'NIEDERLAGE'} · ${esc(store.ended.reason)} <button id="exit">Zur Lobby</button></div>` : '');
    el.querySelector<HTMLButtonElement>('#exit')?.addEventListener('click', onExit);
    el.querySelector('#radio')!.innerHTML = s.radio.map((r) => `<div><span class="dim">${clock(r.time)}</span> ${esc(r.from)}: ${esc(r.text)}</div>`).join('');
    const sub = CLASSES[s.own.cls].submarine;
    el.querySelector('#radio-state')!.textContent = sub ? (s.own.mastUp ? 'MAST OBEN · SENDEN PEILBAR' : 'MAST UNTEN') : 'DATALINK';
  }

  const off = net.on((m: ServerMsg) => {
    if (m.t === 'snap') {
      const first = !store.snap;
      store.ingest(m.s);
      if (first) build();
      stations[current]?.snap?.();
      helm.update();
      renderSide();
    } else if (m.t === 'error') {
      store.lastError = m.msg;
      setTimeout(() => (store.lastError = store.lastError === m.msg ? '' : store.lastError), 4000);
    } else if (m.t === 'end') {
      store.ended = { winner: m.winner, reason: m.reason };
      if (store.snap) renderSide();
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const n = Number(e.key);
    if (n >= 1 && n <= stations.length) return show(n - 1);
    if (stations[current]?.key?.(e)) return;
    helm.key(e);
  };
  window.addEventListener('keydown', onKey);

  let raf = 0;
  const loop = () => {
    stations[current]?.frame();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    off();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
  };
}
