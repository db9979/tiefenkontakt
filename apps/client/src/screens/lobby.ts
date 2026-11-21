import type { MatchLobby, MatchSummary, ServerMsg } from '@tk/shared';
import { net } from '../net.js';
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
            <span>${m.state === 'lobby' ? `<button data-join="${m.id}" data-team="west">Westbund</button> <button data-join="${m.id}" data-team="east">Ostpakt</button>` : ''}</span></div>`).join('')}
          <div style="display:flex;gap:6px;margin-top:10px">
            <input id="mname" placeholder="Grönland-Lücke" maxlength="40" style="flex:1">
            <button id="create">Partie erstellen</button>
          </div>
          <div class="err">${esc(error)}</div>
        </div>`;
      el.querySelector<HTMLButtonElement>('#create')!.onclick = () => {
        const name = el.querySelector<HTMLInputElement>('#mname')!.value.trim() || 'Grönland-Lücke';
        net.send({ t: 'create_match', name });
      };
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
          <div class="row"><span class="dim">SPRUNGSCHICHT</span><span>${match.settings.layerDepth > 0 ? match.settings.layerDepth + ' M' : 'UNBEKANNT · MESSEN'}</span></div>
          <div class="row"><span class="dim">SEEGANG</span><span>${match.settings.seaState}</span></div>
          <div class="row"><span class="dim">ZEITLIMIT</span><span>${match.settings.timeLimitMin} MIN</span></div>
          <div class="row"><span class="dim">LEERES TEAM</span><span>${match.settings.fillBots ? 'KI ÜBERNIMMT' : 'BLEIBT LEER'}</span></div>
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
