import type { MatchLobby, MatchSummary, ServerMsg } from '@tk/shared';
import { net } from '../net.js';
import { careerPanels } from './career.js';
import { CLASS_NAME, esc, h } from '../widgets/format.js';

/** Match browser plus the lobby of the joined match. */
export function lobbyScreen(root: HTMLElement, me: { playerId: string; callsign: string }): () => void {
  let matches: MatchSummary[] = [];
  let match: MatchLobby | undefined;
  let error = '';

  const el = h(`<div class="center"></div>`);
  root.replaceChildren(el);

  function render(): void {
    if (!match) {
      el.innerHTML = `
        <div class="title">TIEFENKONTAKT</div>
        <div class="dim" style="margin-bottom:16px">EINGELOGGT ALS ${esc(me.callsign)}</div>
        <div class="panel">
          <div class="hd"><span>Offene Partien</span><span>${matches.length}</span></div>
          ${matches.length === 0 ? '<div class="dim" style="padding:8px 0">Keine offenen Partien. Erstelle eine.</div>' : ''}
          ${matches.map((m) => `
            <div class="slot"><span>${esc(m.name)} <span class="dim">· ${m.players}/${m.maxPlayers} · ${m.state === 'lobby' ? 'WARTET' : 'LÄUFT'}</span></span>
            <span>${m.state === 'lobby' ? `<button data-join="${m.id}" data-team="west">Westbund</button> <button data-join="${m.id}" data-team="east">Ostpakt</button>` : `<button data-watch="${m.id}" title="Verzögert zuschauen">Zuschauen</button>`}</span></div>`).join('')}
          <div style="display:flex;gap:6px;margin-top:10px">
            <input id="mname" placeholder="Grönland-Lücke" maxlength="40" style="flex:1">
            <button id="create">Partie erstellen</button>
            <button id="quick" class="on" title="Einer offenen Partie beitreten oder eine neue eröffnen">Schnelles Spiel</button>
          </div>
          <div class="err">${esc(error)}</div>
        </div>
        <div class="panel" style="margin-top:10px">
          <div class="hd"><span>Ausbildung</span><span class="dim">EINZELSPIELER · MIT ANLEITUNG</span></div>
          <div class="grid2">
            <button data-lesson="klassifizieren" style="text-align:left;text-transform:none"><div>1 · Horchen und Klassifizieren</div><div class="dim">LOFAR, DEMON, Klassenbibliothek</div></button>
            <button data-lesson="tma" style="text-align:left;text-transform:none"><div>2 · Zielbewegungsanalyse</div><div class="dim">Kurswechsel, Lösung, Güte</div></button>
            <button data-lesson="angriff" style="text-align:left;text-transform:none"><div>3 · Torpedoangriff</div><div class="dim">Schusslösung, Draht, Treffer</div></button>
            <button data-lesson="ujagd" style="text-align:left;text-transform:none"><div>4 · U-Jagd mit Fregatte</div><div class="dim">Schleppsonar, Bojen, Rakete</div></button>
          </div>
        </div>`;
      el.appendChild(careerPanels());
      el.querySelectorAll<HTMLButtonElement>('[data-lesson]').forEach((b) => {
        b.onclick = () => net.send({ t: 'training', lesson: b.dataset.lesson as 'klassifizieren' | 'tma' | 'angriff' | 'ujagd' });
      });
      el.querySelector<HTMLButtonElement>('#create')!.onclick = () => {
        const name = el.querySelector<HTMLInputElement>('#mname')!.value.trim() || 'Grönland-Lücke';
        net.send({ t: 'create_match', name });
      };
      el.querySelector<HTMLButtonElement>('#quick')!.onclick = () => net.send({ t: 'quick' });
      el.querySelectorAll<HTMLButtonElement>('[data-watch]').forEach((b) => (b.onclick = () => net.send({ t: 'spectate', matchId: b.dataset.watch! })));
      el.querySelectorAll<HTMLButtonElement>('[data-join]').forEach((b) => {
        b.onclick = () => net.send({ t: 'join', matchId: b.dataset.join!, team: b.dataset.team as 'west' | 'east' });
      });
      return;
    }
    const mine = match.slots.find((s) => s.playerId === me.playerId);
    const team = (t: 'west' | 'east') => match!.slots.filter((s) => s.team === t).map((s) => `
      <div class="slot"><span>${esc(s.callsign)}${s.playerId === me.playerId ? ' <span class="dim">(DU)</span>' : ''}${s.bot ? ' <span class="dim">(KI)</span>' : ''}</span>
      <span>${s.crewOf ? `<span class="dim">BESATZUNG BEI ${esc(match!.slots.find((c) => c.playerId === s.crewOf)?.callsign ?? '?')}</span>` : CLASS_NAME[s.cls].title}
      ${mine && s.team === mine.team && !s.bot && !s.crewOf && s.playerId !== me.playerId && mine.crewOf !== s.playerId ? `<button data-crew="${s.playerId}" title="Als Besatzung auf diesem Schiff mitfahren">Mitfahren</button>` : ''}
      · ${s.ready ? '<span>BEREIT</span>' : '<span class="amber">WÄHLT</span>'}</span></div>`).join('') ||
      '<div class="slot dim">Freier Platz</div>';
    const classes = mine?.team === 'west' ? (['ffg'] as const) : (['ssk', 'ssn'] as const);
    el.innerHTML = `
      <div class="hd" style="font-size:14px"><span>PARTIE „${esc(match.name)}“</span><span>${match.slots.length} SPIELER · KONVOI ${match.settings.merchants} FRACHTER</span></div>
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
          <div class="row"><span class="dim">MISSION</span><select id="s-mission">
            <option value="groenland">Grönland-Lücke · tief</option><option value="schelf">Schelfmeer · flach</option><option value="fjord">Fjordausfahrt · Kanal</option></select></div>
          <div class="row"><span class="dim">TAGESZEIT</span><select id="s-tod"><option value="tag">Tag</option><option value="daemmerung">Dämmerung</option><option value="nacht">Nacht</option></select></div>
          <div class="row"><span class="dim">SEEGANG</span><select id="s-sea">${[1, 2, 3, 4, 5, 6].map((v) => `<option value="${v}">${v}</option>`).join('')}</select></div>
          <div class="row"><span class="dim">ZEITLIMIT</span><select id="s-time">${[20, 30, 40, 60].map((v) => `<option value="${v}">${v} MIN</option>`).join('')}</select></div>
          <div class="row"><span class="dim">KI FÜR LEERES TEAM</span><select id="s-bots"><option value="1">JA</option><option value="0">NEIN</option></select></div>
          <div class="row"><span class="dim">SPRUNGSCHICHT</span><span>${match.settings.layerDepth > 0 ? match.settings.layerDepth + ' M' : 'UNBEKANNT · MESSEN'}</span></div>

          <div style="display:flex;gap:6px;margin-top:10px">
            <button id="ready" class="${mine?.ready ? 'on' : ''}" style="flex:1">${mine?.ready ? 'Bereit ✓' : 'Bereit melden'}</button>
            <button id="leave">Verlassen</button>
          </div>
          <div class="dim" style="margin-top:6px">Die Partie startet, sobald alle bereit sind.</div>
        </div>
      </div>
      <div class="err">${esc(error)}</div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-cls]').forEach((b) => {
      b.onclick = () => net.send({ t: 'pick_class', cls: b.dataset.cls as 'ffg' | 'ssn' | 'ssk' });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((b) => {
      b.onclick = () => net.send({ t: 'join', matchId: match!.id, team: b.dataset.switch as 'west' | 'east' });
    });
    const sel = (id: string) => el.querySelector<HTMLSelectElement>(id)!;
    sel('#s-mission').value = match.settings.mission;
    sel('#s-tod').value = match.settings.timeOfDay;
    sel('#s-sea').value = String(match.settings.seaState);
    sel('#s-time').value = String(match.settings.timeLimitMin);
    sel('#s-bots').value = match.settings.fillBots ? '1' : '0';
    const send = () => net.send({
      t: 'settings', mission: sel('#s-mission').value as 'groenland' | 'schelf' | 'fjord', timeOfDay: sel('#s-tod').value as 'tag' | 'daemmerung' | 'nacht',
      seaState: Number(sel('#s-sea').value), timeLimitMin: Number(sel('#s-time').value), fillBots: sel('#s-bots').value === '1',
    });
    for (const id of ['#s-mission', '#s-tod', '#s-sea', '#s-time', '#s-bots']) sel(id).onchange = send;
    el.querySelectorAll<HTMLButtonElement>('[data-crew]').forEach((b) => (b.onclick = () => net.send({ t: 'crew', captainId: b.dataset.crew! })));
    el.querySelector<HTMLButtonElement>('#own-ship')?.addEventListener('click', () => net.send({ t: 'crew', captainId: null }));
    el.querySelector<HTMLButtonElement>('#ready')!.onclick = () => net.send({ t: 'ready', ready: !mine?.ready });
    el.querySelector<HTMLButtonElement>('#leave')!.onclick = () => {
      match = undefined;
      net.send({ t: 'leave' });
    };
  }

  const off = net.on((m: ServerMsg) => {
    if (m.t === 'lobby') matches = m.matches;
    else if (m.t === 'match') match = m.match;
    else if (m.t === 'error') error = m.msg;
    else return;
    if (m.t !== 'error') error = '';
    render();
  });
  render();
  return off;
}
