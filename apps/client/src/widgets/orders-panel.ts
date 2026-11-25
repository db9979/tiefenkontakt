import type { OrderView, Snapshot } from '@tk/shared';
import { audio } from '../audio.js';
import { lang } from '../i18n/index.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { esc, h, setHtml, tdeg3 } from './format.js';
import { onTap } from './touch.js';

/**
 * FLASH orders from fleet command: a side panel with every order read aboard (countdown,
 * status, how late it was read), a strip above the station with the most urgent open order
 * (in the page flow, so it never covers a panel's tabs; gone once the match is over), and the
 * teletype alarm when a new order comes in. Surface ships also see the team hunt
 * (datum and hunter-killer roles of the AI escorts) here.
 */

const mmss = (t: number) => {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const STATUS: Record<OrderView['status'], [string, string]> = {
  active: ['OFFEN', ''], done: ['ERFÜLLT', 'green'], missed: ['NICHT ERFÜLLT', 'red'],
};

/** Teletype-style FLASH alarm, spoken on top. */
function announce(o: OrderView): void {
  audio.flash();
  if (localStorage.getItem('tk_voice') === '0' || audio.muted || typeof speechSynthesis === 'undefined') return;
  const u = new SpeechSynthesisUtterance(lang === 'en' ? 'Flash signal from fleet command!' : 'Flash-Befehl der Führung!');
  u.lang = lang === 'en' ? 'en-GB' : 'de-DE';
  u.rate = 1.1;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

export function ordersPanel(openTab: () => void, host: HTMLElement): { el: HTMLElement; key: string; update(s: Snapshot): void; dispose(): void } {
  const el = h(`<div class="panel orders-panel">
    <div class="hd"><span>Befehle der Führung</span><span id="op-sum" class="dim"></span></div>
    <div id="op-list"></div>
    <div id="op-hunt"></div>
  </div>`);
  const banner = h(`<div class="flash-banner" title="Befehle der Führung öffnen"></div>`);
  const seen = new Set<string>();
  let first = true;
  let flashUntil = 0;
  const api = { el, key: '', update, dispose: () => banner.remove() };
  banner.onclick = () => openTab();
  onTap(el, '[data-exec]', (b) => net.send({ t: 'execute_order', id: b.dataset.exec! }));

  function update(s: Snapshot): void {
    const list = s.orders ?? [];
    // New orders: alarm and a flashing banner (not for orders already known after a reconnect)
    for (const o of list) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      if (!first && o.status === 'active') {
        announce(o);
        flashUntil = performance.now() + 6000;
      }
    }
    first = false;
    api.key = list.map((o) => `${o.id}${o.status}`).join('|');
    const open = list.filter((o) => o.status === 'active').length;
    setHtml(el.querySelector('#op-sum')!, list.length ? `${open}/${list.length} OFFEN` : '');
    const rows = [...list].reverse().map((o) => {
      const left = o.deadline - s.time;
      const [st, cls] = STATUS[o.status];
      const late = o.readAt - o.issuedAt > 120 ? `<span class="amber"> · ${mmss(o.readAt - o.issuedAt)} SPÄT GELESEN</span>` : '';
      const due = o.status === 'active' ? `<span class="${left < 300 ? 'red blink' : left < 900 ? 'amber' : ''}">NOCH ${mmss(left)}</span>` : `<span class="${cls}">${st}</span>`;
      const exec = o.canExecute ? `<div class="steps"><button data-exec="${esc(o.id)}" class="on" title="Kursänderung an den Kommodore weitergeben: der Konvoi dreht für zehn Minuten auf den befohlenen Kurs">An Kommodore: Kurs ${tdeg3(o.heading ?? 0)}</button></div>` : '';
      return `<div class="order-row ${o.status}"><div><b class="amber">FLASH</b> ${esc(o.text)}</div><div class="dim">${due}${late}</div>${exec}</div>`;
    });
    setHtml(el.querySelector('#op-list')!, rows.length ? rows.join('') : '<div class="dim">KEINE BEFEHLE · FÜHRUNG SCHWEIGT</div>');
    const hu = s.hunt;
    setHtml(el.querySelector('#op-hunt')!, hu ? `<div class="hd" style="margin-top:6px"><span>U-Jagd im Verband</span><span class="dim">DATALINK</span></div>` +
      (hu.datum ? `<div>DATUM <span class="amber">◇</span> ALTER ${mmss(s.time - hu.datum.t)} · GÜTE ${hu.datum.q}</div>` : '') +
      (hu.director ? `<div>KONTAKT HÄLT <b>${esc(hu.director)}</b> (AKTIV)</div>` : '') +
      (hu.attacker ? `<div>ANGRIFF <b>${esc(hu.attacker)}</b> (LAUTLOS)</div>` : '') : '');
    // Banner: the open order with the least time left
    const urgent = list.filter((o) => o.status === 'active').sort((a, b) => a.deadline - b.deadline)[0];
    if (urgent && s.own.alive && !store.ended) {
      const t = `FLASH · ${urgent.text} · NOCH ${mmss(urgent.deadline - s.time)}`;
      if (banner.textContent !== t) banner.textContent = t;
      banner.classList.toggle('blink', performance.now() < flashUntil);
      // Above the station, below the hint bar
      if (!banner.isConnected) host.insertBefore(banner, host.querySelector('.station'));
    } else banner.remove();
  }
  return api;
}
