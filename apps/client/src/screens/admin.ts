import { lang } from '../i18n/index.js';
import { esc, h } from '../widgets/format.js';
import { post, toast } from './account.js';
import { insightsSection } from './admin-insights.js';

interface Overview {
  matches: { id: string; name: string; state: string; mission: string; lesson: string | null; players: { playerId: string; callsign: string; team: string; online: boolean }[] }[];
  reports: { id: number; at: number; reporter: string; reported: string; reportedId: string; reason: string; evidence: string }[];
  bans: { id: number; callsign: string; until: number; reason: string }[];
}

const when = (t: number) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

/** Moderation panel: only rendered for accounts listed in the server's ADMIN variable. */
export function adminPanel(): HTMLElement {
  const el = h(`<div class="panel" style="margin-top:10px;display:none"></div>`);
  const insights = insightsSection();
  async function load(): Promise<void> {
    const r = await fetch('/api/admin/overview');
    if (!r.ok) return;
    const o = (await r.json()) as Overview;
    el.style.display = '';
    el.innerHTML = `<div class="hd"><span>Moderation</span><button data-a="reload">Aktualisieren</button></div>
      <div class="dim" style="margin:4px 0">PARTIEN</div>
      ${o.matches.map((m) => `<div class="row"><span>${esc(m.name)} <span class="dim">· ${esc(m.state)} · ${esc(m.lesson ?? m.mission)}</span></span><button data-a="end" data-id="${esc(m.id)}">Beenden</button></div>
        ${m.players.map((p) => `<div class="row dim" style="padding-left:12px"><span>${esc(p.callsign)} · ${p.team === 'west' ? 'WEST' : 'OST'}${p.online ? '' : ' · GETRENNT'}</span>
          <span><button data-a="kick" data-id="${esc(p.playerId)}">Entfernen</button> <button data-a="ban" data-id="${esc(p.playerId)}" data-cs="${esc(p.callsign)}" class="danger">Sperren</button></span></div>`).join('')}`).join('') || '<div class="dim">Keine Partien</div>'}
      <div class="dim" style="margin:8px 0 4px">MELDUNGEN</div>
      ${o.reports.map((r) => `<div class="row" style="align-items:flex-start"><span><b>${esc(r.reported)}</b> <span class="dim">von ${esc(r.reporter)} · ${when(r.at)}</span><br>${esc(r.reason)}
        <pre class="dim" style="margin:2px 0;white-space:pre-wrap">${esc(r.evidence)}</pre></span>
        <span><button data-a="ban" data-id="${esc(r.reportedId)}" data-cs="${esc(r.reported)}" class="danger">Sperren</button> <button data-a="dismiss" data-id="${r.id}">Erledigt</button></span></div>`).join('') || '<div class="dim">Keine offenen Meldungen</div>'}
      <div class="dim" style="margin:8px 0 4px">SPERREN</div>
      ${o.bans.map((b) => `<div class="row"><span>${esc(b.callsign)} <span class="dim">bis ${when(b.until)} · ${esc(b.reason)}</span></span><button data-a="unban" data-id="${b.id}">Aufheben</button></div>`).join('') || '<div class="dim">Keine aktiven Sperren</div>'}`;
    el.append(insights.el);
    void insights.load();
  }
  el.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]');
    if (!b) return;
    const id = b.dataset.id ?? '';
    let r: { ok: boolean; data: { error?: string } } | undefined;
    switch (b.dataset.a) {
      case 'end':
        if (confirm(lang === 'en' ? 'End the match for everyone?' : 'Partie für alle beenden?')) r = await post('/api/admin/end', { matchId: id });
        break;
      case 'kick':
        r = await post('/api/admin/kick', { playerId: id });
        break;
      case 'ban': {
        const hours = Number(prompt(lang === 'en' ? `Ban ${b.dataset.cs} – duration in hours:` : `${b.dataset.cs} sperren – Dauer in Stunden:`, '24'));
        const reason = hours > 0 ? prompt(lang === 'en' ? 'Reason:' : 'Grund:')?.trim() : undefined;
        if (reason) r = await post('/api/admin/ban', { playerId: id, hours, reason });
        break;
      }
      case 'unban':
        r = await post('/api/admin/unban', { banId: Number(id) });
        break;
      case 'dismiss':
        r = await post('/api/admin/dismiss', { reportId: Number(id) });
        break;
    }
    if (r && !r.ok) toast(r.data.error ?? 'Fehler');
    void load();
  });
  // Only moderators see the panel; others never call the admin API
  fetch('/api/me').then((r) => (r.ok ? r.json() : undefined)).then((me?: { admin?: boolean }) => { if (me?.admin) void load(); }).catch(() => undefined);
  return el;
}
