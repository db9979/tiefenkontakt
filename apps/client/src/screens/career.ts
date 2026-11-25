import { net } from '../net.js';
import { esc, h } from '../widgets/format.js';
import { badgeShelf, rankingPanel } from './rankings.js';

interface Step {
  id: string;
  kind: 'lesson' | 'mission';
  title: string;
  lesson?: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd';
  mission?: 'groenland' | 'schelf' | 'fjord' | 'duell' | 'hafen';
  timeOfDay?: 'tag' | 'daemmerung' | 'nacht';
  done: boolean;
  unlocked: boolean;
}
interface Summary { callsign: string; points: number; matches: number; wins: number; kills: number; tonnage: number }

/** Service record, campaign and leaderboard below the lobby. Accounts only for record and campaign. */
export function careerPanels(): HTMLElement {
  const el = h(`<div class="grid2" style="margin-top:10px"><div class="panel" id="c-me"></div><div style="display:flex;flex-direction:column;gap:10px"><div class="panel" id="c-board"></div><div class="panel" id="c-balance"></div></div></div>`);
  const balance = el.querySelector<HTMLElement>('#c-balance')!;
  const MISSION: Record<string, string> = { groenland: 'Grönland', schelf: 'Schelf', fjord: 'Fjord' };
  const CLS: Record<string, string> = { ffg: 'Fregatte', kor: 'Korvette', ffk: 'Wachschiff', ssw: 'Jagd-U-Boot', ssk: 'Diesel-U-Boot', ssn: 'Atom-U-Boot', ssc: 'Küsten-U-Boot', ssa: 'AIP-U-Boot', ffv: 'VDS-Fregatte' };
  fetch('/api/balance').then(async (r) => {
    const b = (await r.json()) as { total: number; missions: { key: string; games: number; westWins: number; eastWins: number; avgMin: number }[]; classes: { key: string; games: number; wins: number }[] };
    const pct = (a: number, n: number) => (n ? Math.round((100 * a) / n) : 0);
    balance.innerHTML = `<div class="hd"><span>Balance</span><span class="dim">${b.total} PARTIEN · ALLE SPIELER UND KI</span></div>` +
      (b.total
        ? b.missions.map((m) => {
          const [mi, tod] = m.key.split('/');
          return `<div class="row"><span>${esc(MISSION[mi!] ?? mi!)} · ${esc(tod ?? '')}</span><span>WEST ${pct(m.westWins, m.games)} % · OST ${pct(m.eastWins, m.games)} % · Ø ${m.avgMin} MIN</span></div>`;
        }).join('') + b.classes.map((c) => `<div class="row dim"><span>${esc(CLS[c.key] ?? c.key)}</span><span>${c.games} PARTIEN · ${pct(c.wins, c.games)} % SIEGE</span></div>`).join('')
        : '<div class="dim">NOCH KEINE PARTIEN</div>');
  }).catch(() => undefined);
  const me = el.querySelector<HTMLElement>('#c-me')!;
  const board = el.querySelector<HTMLElement>('#c-board')!;

  fetch('/api/stats').then(async (r) => {
    if (!r.ok) {
      // Nothing to show for a guest: one line instead of an empty box
      me.innerHTML = '<div class="dim">DIENSTBUCH UND KAMPAGNE · NUR MIT KONTO: ERGEBNISSE, PUNKTE UND KAMPAGNE WERDEN GESPEICHERT</div>';
      me.style.padding = '4px 10px';
      me.style.alignSelf = 'start';
      return;
    }
    const d = (await r.json()) as { summary?: Summary; campaign: Step[]; rating?: number; badges?: { id: string; at: number }[] };
    const s = d.summary;
    me.innerHTML = `<div class="hd"><span>Dienstbuch · ${esc(s?.callsign ?? '')}</span><span>${s?.points ?? 0} PUNKTE · WERTUNG ${d.rating ?? 1000}</span></div>
      <div class="row"><span class="dim">PARTIEN / SIEGE</span><span>${s?.matches ?? 0} / ${s?.wins ?? 0}</span></div>
      <div class="row"><span class="dim">VERSENKT</span><span>${s?.kills ?? 0} SCHIFFE · ${Math.round((s?.tonnage ?? 0) / 1000)}K BRT</span></div>
      ${badgeShelf(d.badges ?? [])}
      <div class="hd" style="margin-top:8px"><span>Kampagne</span><span class="dim">${d.campaign.filter((c) => c.done).length}/${d.campaign.length}</span></div>
      ${d.campaign.map((c) => `<div class="row ${c.done ? 'dim' : c.unlocked ? '' : 'dim'}">
        <span>${c.done ? '✓' : c.unlocked ? '▸' : '·'} ${esc(c.title)}</span>
        ${c.unlocked && !c.done ? `<button data-step="${c.id}">Starten</button>` : ''}</div>`).join('')}`;
    me.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
      b.onclick = () => {
        const c = d.campaign.find((x) => x.id === b.dataset.step)!;
        if (c.kind === 'lesson' && c.lesson) net.send({ t: 'training', lesson: c.lesson });
        else if (c.mission) {
          net.send({ t: 'create_match', name: c.title.replace(/^Einsatz \d+: /, '') });
          // Same socket, processed in order: the settings apply to the match just created
          net.send({ t: 'settings', mission: c.mission, timeOfDay: c.timeOfDay });
        }
      };
    });
  }).catch(() => undefined);

  rankingPanel(board);
  return el;
}
