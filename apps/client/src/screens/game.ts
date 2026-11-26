import { CLASSES, fogAt, iceCover, type ServerMsg, type Snapshot, type StationId } from '@tk/shared';
import { audio, installUnlock } from '../audio.js';
import { lang } from '../i18n/index.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { fireControlStation } from '../stations/sub/fire-control.js';
import { periscopeStation } from '../stations/sub/periscope.js';
import { bridgeStation } from '../stations/frigate/bridge.js';
import { subSonarStation } from '../stations/sub/sonar.js';
import { centralStation } from '../stations/sub/central.js';
import { opsCenterStation } from '../stations/frigate/ops-center.js';
import { frigateSonarStation } from '../stations/frigate/sonar.js';
import { weaponsStation } from '../stations/frigate/weapons.js';
import { radarEsmStation } from '../stations/frigate/radar-esm.js';
import { CLASS_LABEL, clock, esc, h, mastState, setHtml, shortClock, tdeg3 } from '../widgets/format.js';
import { closeMenu } from '../widgets/menu.js';
import { renderDamage } from '../widgets/damage-panel.js';
import { mountTutorial } from '../widgets/tutorial.js';
import { mountFastForward, mountSunkPanel } from '../widgets/pacing.js';
import { debriefOverlay } from './debrief.js';
import { bandLabel } from './debrief-grade.js';
import { helpOverlay } from './help.js';
import { radioLog } from '../widgets/radio-log.js';
import { isKey, stationKey } from '../widgets/keys.js';
import { crashDive, decoy, mastDown, singlePing } from '../widgets/emergency.js';
import { noteContacts } from '../widgets/contact-list.js';
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
import { groupLog } from '../widgets/log-group.js';
import { depthAlarms } from '../widgets/depth-alarm-ui.js';
import { mountSandbox } from '../widgets/sandbox-panel.js';
import { ordersPanel } from '../widgets/orders-panel.js';
import { applyDisplayPrefs, settingsMenu } from '../widgets/settings-menu.js';
import { resetPhotoCounter } from '../widgets/photo.js';
import { STATION_SHORT, STATION_TITLE, stationIds } from '../stations/titles.js';

export interface Station {
  /** Stable id (crew seats, hints, the event log and tutorials refer to it). */
  id: StationId;
  title: string;
  el: HTMLElement;
  /** Called every animation frame. */
  frame(): void;
  /** Called on each new snapshot. */
  snap?(): void;
  /** Called on each new snapshot for every station, shown or not: keep histories (waterfalls, profiles) without gaps. */
  collect?(): void;
  key?(e: KeyboardEvent): boolean;
  /** Called when the player switches away (free heavy resources such as 3D scenes). */
  hide?(): void;
  /** Called once when the game screen closes: give back WebGL contexts, timers and anything outside `el`. */
  dispose?(): void;
}

