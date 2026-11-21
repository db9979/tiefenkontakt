import { esc, h } from '../widgets/format.js';
import { post, toast } from './account.js';

type Mode = 'register' | 'login' | 'guest';

/** Registration / login / guest entry. Calls `onEnter` with a guest callsign or '' for an account. */
export function authScreen(root: HTMLElement, onEnter: (guestCallsign: string) => void): void {
  let mode: Mode = 'register';
  let faction: 'west' | 'east' = 'west';
  const el = h(`<div class="center authgrid"></div>`);
  root.replaceChildren(el);

  fetch('/api/me').then((r) => (r.ok ? r.json() : undefined)).then((me) => {
    if (me?.callsign) onEnter('');
  }).catch(() => undefined);

  function field(id: string, label: string, type = 'text', ph = ''): string {
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" placeholder="${ph}" autocomplete="off"><div class="err" id="e-${id}"></div></div>`;
  }

  function render(error = ''): void {
    el.innerHTML = `
      <div>
        <div class="title">TIEFENKONTAKT</div>
        <div class="dim" style="margin-bottom:16px">NORDATLANTIK · KALTER KRIEG</div>
        <div style="line-height:1.8">
          <div>Jage im Wolfsrudel oder schütze den Konvoi.</div>
          <div class="dim">· 2 TEAMS, BIS ZU 6 GEGEN 6</div>
          <div class="dim">· ECHTE SONAR- UND TMA-SIMULATION</div>
          <div class="dim">· JEDER FUNKSPRUCH KANN DICH VERRATEN</div>
        </div>
      </div>
      <div class="panel" style="padding:16px">
        <div style="display:flex;gap:4px;margin-bottom:14px">
          <button data-mode="register" class="${mode === 'register' ? 'on' : ''}">Registrieren</button>
          <button data-mode="login" class="${mode === 'login' ? 'on' : ''}">Anmelden</button>
          <button data-mode="guest" class="${mode === 'guest' ? 'on' : ''}">Als Gast</button>
        </div>
        ${mode === 'register' ? field('cs', 'Rufzeichen', 'text', 'Seewolf') : ''}
        ${mode === 'guest' ? field('cs', 'Rufzeichen', 'text', 'Seewolf') : ''}
        ${mode !== 'guest' ? field('em', 'E-Mail', 'email', 'kapitaen@beispiel.de') + field('pw', 'Passwort', 'password', 'Mindestens 8 Zeichen') : ''}
        ${mode === 'register' ? `<div class="field"><label>Bevorzugte Fraktion</label><div class="grid2">
          <button data-f="west" class="${faction === 'west' ? 'on' : ''}" style="text-align:left;text-transform:none"><div class="team-w">WESTBUND</div><div class="dim">Fregatten, Konvoischutz</div></button>
          <button data-f="east" class="${faction === 'east' ? 'on' : ''}" style="text-align:left;text-transform:none"><div class="team-e">OSTPAKT</div><div class="dim">U-Boote, Wolfsrudel</div></button>
        </div><div class="dim" style="margin-top:4px">Du kannst vor jeder Partie wechseln.</div></div>` : ''}
        <button id="go" class="on" style="width:100%;margin-top:6px">${mode === 'register' ? 'Konto erstellen' : mode === 'login' ? 'Anmelden' : 'Als Gast spielen'}</button>
        ${mode === 'login' ? '<button id="forgot" class="link" style="margin-top:6px">Passwort vergessen?</button>' : ''}
        <div class="err">${esc(error)}</div>
      </div>`;
    const forgot = el.querySelector<HTMLButtonElement>('#forgot');
    if (forgot) forgot.onclick = async () => {
      const em = val('em');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return fieldErr('em', 'E-Mail eingeben, dann „Passwort vergessen?“');
      await post('/api/password/forgot', { email: em });
      toast('WENN DAS KONTO EXISTIERT, KOMMT GLEICH EINE MAIL MIT LINK');
    };
    el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => (b.onclick = () => { mode = b.dataset.mode as Mode; render(); }));
    el.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => (b.onclick = () => {
      faction = b.dataset.f as 'west' | 'east';
      el.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => {
      const e = el.querySelector(`#e-${i.id}`);
      if (e) e.textContent = '';
    }));
    el.querySelector<HTMLButtonElement>('#go')!.onclick = submit;
    el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && submit()));
  }

  const val = (id: string) => el.querySelector<HTMLInputElement>(`#${id}`)?.value.trim() ?? '';
  const fieldErr = (id: string, msg: string) => {
    const e = el.querySelector(`#e-${id}`);
    if (e) e.textContent = msg;
  };

  async function submit(): Promise<void> {
    const cs = val('cs');
    if (mode === 'guest') {
      if (cs && !/^[A-Za-z0-9_-]{3,12}$/.test(cs)) return fieldErr('cs', '3–12 Zeichen, nur Buchstaben, Ziffern, - und _');
      return onEnter(cs || 'Gast');
    }
    const em = val('em');
    const pw = el.querySelector<HTMLInputElement>('#pw')?.value ?? '';
    let bad = false;
    if (mode === 'register' && !/^[A-Za-z0-9_-]{3,16}$/.test(cs)) { fieldErr('cs', '3–16 Zeichen, nur Buchstaben, Ziffern, - und _'); bad = true; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { fieldErr('em', 'Gib eine gültige E-Mail-Adresse ein'); bad = true; }
    if (pw.length < 8) { fieldErr('pw', 'Mindestens 8 Zeichen'); bad = true; }
    if (bad) return;
    const r = mode === 'register'
      ? await post('/api/register', { callsign: cs, email: em, password: pw, faction })
      : await post('/api/login', { email: em, password: pw });
    if (!r.ok) return render(r.data.error ?? 'Fehler');
    if (mode === 'register') toast('BESTÄTIGUNGSLINK AN DEINE E-MAIL GESENDET');
    onEnter('');
  }

  render();
}
