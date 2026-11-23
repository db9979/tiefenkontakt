import type { Debrief } from '@tk/shared';
import { esc, h } from './format.js';

/**
 * "Wiederholung teilen": turns the player's last finished match into a public, read-only link
 * (/r/<id>), and the page that link opens: the debrief playback without lobby or login.
 */

const REPLAY_ID = /^[A-Za-z0-9_-]{16}$/;

/** Replay id when the page was opened as /r/<id>. */
export function sharedReplayId(path = location.pathname): string | undefined {
  const m = /^\/r\/([^/]+)\/?$/.exec(path);
  return m && REPLAY_ID.test(m[1]!) ? m[1] : undefined;
}

export function shareBlock(): string {
  return `<div id="db-share" style="margin-top:10px">
    <button id="db-share-btn" style="width:100%" title="Öffentlicher Link: jeder mit dem Link sieht die Wiederholung, ohne Anmeldung">Wiederholung teilen</button>
    <div id="db-share-out" style="display:none;margin-top:6px;gap:6px">
      <input id="db-share-url" readonly style="flex:1;min-width:0"><button id="db-share-copy">Link kopieren</button>
    </div>
    <div class="dim" id="db-share-msg" style="margin-top:4px"></div>
  </div>`;
}

/** Wire the share button inside the debrief overlay `el`. */
export function wireShare(el: HTMLElement): void {
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s);
  const btn = q<HTMLButtonElement>('#db-share-btn');
  if (!btn) return;
  const msg = q('#db-share-msg')!;
  const input = q<HTMLInputElement>('#db-share-url')!;
  btn.onclick = async () => {
    btn.disabled = true;
    msg.textContent = '';
    // Guests prove who they are with their per-tab secret (the same one the game connection uses)
    const gid = sessionStorage.getItem('tk_guest') ? sessionStorage.getItem('tk_gid') ?? undefined : undefined;
    try {
      const r = await fetch('/api/replays', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(gid ? { gid } : {}) });
      const data = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !data.url) throw new Error(data.error ?? 'Fehler');
      input.value = `${location.origin}${data.url}`;
      q('#db-share-out')!.style.display = 'flex';
      btn.style.display = 'none';
      msg.textContent = 'ÖFFENTLICH · NUR ANSEHEN · KEINE KONTEN-DATEN';
    } catch (e) {
      msg.textContent = (e as Error).message;
      btn.disabled = false;
    }
  };
  q<HTMLButtonElement>('#db-share-copy')!.onclick = async () => {
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      document.execCommand('copy');
    }
    msg.textContent = 'LINK KOPIERT';
  };
}

/** The /r/<id> page: fetch the shared debrief and show the playback. */
export async function sharedReplayScreen(
  root: HTMLElement, id: string, show: (d: Debrief, onClose: () => void) => void,
): Promise<void> {
  const home = () => location.assign('/');
  root.innerHTML = '<div class="dim" style="padding:20px">LADE …</div>';
  try {
    const r = await fetch(`/api/replays/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(r.status === 404 ? 'Wiederholung nicht gefunden oder abgelaufen' : 'Fehler');
    const d = (await r.json()) as Debrief;
    root.innerHTML = '';
    show(d, home);
  } catch (e) {
    root.innerHTML = '';
    const box = h(`<div class="panel" style="max-width:420px;margin:15vh auto;text-align:center;padding:20px">
      <div class="title">TIEFENKONTAKT</div><div style="margin:12px 0" class="red">${esc((e as Error).message)}</div>
      <button id="rp-home" class="on">Selbst spielen</button></div>`);
    box.querySelector<HTMLButtonElement>('#rp-home')!.onclick = home;
    root.appendChild(box);
  }
}
