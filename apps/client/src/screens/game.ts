import { CLASSES, type ServerMsg } from '@tk/shared';
import { audio } from '../audio.js';
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
import { CLASS_LABEL, clock, deg3, esc, h } from '../widgets/format.js';
import { closeMenu } from '../widgets/menu.js';
import { renderDamage } from '../widgets/damage-panel.js';
import { mountTutorial } from '../widgets/tutorial.js';
import { debriefOverlay } from './debrief.js';
import { helpOverlay } from './help.js';
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
  store.loadLocal();
  const saver = setInterval(() => store.saveLocal(), 2000);
  const el = h(`<div class="game">
    <div class="topbar">
      <div class="tabs" id="tabs"></div>
      <span class="spacer"></span>
      <span id="score" class="dim"></span>
      <span id="clock"></span>
      <button id="mute" title="Ton an/aus (M)"></button>
      <input id="vol" type="range" min="0" max="1" step="0.05" style="width:70px" title="Lautstärke">
      <button id="realism" title="Realismusstufe: Einsteiger zeigt Linienbeschriftung, Auto-Marken und Auto-TMA"></button>
      <button id="crt" title="Röhrenbildschirm-Effekt an/aus">Röhre</button>
      <button id="help" title="Hilfe (H)">?</button>
      <button id="quit" class="warn" title="Partie verlassen">Verlassen</button>
    </div>
    <div class="station" id="station"></div>
    <div class="side">
      <div class="panel helm" id="helm"></div>
      <div class="panel" id="damage"></div>
      <div class="panel alerts"><div class="hd"><span>Meldungen</span></div><div id="alerts"></div></div>
      <div class="panel"><div class="hd"><span>Funk</span><span id="radio-state" class="dim"></span></div>
        <div class="radio" id="radio"></div>
        <div style="display:flex;gap:4px;margin-top:6px"><input id="rtext" maxlength="200" placeholder="Konvoi Peilung 052" style="flex:1;min-width:0"><button id="rsend">Senden</button></div>
        <div class="steps" id="quick"></div>
      </div>
    </div>
  </div>`);
  root.replaceChildren(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;

  let stations: Station[] = [];
  let current = 0;
  const stationEl = q('#station');
  const tabs = q('#tabs');
  const helm = mountHelm(q('#helm'));
  const banner = document.createElement('div');
  banner.className = 'banner blink';
  let endShown = false;

  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  const renderMute = () => (q('#mute').textContent = audio.muted ? 'Ton aus' : 'Ton an');
  renderMute();
  const applyCrt = () => {
    const on = localStorage.getItem('tk_crt') !== '0';
    document.body.classList.toggle('crt', on);
    q('#crt').classList.toggle('on', on);
  };
  applyCrt();
  q<HTMLButtonElement>('#crt').onclick = () => {
    localStorage.setItem('tk_crt', document.body.classList.contains('crt') ? '0' : '1');
    applyCrt();
  };
  const renderRealism = () => (q('#realism').textContent = store.realism === 'einsteiger' ? 'Einsteiger' : 'Profi');
  renderRealism();
  q<HTMLButtonElement>('#realism').onclick = () => {
    store.setRealism(store.realism === 'einsteiger' ? 'profi' : 'einsteiger');
    renderRealism();
    stations[current]?.snap?.();
  };
  q<HTMLInputElement>('#vol').value = String(audio.volume);
  q<HTMLInputElement>('#vol').oninput = (e) => audio.setVolume(Number((e.target as HTMLInputElement).value));
  q<HTMLButtonElement>('#mute').onclick = () => {
    audio.setMuted(!audio.muted);
    renderMute();
  };
  let quitArmed: ReturnType<typeof setTimeout> | undefined;
  q<HTMLButtonElement>('#quit').onclick = () => {
    const b = q<HTMLButtonElement>('#quit');
    if (!quitArmed) {
      b.textContent = 'Wirklich verlassen?';
      quitArmed = setTimeout(() => {
        quitArmed = undefined;
        b.textContent = 'Verlassen';
      }, 3000);
      return;
    }
    clearTimeout(quitArmed);
    store.clearLocal();
    onExit();
  };
  q<HTMLButtonElement>('#help').onclick = () => helpOverlay(store.snap ? CLASSES[store.snap.own.cls].submarine : true);
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') audio.click();
  });

  let tutorial: ReturnType<typeof mountTutorial> | undefined;

  function build(): void {
    const sub = store.snap && CLASSES[store.snap.own.cls].submarine;
    if (store.snap?.lesson) {
      tutorial = mountTutorial(store.snap.lesson);
      q('.side').prepend(tutorial.el);
    }
    stations = sub
      ? [subSonarStation(), periscopeStation(), fireControlStation(), diveEngineStation()]
      : [opsCenterStation(), frigateSonarStation(), weaponsStation(), radarEsmStation()];
    tabs.innerHTML = stations.map((s, i) => `<button data-i="${i}" title="Taste ${i + 1}">${i + 1} · ${s.title}</button>`).join('');
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => show(Number(b.dataset.i))));
    q('#quick').innerHTML = (sub ? ['Konvoi gesichtet', 'Greife an', 'Werde gejagt', 'Position'] : ['Kontakt', 'Torpedo im Wasser', 'Suche Sektor', 'Position'])
      .map((t) => `<button data-r="${t}" title="Schnellmeldung senden">${t}</button>`).join('');
    el.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => (b.onclick = () => {
      const s = store.snap;
      const c = store.selectedContact();
      let text = b.dataset.r!;
      if (text === 'Position' && s) text = `Position ${Math.round(s.own.x / 100) / 10} / ${Math.round(s.own.y / 100) / 10} km, Kurs ${deg3(s.own.heading)}`;
      else if (c) text += ` · ${c.label} Peilung ${deg3(c.bearing)}`;
      net.send({ t: 'radio', text });
    }));
    show(0);
  }

  function show(i: number): void {
    closeMenu();
    current = i;
    net.send({ t: 'station', index: i });
    stationEl.replaceChildren(stations[i]!.el);
    tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === i));
    stations[i]?.snap?.();
  }

  const sendRadio = () => {
    const inp = q<HTMLInputElement>('#rtext');
    if (inp.value.trim()) net.send({ t: 'radio', text: inp.value.trim() });
    inp.value = '';
  };
  q<HTMLButtonElement>('#rsend').onclick = sendRadio;
  q<HTMLInputElement>('#rtext').onkeydown = (e) => {
    if (e.key === 'Enter') sendRadio();
    e.stopPropagation();
  };

  function showEnd(): void {
    const s = store.snap;
    if (!store.ended || endShown || !s) return;
    endShown = true;
    const won = store.ended.winner === s.own.team;
    const pct = (x: number) => Math.round((100 * x) / Math.max(1, s.score.totalTons));
    const ov = h(`<div class="overlay"><div class="panel" style="text-align:center;padding:24px 40px">
      <div class="title ${won ? '' : 'red'}">${won ? 'SIEG' : 'NIEDERLAGE'}</div>
      <div style="margin:10px 0">${esc(store.ended.reason)}</div>
      <div class="dim">VERSENKT ${pct(s.score.sunkTons)} % · AM ZIEL ${pct(s.score.arrivedTons)} % · DAUER ${clock(s.time)}</div>
      <div class="steps" style="margin-top:16px;justify-content:center"><button id="debrief" class="on">Nachbesprechung</button><button id="exit">Zur Lobby</button></div></div></div>`);
    ov.querySelector<HTMLButtonElement>('#exit')!.onclick = () => {
      ov.remove();
      onExit();
    };
    ov.querySelector<HTMLButtonElement>('#debrief')!.onclick = () => {
      if (!store.debrief) return;
      ov.remove();
      debriefOverlay(store.debrief, onExit);
    };
    document.body.appendChild(ov);
  }

  function renderSide(): void {
    const s = store.snap!;
    q('#clock').textContent = `${clock(s.time)} · REST ${clock(s.score.timeLeftS)}`;
    const pct = (x: number) => Math.round((100 * x) / Math.max(1, s.score.totalTons));
    q('#score').textContent = `${CLASS_LABEL[s.own.cls]} ${s.own.name}${s.crew.length > 1 ? ` · AN BORD: ${s.crew.join(', ')}` : ''} · VERSENKT ${pct(s.score.sunkTons)} % · AM ZIEL ${pct(s.score.arrivedTons)} %`;
    q('#alerts').innerHTML = (store.lastError ? `<div class="amber">${esc(store.lastError)}</div>` : '') +
      [...s.alerts].reverse().map((a) => {
        const fresh = s.time - a.time < 30;
        const color = a.kind === 'torpedo' || a.kind === 'sunk' ? 'red' : a.kind === 'esm' || a.kind === 'ping' || a.kind === 'transient' ? 'amber' : '';
        const text = a.kind === 'torpedo' && store.realism === 'profi' ? `HOCHFREQUENTES SCHRAUBENGERÄUSCH, SCHNELL WANDERND · PEILUNG ${deg3(a.bearing ?? 0)}` : a.text;
        return `<div class="${color} ${fresh && a.kind === 'torpedo' ? 'blink' : ''}">${clock(a.time)} ${esc(text)}</div>`;
      }).join('');
    q('#radio').innerHTML = s.radio.map((r) => `<div><span class="dim">${clock(r.time)}</span> ${esc(r.from)}: ${esc(r.text)}</div>`).join('');
    const sub = CLASSES[s.own.cls].submarine;
    q('#radio-state').innerHTML = sub ? (s.own.mastUp ? '<span class="amber">MAST OBEN · PEILBAR</span>' : 'MAST UNTEN · KEIN FUNK') : 'DATALINK';
    const torp = s.alerts.filter((a) => a.kind === 'torpedo' && s.time - a.time < 45).pop();
    if (torp && s.own.alive) {
      banner.textContent = store.realism === 'profi'
        ? `SCHNELL WANDERNDES HOCHFREQUENTES GERÄUSCH · PEILUNG ${deg3(torp.bearing ?? 0)}`
        : `TORPEDO! PEILUNG ${deg3(torp.bearing ?? 0)} · AUSWEICHEN · TÄUSCHKÖRPER`;
      if (!banner.isConnected) document.body.appendChild(banner);
    } else banner.remove();
    if (!s.own.alive && !banner.isConnected) {
      banner.textContent = 'EIGENES SCHIFF GESUNKEN';
      document.body.appendChild(banner);
    }
  }

  const off = net.on((m: ServerMsg) => {
    if (m.t === 'snap') {
      const first = !store.snap;
      store.ingest(m.s);
      if (first) build();
      stations[current]?.snap?.();
      helm.update();
      tutorial?.update();
      // Crew: show who mans which station
      if (m.s.crew.length > 1) {
        tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b, j) => {
          const who = (m.s.stations ?? []).filter((x) => x.station === j).map((x) => x.callsign);
          b.textContent = `${j + 1} · ${stations[j]?.title ?? ''}${who.length ? ` (${who.join(', ')})` : ''}`;
        });
      }
      renderDamage(q('#damage'));
      renderSide();
      audio.update(m.s, CLASSES[m.s.own.cls].submarine);
    } else if (m.t === 'error') {
      store.lastError = m.msg;
      setTimeout(() => (store.lastError = store.lastError === m.msg ? '' : store.lastError), 4000);
    } else if (m.t === 'end') {
      store.ended = { winner: m.winner, reason: m.reason };
      showEnd();
    } else if (m.t === 'debrief') {
      store.debrief = m.d;
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const n = Number(e.key);
    if (n >= 1 && n <= stations.length) return show(n - 1);
    if (e.key === 'h' || e.key === 'H' || e.key === '?') return helpOverlay(store.snap ? CLASSES[store.snap.own.cls].submarine : true);
    if (e.key === 'm' || e.key === 'M') {
      audio.setMuted(!audio.muted);
      return renderMute();
    }
    if (stations[current]?.key?.(e)) return;
    helm.key(e);
  };
  window.addEventListener('keydown', onKey);

  let raf = 0;
  const loop = () => {
    stations[current]?.frame();
    helm.frame();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    clearInterval(saver);
    if (store.ended) store.clearLocal();
    else store.saveLocal();
    off();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerdown', unlock);
    banner.remove();
    tutorial?.el.remove();
    closeMenu();
    audio.stopAll();
  };
}
