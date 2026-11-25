import type { Debrief, Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { esc, h } from './format.js';

/**
 * Match pacing in the top bar: "Zeitraffer bis Ereignis" (6× until a new contact, an alarm or
 * a finished tutorial step) with a steady amber "×6" tag while it runs. Solo: one button;
 * multiplayer: the button is a vote, the tag shows how many have voted.
 */
export function mountFastForward(): { el: HTMLElement; update(s: Snapshot): void } {
  const el = h(`<span class="ff" style="display:inline-flex;align-items:center;gap:6px">
    <button id="ff-btn" title="Zeitraffer ×6 bis zum nächsten Ereignis: neuer Kontakt, Alarm, Ausbildungsschritt">⏩ Zeitraffer</button>
    <span id="ff-tag" class="amber" style="display:none;border:1px solid var(--amber);border-radius:3px;padding:1px 6px;font-weight:bold">×6</span>
    <span id="ff-note" class="dim"></span></span>`);
  const btn = el.querySelector<HTMLButtonElement>('#ff-btn')!;
  const tag = el.querySelector<HTMLElement>('#ff-tag')!;
  const note = el.querySelector<HTMLElement>('#ff-note')!;
  let state: Snapshot['ff'];
  btn.onclick = () => state && net.send({ t: 'fastforward', on: !(state.on || state.mine) });
  let shown = '';
  return {
    el,
    update(s) {
      state = s.ff;
      const ff = s.ff;
      // Gone in the sandbox (own time controls) and once the own ship is lost
      const key = JSON.stringify([ff, s.own.alive]);
      if (key === shown) return;
      shown = key;
      el.style.display = ff && s.own.alive ? 'inline-flex' : 'none';
      if (!ff) return;
      const vote = ff.need > 1;
      tag.style.display = ff.on ? '' : 'none';
      btn.classList.toggle('on', ff.on || ff.mine);
      // Icon first, the words in .ff-lbl (hidden below 1280 px: icon-only top bar, the title says it)
      const [icon, words, count] = ff.on ? ['■', 'Zeitraffer aus', ''] : vote
        ? (ff.mine ? ['↶', 'Stimme zurück', ` ${ff.votes}/${ff.need}`] : ['⏩', 'Zeitraffer?', ` ${ff.votes}/${ff.need}`]) : ['⏩', 'Zeitraffer', ''];
      btn.innerHTML = `<span aria-hidden="true">${icon}</span><span class="ff-lbl"> ${words}</span>${count}`;
      btn.setAttribute('aria-label', words);
      btn.disabled = !ff.on && !ff.mine && !!ff.blocked;
      btn.title = ff.blocked ?? (vote
        ? 'Abstimmen: ×6 bis zum nächsten Ereignis, sobald alle an Bord eines Schiffes zugestimmt haben und niemand frischen Feindkontakt hat'
        : 'Zeitraffer ×6 bis zum nächsten Ereignis: neuer Kontakt, Alarm, Ausbildungsschritt');
      // Why it stopped or can't run goes into the tooltip, not the crowded top bar
      note.innerHTML = '';
      const why = ff.on ? '' : ff.blocked ? ff.blocked : ff.stopped ? `Gestoppt: ${ff.stopped}` : '';
      if (why) btn.title = `${why} · ${btn.title}`;
      void esc;
    },
  };
}

/**
 * Own ship sunk: instead of only the banner, three ways on: go aboard a living teammate as
 * crew, watch the battle as a delayed spectator, or the debrief now (and leave).
 */
export function mountSunkPanel(onDebrief: (d: Debrief) => void): { el: HTMLElement; update(s: Snapshot, matchId: string | undefined): void; dispose(): void } {
  const el = h(`<div class="panel sunk-panel" style="position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:55;max-width:520px;width:92vw;display:none;border-color:var(--red)">
    <div class="hd"><span class="red">Eigenes Schiff gesunken</span><span class="dim">WIE WEITER?</span></div>
    <div id="sk-board"></div>
    <div class="steps" style="margin-top:8px;flex-wrap:wrap">
      <button id="sk-watch" title="Die wahre Lage mit einigen Minuten Verzögerung, damit niemand seinem Team helfen kann">Zuschauen (verzögert)</button>
      <button id="sk-debrief" title="Nachbesprechung bis jetzt (verzögert) und die Partie verlassen">Nachbesprechung jetzt</button>
      <button id="sk-stay">Hier bleiben</button>
    </div></div>`);
  let matchId: string | undefined;
  let dismissed = false;
  let shown = '';
  el.querySelector<HTMLButtonElement>('#sk-watch')!.onclick = () => {
    if (!matchId) return;
    net.send({ t: 'spectate', matchId });
    el.style.display = 'none';
    dismissed = true;
  };
  el.querySelector<HTMLButtonElement>('#sk-debrief')!.onclick = () => {
    net.send({ t: 'debrief_now' });
    el.style.display = 'none';
    dismissed = true;
  };
  el.querySelector<HTMLButtonElement>('#sk-stay')!.onclick = () => {
    el.style.display = 'none';
    dismissed = true;
  };
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-board]');
    if (b) net.send({ t: 'crew', captainId: b.dataset.board! });
  });
  // The provisional debrief answers "Nachbesprechung jetzt"; closing it leaves the match
  const off = net.on((m) => {
    if (m.t === 'debrief' && m.d.provisional) onDebrief(m.d);
  });
  return {
    el,
    dispose() {
      off();
      el.remove();
    },
    update(s, id) {
      matchId = id;
      if (s.own.alive) {
        // Aboard a teammate's ship now: the panel is done
        el.style.display = 'none';
        dismissed = false;
        return;
      }
      if (dismissed) return;
      el.style.display = '';
      const key = JSON.stringify(s.boardable ?? []);
      if (key === shown) return;
      shown = key;
      const list = s.boardable ?? [];
      el.querySelector('#sk-board')!.innerHTML = list.length
        ? `<div class="dim" style="margin-bottom:4px">ALS BESATZUNG MITFAHREN · JEDE STATION BEDIENBAR</div>${list.map((b) =>
          `<button class="primary on" data-board="${esc(b.captainId)}" style="width:100%;text-align:left;text-transform:none;margin-bottom:4px">Mitfahren bei ${esc(b.callsign)} · ${esc(b.ship)}</button>`).join('')}`
        : '<div class="dim">KEIN SCHIFF EINES MITSPIELERS MEHR IN FAHRT</div>';
    },
  };
}
