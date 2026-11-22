import { BADGES, BADGE_BY_ID } from '@tk/shared';
import { esc } from '../widgets/format.js';
import { bindSortable, sortHead, sortRows, type SortState } from '../widgets/sortable.js';

interface Row { rank: number; callsign: string; points: number; matches: number; wins: number; kills: number; tonnage: number; badges: string[] }
interface SeasonInfo { id: string; start: number; end: number }
interface View {
  season: SeasonInfo | null;
  current: SeasonInfo;
  past: (SeasonInfo & { podium: { place: number; callsign: string; points: number }[] })[];
  rows: Row[];
}

/** Small badge symbols with name and description as tooltip (next to a callsign). */
export function badgeIcons(ids: string[]): string {
  const list = ids.map((id) => BADGE_BY_ID[id]).filter((b) => !!b);
  if (!list.length) return '';
  return ` <span class="badges">${list.map((b) => `<span class="badge" title="${esc(`${b!.name} · ${b!.desc}`)}">${esc(b!.symbol)}</span>`).join('')}</span>`;
}

/** Badge section for the service record: earned ones with name, the rest dimmed. */
export function badgeShelf(earned: { id: string; at: number }[]): string {
  const have = new Map(earned.map((e) => [e.id, e.at]));
  return `<div class="hd" style="margin-top:8px"><span>Abzeichen</span><span class="dim">${have.size}/${BADGES.length}</span></div>
    <div class="badgeshelf">${BADGES.map((b) => {
      const at = have.get(b.id);
      return `<span class="badgechip${at ? '' : ' dim'}" title="${esc(`${b.name} · ${b.desc}`)}"><span class="badge">${esc(at ? b.symbol : '·')}</span> ${esc(b.name)}</span>`;
    }).join('')}</div>`;
}

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Leaderboard with a season switcher (current season, all time, past seasons) and past podiums. */
export function rankingPanel(board: HTMLElement): void {
  const ID = 'leaderboard';
  const DEF: SortState = { key: 'rank', dir: 1 };
  let choice = sessionStorage.getItem('tk_season') ?? 'current';
  let view: View | undefined;

  const draw = () => {
    if (!view) return;
    const v = view;
    const rows = sortRows(v.rows, ID, DEF, {
      rank: (x) => x.rank, callsign: (x) => x.callsign.toLowerCase(), points: (x) => x.points, wins: (x) => x.wins,
      rate: (x) => (x.matches ? x.wins / x.matches : undefined), kills: (x) => x.kills, tonnage: (x) => x.tonnage,
    });
    const hd = (k: string, l: string) => sortHead(ID, k, l, DEF);
    const opts = [`<option value="current"${choice === 'current' ? ' selected' : ''}>SAISON ${esc(v.current.id)}</option>`,
      `<option value="all"${choice === 'all' ? ' selected' : ''}>GESAMT</option>`,
      ...v.past.map((p) => `<option value="${esc(p.id)}"${choice === p.id ? ' selected' : ''}>SAISON ${esc(p.id)}</option>`)].join('');
    const span = v.season ? `${day(v.season.start)} – ${day(v.season.end - 1)}` : 'ALLE PARTIEN';
    const podium = v.past.slice(0, 4).map((p) => `<div class="row dim"><span>SAISON ${esc(p.id)}</span><span>${p.podium.map((x) => `${x.place}. ${esc(x.callsign)} (${x.points})`).join(' · ')}</span></div>`).join('');
    board.innerHTML = `<div class="hd"><span>Rangliste</span><span class="dim"><select id="season" title="Saison wählen">${opts}</select></span></div>
      <div class="row dim"><span>${span}</span><span>KLICK AUF SPALTE SORTIERT</span></div>` +
      (rows.length
        ? `<div class="row dim ltable">${hd('rank', '#')}${hd('callsign', 'RUFZ.')}${hd('points', 'PKT')}${hd('wins', 'SIEGE')}${hd('rate', 'QUOTE')}${hd('kills', 'VERS.')}${hd('tonnage', 'BRT')}</div>` +
          rows.map((x) => `<div class="row ltable"><span>${x.rank}</span><span>${esc(x.callsign)}${badgeIcons(x.badges)}</span><span>${x.points}</span><span>${x.wins}/${x.matches}</span><span>${x.matches ? Math.round((100 * x.wins) / x.matches) + ' %' : '—'}</span><span>${x.kills}</span><span>${Math.round(x.tonnage / 1000)}K</span></div>`).join('')
        : '<div class="dim">NOCH KEINE ERGEBNISSE</div>') +
      `<div class="dim" style="margin-top:4px">Partien gegen eine reine KI-Seite zählen halb.</div>` +
      (podium ? `<div class="hd" style="margin-top:8px"><span>Frühere Saisons</span><span class="dim">PODEST</span></div>${podium}` : '');
    const sel = board.querySelector<HTMLSelectElement>('#season')!;
    sel.onchange = () => {
      choice = sel.value;
      sessionStorage.setItem('tk_season', choice);
      load();
    };
  };

  const load = () => {
    fetch(`/api/rankings?season=${encodeURIComponent(choice)}`).then(async (r) => {
      if (!r.ok && choice !== 'current') {
        choice = 'current';
        sessionStorage.removeItem('tk_season');
        return load();
      }
      view = (await r.json()) as View;
      draw();
    }).catch(() => undefined);
  };

  const desc = { points: -1, wins: -1, rate: -1, kills: -1, tonnage: -1 } as const;
  bindSortable(board, ID, DEF, draw, { firstDir: desc });
  load();
}
