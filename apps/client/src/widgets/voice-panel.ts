import { voice } from '../voice/voice.js';
import { h, setHtml, setText } from './format.js';
import { isKey } from './keys.js';
import { onTap } from './touch.js';

/**
 * Voice radio in the radio tab: switch on (microphone permission), a big push-to-talk button
 * (also the V key, rebindable, and touch-and-hold on phones), the team mates on the net with
 * link quality and a "talking" light, the own microphone level and the reason when we are
 * off the air. Submarines only talk surfaced or with the mast up; the intercom always works.
 */
export function voicePanel(): { el: HTMLElement; dispose(): void } {
  const el = h(`<div class="voice">
    <div class="row"><span class="dim">SPRECHFUNK</span><span id="vo-mode" class="dim"></span></div>
    <div class="steps">
      <button id="vo-on" title="Mikrofon freigeben und dem Sprechfunk des Teams beitreten">Sprechfunk an</button>
      <button id="vo-ptt" class="ptt" title="Gedrückt halten zum Sprechen (Taste V). Jede Sendung kann der Gegner anpeilen." disabled>Sprechen (V)</button>
    </div>
    <div class="row"><span class="dim">MIKRO</span><span class="bar"><i id="vo-lvl"></i></span></div>
    <div id="vo-peers"></div>
    <div id="vo-note" class="amber"></div>
    <div class="row"><span class="dim">LAUTSTÄRKE</span><input id="vo-vol" type="range" min="0" max="1.5" step="0.05" style="width:50%"></div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const vol = q<HTMLInputElement>('#vo-vol');
  vol.value = String(voice.volume);
  vol.oninput = () => (voice.volume = Number(vol.value));
  onTap(el, '#vo-on', () => (voice.joined ? voice.leave() : void voice.join()));
  const ptt = q<HTMLButtonElement>('#vo-ptt');
  // Hold to talk: pointer for mouse and touch, released anywhere
  ptt.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ptt.setPointerCapture(e.pointerId);
    voice.ptt(true);
  });
  const release = () => voice.ptt(false);
  ptt.addEventListener('pointerup', release);
  ptt.addEventListener('pointercancel', release);
  ptt.addEventListener('contextmenu', (e) => e.preventDefault());
  const down = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.repeat || !isKey(e, 'ptt')) return;
    voice.ptt(true);
  };
  const up = (e: KeyboardEvent) => isKey(e, 'ptt') && voice.ptt(false);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', release);

  const render = () => {
    const st = voice.state;
    setText(q('#vo-on'), voice.joining ? 'Mikrofon …' : voice.joined ? 'Sprechfunk aus' : 'Sprechfunk an');
    q('#vo-on').classList.toggle('on', voice.joined);
    ptt.disabled = !voice.joined;
    const live = voice.pttHeld && !!st?.ptt;
    ptt.classList.toggle('live', live);
    setText(ptt, live ? 'AUF SENDUNG' : voice.pttHeld ? 'Kein Sendebetrieb' : 'Sprechen (V)');
    setText(q('#vo-mode'), !voice.joined ? 'AUS' : voice.mode === 'sfu' ? 'ÜBER SPRACHSERVER' : 'DIREKT');
    const peers = [...voice.peers.values()];
    setHtml(q('#vo-peers'), voice.joined ? (peers.length ? peers.map((p) => {
      const l = st?.links.find((x) => x.playerId === p.info.playerId);
      const link = voice.linkState(p.info.playerId);
      const qPct = Math.round((l?.q ?? 0) * 100);
      const cls = l?.talking ? 'green blink' : qPct === 0 ? 'dim' : '';
      const where = p.info.sameShip ? 'BORDSPRECH' : qPct === 0 ? 'KEINE VERBINDUNG' : `${qPct} %`;
      return `<div class="row"><span class="${cls}">${l?.talking ? '◉' : '○'} ${p.info.callsign} · ${p.info.ship}</span><span class="${link === 'failed' ? 'red' : 'dim'}">${link === 'failed' ? 'LEITUNG GESTÖRT' : link === 'connecting' ? 'VERBINDE …' : where}</span></div>`;
    }).join('') : '<div class="dim">Noch niemand aus dem Team im Sprechfunk</div>') : '');
    setText(q('#vo-note'), voice.error ?? (voice.joined && st && !st.canTx ? st.reason ?? '' : ''));
  };
  const offChange = voice.onChange(render);
  const lvl = q<HTMLElement>('#vo-lvl');
  const meter = setInterval(() => {
    lvl.style.width = `${Math.round(Math.min(1, voice.level * 2.5) * 100)}%`;
    lvl.style.background = voice.pttHeld && voice.state?.ptt ? '#f09595' : '#5dcaa5';
  }, 120);
  render();
  return {
    el,
    dispose() {
      offChange();
      clearInterval(meter);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    },
  };
}
