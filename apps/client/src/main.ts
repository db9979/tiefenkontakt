import './style.css';
import { initI18n } from './i18n/index.js';
import type { ServerMsg } from '@tk/shared';
import { net, type LinkState } from './net.js';
import { handleMailLink, toast } from './screens/account.js';
import { authScreen } from './screens/auth.js';
import { debriefOverlay } from './screens/debrief.js';
import { gameScreen } from './screens/game.js';
import { lobbyScreen } from './screens/lobby.js';
import { store } from './store.js';

initI18n();
const root = document.getElementById('app')!;
let cleanup: (() => void) | undefined;
let screen: 'auth' | 'lobby' | 'game' = 'auth';
let me: { playerId: string; callsign: string } | undefined;
let removedMsg = '';
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
  } else if (m.t === 'removed') {
    removedMsg = m.msg;
    toast(m.msg.toUpperCase());
    if (screen === 'game') toLobby();
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
  banner.textContent = s === 'banned'
    ? `GESPERRT · ${removedMsg}`
    : s === 'replaced'
    ? 'SPIEL IN EINEM ANDEREN FENSTER GEÖFFNET'
    : 'VERBINDUNG UNTERBROCHEN · VERBINDE NEU … DEIN SCHIFF WARTET (PARTIE PAUSIERT, WENN NIEMAND VERBUNDEN IST)';
  if (!banner.isConnected) document.body.appendChild(banner);
};

// A reloaded tab of a guest reconnects directly with its stored callsign
const savedGuest = sessionStorage.getItem('tk_guest');
const toAuth = () => go('auth', () => authScreen(root, (callsign) => net.connect(callsign)));
// A mail link opened in an already open tab only changes the hash
window.addEventListener('hashchange', () => /^#(verify|reset)=/.test(location.hash) && location.reload());
if (handleMailLink(root, () => net.connect(''))) screen = 'auth';
else if (savedGuest) net.connect(savedGuest);
else toAuth();
