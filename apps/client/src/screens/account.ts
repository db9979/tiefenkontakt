import { lang } from '../i18n/index.js';
import { esc, h } from '../widgets/format.js';

export async function post(url: string, body: unknown): Promise<{ ok: boolean; data: { error?: string } }> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({ error: 'Serverfehler' })) };
}

/**
 * Links from account mails land as #verify=… or #reset=…. Verification is handled
 * silently; a reset shows a small form. Returns true while a reset form is shown.
 */
export function handleMailLink(root: HTMLElement, done: () => void): boolean {
  const m = /^#(verify|reset)=([A-Za-z0-9_-]{16,})$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', location.pathname);
  const [, kind, token] = m;
  if (kind === 'verify') {
    void post('/api/verify', { token }).then((r) => toast(r.ok ? 'E-MAIL BESTÄTIGT' : (r.data.error ?? 'Fehler')));
    return false;
  }
  const el = h(`<div class="center"><div class="panel" style="max-width:380px;margin:40px auto;padding:16px">
    <div class="hd"><span>Neues Passwort</span></div>
    <div class="field"><label for="np">Passwort</label><input id="np" type="password" placeholder="Mindestens 8 Zeichen" autocomplete="new-password"></div>
    <button id="go" class="on" style="width:100%">Speichern und anmelden</button><div class="err" id="err"></div></div></div>`);
  root.replaceChildren(el);
  el.querySelector<HTMLButtonElement>('#go')!.onclick = async () => {
    const password = el.querySelector<HTMLInputElement>('#np')!.value;
    if (password.length < 8) return void (el.querySelector('#err')!.textContent = 'Mindestens 8 Zeichen');
    const r = await post('/api/password/reset', { token, password });
    if (!r.ok) return void (el.querySelector('#err')!.textContent = r.data.error ?? 'Fehler');
    toast('PASSWORT GEÄNDERT');
    done();
  };
  return true;
}

export function toast(text: string): void {
  const t = h(`<div class="linkbanner">${esc(text)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

/** Account panel in the lobby: verification state, password change, deletion. Accounts only. */
export function accountPanel(): HTMLElement {
  const el = h(`<div class="panel" style="margin-top:10px;display:none"></div>`);
  fetch('/api/me').then((r) => (r.ok ? r.json() : undefined)).then((me?: { callsign: string; email: string; verified: boolean }) => {
    if (!me) return;
    el.style.display = '';
    el.innerHTML = `<div class="hd"><span>Konto</span><span class="dim">${esc(me.email ?? '')}</span></div>
      <div class="row"><span>E-Mail</span><span>${me.verified ? 'BESTÄTIGT' : '<span class="amber">NICHT BESTÄTIGT</span> <button id="resend">Link erneut senden</button>'}</span></div>
      <div class="dim" style="margin:4px 0 8px">${me.verified ? '' : 'Erst nach Bestätigung erscheinst du in der Rangliste.'}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input id="pold" type="password" placeholder="Altes Passwort" autocomplete="current-password" style="flex:1;min-width:120px">
        <input id="pnew" type="password" placeholder="Neues Passwort" autocomplete="new-password" style="flex:1;min-width:120px">
        <button id="pchg">Passwort ändern</button>
        <button id="del" class="danger" title="Konto, Dienstakte und Kampagne endgültig löschen">Konto löschen</button>
      </div><div class="err" id="aerr"></div>`;
    const err = (s: string) => (el.querySelector('#aerr')!.textContent = s);
    const val = (id: string) => el.querySelector<HTMLInputElement>(`#${id}`)!.value;
    const resend = el.querySelector<HTMLButtonElement>('#resend');
    if (resend) resend.onclick = async () => { await post('/api/verify/resend', {}); toast('BESTÄTIGUNGSLINK GESENDET'); };
    el.querySelector<HTMLButtonElement>('#pchg')!.onclick = async () => {
      if (val('pnew').length < 8) return err('Neues Passwort: mindestens 8 Zeichen');
      const r = await post('/api/password/change', { old: val('pold'), password: val('pnew') });
      if (!r.ok) return err(r.data.error ?? 'Fehler');
      err('');
      toast('PASSWORT GEÄNDERT · ANDERE GERÄTE ABGEMELDET');
    };
    el.querySelector<HTMLButtonElement>('#del')!.onclick = async () => {
      const pw = val('pold');
      if (!pw) return err('Zum Löschen das Passwort ins Feld „Altes Passwort“ eingeben');
      if (!confirm(lang === 'en' ? `Permanently delete account ${me.callsign} with service record and campaign? This cannot be undone.` : `Konto ${me.callsign} mit Dienstakte und Kampagne endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) return;
      const r = await post('/api/account/delete', { password: pw });
      if (!r.ok) return err(r.data.error ?? 'Fehler');
      location.reload();
    };
  }).catch(() => undefined);
  return el;
}
