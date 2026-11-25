import { CLASSES, fogAt, iceCover, type ServerMsg, type Snapshot } from '@tk/shared';
import { audio } from '../audio.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { diveEngineStation } from '../stations/sub/dive-engine.js';
import { fireControlStation } from '../stations/sub/fire-control.js';
import { periscopeStation } from '../stations/sub/periscope.js';
import { bridgeStation } from '../stations/frigate/bridge.js';
import { subSonarStation } from '../stations/sub/sonar.js';
import { centralStation } from '../stations/sub/central.js';
import { opsCenterStation } from '../stations/frigate/ops-center.js';
import { frigateSonarStation } from '../stations/frigate/sonar.js';
import { weaponsStation } from '../stations/frigate/weapons.js';
import { radarEsmStation } from '../stations/frigate/radar-esm.js';
import { CLASS_LABEL, clock, esc, h, mastState, tdeg3 } from '../widgets/format.js';
import { closeMenu } from '../widgets/menu.js';
import { renderDamage } from '../widgets/damage-panel.js';
import { mountTutorial } from '../widgets/tutorial.js';
import { debriefOverlay } from './debrief.js';
import { helpOverlay } from './help.js';
import { radioLog } from '../widgets/radio-log.js';
import { isKey, stationKey } from '../widgets/keys.js';
import { bindSortable, filterChips, getFilters } from '../widgets/sortable.js';
import { hitCam } from '../widgets/hit-cam.js';
import { crewPanel } from '../widgets/crew-panel.js';
import { onTap } from '../widgets/touch.js';
import { voicePanel } from '../widgets/voice-panel.js';
import { voice } from '../voice/voice.js';
import { FrameWatch, frameIntervalMs, stepDown } from '../widgets/perf.js';
import { PerfReporter, beaconPerf } from '../widgets/perf-report.js';
import { mountHelm } from './helm.js';
import { setPadTarget } from '../gamepad.js';
import { mountAssistant } from '../widgets/assistant.js';
import { showBriefing } from '../widgets/briefing.js';
import { callouts } from '../widgets/callouts.js';
import { depthAlarms } from '../widgets/depth-alarm-ui.js';
import { mountSandbox } from '../widgets/sandbox-panel.js';
import { ordersPanel } from '../widgets/orders-panel.js';
import { applyDisplayPrefs, settingsMenu } from '../widgets/settings-menu.js';
import { resetPhotoCounter } from '../widgets/photo.js';

export interface Station {
  title: string;
  el: HTMLElement;
  /** Called every animation frame. */
  frame(): void;
  /** Called on each new snapshot. */
  snap?(): void;
  key?(e: KeyboardEvent): boolean;
  /** Called when the player switches away (free heavy resources such as 3D scenes). */
  hide?(): void;
}