/** Typing into a field (radio text, chat, a select, an editable note) must not steer the ship. */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function gameScreen(root: HTMLElement, onExit: () => void): () => void {
  store.reset();
  resetPhotoCounter();
  // Every window/document listener of this screen hangs on this signal: one abort on leaving removes them all
  const life = new AbortController();
  const signal = life.signal;
  store.loadLocal();
  const saver = setInterval(() => store.saveLocal(), 2000);
  const el = h(`<div class="game">
    <div class="topbar">
      <div class="tabs" id="tabs"></div>
      <div class="status">
        <span id="ship" class="st-ship"></span>
        <span class="st-prog"><span class="dim pb-lbl">KONVOI</span><span class="pbar"><i id="pb-sunk"></i><i id="pb-arr"></i><b class="pb-mid"></b><b class="pb-30"></b></span><span id="pb-txt"></span></span>
        <span id="clock" class="st-clock"></span>
        <span id="ff-why" class="st-ffwhy amber"></span>
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
        <button data-st="alerts" title="Meldungen">MELD<b class="cnt"></b></button><button data-st="crew" title="Besatzung &amp; Boot">BOOT<b class="cnt"></b></button><button data-st="damage" title="Schadensabwehr">SCHADEN<span id="st-dmg"></span><b class="cnt"></b></button><button data-st="radio" title="Funk">FUNK<b class="cnt"></b></button><button data-st="orders" title="Befehle der Führung">BEFEHLE<b class="cnt"></b></button>
      </div>
      <div class="side-body">
      <div class="panel" id="damage" data-sp="damage"></div>
      <div id="crew-slot"></div>
      <div id="orders-slot"></div>
      <div class="panel alerts" data-sp="alerts"><div id="alert-chips"></div><div id="alerts" title="KLICK = HINGEHEN"></div></div>
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
  const orders = ordersPanel(() => showSide('orders'), q('.station-wrap'));
  q('#orders-slot').replaceWith(orders.el);
  orders.el.dataset.sp = 'orders';
  // Right column: helm always visible, the rest as tabs (one panel at a time). A tab in the back
  // counts what is new since it was last open; Meldungen is the default, damage brings Schaden forward
  let sideTab = 'alerts';
  /** Game time each tab was last looked at (new items are newer than that). */
  const sideSeenAt: Record<string, number> = {};
  const sideSeen: Record<string, string> = {};
  const sideKey: Record<string, string> = {};
  /** Wide screens: the message log stays visible under every other side tab (it fills the room they leave). */
  const logAlways = window.matchMedia('(min-width: 901px)');
  function showSide(t: string): void {
    sideTab = t;
    q('.side-body').dataset.tab = t;
    sideSeen[t] = sideKey[t] ?? '';
    sideSeenAt[t] = store.snap?.time ?? 0;
    el.querySelectorAll<HTMLElement>('[data-sp]').forEach((p) => p.classList.toggle('on', p.dataset.sp === t));
    el.querySelectorAll<HTMLElement>('[data-st]').forEach((b) => {
      b.classList.toggle('on', b.dataset.st === t);
      if (b.dataset.st === t) badge(t, 0);
    });
  }
  /** Count badge on a tab: a number, '!' for a change without a count, nothing for 0; red for alarms. */
  function badge(t: string, n: number | string, alarm = false): void {
    const b = el.querySelector(`[data-st="${t}"] .cnt`);
    if (!b) return;
    const txt = n === 0 || n === '' ? '' : typeof n === 'number' && n > 99 ? '99+' : String(n);
    if (b.textContent !== txt) b.textContent = txt;
    b.classList.toggle('alarm', alarm && !!txt);
  }
  onTap(el, '[data-st]', (b) => showSide(b.dataset.st!));
  showSide(sideTab);
  /** Items newer than the tab's last look (0 while it is open). */
  function countSide(t: string, times: number[], alarm = false): void {
    const open = t === sideTab || (t === 'alerts' && logAlways.matches);
    if (open) sideSeenAt[t] = store.snap?.time ?? 0;
    const since = sideSeenAt[t] ?? -Infinity;
    badge(t, open ? 0 : times.filter((x) => x > since).length, alarm);
  }
  /** A tab without countable items: '!' when its content changed since the last look. */
  function markSide(t: string, key: string): void {
    sideKey[t] = key;
    if (sideSeen[t] === undefined) sideSeen[t] = key;
    if (t === sideTab) sideSeen[t] = key;
    badge(t, sideSeen[t] !== key ? '!' : 0);
  }
  let sideHp: number | undefined;
  /** Radio controls disabled (mast down or ship lost). */
  let radioOff: boolean | undefined;
  // Alert log with level filter chips (none on = everything)
  const LOG_ID = 'alerts';
  const logChips = () => (q('#alert-chips').innerHTML = filterChips(LOG_ID, [
    { key: 'alarm', label: 'ALARM' }, { key: 'warn', label: 'WARNUNG' }, { key: 'info', label: 'INFO' },
  ]));
  const renderLog = (s: Snapshot) => {
    const f = getFilters(LOG_ID);
    const rows = groupLog(callouts.log.map((e, i) => ({ e, i })).filter(({ e }) => !f.size || f.has(e.level)), lang === 'en').reverse();
    const logHtml = (store.lastError ? `<div class="amber">${esc(store.lastError)}</div>` : '') +
      (callouts.log.length ? (rows.length ? '' : '<div class="dim">KEINE MELDUNGEN FÜR DIESEN FILTER</div>') : '<div class="dim">KEINE MELDUNGEN · RUHIGE SEE</div>') + rows.map(({ e, i }) => {
        const fresh = s.time - e.time < 30;
        const color = e.level === 'alarm' ? 'red' : e.level === 'warn' ? 'amber' : '';
        const go = e.label !== undefined || e.station !== undefined;
        // T+: time since the start of the match (the top bar shows the time of day)
        const at = `T+${shortClock(e.time)}`;
        const n = e.count ? `<b class="lcnt">${e.count}×</b> ` : '';
        return `<div class="logrow ${color} ${fresh && e.level === 'alarm' ? 'blink' : ''} ${go ? 'clickable' : ''}${e.whole ? ' whole' : ''}" data-log="${i}" title="${esc(`${at} ${e.count ? `${e.count}× ` : ''}${e.text}`)}"><span class="lt">${at}</span><span class="ltx">${n}<span>${esc(e.text)}</span></span></div>`;
      }).join('');
    // Compared with what was written, not with innerHTML: a11y.ts adds role/tabindex to the rows,
    // so innerHTML never matched and the log was rebuilt several times a second
    setHtml(q('#alerts'), logHtml);
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
  const assistant = mountAssistant(q('.station-wrap'), (id) => go(id));
  // In the station column above the station, in place of the hint bar (never on top of it)
  const banner = document.createElement('div');
  banner.className = 'banner blink';
  const stationWrap = q('.station-wrap');
  // A torpedo warning is a way to the countermeasure: click jumps to the decoys
  // (submarine: fire control; frigate: towed decoy on the weapons station)
  let bannerGo: StationId | undefined;
  banner.addEventListener('click', () => bannerGo !== undefined && go(bannerGo));
  // Top bar: "Zeitraffer bis Ereignis" with its ×6 tag; own ship sunk: crew / watch / debrief
  const fastFwd = mountFastForward();
  q('#clock').before(fastFwd.el);
  const sunkPanel = mountSunkPanel((d) => debriefOverlay(d, onExit));
  document.body.appendChild(sunkPanel.el);
  let endShown = false;
  let endBand: 'klar' | 'knapp' | 'remis' | undefined;

  installUnlock(signal);
  const menu = settingsMenu({
    onRealism: () => stations[current]?.snap?.(),
    onBriefing: () => store.briefing && showBriefing(store.briefing, true),
    onKeys: () => helpOverlay(store.snap ? CLASSES[store.snap.own.cls].submarine : true),
    // Phones: VERLASSEN lives in the ⚙ menu (the top bar keeps clock · ⏩ · ⚙)
    onQuit: () => {
      store.clearLocal();
      onExit();
    },
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
  // (on release, not click: the rows are rewritten whenever a report comes in, even mid-tap)
  onTap(q('#alerts'), '[data-log]', (row) => {
    const entry = callouts.log[Number(row.dataset.log)];
    if (!entry) return;
    if (entry.label) store.selected = entry.label;
    if (entry.station !== undefined) go(entry.station);
  });

  function build(): void {
    const sub = store.snap && CLASSES[store.snap.own.cls].submarine;
    if (store.snap?.lesson) {
      tutorial = mountTutorial(store.snap.lesson, (id) => go(id));
      q('.side').prepend(tutorial.el);
    }
    const view3d = sub ? periscopeStation() : bridgeStation();
    // Submarine 4, frigate 5 (panel decision): in the order of stations/titles.ts
    stations = sub
      ? [subSonarStation(), view3d, fireControlStation(), centralStation()]
      : [opsCenterStation(), frigateSonarStation(), weaponsStation(), radarEsmStation(), view3d];
    views3d = new Set([view3d]);
    // Hints, tutorials and help find stations through stations/titles.ts: say so when the two drift apart
    const expect = stationIds(!!sub);
    if (stations.length !== expect.length || stations.some((st, i) => st.id !== expect[i] || st.title !== STATION_TITLE[st.id])) {
      console.warn('Stationsliste weicht von stations/titles.ts ab', stations.map((st) => st.id));
    }
    tabs.innerHTML = stations.map((s, i) => `<button data-i="${i}" data-station="${s.id}" title="Taste ${i + 1}">${tabHtml(i)}</button>`).join('');
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => show(Number(b.dataset.i))));
    // Quick messages: a short label on the button (two even columns), the full message goes out
    const QUICK: [string, string][] = sub
      ? [['Konvoi gesichtet', 'Konvoi gesichtet'], ['Greife an', 'Greife an'], ['Werde gejagt', 'Werde gejagt'], ['Position', 'Position']]
      : [['Kontakt', 'Kontakt'], ['Torpedo im Wasser', 'Torpedo!'], ['Suche Sektor', 'Suche Sektor'], ['Position', 'Position']];
    q('#quick').innerHTML = QUICK.map(([msg, lbl]) => `<button data-r="${msg}" title="Schnellmeldung senden: ${msg}">${lbl}</button>`).join('');
    radioOff = undefined;
    el.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => (b.onclick = () => {
      const s = store.snap;
      const c = store.selectedContact();
      let text = b.dataset.r!;
      if (text === 'Position' && s) text = `Position ${Math.round(s.own.x / 100) / 10} / ${Math.round(s.own.y / 100) / 10} km, Kurs ${tdeg3(s.own.heading)}°`;
      else if (c) text += ` · ${c.label} Peilung ${tdeg3(c.bearing)}°`;
      net.send({ t: 'radio', text });
    }));
    show(0);
  }

  /**
   * Station tab: "1 · Horchraum" (who mans it in brackets); on phones the number above a short
   * name, so every station fits the bottom bar without scrolling (the style sheet picks).
   */
  function tabHtml(i: number, who: string[] = []): string {
    const st = stations[i]!;
    const short = STATION_SHORT[st.id]?.[lang === 'en' ? 1 : 0] ?? st.title;
    return `<span class="tn">${i + 1}</span><span class="tsep"> · </span><span class="tl">${esc(st.title)}</span><span class="ts">${esc(short)}</span>${who.length ? `<span class="tw"> (${esc(who.join(', '))})</span>` : ''}`;
  }

  function show(i: number): void {
    closeMenu();
    if (i !== current) stations[current]?.hide?.();
    current = i;
    net.send({ t: 'station', id: stations[i]!.id });
    stationEl.replaceChildren(stations[i]!.el);
    tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === i));
    stations[i]?.snap?.();
  }

  /** Open a station by id (hints, the event log, tutorials, the torpedo banner); false when this side has none. */
  function go(id: StationId): boolean {
    const i = stations.findIndex((st) => st.id === id);
    if (i < 0) return false;
    show(i);
    return true;
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
    // No convoy (Meerenge, patrols): no tonnage figures, only the time (F24)
    const score = s.score.totalTons > 0 ? `VERSENKT ${pct(s.score.sunkTons)} % · AM ZIEL ${pct(s.score.arrivedTons)} % · ` : '';
    const ov = h(`<div class="overlay"><div class="panel" style="text-align:center;padding:24px 40px">
      <div class="title ${won || endBand === 'remis' ? '' : 'red'}">${bandLabel(won, endBand)}</div>
      <div style="margin:10px 0">${esc(store.ended.reason)}</div>
      <div class="dim">${score}DAUER ${clock(s.time)}</div>
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

  /** Make the banner a link to a station (the stylesheet keeps banners click-through otherwise). */
  function setBannerGo(i: StationId | undefined): void {
    bannerGo = i;
    banner.style.pointerEvents = i === undefined ? '' : 'auto';
    banner.style.cursor = i === undefined ? '' : 'pointer';
    banner.title = i === undefined ? '' : 'Torpedo! Klick: zum Täuschkörper';
    if (i === undefined) banner.removeAttribute('role');
    else banner.setAttribute('role', 'button');
  }

  function renderSide(): void {
    const s = store.snap!;
    // Compact (G4): "18:38 · SG 4 · REST 37:38"; the long form is the tooltip
    const hh = s.env.clock !== undefined ? `${String(Math.floor(s.env.clock)).padStart(2, '0')}:${String(Math.floor((s.env.clock % 1) * 60)).padStart(2, '0')} · ` : '';
    const wxTail = `${s.env.rain ? ' · REGEN' : ''}${fogAt(s.env.met, s.own) > 0.3 ? ' · NEBEL' : ''}${iceCover(s.env.met, s.own) > 0.1 ? ' · EIS' : ''}`;
    // The real time left and the speed-up only in the tooltip (S10: the long form pushed KONVOI out);
    // a lobby time scale stays as a short "×4" (the fast-forward shows its ×6 on its own button)
    const scaled = s.timeScale > 0 && s.timeScale !== 1;
    const rest = s.score.timeLeftS > 1e8 ? '∞' : shortClock(s.score.timeLeftS);
    const restLong = s.score.timeLeftS > 1e8 ? '∞' : `${rest}${scaled ? ` (ECHT ${shortClock(s.score.timeLeftS / s.timeScale)} · ${s.timeScale}×)` : ''}`;
    const clk = q('#clock');
    const clkTxt = `${hh}SG ${s.env.seaState}${wxTail} · REST ${rest}${scaled && !s.ff?.on ? ` ×${s.timeScale}` : ''}`;
    if (clk.textContent !== clkTxt) {
      // Sea state and weather in their own span: a narrow top bar drops them first (the tooltip keeps them, N6)
      clk.innerHTML = `${hh}<span class="clk-sg">SG ${s.env.seaState}${wxTail} · </span>REST ${rest}${scaled && !s.ff?.on ? ` ×${s.timeScale}` : ''}`;
      clk.title = `${hh ? `Uhrzeit ${hh.slice(0, 5)} · ` : ''}Seegang ${s.env.seaState}${wxTail} · Restzeit ${restLong}`;
    }
    // Why the fast-forward stopped, for a while after it did (S29)
    const why = s.ff && !s.ff.on && s.ff.stopped ? `GESTOPPT: ${s.ff.stopped.toUpperCase()}` : '';
    const whyEl = q('#ff-why');
    if (whyEl.textContent !== why) {
      whyEl.textContent = why;
      whyEl.title = why ? 'Warum der Zeitraffer angehalten hat' : '';
    }
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
    // Compact: the two figures only; what they mean and the win rule are in the tooltip
    txt.innerHTML = `<span class="red">${sunk} %${counted !== sunk ? `·${counted}` : ''}</span> <span class="dim">/</span> <span class="blue">${safe} %</span>`;
    void part;
    q('.st-prog').title = escort
      ? `Konvoi-Tonnage${part}. Rot: versenkt (${sunk} %), blau: sicher im Zielhafen (${safe} %). Mehr als die Hälfte im Ziel = Sieg, die Hälfte versenkt = Niederlage. Bei Zeitablauf verliert der Geleitschutz ab 30 % Verlust (Strich).`
      : `Konvoi-Tonnage${part}. Rot: von uns versenkt (${sunk} %), blau: entkommen (${safe} %). Die Hälfte versenkt = Sieg; kommt mehr als die Hälfte an, ist die Partie verloren. Bei Zeitablauf reichen 30 % (Strich).`;
    renderLog(s);
    showRadio(s.radio, s.own.name);
    countSide('radio', s.radio.filter((r) => r.from !== s.own.name).map((r) => r.time));
    const unseenLog = callouts.log.filter((e) => e.level !== 'info');
    countSide('alerts', unseenLog.map((e) => e.time), unseenLog.some((e) => e.level === 'alarm' && e.time > (sideSeenAt.alerts ?? -Infinity)));
    const d = s.own.damage;
    markSide('damage', d ? `${Math.round(s.own.hp)}|${Object.values(d).map((x) => Math.round(x * 10)).join(',')}` : String(Math.round(s.own.hp)));
    // Hull integrity in the tab label; a hit brings the damage panel forward
    const hpPct = Math.max(0, Math.round((100 * s.own.hp) / CLASSES[s.own.cls].hp));
    const dmg = q('#st-dmg');
    const dmgTxt = hpPct < 100 ? ` ${hpPct}%` : '';
    if (dmg.textContent !== dmgTxt) dmg.textContent = dmgTxt;
    dmg.className = hpPct < 50 ? 'red' : hpPct < 80 ? 'amber' : '';
    if (sideHp !== undefined && s.own.hp < sideHp - 0.5 && sideTab !== 'damage') showSide('damage');
    sideHp = s.own.hp;
    const sub = CLASSES[s.own.cls].submarine;
    q('#radio-state').innerHTML = sub ? (mastState(s.own).raised ? '<span class="amber">MAST OBEN · PEILBAR</span>' : mastState(s.own).moving ? `<span class="amber">MAST FÄHRT ${mastState(s.own).moving === 'aus' ? 'AUS' : 'EIN'}</span>` : 'MAST UNTEN · KEIN FUNK') : 'DATALINK';
    // No transmitter without the mast (the server refuses anyway): the controls say so instead of looking ready
    const noRadio = !s.own.alive || (sub && !mastState(s.own).raised);
    if (radioOff !== noRadio) {
      radioOff = noRadio;
      el.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#rtext, #rsend, #quick button').forEach((c) => {
        c.disabled = noRadio;
        if (noRadio) c.dataset.tip ??= c.title;
        c.title = noRadio ? (s.own.alive ? 'Kein Funk: erst den Mast ausfahren (Sehrohr)' : 'Kein Funk') : c.dataset.tip ?? c.title;
      });
    }
    const torp = s.alerts.filter((a) => a.kind === 'torpedo' && s.time - a.time < 45).pop();
    if (torp && s.own.alive && !store.ended) {
      banner.textContent = store.realism === 'profi'
        ? `SCHNELL WANDERNDES HOCHFREQUENTES GERÄUSCH · PEILUNG ${tdeg3(torp.bearing ?? 0)}°`
        : `TORPEDO! PEILUNG ${tdeg3(torp.bearing ?? 0)}° · AUSWEICHEN · TÄUSCHKÖRPER`;
      setBannerGo(sub ? 'feuerleitung' : 'waffen');
      // First in the column after the (hidden) hint bar: above a FLASH order strip
      if (!banner.isConnected) stationWrap.insertBefore(banner, stationWrap.querySelector('.assist')?.nextSibling ?? stationWrap.firstChild);
    } else banner.remove();
    stationWrap.classList.toggle('torp', banner.isConnected);
    fastFwd.update(s);
    sunkPanel.update(s, store.matchId);
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
    noteContacts(s);
    for (const st of stations) st.collect?.();
    stations[current]?.snap?.();
    helm.update();
    tutorial?.update();
    assistant.update();
    // Crew: show who mans which station
    if (s.crew.length > 1) {
      tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b, j) => {
        if (!stations[j]) return;
        const who = (s.stations ?? []).filter((x) => x.station === stations[j]?.id).map((x) => x.callsign);
        const key = who.join(',');
        if (b.dataset.who === key) return;
        b.dataset.who = key;
        b.innerHTML = tabHtml(j, who);
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
      endBand = m.band;
      perfReport.end();
      showEnd();
      // Over: no countdown of an open order and no torpedo alarm behind the result
      if (store.snap) orders.update(store.snap);
      banner.remove();
    } else if (m.t === 'debrief') {
      store.debrief = m.d;
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if (typing(e.target)) return;
    const n = stationKey(e);
    if (n >= 0 && n < stations.length) return show(n);
    if (isKey(e, 'help') || e.key === '?') return helpOverlay(store.snap ? CLASSES[store.snap.own.cls].submarine : true);
    if (isKey(e, 'mute')) {
      audio.setMuted(!audio.muted);
      return renderMute();
    }
    if (emergencyKey(e)) return;
    if (stations[current]?.key?.(e)) return;
    helm.key(e);
  };
  /**
   * Emergency keys (E3), from any station: decoy, crash dive, mast in, fire (submarine);
   * ping, rocket, decoy (frigate). Fire and rocket open their station and press the guarded
   * button there, so the fire guard still asks on a weak solution or a friend near the target.
   */
  function emergencyKey(e: KeyboardEvent): boolean {
    const s = store.snap;
    if (!s || !s.own.alive) return false;
    const sub = CLASSES[s.own.cls].submarine;
    const press = (id: StationId, sel: string) => {
      if (go(id)) stationEl.querySelector<HTMLButtonElement>(sel)?.click();
    };
    if (isKey(e, 'decoy')) decoy();
    else if (sub && isKey(e, 'crashDive')) crashDive();
    else if (sub && isKey(e, 'mastDown')) mastDown();
    else if (sub && isKey(e, 'fire')) press('feuerleitung', '#fire');
    else if (!sub && isKey(e, 'ping')) singlePing();
    else if (!sub && isKey(e, 'rocket')) press('waffen', '#rocket');
    else return false;
    e.preventDefault();
    return true;
  }
  window.addEventListener('keydown', onKey, { signal });
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
    life.abort();
    // Stations: the shown one first gets its hide(), then all give back what they hold (WebGL contexts above all)
    stations[current]?.hide?.();
    for (const st of stations) st.dispose?.();
    stations = [];
    views3d.clear();
    unPad();
    vp.dispose();
    sandbox.dispose();
    voice.leave();
    banner.remove();
    depthAlarms.dispose();
    orders.dispose();
    helmToggle.remove();
    document.body.classList.remove('helm-open');
    tutorial?.el.remove();
    sunkPanel.dispose();
    closeMenu();
    audio.stopAll();
  };
}
