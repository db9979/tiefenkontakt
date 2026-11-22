import { net } from '../net.js';
import { esc, h } from '../widgets/format.js';
import { bindSortable, sortHead, sortRows, type SortState } from '../widgets/sortable.js';

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
  const CLS: Record<string, string> = { ffg: 'Fregatte', kor: 'Korvette', ssk: 'Diesel-U-Boot', ssn: 'Atom-U-Boot', ssc: 'Küsten-U-Boot' };
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
      me.innerHTML = '<div class="hd"><span>Dienstbuch und Kampagne</span></div><div class="dim">MIT KONTO WERDEN ERGEBNISSE, PUNKTE UND KAMPAGNE GESPEICHERT.</div>';
      return;
    }
    const d = (await r.json()) as { summary?: Summary; campaign: Step[]; rating?: number };
    const s = d.summary;
    me.innerHTML = `<div class="hd"><span>Dienstbuch · ${esc(s?.callsign ?? '')}</span><span>${s?.points ?? 0} PUNKTE · WERTUNG ${d.rating ?? 1000}</span></div>
      <div class="row"><span class="dim">PARTIEN / SIEGE</span><span>${s?.matches ?? 0} / ${s?.wins ?? 0}</span></div>
      <div class="row"><span class="dim">VERSENKT</span><span>${s?.kills ?? 0} SCHIFFE · ${Math.round((s?.tonnage ?? 0) / 1000)}K BRT</span></div>
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

  fetch('/api/leaderboard').then(async (r) => {
    const rows = (await r.json()) as Summary[];
    // Rank stays the points rank; columns re-sort the view
    const ranked = rows.map((x, i) => ({ ...x, rank: i + 1 }));
    const ID = 'leaderboard';
    const DEF: SortState = { key: 'rank', dir: 1 };
    const draw = () => {
      const view = sortRows(ranked, ID, DEF, {
        rank: (x) => x.rank, callsign: (x) => x.callsign.toLowerCase(), points: (x) => x.points, wins: (x) => x.wins,
        rate: (x) => (x.matches ? x.wins / x.matches : undefined), kills: (x) => x.kills, tonnage: (x) => x.tonnage,
      });
      const hd = (k: string, l: string) => sortHead(ID, k, l, DEF);
      board.innerHTML = `<div class="hd"><span>Rangliste</span><span class="dim">KLICK AUF SPALTE SORTIERT</span></div>` +
        (rows.length
          ? `<div class="row dim ltable">${hd('rank', '#')}${hd('callsign', 'RUFZ.')}${hd('points', 'PKT')}${hd('wins', 'SIEGE')}${hd('rate', 'QUOTE')}${hd('kills', 'VERS.')}${hd('tonnage', 'BRT')}</div>` +
            view.map((x) => `<div class="row ltable"><span>${x.rank}</span><span>${esc(x.callsign)}</span><span>${x.points}</span><span>${x.wins}/${x.matches}</span><span>${x.matches ? Math.round((100 * x.wins) / x.matches) + ' %' : '—'}</span><span>${x.kills}</span><span>${Math.round(x.tonnage / 1000)}K</span></div>`).join('')
          : '<div class="dim">NOCH KEINE ERGEBNISSE</div>');
    };
    const desc = { points: -1, wins: -1, rate: -1, kills: -1, tonnage: -1 } as const;
    bindSortable(board, ID, DEF, draw, { firstDir: desc });
    draw();
  }).catch(() => undefined);
  return el;
}
