import './style.css';
import './stations.css';
import './widgets.css';
import './stations-frigate.css';
import './stations-sub.css';
import './theme-light.css';
import { initI18n, loadLang } from './i18n/index.js';
import { installErrorReporting } from './error-report.js';
import { applyDisplayPrefs, mountThemeButton } from './widgets/settings-menu.js';
import { installA11y } from './a11y.js';
import { installGamepad } from './gamepad.js';
import { installButtonAck } from './widgets/btn-state.js';
import type { ServerMsg } from '@tk/shared';
import { net, type LinkState } from './net.js';
import { handleMailLink, toast } from './screens/account.js';
import { authScreen } from './screens/auth.js';
import { debriefOverlay } from './screens/debrief.js';
import { sharedReplayId, sharedReplayScreen } from './widgets/replay-share.js';
import { store } from './store.js';
import { loadGame, loadLobby, preloadLobby, warmUp } from './prefetch.js';
import { registerServiceWorker } from './sw-register.js';

installErrorReporting();
registerServiceWorker(() => screen === 'game');
installButtonAck();
applyDisplayPrefs();
mountThemeButton();
installA11y();
installGamepad();
const root = document.getElementById('app')!;
let cleanup: (() => void) | undefined;
let screen: 'auth' | 'lobby' | 'game' = 'auth';
let me: { playerId: string; callsign: string } | undefined;
let removedMsg = '';
let watching: { update(d: import('@tk/shared').Debrief): void } | undefined;

type Close = (() => void) | void;
/** A one-line note in the middle of the page while a screen's code is on its way. */
function bootNote<K extends 'div' | 'button'>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  e.style.cssText = 'display:block;margin:30vh auto 0;text-align:center;letter-spacing:.12em;opacity:.8';
  return e;
}
/** Counts screen changes: a screen whose code arrives after the player has moved on is closed at once. */
let opened = 0;

/** Lobby and game come as their own chunks (the login needs neither): open once loaded. */
function go(name: typeof screen, open: () => Close | Promise<Close>): void {
  cleanup?.();
  cleanup = undefined;
  screen = name;
  const mine = ++opened;
  const r = open();
  if (!(r instanceof Promise)) return void (cleanup = r ?? undefined);
  // Only a slow network shows the wait (a prefetched chunk is there within a tick)
  const wait = setTimeout(() => mine === opened && root.replaceChildren(bootNote('div', 'LÄDT …')), 150);
  r.then((c) => {
    clearTimeout(wait);
    if (mine === opened) cleanup = c ?? undefined;
    else c?.();
  }, (e: unknown) => {
    clearTimeout(wait);
    // A chunk that will not load (deployed anew, offline): a reload fetches the current build
    console.error(e);
    if (mine === opened) {
      const b = bootNote('button', 'LADEN FEHLGESCHLAGEN · NEU LADEN');
      b.onclick = () => location.reload();
      root.replaceChildren(b);
    }
  });
}

const toLobby = () => {
  go('lobby', () => loadLobby().then((m) => m.lobbyScreen(root, me!)));
  // Fetch the game screen, 3D view, models and voice client and warm the shaders while the player is in the lobby
  warmUp();
};

net.on((m: ServerMsg) => {
  if (m.t === 'welcome') {
    me = { playerId: m.playerId, callsign: m.callsign };
    // Invite link: #join=<match id> joins that match right after connecting
    const inv = /^#join=([a-f0-9]{8})$/.exec(location.hash);
    if (inv) {
      history.replaceState(null, '', location.pathname);
      net.send({ t: 'join_code', matchId: inv[1]! });
    }
    store.playerId = m.playerId;
    // The server decides what the periscope tells this player by his realism mode
    net.send({ t: 'realism', realism: store.realism });
    // A returning player is put back into the match by the server; otherwise show the lobby
    if (!m.resume && screen !== 'lobby') toLobby();
  } else if (m.t === 'match') {
    // A new match keeps the player's mode on his slot (and old saves learn it)
    if (store.matchId !== m.match.id) net.send({ t: 'realism', realism: store.realism });
    store.matchId = m.match.id;
    if (m.match.state === 'running' && screen !== 'game') {
      go('game', () => loadGame().then((m) => m.gameScreen(root, () => {
        net.send({ t: 'leave' });
        toLobby();
      })));
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
const toAuth = () => {
  go('auth', () => authScreen(root, (callsign) => net.connect(callsign)));
  preloadLobby();
};
// A mail link opened in an already open tab only changes the hash
window.addEventListener('hashchange', () => /^#(verify|reset)=/.test(location.hash) && location.reload());
// Shared replay link (/r/<id>): only the playback, no connection, lobby or login
const replayId = sharedReplayId();
// Phone view (QR code from the bridge or periscope): only the 3D optic, its own connection
const phoneCode = /^#phone=([\w-]{6,40})$/.exec(location.hash)?.[1];
// English: the dictionaries come first (German players never fetch them), then the first screen
void loadLang().catch((e: unknown) => console.error(e)).then(() => {
  initI18n();
  if (phoneCode) void import('./screens/phone.js').then((m) => m.phoneScreen(root, phoneCode));
  else if (replayId) void sharedReplayScreen(root, replayId, (d, close) => debriefOverlay(d, close, false, true));
  else if (handleMailLink(root, () => net.connect(''))) screen = 'auth';
  else if (savedGuest) {
    net.connect(savedGuest);
    void loadLobby().catch(() => undefined);
  } else toAuth();
});
