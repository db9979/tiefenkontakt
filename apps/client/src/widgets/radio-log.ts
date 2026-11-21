import type { RadioMsg } from '@tk/shared';
import { lang } from '../i18n/index.js';
import { net } from '../net.js';
import { clock, esc } from './format.js';

/** Senders this player has muted (by the name shown in the radio log), kept for the browser session. */
const muted = new Set<string>(JSON.parse(sessionStorage.getItem('tk_muted') ?? '[]') as string[]);
const save = () => sessionStorage.setItem('tk_muted', JSON.stringify([...muted]));

/**
 * Team radio log with per-sender mute and report. Re-renders only when the log changes,
 * so the small buttons stay clickable between snapshots.
 */
export function radioLog(box: HTMLElement): (radio: RadioMsg[], ownName: string) => void {
  let key = '';
  let last: RadioMsg[] = [];
  let me = '';
  const render = () => {
    const shown = last.filter((r) => !muted.has(r.from));
    const hidden = last.length - shown.length;
    box.innerHTML = shown.map((r) => `<div class="rline"><span class="dim">${clock(r.time)}</span> ${esc(r.from)}: ${esc(r.text)}${r.from === me ? '' : `
      <span class="racts"><button data-mute="${esc(r.from)}" title="Diesen Absender ausblenden">stumm</button><button data-report="${esc(r.from)}" title="An die Moderation melden">melden</button></span>`}</div>`).join('') +
      (muted.size ? `<div class="dim">${hidden} AUSGEBLENDET · <button data-unmute="1" class="link">alle wieder zeigen</button></div>` : '');
  };
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.mute) muted.add(b.dataset.mute);
    else if (b.dataset.unmute) muted.clear();
    else if (b.dataset.report) {
      const reason = prompt(lang === 'en' ? `Report ${b.dataset.report} – reason (e.g. insults, spam):` : `${b.dataset.report} melden – Grund (z. B. Beleidigung, Spam):`)?.trim();
      if (reason) net.send({ t: 'report', from: b.dataset.report, reason: reason.slice(0, 200) });
      return;
    }
    save();
    render();
  });
  return (radio, ownName) => {
    const k = `${radio.length}:${radio[radio.length - 1]?.time ?? 0}:${muted.size}`;
    if (k === key) return;
    key = k;
    last = radio;
    me = ownName;
    render();
  };
}