export function gameScreen(root: HTMLElement, onExit: () => void): () => void {
  store.reset();
  resetPhotoCounter();
  store.loadLocal();
  const saver = setInterval(() => store.saveLocal(), 2000);
  const el = h(`<div class="game">
    <div class="topbar">
      <div class="tabs" id="tabs"></div>
      <div class="status">
        <span id="ship" class="st-ship"></span>
        <span class="st-prog"><span class="dim pb-lbl">KONVOI</span><span class="pbar"><i id="pb-sunk"></i><i id="pb-arr"></i><b class="pb-mid"></b><b class="pb-30"></b></span><span id="pb-txt"></span></span>
        <span id="clock" class="st-clock"></span>
      </div>
      <button id="mute" class="icon" title="Ton an/aus (M)"></button>
      <span id="gear-slot"></span>
      <button id="help" class="icon" title="Hilfe (H)">?</button>
      <button id="quit" class="warn" title="Partie verlassen">Verlassen</button>
    </div>
    <div class="station-wrap"><div class="station" id="station"></div></div>
    <div class="side">
      <div class="panel helm" id="helm"></div>
      <div class="side-tabs steps" id="side-tabs">
        <button data-st="alerts">Meldungen</button><button data-st="crew">Boot</button><button data-st="damage">Schaden</button><button data-st="radio">Funk</button><button data-st="orders" title="Befehle der Führung">Befehle</button>
      </div>
      <div class="side-body">
      <div class="panel" id="damage" data-sp="damage"></div>
      <div id="crew-slot"></div>
      <div id="orders-slot"></div>
      <div class="panel alerts" data-sp="alerts"><div class="hd"><span>Meldungen</span><span class="dim">KLICK = HINGEHEN</span></div><div id="alert-chips"></div><div id="alerts"></div></div>
      <div class="panel" data-sp="radio"><div class="hd"><span>Funk</span><span id="radio-state" class="dim"></span></div>
        <div class="radio" id="radio"></div>
        <div style="display:flex;gap:4px;margin-top:6px"><input id="rtext" maxlength="200" placeholder="Konvoi Peilung 052" style="flex:1;min-width:0"><button id="rsend">Senden</button></div>
        <div class="steps" id="quick"></div>
        <div id="voice-slot"></div>
      </div>
      </div>
    </div>
  </div>`);
  root.replaceChildren(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const showRadio = radioLog(q('#radio'));
  const cam = hitCam(el);
  const crew = crewPanel();
  q('#crew-slot').replaceWith(crew.el);
  const vp = voicePanel();
  q('#voice-slot').replaceWith(vp.el);
  crew.el.dataset.sp = 'crew';
  const orders = ordersPanel(() => showSide('orders'));
  q('#orders-slot').replaceWith(orders.el);
  orders.el.dataset.sp = 'orders';
  // Right column: helm always visible, the rest as tabs (one panel at a time, a dot marks news elsewhere)
  let sideTab = localStorage.getItem('tk-side') ?? 'alerts';
  const sideSeen: Record<string, string> = {};
  const sideKey: Record<string, string> = {};
  function showSide(t: string): void {
    sideTab = t;
    localStorage.setItem('tk-side', t);
    sideSeen[t] = sideKey[t] ?? '';
    el.querySelectorAll<HTMLElement>('[data-sp]').forEach((p) => p.classList.toggle('on', p.dataset.sp === t));
    el.querySelectorAll<HTMLElement>('[data-st]').forEach((b) => {
      b.classList.toggle('on', b.dataset.st === t);
      if (b.dataset.st === t) b.classList.remove('news');
    });
  }
  onTap(el, '[data-st]', (b) => showSide(b.dataset.st!));
  showSide(sideTab);
  function markSide(t: string, key: string): void {
    sideKey[t] = key;
    if (sideSeen[t] === undefined) sideSeen[t] = key;
    if (t === sideTab) sideSeen[t] = key;
    el.querySelector(`[data-st="${t}"]`)!.classList.toggle('news', sideSeen[t] !== key);
  }
  // Alert log with level filter chips (none on = everything)
  const LOG_ID = 'alerts';
  const logChips = () => (q('#alert-chips').innerHTML = filterChips(LOG_ID, [
    { key: 'alarm', label: 'ALARM' }, { key: 'warn', label: 'WARNUNG' }, { key: 'info', label: 'INFO' },
  ]));
  const renderLog = (s: Snapshot) => {
    const f = getFilters(LOG_ID);
    const rows = callouts.log.map((e, i) => ({ e, i })).filter(({ e }) => !f.size || f.has(e.level)).reverse();
    const logHtml = (store.lastError ? `<div class="amber">${esc(store.lastError)}</div>` : '') +
      (callouts.log.length ? (rows.length ? '' : '<div class="dim">KEINE MELDUNGEN FÜR DIESEN FILTER</div>') : '<div class="dim">KEINE MELDUNGEN · RUHIGE SEE</div>') + rows.map(({ e, i }) => {
        const fresh = s.time - e.time < 30;
        const color = e.level === 'alarm' ? 'red' : e.level === 'warn' ? 'amber' : '';
        const go = e.label !== undefined || e.station !== undefined;
        return `<div class="logrow ${color} ${fresh && e.level === 'alarm' ? 'blink' : ''} ${go ? 'clickable' : ''}" data-log="${i}">${clock(e.time)} ${esc(e.text)}</div>`;
      }).join('');
    if (q('#alerts').innerHTML !== logHtml) q('#alerts').innerHTML = logHtml;
  };
  logChips();
  bindSortable(q('#alert-chips'), LOG_ID, { key: 'time', dir: -1 }, () => {
    logChips();
    if (store.snap) renderLog(store.snap);
  });

  let stations: Station[] = [];
  /** Stations drawn in 3D (graphics performance samples). */
  let views3d = new Set<Station>();
  const perfReport = new PerfReporter(beaconPerf);
  let current = 0;
  const stationEl = q('#station');
  const tabs = q('#tabs');
  const helm = mountHelm(q('#helm'));
  const sandbox = mountSandbox(el);
  const assistant = mountAssistant(q('.station-wrap'), (i) => i < stations.length && show(i));
  const banner = document.createElement('div');
  banner.className = 'banner blink';
  let endShown = false;

  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  const menu = settingsMenu({
    onRealism: () => stations[current]?.snap?.(),
    onBriefing: () => store.briefing && showBriefing(store.briefing, true),
    onKeys: () => helpOverlay(store.snap ? CLASSES[store.snap.own.cls].submarine : true),
  });
  q('#gear-slot').replaceWith(menu.button);
  const renderMute = () => {
    q('#mute').textContent = audio.muted ? '🔇' : '🔊';
    menu.sync();
  };
  renderMute();
  applyDisplayPrefs();
  q<HTMLButtonElement>('#mute').onclick = () => {
    audio.setMuted(!audio.muted);
    renderMute();
  };
  // Phones: the helm becomes a drawer opened from a floating button
  const helmToggle = h<HTMLButtonElement>(`<button class="helm-toggle" title="Ruderstand">⎈ Ruder</button>`);
  helmToggle.onclick = () => document.body.classList.toggle('helm-open');
  el.appendChild(helmToggle);
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
  callouts.reset();
  // Event log: a click selects the contact and/or opens the station the report belongs to
  q('#alerts').addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-log]');
    const entry = row ? callouts.log[Number(row.dataset.log)] : undefined;
    if (!entry) return;
    if (entry.label) store.selected = entry.label;
    if (entry.station !== undefined && entry.station < stations.length) show(entry.station);
  });

  function build(): void {
    const sub = store.snap && CLASSES[store.snap.own.cls].submarine;
    if (store.snap?.lesson) {
      tutorial = mountTutorial(store.snap.lesson);
      q('.side').prepend(tutorial.el);
    }
    const view3d = sub ? periscopeStation() : bridgeStation();
    stations = sub
      ? [subSonarStation(), view3d, fireControlStation(), diveEngineStation(), centralStation()]
      : [opsCenterStation(), frigateSonarStation(), weaponsStation(), radarEsmStation(), view3d];
    views3d = new Set([view3d]);
    tabs.innerHTML = stations.map((s, i) => `<button data-i="${i}" title="Taste ${i + 1}">${i + 1} · ${s.title}</button>`).join('');
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => show(Number(b.dataset.i))));
    q('#quick').innerHTML = (sub ? ['Konvoi gesichtet', 'Greife an', 'Werde gejagt', 'Position'] : ['Kontakt', 'Torpedo im Wasser', 'Suche Sektor', 'Position'])
      .map((t) => `<button data-r="${t}" title="Schnellmeldung senden">${t}</button>`).join('');
    el.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => (b.onclick = () => {
      const s = store.snap;
      const c = store.selectedContact();
      let text = b.dataset.r!;
      if (text === 'Position' && s) text = `Position ${Math.round(s.own.x / 100) / 10} / ${Math.round(s.own.y / 100) / 10} km, Kurs ${tdeg3(s.own.heading)}`;
      else if (c) text += ` · ${c.label} Peilung ${tdeg3(c.bearing)}`;
      net.send({ t: 'radio', text });
    }));
    show(0);
  }

  function show(i: number): void {
    closeMenu();
    if (i !== current) stations[current]?.hide?.();
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
    const hh = s.env.clock !== undefined ? `${String(Math.floor(s.env.clock)).padStart(2, '0')}:${String(Math.floor((s.env.clock % 1) * 60)).padStart(2, '0')} UHR · ` : '';
    const wx = `SEEGANG ${s.env.seaState}${s.env.rain ? ' · REGEN' : ''}${fogAt(s.env.met, s.own) > 0.3 ? ' · NEBEL' : ''}${iceCover(s.env.met, s.own) > 0.1 ? ' · EIS' : ''}`;
    q('#clock').textContent = `${hh}${s.env.rain ? '🌧 ' : ''}${wx} · REST ${s.score.timeLeftS > 1e8 ? '∞' : `${clock(s.score.timeLeftS)}${s.timeScale > 0 && s.timeScale !== 1 ? ` (ECHT ${clock(s.score.timeLeftS / s.timeScale)} · ${s.timeScale}×)` : ''}`}`;
    const pct = (x: number) => Math.round((100 * x) / Math.max(1, s.score.totalTons));
    q('#ship').textContent = `${CLASS_LABEL[s.own.cls]} ${s.own.name}${s.crew.length > 1 ? ` · AN BORD: ${s.crew.join(', ')}` : ''}`;
    // Convoy tonnage bar: red grows from the left (sunk), blue from the right (safe in port);
    // whoever passes the middle mark (50 %) wins at once, the 30 % mark decides at the time limit
    const sunk = pct(s.score.sunkTons);
    // Merchants the patrol ship sinks count half toward the wolfpack's goal: the bar shows what counts
    const counted = pct(s.score.countedTons ?? s.score.sunkTons);
    const part = counted !== sunk ? ` (ZÄHLT ${counted} %)` : '';
    const safe = pct(s.score.arrivedTons);
    q('.st-prog').style.display = s.score.totalTons > 0 ? '' : 'none';
    q('#pb-sunk').style.width = `${counted}%`;
    q('#pb-arr').style.width = `${safe}%`;
    const escort = s.own.team === 'west';
    const txt = q('#pb-txt');
    txt.innerHTML = escort
      ? `<span class="red">VERLOREN ${sunk} %${part}</span> · <span class="blue">SICHER ${safe} %</span> <span class="dim">· SIEG: ÜBER 50 % SICHER</span>`
      : `<span class="red">VERSENKT ${sunk} %${part}</span> · <span class="blue">ENTKOMMEN ${safe} %</span> <span class="dim">· SIEG: 50 % VERSENKT</span>`;
    q('.st-prog').title = escort
      ? `Konvoi-Tonnage. Rot: versenkt (${sunk} %), blau: sicher im Zielhafen (${safe} %). Mehr als die Hälfte im Ziel = Sieg, die Hälfte versenkt = Niederlage. Bei Zeitablauf verliert der Geleitschutz ab 30 % Verlust (Strich).`
      : `Konvoi-Tonnage. Rot: von uns versenkt (${sunk} %), blau: entkommen (${safe} %). Die Hälfte versenkt = Sieg; kommt mehr als die Hälfte an, ist die Partie verloren. Bei Zeitablauf reichen 30 % (Strich).`;
    renderLog(s);
    showRadio(s.radio, s.own.name);
    markSide('radio', String(s.radio.length));
    markSide('alerts', String(s.alerts.filter((a) => a.kind === 'torpedo' || a.kind === 'ping').length));
    const d = s.own.damage;
    markSide('damage', d ? `${s.own.hp}|${Object.values(d).map((x) => Math.round(x * 10)).join(',')}` : String(s.own.hp));
    const sub = CLASSES[s.own.cls].submarine;
    q('#radio-state').innerHTML = sub ? (mastState(s.own).raised ? '<span class="amber">MAST OBEN · PEILBAR</span>' : mastState(s.own).moving ? `<span class="amber">MAST FÄHRT ${mastState(s.own).moving === 'aus' ? 'AUS' : 'EIN'}</span>` : 'MAST UNTEN · KEIN FUNK') : 'DATALINK';
    const torp = s.alerts.filter((a) => a.kind === 'torpedo' && s.time - a.time < 45).pop();
    if (torp && s.own.alive) {
      banner.textContent = store.realism === 'profi'
        ? `SCHNELL WANDERNDES HOCHFREQUENTES GERÄUSCH · PEILUNG ${tdeg3(torp.bearing ?? 0)}`
        : `TORPEDO! PEILUNG ${tdeg3(torp.bearing ?? 0)} · AUSWEICHEN · TÄUSCHKÖRPER`;
      if (!banner.isConnected) document.body.appendChild(banner);
    } else banner.remove();
    if (!s.own.alive && !banner.isConnected) {
      banner.textContent = 'EIGENES SCHIFF GESUNKEN';
      document.body.appendChild(banner);
    }
  }

  // Panels and lists redraw at most 4× a second: data still arrives at 10 Hz, but phones
  // stay free to react to taps instead of rebuilding the same lists over and over
  const UI_MS = 250;
  let uiAt = 0;
  let uiTimer: ReturnType<typeof setTimeout> | undefined;
  const renderUi = () => {
    uiTimer = undefined;
    uiAt = performance.now();
    const s = store.snap;
    if (!s) return;
    stations[current]?.snap?.();
    helm.update();
    tutorial?.update();
    assistant.update();
    // Crew: show who mans which station
    if (s.crew.length > 1) {
      tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b, j) => {
        const who = (s.stations ?? []).filter((x) => x.station === j).map((x) => x.callsign);
        const t = `${j + 1} · ${stations[j]?.title ?? ''}${who.length ? ` (${who.join(', ')})` : ''}`;
        if (b.textContent !== t) b.textContent = t;
      });
    }
    renderDamage(q('#damage'));
    crew.update(s);
    orders.update(s);
    markSide('orders', orders.key);
    renderSide();
  };
  const scheduleUi = (now = false) => {
    if (now) return renderUi();
    if (uiTimer) return;
    uiTimer = setTimeout(renderUi, Math.max(0, UI_MS - (performance.now() - uiAt)));
  };

  const off = net.on((m: ServerMsg) => {
    if (m.t === 'snap') {
      const first = !store.snap;
      const hpBefore = store.snap?.own.hp;
      store.ingest(m.s);
      if (first) build();
      if (hpBefore !== undefined && m.s.own.hp < hpBefore - 0.5) {
        document.body.classList.remove('hit');
        void document.body.offsetWidth;
        document.body.classList.add('hit');
        setTimeout(() => document.body.classList.remove('hit'), 800);
      }
      callouts.update(m.s);
      cam.snap(m.s);
      audio.update(m.s, CLASSES[m.s.own.cls].submarine);
      if (m.s.briefing) {
        store.briefing = m.s.briefing;
        showBriefing(m.s.briefing);
      }
      scheduleUi(first);
    } else if (m.t === 'error') {
      store.lastError = m.msg;
      setTimeout(() => (store.lastError = store.lastError === m.msg ? '' : store.lastError), 4000);
    } else if (m.t === 'end') {
      store.ended = { winner: m.winner, reason: m.reason };
      perfReport.end();
      showEnd();
    } else if (m.t === 'debrief') {
      store.debrief = m.d;
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const n = stationKey(e);
    if (n >= 0 && n < stations.length) return show(n);
    if (isKey(e, 'help') || e.key === '?') return helpOverlay(store.snap ? CLASSES[store.snap.own.cls].submarine : true);
    if (isKey(e, 'mute')) {
      audio.setMuted(!audio.muted);
      return renderMute();
    }
    if (stations[current]?.key?.(e)) return;
    helm.key(e);
  };
  window.addEventListener('keydown', onKey);
  // Gamepad: same helm orders as mouse and keyboard; LB/RB cycle stations, Start ⚙, Back help
  const unPad = setPadTarget({
    orderedHeading: () => store.snap?.own.order.heading,
    course: (hdg) => helm.course(hdg),
    nudge: (d) => helm.nudge(d),
    station: (d) => stations.length && show((current + d + stations.length) % stations.length),
    menu: () => menu.button.click(),
    help: () => document.querySelector<HTMLButtonElement>('.overlay.help #close')?.click() ?? helpOverlay(store.snap ? CLASSES[store.snap.own.cls].submarine : true),
  });

  let raf = 0;
  let drawnAt = 0;
  const watch = new FrameWatch(frameIntervalMs);
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    // Frame cap by graphics quality: phones draw 24–30 fps instead of 60 (battery, heat)
    if (now - drawnAt < frameIntervalMs() - 2) return;
    drawnAt = now;
    if (watch.note(now) && stepDown()) console.info('Grafik: Auto eine Stufe niedriger (Gerät zu langsam)');
    perfReport.frame(now, views3d.has(stations[current]!));
    stations[current]?.frame();
    cam.frame(store.snap);
    helm.frame();
  };
  raf = requestAnimationFrame(loop);

  return () => {
    perfReport.end();
    clearTimeout(uiTimer);
    clearInterval(saver);
    if (store.ended) store.clearLocal();
    else store.saveLocal();
    off();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    unPad();
    vp.dispose();
    sandbox.dispose();
    voice.leave();
    window.removeEventListener('pointerdown', unlock);
    banner.remove();
    depthAlarms.dispose();
    orders.dispose();
    helmToggle.remove();
    document.body.classList.remove('helm-open');
    tutorial?.el.remove();
    closeMenu();
    audio.stopAll();
  };
}
