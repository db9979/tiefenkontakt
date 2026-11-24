import { esc, h } from '../widgets/format.js';

/**
 * Moderator panel section: graphics performance of real devices, where players drop out, and
 * balance from real matches (GET /api/admin/insights). All anonymous aggregates.
 */

interface Insights {
  perf: { device: string; dpr: string; quality: string; setting: string; steppedDown: boolean; samples: number; avgMs: number; p95Ms: number; stutter: number }[];
  dropouts: {
    lobbyLeft: number;
    tutorials: { lesson: string; finished: number; left: { step: number; n: number }[] }[];
    matches: { finished: number; left: number; disconnects: number; byMinute: { from: number; to: number; n: number }[]; byClass: { team: string; cls: string; left: number; finished: number }[] };
  };
  balance: {
    total: number; pvp: number; pve: number; botsOnly: number;
    missions: { mission: string; group: string; side: string; games: number; wins: number }[];
    classes: { cls: string; group: string; side: string; crew: string; games: number; wins: number }[];
  };
}

const DEVICE: Record<string, string> = { phone: 'Telefon', tablet: 'Tablet', desktop: 'Rechner' };
const SIDE: Record<string, string> = { west: 'WEST', east: 'OST' };
const GROUP: Record<string, string> = { pvp: 'Mensch–Mensch', pve: 'Mensch–KI' };
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '–');
const table = (head: string[], rows: (string | number)[][]) => rows.length
  ? `<table class="dim" style="width:100%;border-collapse:collapse;font-size:12px"><tr>${head.map((x) => `<th style="text-align:left">${esc(x)}</th>`).join('')}</tr>
    ${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('')}</table>`
  : '<div class="dim">Noch keine Daten</div>';
const label = (t: string) => `<div class="dim" style="margin:8px 0 4px">${t}</div>`;

export function insightsHtml(o: Insights): string {
  const d = o.dropouts;
  const b = o.balance;
  return label('GRAFIKLEISTUNG (ECHTE GERÄTE, 3D-ANSICHTEN)') +
    table(['Gerät', 'DPR', 'Stufe', 'Einst.', 'Gesenkt', 'Proben', 'Ø ms', 'p95 ms', 'Ruckelt'],
      o.perf.map((p) => [DEVICE[p.device] ?? p.device, p.dpr, p.quality, p.setting === 'auto' ? 'Auto' : 'Hand', p.steppedDown ? 'ja' : '–', p.samples, p.avgMs, p.p95Ms, pct(p.stutter, 1)])) +
    label('AUSSTIEGE') +
    `<div class="row"><span>Lobby vor dem Start verlassen</span><span>${d.lobbyLeft}</span></div>
     <div class="row"><span>Partien zu Ende gespielt / verlassen (davon Verbindung weg)</span><span>${d.matches.finished} / ${d.matches.left} (${d.matches.disconnects})</span></div>` +
    table(['Ausbildung', 'Geschafft', 'Abgebrochen bei Schritt'],
      d.tutorials.map((t) => [t.lesson, t.finished, t.left.map((s) => `${s.step + 1}: ${s.n}`).join(' · ') || '–'])) +
    table(['Minute', 'Verlassen'], d.matches.byMinute.map((m) => [`${m.from}–${m.to}`, m.n])) +
    table(['Seite', 'Klasse', 'Verlassen', 'Zu Ende', 'Ausstiegsquote'],
      d.matches.byClass.map((c) => [SIDE[c.team] ?? c.team, c.cls.toUpperCase(), c.left, c.finished, pct(c.left, c.left + c.finished)])) +
    label(`BALANCE AUS ECHTEN PARTIEN · ${b.pvp} MENSCH–MENSCH · ${b.pve} MENSCH–KI · ${b.botsOnly} NUR KI (NICHT GEZÄHLT)`) +
    table(['Gruppe', 'Seite', 'Einsatz', 'Partien', 'Siege', 'Quote'],
      b.missions.map((m) => [GROUP[m.group] ?? m.group, SIDE[m.side] ?? m.side, m.mission, m.games, m.wins, pct(m.wins, m.games)])) +
    table(['Gruppe', 'Seite', 'Klasse', 'Crew', 'Partien', 'Siege', 'Quote'],
      b.classes.map((c) => [GROUP[c.group] ?? c.group, SIDE[c.side] ?? c.side, c.cls.toUpperCase(), c.crew === 'mensch' ? 'Mensch' : c.crew === 'ki' ? 'KI' : '?', c.games, c.wins, pct(c.wins, c.games)]));
}

/** Section element that (re)loads itself; append it to the moderator panel. */
export function insightsSection(): { el: HTMLElement; load(): Promise<void> } {
  const el = h('<div></div>');
  return {
    el,
    async load() {
      const r = await fetch('/api/admin/insights').catch(() => undefined);
      if (!r?.ok) return;
      el.innerHTML = insightsHtml((await r.json()) as Insights);
    },
  };
}
