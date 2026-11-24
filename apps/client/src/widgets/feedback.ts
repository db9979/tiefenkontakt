import type { Debrief } from '@tk/shared';
import { quality, qualitySetting } from './perf.js';
import { esc, h } from './format.js';

/**
 * Feedback after a game (test evenings): fun 1–5, a few quick tags and a line of text, sent
 * with the mission, side, class and graphics level. Moderators read it in the lobby.
 */

const TAGS: [string, string][] = [['super', 'Hat Spaß gemacht'], ['ruckeln', 'Ruckelt'], ['fehler', 'Fehler gesehen'], ['unklar', 'Unklar, was zu tun ist'], ['zu_schwer', 'Zu schwer'], ['zu_leicht', 'Zu leicht']];

export function feedbackBlock(d: Debrief, playerId: string | undefined): HTMLElement {
  const me = d.stats.find((s) => s.playerId === playerId);
  const el = h(`<div class="panel" style="margin:8px 0">
    <div class="hd"><span>Rückmeldung</span><span class="dim">HILFT BEIM TESTEN</span></div>
    <div class="row" style="gap:4px"><span class="dim">SPASS</span><span id="fb-stars" style="display:flex;gap:3px">${[1, 2, 3, 4, 5].map((n) => `<button data-r="${n}" title="${n} von 5">${n}</button>`).join('')}</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin:4px 0">${TAGS.map(([k, l]) => `<button data-tag="${k}">${esc(l)}</button>`).join('')}</div>
    <textarea id="fb-text" maxlength="1000" rows="2" style="width:100%;box-sizing:border-box" placeholder="Was war gut, was hat gestört?"></textarea>
    <button id="fb-send" style="width:100%;margin-top:4px" disabled>Senden</button>
  </div>`);
  let rating = 0;
  const tags = new Set<string>();
  const send = el.querySelector<HTMLButtonElement>('#fb-send')!;
  el.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => {
    b.onclick = () => {
      rating = Number(b.dataset.r);
      el.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((x) => x.classList.toggle('on', Number(x.dataset.r) <= rating));
      send.disabled = false;
    };
  });
  el.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.tag!;
      if (tags.has(k)) tags.delete(k);
      else tags.add(k);
      b.classList.toggle('on', tags.has(k));
    };
  });
  send.onclick = async () => {
    send.disabled = true;
    const body = {
      rating, tags: [...tags], text: el.querySelector<HTMLTextAreaElement>('#fb-text')!.value,
      mission: d.setup?.settings?.mission, side: me?.team === 'west' || me?.team === 'east' ? me.team : undefined, cls: me?.cls, won: me?.won,
      quality: `${qualitySetting()}:${quality()}`,
    };
    const r = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
    el.innerHTML = r?.ok ? '<div class="dim" style="padding:4px">DANKE FÜR DIE RÜCKMELDUNG.</div>' : '<div class="amber" style="padding:4px">KONNTE NICHT GESENDET WERDEN.</div>';
  };
  return el;
}

/** Moderators: the latest feedback with the average (hidden for everyone else). */
export function feedbackAdmin(): HTMLElement {
  const el = h('<div class="panel" style="margin-top:10px;display:none"></div>');
  void fetch('/api/admin/feedback').then(async (r) => {
    if (!r.ok) return;
    const b = (await r.json()) as { average: number | null; count: number; rows: { at: number; callsign?: string; rating: number; tags: string[]; text: string; mission?: string; side?: string; cls?: string; quality?: string }[] };
    el.style.display = '';
    el.innerHTML = `<div class="hd"><span>Rückmeldungen</span><span class="dim">${b.count} · Ø ${b.average?.toFixed(1) ?? '—'}</span></div>` + (b.rows.map((x) => `<div class="row" style="display:block;border-top:1px solid var(--line);padding:3px 0">
      <span class="amber">${'★'.repeat(x.rating)}</span> <span class="dim">${new Date(x.at).toLocaleString('de-DE')} · ${esc(x.callsign ?? 'Gast')} · ${esc(x.mission ?? '')} ${esc(x.side ?? '')} ${esc(x.cls ?? '')} · ${esc(x.quality ?? '')}</span>
      ${x.tags.length ? `<div class="dim">${x.tags.map(esc).join(' · ')}</div>` : ''}${x.text ? `<div>${esc(x.text)}</div>` : ''}</div>`).join('') || '<div class="dim">NOCH KEINE</div>');
  });
  return el;
}
