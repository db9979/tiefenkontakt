import { REGIONS, SEA_TIME_FACTOR, TIME_SCALES, areasFor, type MatchLobby, type MatchSummary, type MissionKey, type RegionId, type ServerMsg } from '@tk/shared';
import { net } from '../net.js';
import { t } from '../i18n/index.js';
import { accountPanel } from './account.js';
import { feedbackAdmin } from '../widgets/feedback.js';
import { adminPanel } from './admin.js';
import { careerPanels } from './career.js';
import { campaignPanel } from './campaign.js';
import { seriesPanel } from './series.js';
import { quickPanel } from './quick-play.js';
import { CLASS_NAME, esc, h } from '../widgets/format.js';
import { missionCards, paintMissionCharts } from '../widgets/mission-cards.js';
import { logout } from './logout.js';

const rankShort = (r: string) => ({ 'Kapitän zur See': 'KptzS', Fregattenkapitän: 'FKpt', Korvettenkapitän: 'KKpt', Kapitänleutnant: 'KptLt', 'Oberleutnant zur See': 'OLzS', 'Leutnant zur See': 'LzS' })[r] ?? r;

/** Match browser plus the lobby of the joined match. */
export function lobbyScreen(root: HTMLElement, me: { playerId: string; callsign: string }): () => void {
  let matches: MatchSummary[] = [];
  let match: MatchLobby | undefined;
  let error = '';

  const el = h(`<div class="center"></div>`);
  root.replaceChildren(el);

  let shownList = '';
  function renderList(): void {
    el.querySelector('#merr')!.textContent = error;
    const key = JSON.stringify(matches);
    if (key === shownList) return;
    shownList = key;
    const list = el.querySelector<HTMLElement>('#mlist')!;
    list.innerHTML = `<div class="hd"><span>Offene Partien</span><span>${matches.length}</span></div>
      ${matches.length === 0 ? '<div class="dim" style="padding:8px 0">Keine offenen Partien. Erstelle eine.</div>' : ''}
      ${matches.map((m) => `
        <div class="slot"><span>${esc(m.name)} <span class="dim">· ${m.players}/${m.maxPlayers} · ${m.state === 'lobby' ? 'WARTET' : 'LÄUFT'}</span></span>
        <span>${m.state === 'lobby' ? `<button data-join="${m.id}" data-team="west">Westbund</button> <button data-join="${m.id}" data-team="east">Ostpakt</button>` : `<button data-watch="${m.id}" title="Verzögert zuschauen">Zuschauen</button>`}</span></div>`).join('')}`;
    list.querySelectorAll<HTMLButtonElement>('[data-watch]').forEach((b) => (b.onclick = () => net.send({ t: 'spectate', matchId: b.dataset.watch! })));
    list.querySelectorAll<HTMLButtonElement>('[data-join]').forEach((b) => {
      b.onclick = () => net.send({ t: 'join', matchId: b.dataset.join!, team: b.dataset.team as 'west' | 'east' });
    });
  }

  function render(): void {
    if (!match) {
      // Built once; lobby broadcasts only refresh the match list, so taps elsewhere never hit a replaced button
      if (el.dataset.view === 'list') return renderList();
      el.dataset.view = 'list';
      shownList = '';
      el.innerHTML = `
        <div class="title">TIEFENKONTAKT</div>
        <div class="dim" style="margin-bottom:16px;display:flex;gap:10px;align-items:center">EINGELOGGT ALS ${esc(me.callsign)} <button id="logout" title="Abmelden und zurück zur Anmeldung">Abmelden</button></div>
        <div class="panel">
          <div id="mlist"></div>
          <div class="newmatch">
            <input id="mname" placeholder="Grönland-Lücke" maxlength="40">
            <label class="dim" title="Nicht in der Liste; nur per Einladungslink"><input type="checkbox" id="mpriv"> PRIVAT</label>
            <button id="create">Partie erstellen</button>
            <button id="quick" class="on" title="Einer offenen Partie beitreten oder eine neue eröffnen">Schnelles Spiel</button>
          </div>
          <div class="err" id="merr"></div>
        </div>
        <div class="panel" style="margin-top:10px">
          <div class="hd"><span>Ausbildung</span><span class="dim">EINZELSPIELER · MIT ANLEITUNG · <a class="btnlink" href="/handbuch.pdf" download="Tiefenkontakt-Handbuch.pdf" title="Ausführliches Spielerhandbuch zum Drucken (A4, PDF)">HANDBUCH (PDF)</a> · <a class="btnlink" href="/erkennungsheft.pdf" download="Tiefenkontakt-Erkennungsheft.pdf" title="Alle Klassen zum Ausdrucken: Silhouetten im Maßstab, Akustik, Bedrohung, Radar (A4, PDF)">ERKENNUNGSHEFT (PDF)</a></span></div>
          <button data-lesson="feindfahrt" class="on" style="width:100%;text-align:left;text-transform:none;margin-bottom:6px" title="Geführte Einsteiger-Mission: Schritt für Schritt vom Tauchen bis zum Torpedoschuss"><div>Erste Feindfahrt · Einstieg mit Anleitung</div><div class="dim">Tiefe und Ruder, Horchen, Kurswechsel und Lösung, Sehrohr, Torpedo, Ablaufen</div></button>
          <button data-lesson="geleitfahrt" class="on" style="width:100%;text-align:left;text-transform:none;margin-bottom:6px" title="Geführte Einsteiger-Mission auf der Fregatte: vom Schleppsonar bis zur U-Jagd-Rakete"><div>Erste Geleitfahrt · Fregatte mit Anleitung</div><div class="dim">Schleppsonar, Sonarboje, Klassifizieren, Konvoi umleiten, Ping, U-Jagd-Rakete</div></button>
          <div class="grid2">
            <button data-lesson="klassifizieren" style="text-align:left;text-transform:none"><div>1 · Horchen und Klassifizieren</div><div class="dim">LOFAR, DEMON, Klassenbibliothek</div></button>
            <button data-lesson="tma" style="text-align:left;text-transform:none"><div>2 · Zielbewegungsanalyse</div><div class="dim">Kurswechsel, Lösung, Güte</div></button>
            <button data-lesson="angriff" style="text-align:left;text-transform:none"><div>3 · Torpedoangriff</div><div class="dim">Schusslösung, Draht, Treffer</div></button>
            <button data-lesson="ujagd" style="text-align:left;text-transform:none"><div>4 · U-Jagd mit Fregatte</div><div class="dim">Schleppsonar, Bojen, Rakete</div></button>
          </div>
        </div>`;
      el.querySelector('.panel')!.after(quickPanel());
      el.appendChild(careerPanels());
      el.appendChild(campaignPanel());
      el.appendChild(seriesPanel());
      el.appendChild(accountPanel());
      el.appendChild(adminPanel());
      el.appendChild(feedbackAdmin());
      el.querySelectorAll<HTMLButtonElement>('[data-lesson]').forEach((b) => {
        b.onclick = () => net.send({ t: 'training', lesson: b.dataset.lesson as 'klassifizieren' | 'tma' | 'angriff' | 'ujagd' | 'feindfahrt' | 'geleitfahrt' });
      });
      el.querySelector<HTMLButtonElement>('#logout')!.onclick = () => void logout();
      el.querySelector<HTMLButtonElement>('#create')!.onclick = () => {
        const name = el.querySelector<HTMLInputElement>('#mname')!.value.trim() || t('Grönland-Lücke');
        net.send({ t: 'create_match', name, private: el.querySelector<HTMLInputElement>('#mpriv')!.checked });
      };
      el.querySelector<HTMLButtonElement>('#quick')!.onclick = () => net.send({ t: 'quick' });
      return renderList();
    }
    el.dataset.view = 'match';
    // Keep a half-typed chat line and the focus across re-renders
    const draft = el.querySelector<HTMLInputElement>('#lc-text')?.value ?? '';
    const typing = document.activeElement?.id === 'lc-text';
    const mine = match.slots.find((s) => s.playerId === me.playerId);
    const team = (t: 'west' | 'east') => match!.slots.filter((s) => s.team === t).map((s) => `
      <div class="slot"><span>${s.rank ? `<span class="rank" title="${esc(s.rank)}">${esc(rankShort(s.rank))}</span> ` : ''}${esc(s.callsign)}${s.rating && s.rank && !s.bot ? ` <span class="dim" title="Wertung">${s.rating}</span>` : ''}${s.playerId === me.playerId ? ' <span class="dim">(DU)</span>' : ''}${s.bot ? ' <span class="dim">(KI)</span>' : ''}</span>
      <span>${s.crewOf ? `<span class="dim">BESATZUNG BEI ${esc(match!.slots.find((c) => c.playerId === s.crewOf)?.callsign ?? '?')}</span>` : CLASS_NAME[s.cls].title}
      ${mine && s.team === mine.team && !s.bot && !s.crewOf && s.playerId !== me.playerId && mine.crewOf !== s.playerId ? `<button data-crew="${s.playerId}" title="Als Besatzung auf diesem Schiff mitfahren">Mitfahren</button>` : ''}
      · ${s.ready ? '<span>BEREIT</span>' : '<span class="amber">WÄHLT</span>'}</span></div>`).join('') ||
      '<div class="slot dim">Freier Platz</div>';
    // One mixed place per team: the Westbund's hunter-killer boat, the Ostpakt's patrol ship
    const classes = match.settings.mission === 'duell' ? (['ssk', 'ssn', 'ssc', 'ssa', 'ssw'] as const)
      : mine?.team !== 'west' ? (['ssk', 'ssn', 'ssc', 'ssa', 'ffk'] as const) : (['ffg', 'kor', 'ffv', 'ssw'] as const);
    el.innerHTML = `
      <div class="hd" style="font-size:1.1667rem"><span>PARTIE „${esc(match.name)}“</span><span>${match.slots.length} SPIELER · KONVOI ${match.settings.merchants} FRACHTER</span></div>
      <div class="invite"><span class="dim">${match.settings.private ? 'PRIVATE PARTIE · NUR PER LINK' : 'EINLADEN'}</span>
        <input id="inv-link" readonly value="${esc(`${location.origin}/#join=${match.id}`)}"><button id="inv-copy">Link kopieren</button></div>
      <div class="grid2" style="margin-bottom:8px">
        <div class="panel"><div class="hd team-w"><span>Westbund · Geleitschutz</span><button data-switch="west">Wechseln</button></div>${team('west')}</div>
        <div class="panel"><div class="hd team-e"><span>Ostpakt · Wolfsrudel</span><button data-switch="east">Wechseln</button></div>${team('east')}</div>
      </div>
      <div class="cols">
        <div class="panel"><div class="hd"><span>Deine Schiffsklasse</span>${mine?.crewOf ? '<button id="own-ship">Eigenes Schiff führen</button>' : ''}</div>
          ${mine?.crewOf ? '<div class="dim" style="margin-bottom:6px">DU FÄHRST ALS BESATZUNG MIT. ALLE AN BORD KÖNNEN JEDE STATION BEDIENEN.</div>' : ''}
          <div class="grid2">${classes.map((c) => `
            <button data-cls="${c}" class="${mine?.cls === c ? 'on' : ''}" style="text-align:left;text-transform:none;padding:10px">
              <div>${CLASS_NAME[c].title}</div><div class="dim">${CLASS_NAME[c].info}</div></button>`).join('')}
          </div></div>
        <div class="panel"><div class="hd"><span>Einstellungen</span></div>
          <div class="dim" style="margin:2px 0 4px">MISSION</div>
          ${missionCards(match.settings.mission)}
          <select id="s-mission" style="display:none">
            <option value="groenland">Grönland-Lücke · tief</option><option value="schelf">Schelfmeer · flach</option><option value="fjord">Fjordausfahrt · Kanal</option>
            <option value="duell">U-Boot-Duell</option><option value="hafen">Hafenangriff</option><option value="fuehlung">Fühlung halten</option><option value="meerenge">Meerengen-Durchbruch</option><option value="aufklaerung">Aufklärung</option><option value="eigene">Eigene Mission</option></select>
          <div class="row"><span class="dim" title="Echte Seegebiete (Tiefen: NOAA ETOPO 2022). Jede Mission spielt in den Gebieten, die zu ihr passen">SEEGEBIET</span><select id="s-area">${areasFor(match.settings.mission).map((id: RegionId) => `<option value="${id}">${esc(REGIONS[id].name)}</option>`).join('')}</select></div>
          <div id="custom" style="display:none">
            <div class="row"><span class="dim">FRACHTER</span><select id="c-n">${[4, 6, 8, 10, 12].map((v) => `<option value="${v}">${v}</option>`).join('')}</select></div>
            <div class="row"><span class="dim">KONVOIFAHRT</span><select id="c-kn">${[7, 9, 11, 13].map((v) => `<option value="${v}">${v} KN</option>`).join('')}</select></div>
            <div class="row"><span class="dim">MEERESBODEN</span><select id="c-bed"><option value="tief">TIEF</option><option value="schelf">SCHELF</option><option value="fjord">FJORD</option></select></div>
            <div class="row"><span class="dim">U-BOOTE WARTEN BEI</span><select id="c-sub">${[0.3, 0.5, 0.7].map((v) => `<option value="${v}">${Math.round(v * 100)} % DER ROUTE</option>`).join('')}</select></div>
          </div>
          <div class="row"><span class="dim">TAGESZEIT</span><select id="s-tod"><option value="tag">Tag</option><option value="daemmerung">Dämmerung</option><option value="nacht">Nacht</option><option value="zufall">Zufall</option></select></div>
          <div class="row"><span class="dim" title="Monat der Partie: Sonnenstand (Polarnacht, Mitternachtssonne), Sprungschicht, Nebel und Eis wie im echten Seegebiet">JAHRESZEIT</span><select id="s-season"><option value="zufall">ZUFALL</option><option value="winter">WINTER</option><option value="fruehling">FRÜHLING</option><option value="sommer">SOMMER</option><option value="herbst">HERBST</option></select></div>
          <div class="row"><span class="dim">WETTER</span><select id="s-wx"><option value="wechselhaft">WECHSELHAFT</option><option value="stabil">STABIL</option><option value="zufall">ZUFALL</option></select></div>
          <div class="row"><span class="dim">SEEGANG</span><select id="s-sea">${[1, 2, 3, 4, 5, 6].map((v) => `<option value="${v}">${v}</option>`).join('')}</select></div>
          <div class="row"><span class="dim" title="Wartepositionen, Abstände, Route, Konvoifahrt und Seegang (±1) ändern sich von Partie zu Partie">VARIATION</span><select id="s-var"><option value="aus">AUS</option><option value="leicht">GERING</option><option value="stark">STARK</option></select></div>
          ${match.settings.lage !== undefined ? `<div class="row"><span class="dim">LAGE</span><span>#${match.settings.lage} · WIE IN DER LETZTEN PARTIE</span></div>` : ''}
          <div class="row"><span class="dim" title="So lange dauert der Einsatz auf See; die echte Dauer hängt vom Zeitraffer ab">EINSATZDAUER</span><select id="s-time">${[20, 30, 40, 60].map((v) => `<option value="${v}">${v * SEA_TIME_FACTOR} MIN SEEZEIT</option>`).join('')}</select></div>
          <div class="row"><span class="dim" title="Wie schnell die Zeit auf See läuft. Die Lage bleibt gleich, nur die echte Spieldauer ändert sich">ZEITRAFFER</span><select id="s-scale">${TIME_SCALES.map((n) => `<option value="${n}">${n === 1 ? 'ECHTZEIT' : `${n}×`} · ${Math.round((match!.settings.timeLimitMin * SEA_TIME_FACTOR) / n)} MIN ECHT</option>`).join('')}</select></div>
          <div class="row"><span class="dim">KI FÜR LEERES TEAM</span><select id="s-bots"><option value="1">JA</option><option value="0">NEIN</option></select></div>
          <div class="row"><span class="dim">KI-STÄRKE</span><select id="s-skill"><option value="leicht">LEICHT</option><option value="normal">NORMAL</option><option value="schwer">SCHWER</option></select></div>
          <div class="row"><span class="dim" title="Wahrheitsansicht, Zeitraffer und Ziele setzen; ohne Wertung">ÜBUNGSMODUS (SANDKASTEN)</span><select id="s-sandbox"><option value="0">NEIN</option><option value="1">JA</option></select></div>
          <div class="row"><span class="dim">SPRUNGSCHICHT</span><span>${match.settings.layerDepth > 0 ? match.settings.layerDepth + ' M' : 'UNBEKANNT · MESSEN'}</span></div>

          <div style="display:flex;gap:6px;margin-top:10px">
            <button id="ready" class="${mine?.ready ? 'on' : ''}" style="flex:1">${mine?.ready ? 'Bereit ✓' : 'Bereit melden'}</button>
            <button id="leave">Verlassen</button>
          </div>
          <div class="dim" style="margin-top:6px">Die Partie startet, sobald alle bereit sind.</div>
        </div>
      </div>
      <div class="panel" style="margin-top:8px"><div class="hd"><span>Lobby-Funk</span><span class="dim">VOR DEM START</span></div>
        <div class="lchat" id="lchat">${(match.chat ?? []).map((l) => `<div><span class="amber">${esc(l.from)}:</span> ${esc(l.text)}</div>`).join('') || '<div class="dim">Noch keine Nachrichten. Taktik absprechen?</div>'}</div>
        <div style="display:flex;gap:4px;margin-top:6px"><input id="lc-text" maxlength="200" placeholder="Ich nehme die Nordflanke" style="flex:1;min-width:0"><button id="lc-send">Senden</button></div>
      </div>
      <div class="err">${esc(error)}</div>`;
    paintMissionCharts(el, match.settings.custom?.seabed);
    el.querySelector<HTMLButtonElement>('#inv-copy')!.onclick = async (e) => {
      const inp = el.querySelector<HTMLInputElement>('#inv-link')!;
      try {
        await navigator.clipboard.writeText(inp.value);
      } catch {
        inp.select();
        document.execCommand('copy');
      }
      (e.target as HTMLButtonElement).textContent = 'Kopiert ✓';
    };
    const lcInput = el.querySelector<HTMLInputElement>('#lc-text')!;
    lcInput.value = draft;
    if (typing) lcInput.focus();
    const lc = el.querySelector<HTMLElement>('#lchat')!;
    lc.scrollTop = lc.scrollHeight;
    const sendChat = () => {
      const inp = el.querySelector<HTMLInputElement>('#lc-text')!;
      if (inp.value.trim()) net.send({ t: 'lobby_chat', text: inp.value.trim() });
      inp.value = '';
    };
    el.querySelector<HTMLButtonElement>('#lc-send')!.onclick = sendChat;
    el.querySelector<HTMLInputElement>('#lc-text')!.onkeydown = (e) => e.key === 'Enter' && sendChat();
    el.querySelectorAll<HTMLButtonElement>('[data-mission]').forEach((b) => {
      b.onclick = () => {
        el.querySelector<HTMLSelectElement>('#s-mission')!.value = b.dataset.mission!;
        el.querySelector<HTMLSelectElement>('#s-mission')!.dispatchEvent(new Event('change'));
      };
    });
    el.querySelectorAll<HTMLButtonElement>('[data-cls]').forEach((b) => {
      b.onclick = () => net.send({ t: 'pick_class', cls: b.dataset.cls as 'ffg' | 'kor' | 'ffv' | 'ssn' | 'ssk' | 'ssc' | 'ssa' | 'ssw' | 'ffk' });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((b) => {
      b.onclick = () => net.send({ t: 'join', matchId: match!.id, team: b.dataset.switch as 'west' | 'east' });
    });
    const sel = (id: string) => el.querySelector<HTMLSelectElement>(id)!;
    sel('#s-mission').value = match.settings.mission;
    const areas = areasFor(match.settings.mission);
    sel('#s-area').value = match.settings.area && areas.includes(match.settings.area) ? match.settings.area : areas[0]!;
    el.querySelector<HTMLElement>('#custom')!.style.display = match.settings.mission === 'eigene' ? '' : 'none';
    const cu = match.settings.custom ?? { convoyKn: 9, seabed: 'tief', subFrac: 0.5 };
    sel('#c-n').value = String(match.settings.merchants);
    sel('#c-kn').value = String(cu.convoyKn);
    sel('#c-bed').value = cu.seabed;
    sel('#c-sub').value = String(cu.subFrac);
    sel('#s-tod').value = match.settings.timeOfDay;
    sel('#s-sea').value = String(match.settings.seaState);
    sel('#s-time').value = String(match.settings.timeLimitMin);
    sel('#s-scale').value = String(match.settings.timeScale ?? 1);
    sel('#s-bots').value = match.settings.fillBots ? '1' : '0';
    sel('#s-skill').value = match.settings.botSkill ?? 'normal';
    sel('#s-wx').value = match.settings.weather ?? 'wechselhaft';
    sel('#s-var').value = match.settings.variation ?? 'leicht';
    sel('#s-season').value = match.settings.season ?? 'zufall';
    sel('#s-sandbox').value = match.settings.sandbox ? '1' : '0';
    const send = () => net.send({
      t: 'settings', mission: sel('#s-mission').value as MissionKey,
      // A new mission starts in its home area; otherwise the chosen one
      area: sel('#s-mission').value === match!.settings.mission ? sel('#s-area').value as RegionId : undefined,
      timeOfDay: sel('#s-tod').value as 'tag' | 'daemmerung' | 'nacht' | 'zufall',
      seaState: Number(sel('#s-sea').value), timeLimitMin: Number(sel('#s-time').value), timeScale: Number(sel('#s-scale').value), fillBots: sel('#s-bots').value === '1',
      botSkill: sel('#s-skill').value as 'leicht' | 'normal' | 'schwer',
      weather: sel('#s-wx').value as 'wechselhaft' | 'stabil' | 'zufall',
      season: sel('#s-season').value as 'winter' | 'fruehling' | 'sommer' | 'herbst' | 'zufall',
      variation: sel('#s-var').value as 'aus' | 'leicht' | 'stark',
      merchants: Number(sel('#c-n').value),
      sandbox: sel('#s-sandbox').value === '1',
      custom: { convoyKn: Number(sel('#c-kn').value), seabed: sel('#c-bed').value as 'tief' | 'schelf' | 'fjord', subFrac: Number(sel('#c-sub').value) },
    });
    for (const id of ['#s-mission', '#s-area', '#s-tod', '#s-sea', '#s-time', '#s-scale', '#s-bots', '#s-skill', '#s-wx', '#s-season', '#s-var', '#c-n', '#c-kn', '#c-bed', '#c-sub', '#s-sandbox']) sel(id).onchange = send;
    el.querySelectorAll<HTMLButtonElement>('[data-crew]').forEach((b) => (b.onclick = () => net.send({ t: 'crew', captainId: b.dataset.crew! })));
    el.querySelector<HTMLButtonElement>('#own-ship')?.addEventListener('click', () => net.send({ t: 'crew', captainId: null }));
    el.querySelector<HTMLButtonElement>('#ready')!.onclick = () => net.send({ t: 'ready', ready: !mine?.ready });
    el.querySelector<HTMLButtonElement>('#leave')!.onclick = () => {
      match = undefined;
      shownMatch = '';
      net.send({ t: 'leave' });
    };
  }

  // While a finger is down or a picker is open, hold re-renders so the tap or selection is not lost
  let pressing = false;
  let pending = false;
  let shownMatch = '';
  const flush = () => {
    if (!pending || pressing || el.querySelector('select:focus')) return;
    pending = false;
    render();
  };
  el.addEventListener('pointerdown', () => (pressing = true));
  const release = () => {
    pressing = false;
    setTimeout(flush, 50); // after the click handler has run
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('focusout', () => setTimeout(flush, 50));
  const off = net.on((m: ServerMsg) => {
    if (m.t === 'lobby') matches = m.matches;
    else if (m.t === 'match') {
      const key = JSON.stringify(m.match);
      if (key === shownMatch && match) return;
      shownMatch = key;
      match = m.match;
    } else if (m.t === 'error') error = m.msg;
    else return;
    if (m.t !== 'error') error = '';
    if (match && (pressing || el.querySelector('select:focus'))) {
      pending = true;
      return;
    }
    render();
  });
  render();
  return off;
}
