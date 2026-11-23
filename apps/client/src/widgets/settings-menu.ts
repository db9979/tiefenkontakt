import { audio } from '../audio.js';
import { lang, setLang } from '../i18n/index.js';
import { store } from '../store.js';
import { h } from './format.js';
import { QUALITY_LABEL, quality, qualitySetting, setQuality, type QualitySetting } from './perf.js';
import { logout } from '../screens/logout.js';

/** Display preferences that apply outside a match too (font size, palette, red light). */
export function applyDisplayPrefs(): void {
  const scale = Number(localStorage.getItem('tk_font') ?? '1');
  document.documentElement.style.fontSize = `${12 * scale}px`;
  document.body.classList.toggle('cb', localStorage.getItem('tk_cb') === '1');
  document.body.classList.toggle('crt', localStorage.getItem('tk_crt') !== '0');
  document.body.classList.toggle('redlight', localStorage.getItem('tk_red') === '1');
  document.documentElement.dataset.theme = isLight() ? 'light' : 'dark';
  const tb = document.querySelector<HTMLButtonElement>('.themebtn');
  if (tb) {
    tb.textContent = isLight() ? '☾' : '☀';
    tb.title = isLight() ? 'Dunkler Modus' : 'Heller Modus';
  }
}

/** Light or dark interface (stored per browser). */
export const isLight = (): boolean => localStorage.getItem('tk_theme') === 'light';
export function setLight(on: boolean): void {
  localStorage.setItem('tk_theme', on ? 'light' : 'dark');
  applyDisplayPrefs();
}

/** ☀/☾ switch next to the language switch, on every screen. */
export function mountThemeButton(): void {
  if (document.querySelector('.themebtn')) return;
  const b = document.createElement('button');
  b.className = 'langbtn themebtn';
  b.onclick = () => setLight(!isLight());
  document.body.appendChild(b);
  applyDisplayPrefs();
}

type Toggle = { id: string; label: string; get(): boolean; set(on: boolean): void };

/** Gear menu in the top bar: every option in one place instead of a row of buttons. */
export function settingsMenu(opts: { onRealism(): void; onBriefing(): void; onKeys(): void }): { button: HTMLButtonElement; sync(): void } {
  const button = h<HTMLButtonElement>(`<button class="gear" title="Einstellungen">⚙</button>`);
  const panel = h(`<div class="menu-panel panel" style="display:none"></div>`);
  const flag = (key: string, def: boolean) => ({ get: () => (localStorage.getItem(key) ?? (def ? '1' : '0')) === '1', set: (on: boolean) => localStorage.setItem(key, on ? '1' : '0') });
  const toggles: Toggle[] = [
    { id: 'snd', label: 'Ton', get: () => !audio.muted, set: (on) => audio.setMuted(!on) },
    { id: 'voice', label: 'Sprachmeldungen', ...flag('tk_voice', true) },
    { id: 'engine', label: 'Maschinengeräusch', ...flag('tk_engine', true) },
    { id: 'assist', label: 'Nächster-Schritt-Hilfe', ...flag('tk_assist', true) },
    { id: 'real', label: 'Einsteiger-Modus', get: () => store.realism === 'einsteiger', set: (on) => { store.setRealism(on ? 'einsteiger' : 'profi'); opts.onRealism(); } },
    { id: 'crt', label: 'Röhren-Effekt', ...flag('tk_crt', true) },
    { id: 'red', label: 'Rotlicht (Nacht)', ...flag('tk_red', false) },
    { id: 'cb', label: 'Farbenblind-Palette', ...flag('tk_cb', false) },
    { id: 'light', label: 'Heller Modus', get: isLight, set: (on) => localStorage.setItem('tk_theme', on ? 'light' : 'dark') },
  ];
  const render = () => {
    const font = Number(localStorage.getItem('tk_font') ?? '1');
    panel.innerHTML = `<div class="hd"><span>Einstellungen</span></div>
      ${toggles.map((t) => `<label class="menu-row"><span>${t.label}</span><input type="checkbox" data-t="${t.id}" ${t.get() ? 'checked' : ''}></label>`).join('')}
      <div class="menu-row"><span>Lautstärke</span><input type="range" id="m-vol" min="0" max="1" step="0.05" value="${audio.volume}" style="width:110px"></div>
      <div class="menu-row"><span>Schriftgröße</span><span><button data-font="-1">A−</button> ${Math.round(font * 100)} % <button data-font="1">A+</button></span></div>
      <div class="menu-row" title="Auto: auf Handys und kleinen Rechnern sparsamer (Akku, Wärme)"><span>Grafik</span><button id="m-q">${QUALITY_LABEL[qualitySetting()]}${qualitySetting() === 'auto' ? ` · ${QUALITY_LABEL[quality()]}` : ''}</button></div>
      <div class="menu-row"><span>Sprache</span><button id="m-lang">${lang === 'de' ? 'English' : 'Deutsch'}</button></div>
      <div class="steps" style="margin-top:8px"><button id="m-brief">Lagebesprechung</button><button id="m-keys">Tasten</button></div>
      <div class="steps"><button id="m-logout" class="warn" title="Abmelden. In einer laufenden Partie wartet dein Schiff, bis du dich wieder anmeldest.">Abmelden</button></div>`;
  };
  panel.addEventListener('change', (e) => {
    const t = toggles.find((x) => x.id === (e.target as HTMLInputElement).dataset.t);
    if (!t) return;
    t.set((e.target as HTMLInputElement).checked);
    applyDisplayPrefs();
  });
  panel.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).id === 'm-vol') audio.setVolume(Number((e.target as HTMLInputElement).value));
  });
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.font) {
      const f = Math.min(1.5, Math.max(0.85, Number(localStorage.getItem('tk_font') ?? '1') + Number(b.dataset.font) * 0.1));
      localStorage.setItem('tk_font', f.toFixed(2));
      applyDisplayPrefs();
      render();
    } else if (b.id === 'm-q') {
      const order: QualitySetting[] = ['auto', 'niedrig', 'mittel', 'hoch'];
      setQuality(order[(order.indexOf(qualitySetting()) + 1) % order.length]!);
      render();
    } else if (b.id === 'm-lang') setLang(lang === 'de' ? 'en' : 'de');
    else if (b.id === 'm-brief') { close(); opts.onBriefing(); }
    else if (b.id === 'm-keys') { close(); opts.onKeys(); }
    else if (b.id === 'm-logout') {
      // Two taps: signing out mid-match is easy to hit by accident
      if (b.dataset.armed) void logout();
      else {
        b.dataset.armed = '1';
        b.textContent = 'Wirklich abmelden?';
        setTimeout(() => { delete b.dataset.armed; b.textContent = 'Abmelden'; }, 3000);
      }
    }
  });
  const close = () => {
    panel.style.display = 'none';
    window.removeEventListener('pointerdown', outside);
  };
  const outside = (e: PointerEvent) => {
    if (!panel.contains(e.target as Node) && e.target !== button) close();
  };
  button.onclick = () => {
    if (panel.style.display !== 'none') return close();
    render();
    panel.style.display = '';
    setTimeout(() => window.addEventListener('pointerdown', outside), 0);
  };
  document.body.appendChild(panel);
  const obs = new MutationObserver(() => {
    if (!button.isConnected) {
      panel.remove();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  return { button, sync: () => panel.style.display !== 'none' && render() };
}
