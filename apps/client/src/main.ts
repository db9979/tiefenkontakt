import './style.css';
import type { ServerMsg } from '@tk/shared';
import { net, type LinkState } from './net.js';
import { authScreen } from './screens/auth.js';
import { debriefOverlay } from './screens/debrief.js';
import { gameScreen } from './screens/game.js';
import { lobbyScreen } from './screens/lobby.js';
import { store } from './store.js';

const root = document.getElementById('app')!;
let cleanup: (() => void) | undefined;
let screen: 'auth' | 'lobby' | 'game' = 'auth';
let me: { playerId: string; callsign: string } | undefined;
let watching: { update(d: import('@tk/shared').Debrief): void } | undefined;

function go(name: typeof screen, open: () => (() => void) | void): void {
  cleanup?.();
  screen = name;
  cleanup = open() ?? undefined;
}

const toLobby = () => go('lobby', () => lobbyScreen(root, me!));

net.on((m: ServerMsg) => {
  if (m.t === 'welcome') {
    me = { playerId: m.playerId, callsign: m.callsign };
    store.playerId = m.playerId;
    // A returning player is put back into the match by the server; otherwise show the lobby
    if (!m.resume && screen !== 'lobby') toLobby();
  } else if (m.t === 'match') {
    store.matchId = m.match.id;
    if (m.match.state === 'running' && screen !== 'game') {
      go('game', () => gameScreen(root, () => {
        net.send({ t: 'leave' });
        toLobby();
      }));
    } else if (m.match.state === 'lobby' && screen !== 'lobby') toLobby();
  } else if (m.t === 'spectate') {
    if (!watching) {
      watching = debriefOverlay(m.d, () => {
        watching = undefined;
        net.send({ t: 'leave' });
      }, true);
    } else watching.update(m.d);
  } else if (m.t === 'debrief' && screen !== 'game') {
    // Reconnected after the end: go straight to the debrief
    debriefOverlay(m.d, () => {
      net.send({ t: 'leave' });
      toLobby();
    });
  }
});

const banner = document.createElement('div');
banner.className = 'linkbanner';
net.onState = (s: LinkState) => {
  if (s === 'online') return banner.remove();
  banner.textContent = s === 'replaced'
    ? 'SPIEL IN EINEM ANDEREN FENSTER GEÖFFNET'
    : 'VERBINDUNG UNTERBROCHEN · VERBINDE NEU … DEIN SCHIFF WARTET (PARTIE PAUSIERT, WENN NIEMAND VERBUNDEN IST)';
  if (!banner.isConnected) document.body.appendChild(banner);
};

// A reloaded tab of a guest reconnects directly with its stored callsign
const savedGuest = sessionStorage.getItem('tk_guest');
if (savedGuest) net.connect(savedGuest);
else go('auth', () => authScreen(root, (callsign) => net.connect(callsign)));
