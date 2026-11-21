import './style.css';
import type { ServerMsg } from '@tk/shared';
import { net } from './net.js';
import { authScreen } from './screens/auth.js';
import { gameScreen } from './screens/game.js';
import { lobbyScreen } from './screens/lobby.js';

const root = document.getElementById('app')!;
let cleanup: (() => void) | undefined;
let me: { playerId: string; callsign: string } | undefined;

function go(screen: () => (() => void) | void): void {
  cleanup?.();
  cleanup = screen() ?? undefined;
}

net.on((m: ServerMsg) => {
  if (m.t === 'welcome') {
    me = { playerId: m.playerId, callsign: m.callsign };
    go(() => lobbyScreen(root, me!));
  } else if (m.t === 'match' && m.match.state === 'running' && !document.querySelector('.game')) {
    go(() => gameScreen(root, () => {
      net.send({ t: 'leave' });
      go(() => lobbyScreen(root, me!));
    }));
  }
});
net.onClose = () => {
  root.innerHTML = '<div class="center"><div class="title">VERBINDUNG GETRENNT</div><button onclick="location.reload()">Neu verbinden</button></div>';
};

go(() => authScreen(root, (callsign) => net.connect(callsign)));
